import type { FastifyInstance, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { bankEnabled } from '../domain/bank.js';
import { cancelWithBank, captureWithBank, linkBankAccount, payoutAccount, payoutToBank, refundWithBank } from '../domain/bankpay.js';
import { audit, HttpError, type Ctx } from '../context.js';
import { getGlobalFees, METHODS, shopFees } from '../domain/fees.js';
import { convert, getRates } from '../domain/fx.js';
import { createLink, serializeLink, type LinkRow } from '../domain/links.js';
import { CURRENCIES, parseAmount } from '../domain/money.js';
import {
  balances, cancelByMerchant, capturePayment, createPayout, getShop, loadPayment, refundPayment, serializePayment, serializePayout,
  serializeRefund, shopMethods, type PaymentRow, type PayoutRow, type RefundRow, type ShopRow,
} from '../domain/payments.js';
import { newKktNumbers, serializeReceipt, TAX_SYSTEMS, VAT_CODES } from '../domain/receipts.js';
import { checkTarget, deliver, EVENTS } from '../domain/webhooks.js';
import { newId, randomString, safeJson, sha256 } from '../util.js';

const DAY = 24 * 3600 * 1000;

const shopBody = z.object({
  name: z.string().trim().min(2, 'Название магазина: минимум 2 символа').max(60),
  legalName: z.string().trim().min(2, 'Укажите юридическое название').max(120),
  inn: z.string().trim().regex(/^(\d{10}|\d{12})$/, 'ИНН: 10 или 12 цифр'),
  taxSystem: z.enum(Object.keys(TAX_SYSTEMS) as [keyof typeof TAX_SYSTEMS]),
  site: z.string().trim().max(200).default(''),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).default('#5b3df5'),
});

const settingsBody = shopBody.partial().extend({
  mcc: z.number().int().min(742).max(9999).optional(),
  methods: z.array(z.enum(METHODS)).min(1, 'Включите хотя бы один способ оплаты').optional(),
  returnUrl: z.union([z.literal(''), z.string().url().max(500)]).optional(),
  defaultVat: z.enum(VAT_CODES).optional(),
});

export function shopSummary(ctx: Ctx, s: ShopRow) {
  return {
    id: s.id,
    name: s.name,
    legalName: s.legal_name,
    inn: s.inn,
    taxSystem: s.tax_system,
    site: s.site,
    color: s.color,
    status: s.status,
    methods: shopMethods(s),
    fees: shopFees(ctx.db, s.fees),
    returnUrl: s.return_url,
    defaultVat: s.default_vat,
    mcc: s.mcc,
    payoutAccount: payoutAccount(s),
    bankEnabled: bankEnabled(ctx),
    kkt: { rn: s.kkt_rn, fn: s.fn_number, fd: s.fd_counter, shift: s.shift_no },
    createdAt: s.created_at,
  };
}

/** Compact row for tables. */
export function paymentRow(p: PaymentRow) {
  const m = safeJson<{ title?: string; type?: string; card?: { card_type: string; last4: string } } | null>(p.method, null);
  return {
    id: p.id,
    shopId: p.shop_id,
    status: p.status,
    amount: p.amount,
    currency: p.currency,
    fee: p.fee,
    refunded: p.refunded,
    description: p.description,
    methodType: p.method_type,
    methodTitle: m?.title ?? null,
    cardBrand: m?.card?.card_type ?? null,
    email: p.customer_email,
    source: p.source,
    cancellation: safeJson<{ reason: string } | null>(p.cancellation, null),
    createdAt: p.created_at,
    capturedAt: p.captured_at,
  };
}

