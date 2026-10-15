import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { audit, HttpError, type Ctx } from '../context.js';
import { ownedAccount } from '../domain/ledger.js';
import { FEE_PCT, getStock, listStocks, portfolio, position, quote, series, stockView, trade } from '../domain/market.js';

export function registerMarketRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;
  const ticker = (raw: string) => {
    const s = getStock(ctx, raw.toUpperCase());
    if (!s) throw new HttpError(404, 'Бумага не найдена');
    return s;
  };

  app.get('/api/market', async (req) => {
    const u = requireUser(req);
    const owned = new Map((db.prepare('SELECT ticker, qty FROM positions WHERE user_id = ?').all(u.id) as { ticker: string; qty: number }[]).map((p) => [p.ticker, p.qty]));
    return {
      stocks: listStocks(ctx).map((s) => ({ ...stockView(ctx, s), spark: series(ctx, s.ticker, '1h').map((p) => p[1]).filter((_, i, a) => i % Math.max(1, Math.ceil(a.length / 40)) === 0), owned: owned.get(s.ticker) ?? 0 })),
      portfolio: portfolio(ctx, u.id),
      feePct: FEE_PCT,
    };
  });

  app.get('/api/market/:ticker', async (req) => {
    const u = requireUser(req);
    const s = ticker((req.params as { ticker: string }).ticker);
    const range = z.enum(['1h', '1d', '7d', '30d']).catch('1h').parse((req.query as { range?: string }).range);
    const pos = position(ctx, u.id, s.ticker);
    const tape = db.prepare('SELECT side, qty, price, created_at FROM trades WHERE ticker = ? ORDER BY created_at DESC LIMIT 15').all(s.ticker) as { side: string; qty: number; price: number; created_at: number }[];
    const day = db.prepare(`SELECT MIN(price) low, MAX(price) high FROM stock_ticks WHERE ticker = ? AND ts >= ?`).get(s.ticker, ctx.now() - 86_400_000) as { low: number | null; high: number | null };
    return {
      stock: stockView(ctx, s),
      series: series(ctx, s.ticker, range),
      range,
      day: { low: day.low ?? s.price, high: day.high ?? s.price },
      position: pos ? { qty: pos.qty, cost: pos.cost, value: pos.qty * s.price, profit: pos.qty * s.price - pos.cost } : null,
      tape: tape.map((t) => ({ side: t.side, qty: t.qty, price: t.price, at: t.created_at })),
      feePct: FEE_PCT,
    };
  });

  app.post('/api/market/:ticker/quote', async (req) => {
    requireUser(req);
    const s = ticker((req.params as { ticker: string }).ticker);
    const b = z.object({ side: z.enum(['buy', 'sell']), qty: z.number().int().min(1).max(100_000) }).parse(req.body);
    return quote(s, b.side, b.qty);
  });

  app.post('/api/market/:ticker/trade', async (req) => {
    const u = requireUser(req);
    const s = ticker((req.params as { ticker: string }).ticker);
    const b = z.object({ side: z.enum(['buy', 'sell']), qty: z.number().int(), accountId: z.string() }).parse(req.body);
    const r = trade(ctx, u.id, ownedAccount(ctx, u.id, b.accountId), s.ticker, b.side, b.qty);
    audit(ctx, req, `stock_${b.side}`, 'stock', s.ticker, `${b.qty} × ${r.price}`);
    return r;
  });

  app.get('/api/portfolio', async (req) => portfolio(ctx, requireUser(req).id));

  // ---------- Admin ----------
  app.get('/api/admin/market', async () => ({
    stocks: listStocks(ctx).map((s) => ({ ...stockView(ctx, s), vol: s.vol, drift: s.drift, fair: s.fair, shopId: s.shop_id, holders: (db.prepare('SELECT COUNT(*) c FROM positions WHERE ticker = ?').get(s.ticker) as { c: number }).c })),
  }));

  app.post('/api/admin/market/:ticker', async (req) => {
    const s = ticker((req.params as { ticker: string }).ticker);
    const b = z.object({ halted: z.boolean().optional(), vol: z.number().min(0).max(1).optional(), drift: z.number().min(-0.05).max(0.05).optional(), fair: z.number().int().min(100).optional() }).parse(req.body);
    if (b.halted !== undefined) db.prepare('UPDATE stocks SET halted = ? WHERE ticker = ?').run(b.halted ? 1 : 0, s.ticker);
    if (b.vol !== undefined) db.prepare('UPDATE stocks SET vol = ? WHERE ticker = ?').run(b.vol, s.ticker);
    if (b.drift !== undefined) db.prepare('UPDATE stocks SET drift = ? WHERE ticker = ?').run(b.drift, s.ticker);
    if (b.fair !== undefined && s.driver === 'none') db.prepare('UPDATE stocks SET fair = ? WHERE ticker = ?').run(b.fair, s.ticker);
    audit(ctx, req, 'market_update', 'stock', s.ticker, JSON.stringify(b));
    return { ok: true };
  });

  // IPO of a GPAY shop: its price follows the shop's turnover.
  app.post('/api/admin/market', async (req) => {
    const b = z
      .object({
        ticker: z.string().trim().toUpperCase().regex(/^[A-Z]{3,5}$/, 'Тикер — 3–5 латинских букв'),
        name: z.string().trim().min(2).max(60),
        sector: z.string().trim().min(2).max(40).default('Торговля'),
        description: z.string().trim().max(300).default(''),
        price: z.number().int().min(100).max(10_000_000),
        floatShares: z.number().int().min(1000).max(100_000_000),
        shopId: z.number().int().optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#64748B'),
      })
      .parse(req.body);
    if (getStock(ctx, b.ticker)) throw new HttpError(409, 'Такой тикер уже есть');
    const now = ctx.now();
    db.prepare(
      `INSERT INTO stocks(ticker, name, sector, description, color, price, fair, vol, drift, float_shares, open_price, day_key, shop_id, driver, sort, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(b.ticker, b.name, b.sector, b.description, b.color, b.price, b.price, 0.08, 0.0003, b.floatShares, b.price, '', b.shopId ?? null, b.shopId ? 'shop' : 'none', 100, now);
    audit(ctx, req, 'market_ipo', 'stock', b.ticker, b.name);
    return { ok: true };
  });
}
