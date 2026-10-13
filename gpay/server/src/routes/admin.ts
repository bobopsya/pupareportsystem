import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, HttpError, type Ctx } from '../context.js';
import { brandOf, luhn, OUTCOMES } from '../domain/cards.js';
import { getGlobalFees, METHODS, setGlobalFees } from '../domain/fees.js';
import { convert, getRates, setRates } from '../domain/fx.js';
import { getShop, type PaymentRow, type ShopRow } from '../domain/payments.js';
import { safeJson } from '../util.js';
import { paymentRow, shopSummary } from './merchant.js';

export function registerAdminRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;

  app.get('/api/admin/stats', async () => {
    const rates = getRates(db);
    const sums = db.prepare(`SELECT currency, COUNT(*) c, SUM(amount - refunded) gross, SUM(fee) fee FROM payments WHERE status = 'succeeded' GROUP BY currency`).all() as { currency: string; c: number; gross: number; fee: number }[];
    const count = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
    return {
      users: count('SELECT COUNT(*) c FROM users'),
      shops: count('SELECT COUNT(*) c FROM shops'),
      payments: count('SELECT COUNT(*) c FROM payments'),
      succeeded: sums.reduce((s, r) => s + r.c, 0),
      turnoverRub: sums.reduce((s, r) => s + convert(rates, r.gross, r.currency, 'RUB'), 0),
      feesRub: sums.reduce((s, r) => s + convert(rates, r.fee, r.currency, 'RUB'), 0),
      pendingWebhooks: count(`SELECT COUNT(*) c FROM webhook_deliveries WHERE status = 'pending'`),
    };
  });

  app.get('/api/admin/users', async () => ({
    items: db.prepare(`SELECT u.id, u.email, u.name, u.role, u.blocked, u.created_at createdAt, (SELECT COUNT(*) FROM shops s WHERE s.owner_id = u.id) shops FROM users u ORDER BY u.created_at DESC`).all(),
  }));

  app.patch<{ Params: { id: string } }>('/api/admin/users/:id', async (req) => {
    const b = z.object({ blocked: z.boolean().optional(), role: z.enum(['merchant', 'admin']).optional() }).parse(req.body);
    if (req.params.id === req.user!.id) throw new HttpError(400, 'Нельзя изменить собственную учётную запись');
    if (b.blocked !== undefined) {
      db.prepare('UPDATE users SET blocked = ? WHERE id = ?').run(b.blocked ? 1 : 0, req.params.id);
      if (b.blocked) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.params.id);
    }
    if (b.role) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(b.role, req.params.id);
    audit(ctx, req, 'admin_user', 'user', req.params.id, JSON.stringify(b));
    return { ok: true };
  });

  app.get('/api/admin/shops', async () => {
    const rows = db.prepare('SELECT s.*, u.email owner_email FROM shops s JOIN users u ON u.id = s.owner_id ORDER BY s.created_at DESC').all() as (ShopRow & { owner_email: string })[];
    const stats = db.prepare(`SELECT shop_id, COUNT(*) c, SUM(CASE WHEN status = 'succeeded' THEN amount - refunded ELSE 0 END) gross FROM payments GROUP BY shop_id`).all() as { shop_id: number; c: number; gross: number }[];
    return { items: rows.map((s) => ({ ...shopSummary(ctx, s), ownerEmail: s.owner_email, ownFees: safeJson(s.fees, {}), payments: stats.find((x) => x.shop_id === s.id)?.c ?? 0, gross: stats.find((x) => x.shop_id === s.id)?.gross ?? 0 })) };
  });

  const feesSchema = z.object(Object.fromEntries(METHODS.map((m) => [m, z.number().min(0).max(50)])) as Record<(typeof METHODS)[number], z.ZodNumber>);

  app.patch<{ Params: { id: string } }>('/api/admin/shops/:id', async (req) => {
    const shop = getShop(ctx, Number(req.params.id));
    if (!shop) throw new HttpError(404, 'Магазин не найден');
    const b = z.object({ status: z.enum(['active', 'blocked']).optional(), fees: feesSchema.partial().optional() }).parse(req.body);
    if (b.status) db.prepare('UPDATE shops SET status = ? WHERE id = ?').run(b.status, shop.id);
    if (b.fees) db.prepare('UPDATE shops SET fees = ? WHERE id = ?').run(JSON.stringify(b.fees), shop.id);
    audit(ctx, req, 'admin_shop', 'shop', String(shop.id), JSON.stringify(b));
    return { ok: true };
  });

  app.get<{ Querystring: { q?: string; status?: string } }>('/api/admin/payments', async (req) => {
    const q = req.query.q ? `%${req.query.q.replace(/[%_]/g, '')}%` : null;
    const rows = db
      .prepare(`SELECT p.*, s.name shop_name FROM payments p JOIN shops s ON s.id = p.shop_id WHERE (@q IS NULL OR p.id LIKE @q OR p.description LIKE @q OR s.name LIKE @q OR p.customer_email LIKE @q) AND (@st IS NULL OR p.status = @st) ORDER BY p.created_at DESC LIMIT 300`)
      .all({ q, st: req.query.status ?? null }) as (PaymentRow & { shop_name: string })[];
    return { items: rows.map((p) => ({ ...paymentRow(p), shopName: p.shop_name })) };
  });

  app.get('/api/admin/settings', async () => ({ rates: getRates(db), fees: getGlobalFees(db) }));

  app.put('/api/admin/rates', async (req) => {
    const b = z.object({ USD: z.number().positive(), EUR: z.number().positive(), BTC: z.number().positive(), USDT: z.number().positive() }).parse(req.body);
    setRates(db, b, ctx.now());
    audit(ctx, req, 'admin_rates', null, null, JSON.stringify(b));
    return { rates: getRates(db) };
  });

  app.put('/api/admin/fees', async (req) => {
    const b = feesSchema.parse(req.body);
    setGlobalFees(db, b);
    audit(ctx, req, 'admin_fees', null, null, JSON.stringify(b));
    return { fees: getGlobalFees(db) };
  });

  app.get('/api/admin/cards', async () => ({
    items: db.prepare('SELECT pan, outcome, label, created_at createdAt FROM game_cards ORDER BY created_at, pan').all(),
    outcomes: Object.fromEntries(Object.entries(OUTCOMES).map(([k, v]) => [k, v.title])),
  }));

  app.post('/api/admin/cards', async (req) => {
    const b = z.object({ pan: z.string().transform((s) => s.replace(/\D/g, '')), outcome: z.enum(Object.keys(OUTCOMES) as [keyof typeof OUTCOMES]), label: z.string().trim().max(60).default('') }).parse(req.body);
    if (b.pan.length !== 16 || !luhn(b.pan)) throw new HttpError(400, 'Номер должен состоять из 16 цифр и проходить проверку Луна');
    if (!brandOf(b.pan)) throw new HttpError(400, 'Номер должен начинаться с BIN Visa (4), Mastercard (51–55, 2221–2720), МИР (2200–2204) или UnionPay (62)');
    db.prepare('INSERT INTO game_cards(pan, outcome, label, created_at) VALUES(?,?,?,?) ON CONFLICT(pan) DO UPDATE SET outcome = excluded.outcome, label = excluded.label').run(b.pan, b.outcome, b.label, ctx.now());
    audit(ctx, req, 'admin_card', 'card', `*${b.pan.slice(-4)}`, b.outcome);
    return { ok: true };
  });

  app.delete<{ Params: { pan: string } }>('/api/admin/cards/:pan', async (req) => {
    db.prepare('DELETE FROM game_cards WHERE pan = ?').run(req.params.pan);
    audit(ctx, req, 'admin_card_delete', 'card', `*${req.params.pan.slice(-4)}`);
    return { ok: true };
  });

  app.get('/api/admin/audit', async () => ({ items: db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 300').all() }));
}