export function registerMerchantRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;

  const ownShop = (req: FastifyRequest<{ Params: { shopId: string } }>): ShopRow => {
    const user = requireUser(req);
    const shop = getShop(ctx, Number(req.params.shopId));
    if (!shop || (shop.owner_id !== user.id && user.role !== 'admin')) throw new HttpError(404, 'Магазин не найден');
    return shop;
  };
  const ownPayment = (shop: ShopRow, id: string) => {
    const p = loadPayment(ctx, id);
    if (!p || p.shop_id !== shop.id) throw new HttpError(404, 'Платёж не найден');
    return p;
  };

  type P = { Params: { shopId: string } };
  type PI = { Params: { shopId: string; id: string } };

  // ---------- Shops ----------
  app.get('/api/m/shops', async (req) => {
    const user = requireUser(req);
    const rows = db.prepare('SELECT * FROM shops WHERE owner_id = ? ORDER BY created_at').all(user.id) as ShopRow[];
    return { shops: rows.map((s) => shopSummary(ctx, s)) };
  });

  app.post('/api/m/shops', async (req) => {
    const user = requireUser(req);
    const b = shopBody.parse(req.body);
    const { c } = db.prepare('SELECT COUNT(*) c FROM shops WHERE owner_id = ?').get(user.id) as { c: number };
    if (c >= 10) throw new HttpError(400, 'Не больше 10 магазинов на аккаунт');
    const kkt = newKktNumbers();
    const r = db
      .prepare('INSERT INTO shops(owner_id, name, legal_name, inn, tax_system, site, color, kkt_rn, fn_number, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(user.id, b.name, b.legalName, b.inn, b.taxSystem, b.site, b.color, kkt.rn, kkt.fn, ctx.now());
    const shop = getShop(ctx, Number(r.lastInsertRowid))!;
    audit(ctx, req, 'shop_create', 'shop', String(shop.id), b.name);
    return { shop: shopSummary(ctx, shop) };
  });

  app.get<P>('/api/m/shops/:shopId', async (req) => ({ shop: shopSummary(ctx, ownShop(req)) }));

  app.patch<P>('/api/m/shops/:shopId', async (req) => {
    const shop = ownShop(req);
    const b = settingsBody.parse(req.body);
    const cols: Record<string, unknown> = {
      name: b.name, legal_name: b.legalName, inn: b.inn, tax_system: b.taxSystem, site: b.site, color: b.color,
      methods: b.methods ? JSON.stringify(b.methods) : undefined, return_url: b.returnUrl, default_vat: b.defaultVat, mcc: b.mcc,
    };
    for (const [k, v] of Object.entries(cols)) if (v !== undefined) db.prepare(`UPDATE shops SET ${k} = ? WHERE id = ?`).run(v, shop.id);
    audit(ctx, req, 'shop_update', 'shop', String(shop.id));
    return { shop: shopSummary(ctx, getShop(ctx, shop.id)!) };
  });

  // ---------- Overview & analytics ----------
  app.get<P & { Querystring: { days?: string } }>('/api/m/shops/:shopId/analytics', async (req) => {
    const shop = ownShop(req);
    const days = Math.min(Math.max(Number(req.query.days ?? 30) || 30, 1), 365);
    const now = ctx.now();
    // Calendar days in Moscow time.
    const startOfDay = (ts: number) => ts - ((ts + 3 * 3600_000) % DAY);
    const from = startOfDay(now) - (days - 1) * DAY;
    const rates = getRates(db);
    const rows = db.prepare('SELECT * FROM payments WHERE shop_id = ? AND created_at >= ?').all(shop.id, from - days * DAY) as PaymentRow[];
    const rub = (p: PaymentRow, v: number) => convert(rates, v, p.currency, 'RUB');

    const series = Array.from({ length: days }, (_, i) => ({ day: from + i * DAY, turnover: 0, count: 0, created: 0, refunds: 0 }));
    const cur = { turnover: 0, net: 0, count: 0, created: 0, finished: 0, refunds: 0 };
    const prev = { turnover: 0, count: 0, created: 0, finished: 0 };
    const byMethod: Record<string, { count: number; turnover: number }> = {};
    const byCurrency: Record<string, { count: number; amount: number }> = {};
    const byStatus: Record<string, number> = {};
    const declines: Record<string, number> = {};
    for (const p of rows) {
      const isCur = p.created_at >= from;
      const ok = p.status === 'succeeded';
      const finished = p.status !== 'pending';
      if (isCur) {
        cur.created++;
        if (finished) cur.finished++;
        byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
        const idx = Math.floor((p.created_at - from) / DAY);
        series[idx].created++;
        if (ok) {
          const v = rub(p, p.amount - p.refunded);
          cur.turnover += v;
          cur.net += rub(p, p.amount - p.fee - p.refunded);
          cur.count++;
          cur.refunds += rub(p, p.refunded);
          series[idx].turnover += v;
          series[idx].count++;
          series[idx].refunds += rub(p, p.refunded);
          const m = p.method_type ?? 'bank_card';
          byMethod[m] ??= { count: 0, turnover: 0 };
          byMethod[m].count++;
          byMethod[m].turnover += v;
          byCurrency[p.currency] ??= { count: 0, amount: 0 };
          byCurrency[p.currency].count++;
          byCurrency[p.currency].amount += p.amount - p.refunded;
        }
      } else {
        prev.created++;
        if (finished) prev.finished++;
        if (ok) {
          prev.turnover += rub(p, p.amount - p.refunded);
          prev.count++;
        }
      }
    }
    const fails = db
      .prepare(`SELECT e.data FROM payment_events e JOIN payments p ON p.id = e.payment_id WHERE p.shop_id = ? AND e.type = 'attempt_failed' AND e.ts >= ?`)
      .all(shop.id, from) as { data: string }[];
    for (const f of fails) {
      const reason = safeJson<{ reason: string }>(f.data, { reason: 'unknown' }).reason;
      declines[reason] = (declines[reason] ?? 0) + 1;
    }
    const conv = (o: { count: number; finished: number }) => (o.finished ? o.count / o.finished : null);
    const recent = db.prepare('SELECT * FROM payments WHERE shop_id = ? ORDER BY created_at DESC LIMIT 8').all(shop.id) as PaymentRow[];
    return {
      days,
      from,
      kpi: {
        turnover: cur.turnover, turnoverPrev: prev.turnover, net: cur.net, count: cur.count, countPrev: prev.count,
        avg: cur.count ? Math.round(cur.turnover / cur.count) : 0, avgPrev: prev.count ? Math.round(prev.turnover / prev.count) : 0,
        conversion: conv({ count: cur.count, finished: cur.finished }), conversionPrev: conv(prev), refunds: cur.refunds,
      },
      series,
      byMethod,
      byCurrency,
      byStatus,
      declines,
      balances: balances(ctx, shop.id),
      recent: recent.map(paymentRow),
    };
  });

  // ---------- Payments ----------
  app.get<P & { Querystring: Record<string, string | undefined> }>('/api/m/shops/:shopId/payments', async (req) => {
    const shop = ownShop(req);
    const q = req.query;
    const limit = Math.min(Number(q.limit ?? 50) || 50, 200);
    const offset = Math.max(Number(q.offset ?? 0) || 0, 0);
    const where = ['shop_id = @shop'];
    const args: Record<string, unknown> = { shop: shop.id };
    if (q.status === 'refunded') where.push('refunded > 0');
    else if (q.status) (where.push('status = @status'), (args.status = q.status));
    if (q.method) (where.push('method_type = @method'), (args.method = q.method));
    if (q.currency) (where.push('currency = @currency'), (args.currency = q.currency));
    if (q.from) (where.push('created_at >= @from'), (args.from = Number(q.from)));
    if (q.to) (where.push('created_at < @to'), (args.to = Number(q.to)));
    if (q.q) {
      where.push(`(id LIKE @q OR description LIKE @q OR customer_email LIKE @q OR method LIKE @q OR metadata LIKE @q OR printf('%.2f', amount / 100.0) LIKE @q)`);
      args.q = `%${q.q.replace(/[%_]/g, '')}%`;
    }
    const w = where.join(' AND ');
    const total = (db.prepare(`SELECT COUNT(*) c FROM payments WHERE ${w}`).get(args) as { c: number }).c;
    const rows = db.prepare(`SELECT * FROM payments WHERE ${w} ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`).all(args) as PaymentRow[];
    return { total, items: rows.map(paymentRow) };
  });

  app.get<PI>('/api/m/shops/:shopId/payments/:id', async (req) => {
    const shop = ownShop(req);
    const p = ownPayment(shop, req.params.id);
    const events = db.prepare('SELECT ts, type, data FROM payment_events WHERE payment_id = ? ORDER BY id').all(p.id) as { ts: number; type: string; data: string }[];
    const refunds = db.prepare('SELECT * FROM refunds WHERE payment_id = ? ORDER BY created_at').all(p.id) as RefundRow[];
    const receipts = db.prepare('SELECT * FROM receipts WHERE payment_id = ? ORDER BY created_at').all(p.id) as { id: string; payment_id: string; refund_id: string | null; type: string; data: string; created_at: number }[];
    const deliveries = db.prepare(`SELECT d.id, d.event, d.status, d.attempts, d.last_code, d.created_at, w.url FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id WHERE d.object_id = ? ORDER BY d.created_at`).all(p.id);
    return {
      row: paymentRow(p),
      api: serializePayment(ctx, p),
      events: events.map((e) => ({ ts: e.ts, type: e.type, data: safeJson(e.data, {}) })),
      refunds: refunds.map(serializeRefund),
      receipts: receipts.map((r) => serializeReceipt(r, ctx.cfg.publicUrl)),
      deliveries,
    };
  });

  const amountOpt = z.object({ amount: z.string().max(20).optional(), description: z.string().max(250).optional() });

  app.post<PI>('/api/m/shops/:shopId/payments/:id/capture', async (req) => {
    const shop = ownShop(req);
    const b = amountOpt.parse(req.body ?? {});
    const p = await captureWithBank(ctx, shop, ownPayment(shop, req.params.id), b.amount ? parseAmount(b.amount) : undefined);
    audit(ctx, req, 'capture', 'payment', p.id);
    return { row: paymentRow(p) };
  });

  app.post<PI>('/api/m/shops/:shopId/payments/:id/cancel', async (req) => {
    const shop = ownShop(req);
    const p = await cancelWithBank(ctx, ownPayment(shop, req.params.id));
    audit(ctx, req, 'cancel', 'payment', p.id);
    return { row: paymentRow(p) };
  });

  app.post<PI>('/api/m/shops/:shopId/payments/:id/refund', async (req) => {
    const shop = ownShop(req);
    const b = amountOpt.parse(req.body ?? {});
    const r = await refundWithBank(ctx, shop, ownPayment(shop, req.params.id), b.amount ? parseAmount(b.amount) : undefined, b.description ?? '');
    audit(ctx, req, 'refund', 'payment', r.payment_id, `${r.amount / 100} ${r.currency}`);
    return { refund: serializeRefund(r) };
  });

  app.get<P>('/api/m/shops/:shopId/refunds', async (req) => {
    const shop = ownShop(req);
    const rows = db
      .prepare('SELECT r.*, p.description pdesc, p.method pmethod FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE r.shop_id = ? ORDER BY r.created_at DESC LIMIT 300')
      .all(shop.id) as (RefundRow & { pdesc: string; pmethod: string | null })[];
    return {
      items: rows.map((r) => ({ ...serializeRefund(r), amountMinor: r.amount, currency: r.currency, createdAt: r.created_at, paymentDescription: r.pdesc, methodTitle: safeJson<{ title?: string }>(r.pmethod, {}).title ?? null })),
    };
  });

  // ---------- Links & invoices ----------
  const linkBody = z.object({
    kind: z.enum(['link', 'invoice']),
    title: z.string().max(100),
    description: z.string().max(500).optional(),
    amount: z.string().max(20).optional(),
    minAmount: z.string().max(20).optional(),
    maxAmount: z.string().max(20).optional(),
    currency: z.enum(CURRENCIES),
    reusable: z.boolean().optional(),
    expiresAt: z.number().int().nullable().optional(),
    items: z.array(z.object({ description: z.string(), quantity: z.number(), price: z.string(), vat_code: z.enum(VAT_CODES) })).optional(),
    customer: z.object({ email: z.string().max(200).optional(), name: z.string().max(100).optional() }).optional(),
  });

  app.get<P>('/api/m/shops/:shopId/links', async (req) => {
    const shop = ownShop(req);
    const rows = db.prepare('SELECT * FROM payment_links WHERE shop_id = ? ORDER BY created_at DESC').all(shop.id) as LinkRow[];
    return { items: rows.map((l) => ({ ...serializeLink(ctx, l), slug: l.slug, amountMinor: l.amount, paidTotal: l.paid_total, createdAt: l.created_at })) };
  });

  app.post<P>('/api/m/shops/:shopId/links', async (req) => {
    const shop = ownShop(req);
    const b = linkBody.parse(req.body);
    const items = b.items?.length ? b.items : null;
    let amount = b.amount ? parseAmount(b.amount) : null;
    if (items) amount = items.reduce((s, it) => s + Math.round(parseAmount(it.price) * it.quantity), 0);
    const l = createLink(ctx, shop, {
      kind: b.kind, title: b.title, description: b.description, amount, minAmount: b.minAmount ? parseAmount(b.minAmount) : null, maxAmount: b.maxAmount ? parseAmount(b.maxAmount) : null,
      currency: b.currency, reusable: b.reusable, expiresAt: b.expiresAt ?? null, customer: b.customer,
      receipt: items ? { customer: { email: b.customer?.email }, items: items.map((it) => ({ description: it.description, quantity: it.quantity, amount: { value: it.price, currency: b.currency }, vat_code: it.vat_code })) } : undefined,
    });
    audit(ctx, req, 'link_create', 'link', l.id, l.title);
    return { link: serializeLink(ctx, l) };
  });

  app.patch<PI>('/api/m/shops/:shopId/links/:id', async (req) => {
    const shop = ownShop(req);
    const b = z.object({ active: z.boolean() }).parse(req.body);
    const r = db.prepare('UPDATE payment_links SET active = ? WHERE id = ? AND shop_id = ?').run(b.active ? 1 : 0, req.params.id, shop.id);
    if (!r.changes) throw new HttpError(404, 'Ссылка не найдена');
    return { ok: true };
  });

  // ---------- Balance & payouts ----------
  app.get<P>('/api/m/shops/:shopId/payouts', async (req) => {
    const shop = ownShop(req);
    const rows = db.prepare('SELECT * FROM payouts WHERE shop_id = ? ORDER BY created_at DESC LIMIT 200').all(shop.id) as PayoutRow[];
    const fees = db.prepare(`SELECT currency, SUM(fee) fee, SUM(amount) gross FROM payments WHERE shop_id = ? AND status = 'succeeded' GROUP BY currency`).all(shop.id);
    return { balances: balances(ctx, shop.id), payoutAccount: payoutAccount(shop), bankEnabled: bankEnabled(ctx), fees, items: rows.map((r) => ({ ...serializePayout(r), amountMinor: r.amount, currency: r.currency, createdAt: r.created_at })) };
  });

  app.post<P>('/api/m/shops/:shopId/payouts', async (req) => {
    const shop = ownShop(req);
    const b = z
      .object({ amount: z.string().max(20), currency: z.enum(CURRENCIES), destination: z.enum(['bobobank', 'card']).default('card'), cardLast4: z.string().regex(/^\d{4}$/, 'Последние 4 цифры карты').optional() })
      .parse(req.body);
    let po;
    if (b.destination === 'bobobank') po = await payoutToBank(ctx, shop, parseAmount(b.amount), b.currency);
    else {
      if (!b.cardLast4) throw new HttpError(400, 'Укажите последние 4 цифры карты');
      po = createPayout(ctx, shop, parseAmount(b.amount), b.currency, { type: 'bank_card', card_last4: b.cardLast4 });
    }
    audit(ctx, req, 'payout', 'payout', po.id, `${b.amount} ${b.currency}`);
    return { payout: serializePayout(po) };
  });

  // ---------- Bobobank payout account ----------
  app.post<P>('/api/m/shops/:shopId/bank-link', async (req) => {
    const shop = ownShop(req);
    const { code } = z.object({ code: z.string().trim().regex(/^\d{4}-?\d{4}$/, 'Код — 8 цифр из приложения Bobobank') }).parse(req.body);
    const acc = await linkBankAccount(ctx, shop, code);
    audit(ctx, req, 'bank_link', 'shop', String(shop.id), acc.number.slice(-4));
    return { payoutAccount: acc };
  });

  app.delete<P>('/api/m/shops/:shopId/bank-link', async (req) => {
    const shop = ownShop(req);
    db.prepare('UPDATE shops SET payout_account = NULL WHERE id = ?').run(shop.id);
    audit(ctx, req, 'bank_unlink', 'shop', String(shop.id));
    return { ok: true };
  });

  // ---------- API keys ----------
  app.get<P>('/api/m/shops/:shopId/keys', async (req) => {
    const shop = ownShop(req);
    return { items: db.prepare('SELECT id, name, last4, created_at createdAt, last_used_at lastUsedAt, revoked_at revokedAt FROM api_keys WHERE shop_id = ? ORDER BY created_at DESC').all(shop.id) };
  });

  app.post<P>('/api/m/shops/:shopId/keys', async (req) => {
    const shop = ownShop(req);
    const b = z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body);
    const { c } = db.prepare('SELECT COUNT(*) c FROM api_keys WHERE shop_id = ? AND revoked_at IS NULL').get(shop.id) as { c: number };
    if (c >= 10) throw new HttpError(400, 'Не больше 10 активных ключей');
    const secret = `sk_live_${randomString(40)}`;
    const id = newId('key', 16);
    db.prepare('INSERT INTO api_keys(id, shop_id, name, hash, last4, created_at) VALUES(?,?,?,?,?,?)').run(id, shop.id, b.name, sha256(secret), secret.slice(-4), ctx.now());
    audit(ctx, req, 'key_create', 'api_key', id, b.name);
    return { id, secret };
  });

  app.delete<PI>('/api/m/shops/:shopId/keys/:id', async (req) => {
    const shop = ownShop(req);
    db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND shop_id = ? AND revoked_at IS NULL').run(ctx.now(), req.params.id, shop.id);
    audit(ctx, req, 'key_revoke', 'api_key', req.params.id);
    return { ok: true };
  });

  // ---------- Webhooks ----------
  const hookBody = z.object({ url: z.string().trim().url('Некорректный URL').max(500), events: z.array(z.enum(EVENTS)).min(1, 'Выберите хотя бы одно событие') });

  app.get<P>('/api/m/shops/:shopId/webhooks', async (req) => {
    const shop = ownShop(req);
    const hooks = db.prepare('SELECT id, url, secret, events, active, created_at FROM webhooks WHERE shop_id = ? ORDER BY created_at').all(shop.id) as { id: string; url: string; secret: string; events: string; active: number; created_at: number }[];
    const stats = db.prepare(`SELECT webhook_id, SUM(status = 'succeeded') ok, SUM(status = 'failed') failed, SUM(status = 'pending') pending FROM webhook_deliveries WHERE shop_id = ? GROUP BY webhook_id`).all(shop.id) as { webhook_id: string; ok: number; failed: number; pending: number }[];
    return {
      items: hooks.map((h) => ({ id: h.id, url: h.url, secret: h.secret, events: safeJson(h.events, []), active: !!h.active, createdAt: h.created_at, stats: stats.find((s) => s.webhook_id === h.id) ?? { ok: 0, failed: 0, pending: 0 } })),
      events: EVENTS,
    };
  });

  app.post<P>('/api/m/shops/:shopId/webhooks', async (req) => {
    const shop = ownShop(req);
    const b = hookBody.parse(req.body);
    const err = await checkTarget(ctx, b.url);
    if (err) throw new HttpError(400, err);
    const { c } = db.prepare('SELECT COUNT(*) c FROM webhooks WHERE shop_id = ?').get(shop.id) as { c: number };
    if (c >= 5) throw new HttpError(400, 'Не больше 5 эндпоинтов');
    const id = newId('wh', 16);
    db.prepare('INSERT INTO webhooks(id, shop_id, url, secret, events, created_at) VALUES(?,?,?,?,?,?)').run(id, shop.id, b.url, `whsec_${randomString(32)}`, JSON.stringify(b.events), ctx.now());
    audit(ctx, req, 'webhook_create', 'webhook', id, b.url);
    return { id };
  });

  app.patch<PI>('/api/m/shops/:shopId/webhooks/:id', async (req) => {
    const shop = ownShop(req);
    const b = hookBody.partial().extend({ active: z.boolean().optional(), rotateSecret: z.boolean().optional() }).parse(req.body);
    if (b.url) {
      const err = await checkTarget(ctx, b.url);
      if (err) throw new HttpError(400, err);
      db.prepare('UPDATE webhooks SET url = ? WHERE id = ? AND shop_id = ?').run(b.url, req.params.id, shop.id);
    }
    if (b.events) db.prepare('UPDATE webhooks SET events = ? WHERE id = ? AND shop_id = ?').run(JSON.stringify(b.events), req.params.id, shop.id);
    if (b.active !== undefined) db.prepare('UPDATE webhooks SET active = ? WHERE id = ? AND shop_id = ?').run(b.active ? 1 : 0, req.params.id, shop.id);
    if (b.rotateSecret) db.prepare('UPDATE webhooks SET secret = ? WHERE id = ? AND shop_id = ?').run(`whsec_${randomString(32)}`, req.params.id, shop.id);
    return { ok: true };
  });

  app.delete<PI>('/api/m/shops/:shopId/webhooks/:id', async (req) => {
    const shop = ownShop(req);
    db.prepare('DELETE FROM webhooks WHERE id = ? AND shop_id = ?').run(req.params.id, shop.id);
    audit(ctx, req, 'webhook_delete', 'webhook', req.params.id);
    return { ok: true };
  });

  /** Sends a sample payment.succeeded event to one endpoint right away. */
  app.post<PI>('/api/m/shops/:shopId/webhooks/:id/test', async (req) => {
    const shop = ownShop(req);
    const hook = db.prepare('SELECT id FROM webhooks WHERE id = ? AND shop_id = ?').get(req.params.id, shop.id) as { id: string } | undefined;
    if (!hook) throw new HttpError(404, 'Эндпоинт не найден');
    const now = ctx.now();
    const sampleId = `pay_test_${randomString(15)}`;
    const object = {
      id: sampleId, status: 'succeeded', paid: true, amount: { value: '1500.00', currency: 'RUB' }, income_amount: { value: '1458.00', currency: 'RUB' }, description: 'Тестовое уведомление',
      recipient: { account_id: String(shop.id), gateway_id: `${shop.id}01` }, payment_method: { type: 'bank_card', id: `pm_${randomString(20)}`, saved: false, title: 'Visa •• 1111', card: { first6: '411111', last4: '1111', expiry_month: '12', expiry_year: '2030', card_type: 'Visa' } },
      captured_at: new Date(now).toISOString(), created_at: new Date(now - 30_000).toISOString(), test: false, refundable: true, metadata: { test: 'true' },
    };
    const id = newId('evt', 20);
    const payload = JSON.stringify({ type: 'notification', id, event: 'payment.succeeded', created_at: new Date(now).toISOString(), object });
    db.prepare(`INSERT INTO webhook_deliveries(id, webhook_id, shop_id, event, object_id, payload, status, attempts, next_at, created_at, updated_at) VALUES(?,?,?,?,?,?,'pending',0,?,?,?)`).run(id, hook.id, shop.id, 'payment.succeeded', sampleId, payload, now, now, now);
    const row = db.prepare('SELECT id, webhook_id, payload, attempts, created_at FROM webhook_deliveries WHERE id = ?').get(id) as Parameters<typeof deliver>[1];
    await deliver(ctx, row);
    return { delivery: db.prepare('SELECT id, status, last_code lastCode, last_error lastError, last_body lastBody, last_ms lastMs FROM webhook_deliveries WHERE id = ?').get(id) };
  });

  app.get<P & { Querystring: { status?: string; webhookId?: string } }>('/api/m/shops/:shopId/deliveries', async (req) => {
    const shop = ownShop(req);
    const rows = db
      .prepare(
        `SELECT d.id, d.webhook_id webhookId, d.event, d.object_id objectId, d.status, d.attempts, d.next_at nextAt, d.last_code lastCode, d.last_error lastError, d.last_body lastBody, d.last_ms lastMs, d.payload, d.created_at createdAt, d.updated_at updatedAt, w.url
         FROM webhook_deliveries d LEFT JOIN webhooks w ON w.id = d.webhook_id WHERE d.shop_id = @shop AND (@status IS NULL OR d.status = @status) AND (@wh IS NULL OR d.webhook_id = @wh) ORDER BY d.created_at DESC LIMIT 200`,
      )
      .all({ shop: shop.id, status: req.query.status ?? null, wh: req.query.webhookId ?? null });
    return { items: rows };
  });

  app.post<PI>('/api/m/shops/:shopId/deliveries/:id/resend', async (req) => {
    const shop = ownShop(req);
    const row = db.prepare('SELECT id, webhook_id, payload, attempts, created_at FROM webhook_deliveries WHERE id = ? AND shop_id = ?').get(req.params.id, shop.id) as Parameters<typeof deliver>[1] | undefined;
    if (!row) throw new HttpError(404, 'Доставка не найдена');
    await deliver(ctx, row);
    return { delivery: db.prepare('SELECT id, status, attempts, last_code lastCode, last_error lastError FROM webhook_deliveries WHERE id = ?').get(row.id) };
  });

  // ---------- API request log ----------
  app.get<P>('/api/m/shops/:shopId/logs', async (req) => {
    const shop = ownShop(req);
    const rows = db
      .prepare('SELECT r.id, r.method, r.path, r.status, r.ms, r.idem_key idemKey, r.req_body reqBody, r.res_body resBody, r.ip, r.ts, k.name keyName FROM api_requests r LEFT JOIN api_keys k ON k.id = r.key_id WHERE r.shop_id = ? ORDER BY r.id DESC LIMIT 200')
      .all(shop.id);
    return { items: rows };
  });

  app.get('/api/m/meta', async () => ({ methods: METHODS, fees: getGlobalFees(db), events: EVENTS, vatCodes: VAT_CODES, taxSystems: TAX_SYSTEMS, rates: getRates(db), newInn: suggestInn() }));
}

/**
 * A random 10-digit INN for the shop form. The check digit is deliberately off by one,
 * so a generated number can never coincide with a real company's INN.
 */
export function suggestInn(): string {
  const w = [2, 4, 10, 3, 5, 9, 4, 6, 8];
  for (;;) {
    const d = Array.from(crypto.randomBytes(9), (b) => b % 10);
    if (d[0] === 0) continue;
    const c = ((w.reduce((s, k, i) => s + k * d[i], 0) % 11) % 10 + 1) % 10;
    return [...d, c].join('');
  }
}
