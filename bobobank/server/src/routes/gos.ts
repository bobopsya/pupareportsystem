import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { audit, HttpError, type Ctx } from '../context.js';
import {
  EXCHANGE_SPREAD, exchangeCoins, exchangeQuote, gosEnabled, gosRpc, gosUser, kycStatus, payFine, refreshPerson, treasuryAccount, userByGosUid, verifyGosToken,
  type GosFine, type GosPerson, type GosSettings,
} from '../domain/gos.js';
import { ownedAccount, serializeAccount, userAccounts } from '../domain/ledger.js';
import { ENTRY_SELECT, serializeEntry, type EntryRow } from './client.js';

const MONTH = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

/** In-app pages: fines from Бобуслуги, coin exchange, the president's treasury. */
export function registerGosRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;
  const enabled = () => {
    if (!gosEnabled(ctx)) throw new HttpError(503, 'Бобуслуги не подключены к банку');
  };
  const safeReturn = (r: unknown) => (typeof r === 'string' && r.startsWith(`${ctx.cfg.gosPublicUrl}/`) ? r : null);

  app.get('/api/gos/fines/:id', async (req) => {
    requireUser(req);
    enabled();
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'Штраф не найден');
    const f = await gosRpc<GosFine>(ctx, 'svc_fine', { p_id: id }).catch(() => {
      throw new HttpError(404, 'Штраф не найден на Бобуслугах');
    });
    return { fine: { id: f.id, amount: f.amount, amountRub: f.amount_rub, reason: f.reason, kind: f.kind, status: f.status, country: f.country_name, payer: f.display_name, login: f.login } };
  });

  app.post('/api/gos/fines/:id/pay', async (req) => {
    const u = requireUser(req);
    enabled();
    const b = z.object({ accountId: z.string(), return: z.string().max(500).optional() }).parse(req.body);
    const id = Number((req.params as { id: string }).id);
    const r = await payFine(ctx, u.id, ownedAccount(ctx, u.id, b.accountId), id);
    audit(ctx, req, 'gos_fine_pay', 'fine', String(id));
    return { ok: true, entryId: r.entryId, returnUrl: safeReturn(b.return) };
  });

  app.get('/api/gos/exchange', async (req) => {
    const u = requireUser(req);
    enabled();
    const k = kycStatus(ctx, u.id);
    if (!k.linked) return { linked: false };
    const [s, p] = await Promise.all([gosRpc<GosSettings>(ctx, 'svc_settings'), refreshPerson(ctx, u.id)]);
    return { linked: true, rate: s.psy_rub_rate, spread: EXCHANGE_SPREAD, coins: p?.balance ?? 0, buy: exchangeQuote(s.psy_rub_rate, 1, 'to_psy'), sell: exchangeQuote(s.psy_rub_rate, 1, 'to_rub') };
  });

  app.post('/api/gos/exchange', async (req) => {
    const u = requireUser(req);
    enabled();
    const b = z.object({ accountId: z.string(), coins: z.number().int(), direction: z.enum(['to_rub', 'to_psy']) }).parse(req.body);
    const r = await exchangeCoins(ctx, u.id, ownedAccount(ctx, u.id, b.accountId), b.coins, b.direction);
    audit(ctx, req, 'psy_exchange', 'exchange', r.id, `${b.direction} ${b.coins}`);
    return r;
  });

  app.get('/api/gos/businesses', async (req) => {
    const u = requireUser(req);
    enabled();
    const p = await refreshPerson(ctx, u.id);
    if (!p) return { linked: false, businesses: [] };
    const used = new Set(userAccounts(ctx, u.id).map((a) => (JSON.parse(a.params || '{}') as { gosBusinessId?: number }).gosBusinessId).filter(Boolean));
    return { linked: true, businesses: p.businesses.map((x) => ({ ...x, hasAccount: used.has(x.id) })) };
  });

  // The president of a country sees its treasury account in the bank.
  app.get('/api/treasury', async (req) => {
    const u = requireUser(req);
    enabled();
    const g = gosUser(ctx, u.id);
    if (g?.gos_role !== 'president' || !g.gos_country) throw new HttpError(403, 'Казна видна только президенту страны');
    const s = await gosRpc<GosSettings>(ctx, 'svc_settings');
    const name = s.countries.find((c) => c.code === g.gos_country)?.name;
    const acc = treasuryAccount(ctx, g.gos_country, name);
    const entries = (db.prepare(`${ENTRY_SELECT} WHERE e.account_id = ? ORDER BY e.id DESC LIMIT 100`).all(acc.id) as EntryRow[]).map(serializeEntry);
    return { country: { code: g.gos_country, name }, account: serializeAccount(ctx, acc), entries };
  });
}

/**
 * API for Бобуслуги pages (another origin): CORS for that origin only, a Supabase access token instead of cookies.
 * Read-only: accounts, statements and income certificates of the customer linked to that Бобуслуги account.
 */
