import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { setTurnover } from '../domain/market.js';
import { HttpError, type Ctx } from '../context.js';
import { authorize, capture, cardHashes, getAuthorization, refund, serializeAuthorization, voidAuthorization } from '../domain/acquiring.js';
import { categoryOfMcc } from '../domain/bank.js';
import { createRequest, getRequest } from '../domain/orders.js';
import { BINS, findCardByPan } from '../domain/cards.js';
import { convertCustomer, fxLegs, getFx } from '../domain/fx.js';
import { getAccount, notify, post, systemAccount, type AccountRow } from '../domain/ledger.js';
import { CURRENCIES, humanMoney } from '../domain/money.js';
import { verify, SIGNATURE_HEADER } from '../domain/signing.js';
import { getUser } from '../domain/transfers.js';
import { sha256 } from '../util.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

const minor = z.number().int().positive().max(100_000_000_000);

/** API for GPAY only: card authorizations, refunds, payouts and shop linking. Every call is HMAC-signed. */
export function registerInternalRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/internal/')) return;
    if (!ctx.cfg.gpaySecret) return reply.code(503).send({ error: 'Интеграция с GPAY не настроена' });
  });
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/internal/')) return;
    const path = req.url.split('?')[0];
    if (!verify(ctx.cfg.gpaySecret, req.headers[SIGNATURE_HEADER] as string | undefined, req.method, path, req.rawBody ?? '', Math.floor(ctx.now() / 1000))) {
      return reply.code(401).send({ error: 'Неверная подпись запроса' });
    }
  });

  /** Replays the stored response for a repeated Idempotence-Key (network retries from GPAY). */
  const idempotent = (handler: (req: FastifyRequest) => unknown) => async (req: FastifyRequest, reply: FastifyReply) => {
    const key = req.headers['idempotence-key'] as string | undefined;
    if (key) {
      const prev = db.prepare('SELECT status, response FROM idempotency WHERE key = ?').get(`${req.url}:${key}`) as { status: number; response: string } | undefined;
      if (prev) return reply.code(prev.status).send(JSON.parse(prev.response));
    }
    let status = 200;
    let body: unknown;
    try {
      body = await handler(req);
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      status = e.statusCode;
      body = { error: e.message, code: e.code };
    }
    if (key) db.prepare('INSERT OR REPLACE INTO idempotency(key, status, response, created_at) VALUES(?,?,?,?)').run(`${req.url}:${key}`, status, JSON.stringify(body), ctx.now());
    return reply.code(status).send(body);
  };

  app.get('/internal/v1/cards', async () => ({ hashes: cardHashes(ctx), bins: Object.values(BINS) }));

  const authorizeBody = z.object({
    pan: z.string().regex(/^\d{12,19}$/),
    exp_month: z.number().int().min(1).max(12),
    exp_year: z.number().int().min(0).max(9999),
    cvc: z.string().regex(/^\d{3,4}$/),
    amount: minor,
    currency: z.enum(CURRENCIES),
    capture: z.boolean(),
    payment_id: z.string().min(1).max(64),
    merchant: z.object({ name: z.string().min(1).max(120), shop_id: z.number().int().optional(), mcc: z.number().int().optional(), inn: z.string().max(12).optional(), site: z.string().max(200).optional() }),
  });
  app.post('/internal/v1/authorize', idempotent((req) => {
    const b = authorizeBody.parse(req.body);
    return authorize(ctx, { pan: b.pan, expMonth: b.exp_month, expYear: b.exp_year, cvc: b.cvc, amount: b.amount, currency: b.currency, capture: b.capture, externalId: b.payment_id, merchant: { name: b.merchant.name, shopId: b.merchant.shop_id, mcc: b.merchant.mcc, inn: b.merchant.inn, site: b.merchant.site } });
  }));

  const authById = (req: FastifyRequest) => {
    const a = getAuthorization(ctx, (req.params as { id: string }).id);
    if (!a) throw new HttpError(404, 'Авторизация не найдена');
    return a;
  };

  app.get('/internal/v1/authorizations/:id', async (req) => {
    const a = authById(req);
    const s = serializeAuthorization(ctx, a);
    return { id: s.id, status: s.status, reason: a.reason, expires_at: a.expires_at };
  });

  app.post('/internal/v1/authorizations/:id/capture', idempotent((req) => {
    const a = authById(req);
    const { amount } = z.object({ amount: minor.optional() }).parse(req.body ?? {});
    const r = capture(ctx, a.id, amount ?? a.amount);
    return { id: r.id, status: r.status };
  }));

  app.post('/internal/v1/authorizations/:id/void', idempotent((req) => {
    const r = voidAuthorization(ctx, authById(req).id);
    return { id: r.id, status: r.status };
  }));

  app.post('/internal/v1/authorizations/:id/refund', idempotent((req) => {
    const a = authById(req);
    const { amount, refund_id } = z.object({ amount: minor, refund_id: z.string().max(64) }).parse(req.body);
    const r = refund(ctx, a.id, amount, refund_id);
    return { id: r.id, refunded: r.refunded };
  }));

  // Bobo Pay by phone: GPAY asks the customer to confirm the order in the app.
  app.post('/internal/v1/requests', idempotent((req) => {
    const b = z
      .object({
        phone: z.string().max(30),
        payment_id: z.string().max(64),
        amount: minor,
        currency: z.enum(CURRENCIES),
        description: z.string().max(200).default(''),
        merchant: z.object({ name: z.string().max(120), shop_id: z.number().int(), mcc: z.number().int().optional(), inn: z.string().max(12).optional(), site: z.string().max(200).optional() }),
      })
      .parse(req.body);
    const r = createRequest(ctx, { phone: b.phone, paymentId: b.payment_id, amount: b.amount, currency: b.currency, merchant: b.merchant, description: b.description });
    return { id: r.id, status: r.status, expires_at: r.expires_at };
  }));

  app.get('/internal/v1/requests/:id', async (req) => {
    const r = getRequest(ctx, (req.params as { id: string }).id);
    if (!r) throw new HttpError(404, 'Запрос не найден');
    return { id: r.id, status: r.expires_at <= ctx.now() && r.status === 'pending' ? 'expired' : r.status };
  });

  // Refund of an order the customer paid from the app (SBP or Bobo Pay): back to the same account.
  app.post('/internal/v1/sbp/:paymentId/refund', idempotent((req) => {
    const { amount, refund_id } = z.object({ amount: minor, refund_id: z.string().max(64) }).parse(req.body);
    const sp = db.prepare(`SELECT * FROM sbp_payments WHERE external_id = ? AND status = 'succeeded'`).get((req.params as { paymentId: string }).paymentId) as
      | { id: string; user_id: string; account_id: string; amount: number; currency: string; merchant: string; refunded?: number }
      | undefined;
    if (!sp) throw new HttpError(404, 'Оплата из приложения банка не найдена');
    const done = (db.prepare(`SELECT COALESCE(SUM(json_extract(meta, '$.amount')), 0) s FROM transactions WHERE kind = 'sbp_refund' AND json_extract(meta, '$.paymentId') = ?`).get(sp.id) as { s: number }).s;
    if (done + amount > sp.amount) throw new HttpError(400, 'Сумма возврата больше суммы оплаты');
    let acc = getAccount(ctx, sp.account_id)!;
    if (acc.status !== 'open') acc = db.prepare(`SELECT * FROM accounts WHERE user_id = ? AND kind = 'current' AND currency = ? AND status = 'open' LIMIT 1`).get(sp.user_id, sp.currency) as AccountRow;
    const m = JSON.parse(sp.merchant) as { name: string; mcc?: number };
    const txId = post(ctx, {
      kind: 'sbp_refund',
      description: `Возврат от ${m.name}`,
      meta: { paymentId: sp.id, refundId: refund_id, amount },
      legs: [
        { account: systemAccount(ctx, 'gpay', sp.currency), amount: -amount },
        { account: acc, amount, title: m.name, subtitle: 'Возврат оплаты', category: categoryOfMcc(m.mcc) },
      ],
    });
    notify(ctx, sp.user_id, 'refund', `Возврат ${humanMoney(amount, sp.currency)}`, `${m.name} вернул деньги`);
    return { status: 'succeeded', transaction_id: txId };
  }));

  // Payout of shop revenue to a Bobobank account or card.
  const creditBody = z.object({
    destination: z.union([z.object({ type: z.literal('account'), number: z.string().regex(/^\d{20}$/) }), z.object({ type: z.literal('card'), pan: z.string().regex(/^\d{12,19}$/) })]),
    amount: minor,
    currency: z.enum(CURRENCIES),
    payout_id: z.string().max(64),
    shop: z.object({ id: z.number().int(), name: z.string().max(120) }),
  });
  app.post('/internal/v1/credits', idempotent((req) => {
    const b = creditBody.parse(req.body);
    let acc: AccountRow | undefined;
    let viaCard = '';
    if (b.destination.type === 'account') {
      acc = db.prepare('SELECT * FROM accounts WHERE number = ? AND user_id IS NOT NULL').get(b.destination.number) as AccountRow | undefined;
    } else {
      const card = findCardByPan(ctx, b.destination.pan);
      if (card && card.status !== 'closed') {
        acc = getAccount(ctx, card.account_id);
        viaCard = ` · карта •• ${card.last4}`;
      }
    }
    if (!acc || acc.status !== 'open') throw new HttpError(404, 'Счёт получателя не найден или закрыт');
    if (['loan', 'deposit'].includes(acc.kind)) throw new HttpError(400, 'На этот счёт нельзя зачислить выплату');
    const credited = acc.currency === b.currency ? b.amount : convertCustomer(getFx(db), b.amount, b.currency, acc.currency).result;
    const txId = post(ctx, {
      kind: 'gpay_payout',
      description: `Выплата GPAY: ${b.shop.name}`,
      meta: { payoutId: b.payout_id, shop: b.shop },
      legs: [
        { account: systemAccount(ctx, 'gpay', b.currency), amount: -b.amount },
        ...fxLegs(ctx, b.currency, b.amount, acc.currency, credited),
        { account: acc, amount: credited, title: 'GPAY', subtitle: `Выплата выручки «${b.shop.name}»${viaCard}`, category: 'income' },
      ],
    });
    notify(ctx, acc.user_id!, 'income', `+${humanMoney(credited, acc.currency)}`, `Выплата из GPAY: ${b.shop.name}`);
    return { status: 'succeeded', transaction_id: txId, account: { number: acc.number } };
  }));

  // A shop owner enters the code from the bank app in GPAY; we tell GPAY which account it is.
  // GPAY turnover for the stock market: GPAY's own share price and the prices of shops that went public.
  app.post('/internal/v1/market/turnover', async (req) => {
    const b = z
      .object({ total30: z.number().int().min(0), shops: z.array(z.object({ id: z.number().int(), name: z.string().max(120), t30: z.number().int().min(0) })).max(10_000) })
      .parse(req.body);
    setTurnover(ctx, { total30: b.total30, shops: Object.fromEntries(b.shops.map((s) => [String(s.id), { name: s.name, t30: s.t30 }])) });
    return { ok: true };
  });

  app.post('/internal/v1/links/claim', idempotent((req) => {
    const b = z.object({ code: z.string().regex(/^\d{4}-?\d{4}$/), shop_id: z.number().int(), shop_name: z.string().max(120) }).parse(req.body);
    const code = b.code.includes('-') ? b.code : `${b.code.slice(0, 4)}-${b.code.slice(4)}`;
    const row = db.prepare('SELECT * FROM gpay_links WHERE code_hash = ?').get(sha256(code)) as { id: string; account_id: string; expires_at: number; used_at: number | null } | undefined;
    if (!row || row.used_at || row.expires_at < ctx.now()) throw new HttpError(400, 'Код не найден или устарел. Получите новый в приложении Bobobank.');
    const acc = getAccount(ctx, row.account_id)!;
    if (acc.status !== 'open') throw new HttpError(400, 'Счёт закрыт');
    db.prepare('UPDATE gpay_links SET used_at = ?, shop_id = ?, shop_name = ? WHERE id = ?').run(ctx.now(), b.shop_id, b.shop_name, row.id);
    const holder = acc.kind === 'business' ? acc.name : getUser(ctx, acc.user_id!)!.name;
    notify(ctx, acc.user_id!, 'gpay', 'Магазин GPAY подключён', `Выручка «${b.shop_name}» будет поступать на счёт •• ${acc.number.slice(-4)}`);
    return { account: { number: acc.number, name: acc.name, holder, currency: acc.currency } };
  }));

  app.get('/internal/v1/health', async () => ({ ok: true }));
}
