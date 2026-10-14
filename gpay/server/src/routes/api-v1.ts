import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import { ApiError, type Ctx } from '../context.js';
import { createLink, serializeLink, type LinkRow } from '../domain/links.js';
import { isCurrency, parseAmount } from '../domain/money.js';
import {
  balances, cancelByMerchant, capturePayment, createPayment, createPayout, getShop, loadPayment, refundPayment,
  serializePayment, serializePayout, serializeRefund, shopMethods, type PaymentRow, type PayoutRow, type RefundRow, type ShopRow,
} from '../domain/payments.js';
import { cancelWithBank, captureWithBank, payoutToBank, refundWithBank } from '../domain/bankpay.js';
import { serializeReceipt } from '../domain/receipts.js';
import { sha256 } from '../util.js';

declare module 'fastify' {
  interface FastifyRequest {
    apiShop?: ShopRow;
    apiKeyId?: string;
    apiStarted?: number;
    apiResponse?: string;
  }
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** Bearer sk_live_… or Basic <shopId>:<secret>, as in common acquiring APIs. */
function authenticate(ctx: Ctx, req: FastifyRequest): { shop: ShopRow; keyId: string } {
  const h = req.headers.authorization ?? '';
  let secret = '';
  let shopId: number | null = null;
  if (h.startsWith('Bearer ')) secret = h.slice(7).trim();
  else if (h.startsWith('Basic ')) {
    const [login, pass] = Buffer.from(h.slice(6), 'base64').toString().split(':');
    shopId = Number(login);
    secret = pass ?? '';
  }
  if (!secret) throw new ApiError(401, 'invalid_credentials', 'Не передан секретный ключ. Используйте заголовок Authorization: Bearer sk_live_…');
  const key = ctx.db.prepare('SELECT id, shop_id FROM api_keys WHERE hash = ? AND revoked_at IS NULL').get(sha256(secret)) as { id: string; shop_id: number } | undefined;
  if (!key || (shopId !== null && key.shop_id !== shopId)) throw new ApiError(401, 'invalid_credentials', 'Неверный или отозванный секретный ключ');
  const shop = getShop(ctx, key.shop_id)!;
  if (shop.status !== 'active') throw new ApiError(403, 'forbidden', 'Магазин заблокирован');
  ctx.db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(ctx.now(), key.id);
  return { shop, keyId: key.id };
}

const shopOf = (req: FastifyRequest) => req.apiShop!;

function amountArg(v: unknown, parameter = 'amount'): { amount: number; currency: string } {
  const a = obj(v);
  if (!isCurrency(a.currency)) throw new ApiError(400, 'invalid_request', 'Валюта: RUB, USD или EUR', `${parameter}.currency`);
  return { amount: parseAmount(a.value, `${parameter}.value`), currency: a.currency };
}

function ownPayment(ctx: Ctx, req: FastifyRequest, id: string): PaymentRow {
  const p = loadPayment(ctx, id);
  if (!p || p.shop_id !== shopOf(req).id) throw new ApiError(404, 'not_found', 'Платёж не найден', 'payment_id');
  return p;
}

function pageArgs(q: Obj) {
  const limit = Math.min(Math.max(Number(q.limit ?? 20) || 20, 1), 100);
  const cursor = str(q.cursor);
  const [cTs, cId] = cursor ? Buffer.from(cursor, 'base64url').toString().split('|') : [];
  return { limit, cTs: cTs ? Number(cTs) : null, cId: cId ?? null };
}

function page<T extends { id: string; created_at: number }>(rows: T[], limit: number, map: (r: T) => unknown) {
  const more = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { type: 'list', items: items.map(map), next_cursor: more && last ? Buffer.from(`${last.created_at}|${last.id}`).toString('base64url') : undefined };
}

export function registerApiV1(app: FastifyInstance, ctx: Ctx) {
  app.register(async (api) => {
    api.addHook('onRequest', async (req) => {
      req.apiStarted = Date.now();
      const { shop, keyId } = authenticate(ctx, req);
      req.apiShop = shop;
      req.apiKeyId = keyId;
    });
    api.addHook('onSend', async (req, _reply, payload) => {
      if (typeof payload === 'string') req.apiResponse = payload;
      return payload;
    });
    api.addHook('onResponse', async (req, reply) => {
      if (!req.apiShop) return;
      ctx.db
        .prepare('INSERT INTO api_requests(shop_id, key_id, method, path, status, ms, idem_key, req_body, res_body, ip, ts) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(req.apiShop.id, req.apiKeyId ?? null, req.method, req.url.slice(0, 300), reply.statusCode, Date.now() - (req.apiStarted ?? Date.now()), String(req.headers['idempotence-key'] ?? '') || null, req.body ? JSON.stringify(req.body).slice(0, 4000) : null, (req.apiResponse ?? '').slice(0, 4000), req.ip, ctx.now());
      ctx.db.prepare('DELETE FROM api_requests WHERE shop_id = ? AND id <= (SELECT id FROM api_requests WHERE shop_id = ? ORDER BY id DESC LIMIT 1 OFFSET 500)').run(req.apiShop.id, req.apiShop.id);
    });

    /** Replays the stored response for a repeated Idempotence-Key. */
    async function idempotent(req: FastifyRequest, reply: FastifyReply, endpoint: string, fn: () => unknown | Promise<unknown>) {
      const key = String(req.headers['idempotence-key'] ?? '');
      if (!key) throw new ApiError(400, 'invalid_request', 'Не передан заголовок Idempotence-Key', 'Idempotence-Key');
      if (key.length > 64) throw new ApiError(400, 'invalid_request', 'Idempotence-Key: не длиннее 64 символов', 'Idempotence-Key');
      const shop = shopOf(req);
      const reqHash = sha256(`${endpoint}|${JSON.stringify(req.body ?? null)}`);
      const prev = ctx.db.prepare('SELECT endpoint, req_hash, status, response FROM idempotency WHERE shop_id = ? AND key = ?').get(shop.id, key) as { endpoint: string; req_hash: string; status: number; response: string } | undefined;
      if (prev) {
        if (prev.req_hash !== reqHash) throw new ApiError(400, 'invalid_request', 'Idempotence-Key уже использован с другими параметрами запроса', 'Idempotence-Key');
        return reply.code(prev.status).header('content-type', 'application/json; charset=utf-8').send(prev.response);
      }
      let status = 200;
      let body: unknown;
      try {
        body = await fn();
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        status = e.statusCode;
        body = apiErrorBody(e);
      }
      const response = JSON.stringify(body);
      ctx.db.prepare('INSERT INTO idempotency(shop_id, key, endpoint, req_hash, status, response, created_at) VALUES(?,?,?,?,?,?,?)').run(shop.id, key, endpoint, reqHash, status, response, ctx.now());
      return reply.code(status).header('content-type', 'application/json; charset=utf-8').send(response);
    }

    api.get('/me', async (req) => {
      const s = shopOf(req);
      return {
        account_id: String(s.id),
        name: s.name,
        status: s.status === 'active' ? 'enabled' : 'disabled',
        test: false,
        fiscalization_enabled: true,
        payment_methods: shopMethods(s),
        balances: balances(ctx, s.id).map((b) => ({ currency: b.currency, available: (b.available / 100).toFixed(2) })),
      };
    });

    // ---------- Payments ----------
    api.post('/payments', async (req, reply) =>
      idempotent(req, reply, 'POST /payments', () => {
        const b = obj(req.body);
        const { amount, currency } = amountArg(b.amount);
        const conf = obj(b.confirmation);
        if (b.confirmation !== undefined && conf.type !== 'redirect' && conf.type !== 'embedded') throw new ApiError(400, 'invalid_request', 'confirmation.type: redirect или embedded', 'confirmation.type');
        const p = createPayment(ctx, shopOf(req), {
          amount,
          currency,
          description: str(b.description),
          capture: b.capture !== false,
          returnUrl: str(conf.return_url),
          metadata: b.metadata as Record<string, string> | undefined,
          receipt: b.receipt,
          customerEmail: str(obj(b.customer).email),
          source: 'api',
        });
        return serializePayment(ctx, p);
      }),
    );

    api.get('/payments', async (req) => {
      const q = obj(req.query);
      const { limit, cTs, cId } = pageArgs(q);
      const status = str(q.status);
      const rows = ctx.db
        .prepare(
          `SELECT * FROM payments WHERE shop_id = @shop AND (@status IS NULL OR status = @status)
           AND (@cTs IS NULL OR created_at < @cTs OR (created_at = @cTs AND id < @cId)) ORDER BY created_at DESC, id DESC LIMIT @lim`,
        )
        .all({ shop: shopOf(req).id, status: status ?? null, cTs, cId, lim: limit + 1 }) as PaymentRow[];
      return page(rows, limit, (p) => serializePayment(ctx, p));
    });

    api.get<{ Params: { id: string } }>('/payments/:id', async (req) => serializePayment(ctx, ownPayment(ctx, req, req.params.id)));

    api.post<{ Params: { id: string } }>('/payments/:id/capture', async (req, reply) =>
      idempotent(req, reply, `POST /payments/${req.params.id}/capture`, async () => {
        const p = ownPayment(ctx, req, req.params.id);
        const b = obj(req.body);
        let amount: number | undefined;
        if (b.amount !== undefined) {
          const a = amountArg(b.amount);
          if (a.currency !== p.currency) throw new ApiError(400, 'invalid_request', 'Валюта не совпадает с валютой платежа', 'amount.currency');
          amount = a.amount;
        }
        return serializePayment(ctx, await captureWithBank(ctx, shopOf(req), p, amount));
      }),
    );

    api.post<{ Params: { id: string } }>('/payments/:id/cancel', async (req, reply) =>
      idempotent(req, reply, `POST /payments/${req.params.id}/cancel`, async () => serializePayment(ctx, await cancelWithBank(ctx, ownPayment(ctx, req, req.params.id)))),
    );

    // ---------- Refunds ----------
    api.post('/refunds', async (req, reply) =>
      idempotent(req, reply, 'POST /refunds', async () => {
        const b = obj(req.body);
        const pid = str(b.payment_id);
        if (!pid) throw new ApiError(400, 'invalid_request', 'Не указан payment_id', 'payment_id');
        const p = ownPayment(ctx, req, pid);
        let amount: number | undefined;
        if (b.amount !== undefined) {
          const a = amountArg(b.amount);
          if (a.currency !== p.currency) throw new ApiError(400, 'invalid_request', 'Валюта не совпадает с валютой платежа', 'amount.currency');
          amount = a.amount;
        }
        return serializeRefund(await refundWithBank(ctx, shopOf(req), p, amount, str(b.description) ?? ''));
      }),
    );

    api.get('/refunds', async (req) => {
      const q = obj(req.query);
      const { limit, cTs, cId } = pageArgs(q);
      const rows = ctx.db
        .prepare(
          `SELECT * FROM refunds WHERE shop_id = @shop AND (@pid IS NULL OR payment_id = @pid)
           AND (@cTs IS NULL OR created_at < @cTs OR (created_at = @cTs AND id < @cId)) ORDER BY created_at DESC, id DESC LIMIT @lim`,
        )
        .all({ shop: shopOf(req).id, pid: str(q.payment_id) ?? null, cTs, cId, lim: limit + 1 }) as RefundRow[];
      return page(rows, limit, serializeRefund);
    });

    api.get<{ Params: { id: string } }>('/refunds/:id', async (req) => {
      const r = ctx.db.prepare('SELECT * FROM refunds WHERE id = ? AND shop_id = ?').get(req.params.id, shopOf(req).id) as RefundRow | undefined;
      if (!r) throw new ApiError(404, 'not_found', 'Возврат не найден');
      return serializeRefund(r);
    });

    // ---------- Receipts ----------
    api.get('/receipts', async (req) => {
      const q = obj(req.query);
      const rows = ctx.db
        .prepare('SELECT * FROM receipts WHERE shop_id = @shop AND (@pid IS NULL OR payment_id = @pid) AND (@rid IS NULL OR refund_id = @rid) ORDER BY created_at DESC LIMIT 100')
        .all({ shop: shopOf(req).id, pid: str(q.payment_id) ?? null, rid: str(q.refund_id) ?? null }) as { id: string; payment_id: string; refund_id: string | null; type: string; data: string; created_at: number }[];
      return { type: 'list', items: rows.map((r) => serializeReceipt(r, ctx.cfg.publicUrl)) };
    });

    api.get<{ Params: { id: string } }>('/receipts/:id', async (req) => {
      const r = ctx.db.prepare('SELECT * FROM receipts WHERE id = ? AND shop_id = ?').get(req.params.id, shopOf(req).id) as { id: string; payment_id: string; refund_id: string | null; type: string; data: string; created_at: number } | undefined;
      if (!r) throw new ApiError(404, 'not_found', 'Чек не найден');
      return serializeReceipt(r, ctx.cfg.publicUrl);
    });

    // ---------- Payment links ----------
    api.post('/payment_links', async (req, reply) =>
      idempotent(req, reply, 'POST /payment_links', () => {
        const b = obj(req.body);
        const currency = str(b.currency) ?? str(obj(b.amount).currency) ?? 'RUB';
        const fixed = b.amount !== undefined ? amountArg(b.amount) : null;
        const min = b.min_amount !== undefined ? amountArg(b.min_amount, 'min_amount').amount : null;
        const max = b.max_amount !== undefined ? amountArg(b.max_amount, 'max_amount').amount : null;
        const exp = str(b.expires_at) ? Date.parse(str(b.expires_at)!) : null;
        if (exp !== null && Number.isNaN(exp)) throw new ApiError(400, 'invalid_request', 'expires_at: дата в формате ISO 8601', 'expires_at');
        const l = createLink(ctx, shopOf(req), {
          kind: b.type === 'invoice' ? 'invoice' : 'link',
          title: str(b.title) ?? '',
          description: str(b.description),
          amount: fixed?.amount ?? null,
          minAmount: min,
          maxAmount: max,
          currency: fixed?.currency ?? currency,
          reusable: b.reusable !== false,
          expiresAt: exp,
          receipt: b.receipt,
          customer: b.customer as { email?: string; name?: string } | undefined,
        });
        return serializeLink(ctx, l);
      }),
    );

    api.get('/payment_links', async (req) => {
      const rows = ctx.db.prepare('SELECT * FROM payment_links WHERE shop_id = ? ORDER BY created_at DESC LIMIT 100').all(shopOf(req).id) as LinkRow[];
      return { type: 'list', items: rows.map((l) => serializeLink(ctx, l)) };
    });

    api.get<{ Params: { id: string } }>('/payment_links/:id', async (req) => {
      const l = ctx.db.prepare('SELECT * FROM payment_links WHERE id = ? AND shop_id = ?').get(req.params.id, shopOf(req).id) as LinkRow | undefined;
      if (!l) throw new ApiError(404, 'not_found', 'Ссылка не найдена');
      return serializeLink(ctx, l);
    });

    // ---------- Payouts ----------
    api.post('/payouts', async (req, reply) =>
      idempotent(req, reply, 'POST /payouts', async () => {
        const b = obj(req.body);
        const { amount, currency } = amountArg(b.amount);
        const dest = obj(b.payout_destination);
        // Bobobank money goes to the account linked in the shop settings.
        if (dest.type === 'bobobank') return serializePayout(await payoutToBank(ctx, shopOf(req), amount, currency));
        const card = String(dest.card_last4 ?? '').replace(/\D/g, '').slice(-4);
        if (card.length !== 4) throw new ApiError(400, 'invalid_request', 'payout_destination.card_last4: последние 4 цифры карты', 'payout_destination');
        return serializePayout(createPayout(ctx, shopOf(req), amount, currency, { type: 'bank_card', card_last4: card }));
      }),
    );

    api.get('/payouts', async (req) => {
      const rows = ctx.db.prepare('SELECT * FROM payouts WHERE shop_id = ? ORDER BY created_at DESC LIMIT 100').all(shopOf(req).id) as PayoutRow[];
      return { type: 'list', items: rows.map(serializePayout) };
    });

    api.all('/*', async () => {
      throw new ApiError(404, 'not_found', 'Метод API не найден. Документация: /docs');
    });
  }, { prefix: '/api/v1' });
}

export function apiErrorBody(e: ApiError) {
  return { type: 'error', id: crypto.randomUUID(), code: e.code, description: e.message, parameter: e.parameter };
}