export function registerGosApi(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;
  const cors = (req: FastifyRequest, reply: FastifyReply) => {
    const origin = req.headers.origin;
    if (origin && gosEnabled(ctx) && origin === new URL(ctx.cfg.gosPublicUrl).origin) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Allow-Headers', 'authorization, content-type');
      reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
      reply.header('Access-Control-Max-Age', '600');
    }
    reply.header('Vary', 'Origin');
  };

  app.options('/api/gos/v1/*', async (req, reply) => {
    cors(req, reply);
    return reply.code(204).send();
  });

  const who = async (req: FastifyRequest, reply: FastifyReply) => {
    cors(req, reply);
    if (!gosEnabled(ctx)) throw new HttpError(503, 'Бобуслуги не подключены к банку');
    const auth = String(req.headers.authorization ?? '');
    if (!auth.startsWith('Bearer ')) throw new HttpError(401, 'Нужен вход на Бобуслугах');
    const uid = await verifyGosToken(ctx, auth.slice(7));
    return { uid, user: userByGosUid(ctx, uid) };
  };

  app.get('/api/gos/v1/summary', async (req, reply) => {
    const { user } = await who(req, reply);
    if (!user) return { linked: false, bankUrl: ctx.cfg.publicUrl };
    const row = db.prepare('SELECT name, phone, created_at FROM users WHERE id = ?').get(user.id) as { name: string; phone: string; created_at: number };
    const accounts = userAccounts(ctx, user.id).filter((a) => a.kind !== 'loan').map((a) => serializeAccount(ctx, a));
    return {
      linked: true,
      bankUrl: ctx.cfg.publicUrl,
      client: { name: row.name, phone: `+7 *** ***-${row.phone.slice(-4, -2)}-${row.phone.slice(-2)}`, since: row.created_at },
      accounts: accounts.map((a) => ({ id: a.id, name: a.name, number: a.number, kind: a.kind, currency: a.currency, balance: a.balance })),
      kyc: kycStatus(ctx, user.id),
    };
  });

  app.get('/api/gos/v1/statement', async (req, reply) => {
    const { user } = await who(req, reply);
    if (!user) throw new HttpError(404, 'Счёт в Bobobank не подключён');
    const q = z.object({ account: z.string(), from: z.coerce.number().int(), to: z.coerce.number().int() }).parse(req.query);
    const acc = ownedAccount(ctx, user.id, q.account);
    if (q.to < q.from || q.to - q.from > 366 * 24 * 3600_000) throw new HttpError(400, 'Период — не больше года');
    const entries = (db.prepare(`${ENTRY_SELECT} WHERE e.account_id = ? AND e.created_at >= ? AND e.created_at < ? ORDER BY e.id`).all(acc.id, q.from, q.to) as EntryRow[]).map(serializeEntry);
    const before = db.prepare('SELECT balance_after FROM entries WHERE account_id = ? AND created_at < ? ORDER BY id DESC LIMIT 1').get(acc.id, q.from) as { balance_after: number } | undefined;
    const opening = before?.balance_after ?? 0;
    const income = entries.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);
    const spent = entries.filter((e) => e.amount < 0).reduce((s, e) => s - e.amount, 0);
    return {
      account: { name: acc.name, number: acc.number, currency: acc.currency },
      holder: user.name,
      from: q.from,
      to: q.to,
      opening,
      closing: opening + income - spent,
      income,
      spent,
      entries: entries.map((e) => ({ date: e.createdAt, title: e.title, subtitle: e.subtitle, amount: e.amount })),
    };
  });

  app.get('/api/gos/v1/income', async (req, reply) => {
    const { user } = await who(req, reply);
    if (!user) throw new HttpError(404, 'Счёт в Bobobank не подключён');
    const months = Math.min(Math.max(Number((req.query as { months?: string }).months ?? 12) || 12, 1), 24);
    const now = new Date(ctx.now());
    const out: { month: string; amount: number }[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const from = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1);
      const to = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1);
      // Income: money from other people and organisations (salary, transfers, refunds, interest), not moves between own accounts.
      const r = db
        .prepare(
          `SELECT COALESCE(SUM(e.amount), 0) s FROM entries e JOIN accounts a ON a.id = e.account_id JOIN transactions t ON t.id = e.tx_id
           WHERE a.user_id = ? AND e.currency = 'RUB' AND e.amount > 0 AND e.created_at >= ? AND e.created_at < ?
             AND t.kind NOT IN ('own_transfer', 'deposit_open', 'deposit_close', 'fx', 'loan_issue', 'psy_exchange_reversal', 'gos_fine_reversal', 'sbp_reversal')`,
        )
        .get(user.id, from, to) as { s: number };
      const d = new Date(from);
      out.push({ month: `${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`, amount: r.s });
    }
    return { holder: user.name, months: out, total: out.reduce((s, m) => s + m.amount, 0) };
  });

  // Treasury balance for the country's staff on Бобуслуги (no bank account needed).
  app.get('/api/gos/v1/treasury/:country', async (req, reply) => {
    const { uid } = await who(req, reply);
    const country = (req.params as { country: string }).country;
    const p = await gosRpc<GosPerson>(ctx, 'svc_person', { p_user: uid });
    if (!(p.role === 'superadmin' || (['president', 'official'].includes(p.role) && p.gov_country_code === country))) throw new HttpError(403, 'Нет доступа к казне');
    const acc = treasuryAccount(ctx, country);
    const entries = (db.prepare(`${ENTRY_SELECT} WHERE e.account_id = ? ORDER BY e.id DESC LIMIT 30`).all(acc.id) as EntryRow[]).map(serializeEntry);
    return { number: acc.number, balance: acc.balance, entries: entries.map((e) => ({ date: e.createdAt, title: e.title, subtitle: e.subtitle, amount: e.amount })) };
  });
}
