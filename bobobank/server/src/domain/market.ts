import { HttpError, type Ctx } from '../context.js';
import { getSetting, setSetting } from '../db.js';
import { newId } from '../util.js';
import { requireKyc } from './gos.js';
import { getAccount, notify, post, systemAccount, type AccountRow } from './ledger.js';
import { humanMoney } from './money.js';

/**
 * Bobobank stock market (game). Each stock's price is a random walk pulled towards a fair value; clients'
 * trades move it too: buying pushes the price up, selling pushes it down, harder for bigger orders.
 */

export const TICK_MS = 5_000;
export const FEE_PCT = 0.3;
/** Price impact: buying 1 % of the free float moves the price by about IMPACT %. */
export const IMPACT = 4;
const DAY_MS = 86_400_000;
const MAX_STEP = 0.02; // a single tick moves the price by 2 % at most
const MAX_MINUTE = 0.15; // and 15 % within a minute

export interface StockRow {
  ticker: string;
  name: string;
  sector: string;
  description: string;
  color: string;
  price: number;
  fair: number;
  vol: number;
  drift: number;
  float_shares: number;
  flow: number;
  open_price: number;
  day_key: string;
  shop_id: number | null;
  driver: 'none' | 'bank' | 'gpay' | 'shop';
  halted: number;
  sort: number;
  created_at: number;
}

/** Fictional companies of planet Асей. Prices in kopecks; vol is daily volatility. */
const SEED: Omit<StockRow, 'flow' | 'open_price' | 'day_key' | 'halted' | 'created_at' | 'fair' | 'shop_id'>[] = [
  { ticker: 'BOBO', name: 'Бобобанк', sector: 'Финансы', description: 'Крупнейший банк Бобосоюза. Цена следит за деньгами клиентов на счетах.', color: '#21A038', price: 32_100, vol: 0.05, drift: 0.0004, float_shares: 1_000_000, driver: 'bank', sort: 1 },
  { ticker: 'GPAY', name: 'GnusaPay', sector: 'Финансы', description: 'Платёжный сервис: эквайринг, кассы, ссылки на оплату. Цена следит за оборотом магазинов.', color: '#5b3df5', price: 12_340, vol: 0.07, drift: 0.0005, float_shares: 800_000, driver: 'gpay', sort: 2 },
  { ticker: 'ZHUK', name: 'Жуконет', sector: 'Технологии', description: 'Интернет-провайдер и облако Асея. Хакеры его не любят.', color: '#0EA5E9', price: 43_210, vol: 0.09, drift: 0.0006, float_shares: 500_000, driver: 'none', sort: 3 },
  { ticker: 'SAMN', name: 'Саменка Речфлот', sector: 'Транспорт', description: 'Грузы и паромы по реке Саменка, доставка мигрантов между странами.', color: '#2563EB', price: 1_234, vol: 0.06, drift: 0.0002, float_shares: 3_000_000, driver: 'none', sort: 4 },
  { ticker: 'PSYE', name: 'Псяэнерго', sector: 'Энергетика', description: 'Электростанции и сети всего Бобосоюза. Скучно, но надёжно.', color: '#F59E0B', price: 3_210, vol: 0.035, drift: 0.0003, float_shares: 2_000_000, driver: 'none', sort: 5 },
  { ticker: 'GRMD', name: 'Гармод Девелопмент', sector: 'Недвижимость', description: 'Строит жильё и госучреждения в Гармоде и Псяленде.', color: '#A855F7', price: 4_321, vol: 0.06, drift: 0.0003, float_shares: 1_200_000, driver: 'none', sort: 6 },
  { ticker: 'BAGR', name: 'Бобостан Агро', sector: 'Сельское хозяйство', description: 'Поля, теплицы и сыроварни Бобостана.', color: '#65A30D', price: 2_123, vol: 0.05, drift: 0.0002, float_shares: 1_500_000, driver: 'none', sort: 7 },
];

export function ensureStocks(ctx: Ctx) {
  const now = ctx.now();
  const ins = ctx.db.prepare(
    `INSERT OR IGNORE INTO stocks(ticker, name, sector, description, color, price, fair, vol, drift, float_shares, open_price, day_key, driver, sort, created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const s of SEED) ins.run(s.ticker, s.name, s.sector, s.description, s.color, s.price, s.price, s.vol, s.drift, s.float_shares, s.price, dayKey(now), s.driver, s.sort, now);
}

export const getStock = (ctx: Ctx, ticker: string) => ctx.db.prepare('SELECT * FROM stocks WHERE ticker = ?').get(ticker) as StockRow | undefined;
export const listStocks = (ctx: Ctx) => ctx.db.prepare('SELECT * FROM stocks ORDER BY sort, ticker').all() as StockRow[];

/** Trading day in Moscow time: the day's change is counted from its first price. */
const dayKey = (ts: number) => new Date(ts + 3 * 3600_000).toISOString().slice(0, 10);

function gauss(rand: () => number) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

// ---------- Fair value ----------

interface Turnover {
  total30: number;
  shops: Record<string, { name: string; t30: number }>;
  at: number;
}
export const getTurnover = (ctx: Ctx) => getSetting<Turnover>(ctx.db, 'market_turnover', { total30: 0, shops: {}, at: 0 });
export function setTurnover(ctx: Ctx, t: Omit<Turnover, 'at'>) {
  setSetting(ctx.db, 'market_turnover', { ...t, at: ctx.now() });
}

/** Where the price is pulled to. Bobobank follows client money, GPAY its turnover, shops their own turnover. */
function fairValue(ctx: Ctx, s: StockRow): number {
  if (s.driver === 'bank') {
    const { total } = ctx.db.prepare(`SELECT COALESCE(SUM(balance), 0) total FROM accounts WHERE user_id IS NOT NULL AND currency = 'RUB' AND balance > 0`).get() as { total: number };
    // Each million roubles of deposits adds 1 %.
    return Math.round(32_100 * (1 + total / 100_000_000 / 100));
  }
  if (s.driver === 'gpay') {
    const t = getTurnover(ctx).total30;
    return Math.round(12_340 * (1 + t / 50_000_000 / 100));
  }
  if (s.driver === 'shop' && s.shop_id) {
    const t = getTurnover(ctx).shops[String(s.shop_id)]?.t30 ?? 0;
    // A year of turnover times two, spread over the shares (but not below 10 ₽).
    return Math.max(1_000, Math.round((t * 12 * 2) / s.float_shares));
  }
  return s.fair;
}

// ---------- Ticks ----------

function recordPrice(ctx: Ctx, ticker: string, ts: number, price: number, volume = 0) {
  ctx.db.prepare('INSERT INTO stock_ticks(ticker, ts, price) VALUES(?,?,?)').run(ticker, ts, price);
  for (const [res, size] of [['1m', 60_000], ['1d', DAY_MS]] as const) {
    const bucket = Math.floor(ts / size) * size;
    ctx.db
      .prepare(
        `INSERT INTO stock_candles(ticker, res, ts, o, h, l, c, volume) VALUES(?,?,?,?,?,?,?,?)
         ON CONFLICT(ticker, res, ts) DO UPDATE SET h = MAX(h, excluded.h), l = MIN(l, excluded.l), c = excluded.c, volume = volume + excluded.volume`,
      )
      .run(ticker, res, bucket, price, price, price, price, volume);
  }
}

/** One step of the market (every 5 seconds). `rand` is replaceable for tests. */
export function marketTick(ctx: Ctx, rand: () => number = Math.random) {
  const now = ctx.now();
  const dt = TICK_MS / DAY_MS;
  const today = dayKey(now);
  for (const s of listStocks(ctx)) {
    if (s.halted) continue;
    const fair = fairValue(ctx, s);
    // No momentum after trades on purpose: with it a big buy-then-sell would pay off. Trades move the price once,
    // then it drifts back towards the fair value.
    let step = s.drift * dt + s.vol * Math.sqrt(dt) * gauss(rand) + 0.5 * Math.log(fair / s.price) * dt * 24;
    step = Math.max(-MAX_STEP, Math.min(MAX_STEP, step));
    let price = Math.max(100, Math.round(s.price * Math.exp(step)));
    const minuteAgo = ctx.db.prepare('SELECT price FROM stock_ticks WHERE ticker = ? AND ts >= ? ORDER BY ts LIMIT 1').get(s.ticker, now - 60_000) as { price: number } | undefined;
    if (minuteAgo) price = Math.min(Math.round(minuteAgo.price * (1 + MAX_MINUTE)), Math.max(Math.round(minuteAgo.price * (1 - MAX_MINUTE)), price));
    const open = s.day_key === today ? s.open_price : s.price;
    ctx.db.prepare('UPDATE stocks SET price = ?, fair = ?, flow = ?, open_price = ?, day_key = ? WHERE ticker = ?').run(price, fair, s.flow * 0.7, open, today, s.ticker);
    recordPrice(ctx, s.ticker, now, price);
  }
  // Keep a day of 5-second ticks and a week of minute candles.
  ctx.db.prepare('DELETE FROM stock_ticks WHERE ts < ?').run(now - DAY_MS);
  ctx.db.prepare(`DELETE FROM stock_candles WHERE res = '1m' AND ts < ?`).run(now - 7 * DAY_MS);
}

// ---------- Trading ----------

export interface Position {
  user_id: string;
  ticker: string;
  qty: number;
  cost: number;
}

export const position = (ctx: Ctx, userId: string, ticker: string) =>
  ctx.db.prepare('SELECT * FROM positions WHERE user_id = ? AND ticker = ?').get(userId, ticker) as Position | undefined;

/** The price a market order gets: half of its own impact is paid as slippage. */
export function quote(s: StockRow, side: 'buy' | 'sell', qty: number) {
  const slip = (IMPACT * qty) / s.float_shares / 2;
  const price = side === 'buy' ? Math.ceil(s.price * (1 + slip)) : Math.max(1, Math.floor(s.price * (1 - slip)));
  const amount = price * qty;
  const fee = Math.max(1, Math.ceil((amount * FEE_PCT) / 100));
  return { price, amount, fee, total: side === 'buy' ? amount + fee : amount - fee };
}

export function trade(ctx: Ctx, userId: string, acc: AccountRow, ticker: string, side: 'buy' | 'sell', qty: number) {
  requireKyc(ctx, userId);
  if (!Number.isInteger(qty) || qty < 1 || qty > 100_000) throw new HttpError(400, 'Количество — от 1 до 100 000 акций');
  const s = getStock(ctx, ticker);
  if (!s) throw new HttpError(404, 'Бумага не найдена');
  if (s.halted) throw new HttpError(400, 'Торги по бумаге приостановлены');
  if (acc.currency !== 'RUB' || !['current', 'business'].includes(acc.kind)) throw new HttpError(400, 'Торговать можно с платёжного или бизнес-счёта в рублях');
  if (qty > s.float_shares * 0.05) throw new HttpError(400, `За раз можно не больше ${Math.floor(s.float_shares * 0.05).toLocaleString('ru-RU')} акций`);
  const pos = position(ctx, userId, ticker);
  if (side === 'sell' && (!pos || pos.qty < qty)) throw new HttpError(400, `У вас ${pos?.qty ?? 0} акций ${ticker}`);
  const q = quote(s, side, qty);
  const market = systemAccount(ctx, 'market', 'RUB');
  const fees = systemAccount(ctx, 'fees', 'RUB');
  const id = newId('trd', 16);
  const title = `${side === 'buy' ? 'Покупка' : 'Продажа'} ${ticker}`;
  const subtitle = `${qty} шт. × ${humanMoney(q.price, 'RUB')}`;
  let txId = '';
  ctx.db.transaction(() => {
    txId = post(ctx, {
      kind: side === 'buy' ? 'stock_buy' : 'stock_sell',
      description: `${title}: ${s.name}`,
      initiatorId: userId,
      meta: { trade: id, ticker, qty, price: q.price },
      legs:
        side === 'buy'
          ? [
              { account: acc, amount: -q.total, title, subtitle, category: 'other' },
              { account: market, amount: q.amount },
              { account: fees, amount: q.fee },
            ]
          : [
              { account: market, amount: -q.amount },
              { account: acc, amount: q.total, title, subtitle, category: 'income' },
              { account: fees, amount: q.fee },
            ],
    });
    if (side === 'buy') {
      ctx.db.prepare('INSERT INTO positions(user_id, ticker, qty, cost) VALUES(?,?,?,?) ON CONFLICT(user_id, ticker) DO UPDATE SET qty = qty + excluded.qty, cost = cost + excluded.cost').run(userId, ticker, qty, q.total);
    } else {
      const left = pos!.qty - qty;
      if (left === 0) ctx.db.prepare('DELETE FROM positions WHERE user_id = ? AND ticker = ?').run(userId, ticker);
      else ctx.db.prepare('UPDATE positions SET qty = ?, cost = ? WHERE user_id = ? AND ticker = ?').run(left, Math.round((pos!.cost * left) / pos!.qty), userId, ticker);
    }
    // The trade moves the price at once and leaves momentum for the next ticks.
    const signed = side === 'buy' ? qty : -qty;
    const moved = Math.max(100, Math.round(s.price * Math.exp((IMPACT * signed) / s.float_shares)));
    ctx.db.prepare('UPDATE stocks SET price = ?, flow = flow + ? WHERE ticker = ?').run(moved, signed, ticker);
    recordPrice(ctx, ticker, ctx.now(), moved, qty);
    ctx.db.prepare('INSERT INTO trades(id, user_id, ticker, side, qty, price, amount, fee, account_id, tx_id, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, userId, ticker, side, qty, q.price, q.amount, q.fee, acc.id, txId, ctx.now());
  })();
  notify(ctx, userId, 'invest', `${title} — ${qty} шт.`, `${humanMoney(q.total, 'RUB')} · ${s.name}`);
  const entry = ctx.db.prepare('SELECT id FROM entries WHERE tx_id = ? AND account_id = ?').get(txId, getAccount(ctx, acc.id)!.id) as { id: number };
  return { id, ...q, qty, ticker, entryId: entry.id, newPrice: getStock(ctx, ticker)!.price };
}

// ---------- Views ----------

export function stockView(ctx: Ctx, s: StockRow) {
  return {
    ticker: s.ticker,
    name: s.name,
    sector: s.sector,
    description: s.description,
    color: s.color,
    price: s.price,
    open: s.open_price,
    change: s.price - s.open_price,
    changePct: s.open_price ? ((s.price - s.open_price) / s.open_price) * 100 : 0,
    halted: !!s.halted,
    driver: s.driver,
    floatShares: s.float_shares,
    capitalization: s.price * s.float_shares,
  };
}

/** Price series for the chart: 5-second ticks for an hour, minute candles for a day or week, daily candles for longer. */
export function series(ctx: Ctx, ticker: string, range: '1h' | '1d' | '7d' | '30d') {
  const now = ctx.now();
  let rows: { ts: number; price: number }[];
  if (range === '1h') rows = ctx.db.prepare('SELECT ts, price FROM stock_ticks WHERE ticker = ? AND ts >= ? ORDER BY ts').all(ticker, now - 3600_000) as typeof rows;
  else if (range === '30d') rows = ctx.db.prepare(`SELECT ts, c price FROM stock_candles WHERE ticker = ? AND res = '1d' AND ts >= ? ORDER BY ts`).all(ticker, now - 30 * DAY_MS) as typeof rows;
  else rows = ctx.db.prepare(`SELECT ts, c price FROM stock_candles WHERE ticker = ? AND res = '1m' AND ts >= ? ORDER BY ts`).all(ticker, now - (range === '1d' ? DAY_MS : 7 * DAY_MS)) as typeof rows;
  // At most ~240 points: enough for a phone-width chart.
  const step = Math.max(1, Math.ceil(rows.length / 240));
  const out = rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
  return out.map((r) => [r.ts, r.price] as [number, number]);
}

export function portfolio(ctx: Ctx, userId: string) {
  const rows = ctx.db.prepare('SELECT p.*, s.name, s.price, s.color, s.open_price FROM positions p JOIN stocks s ON s.ticker = p.ticker WHERE p.user_id = ? ORDER BY p.cost DESC').all(userId) as (Position & { name: string; price: number; color: string; open_price: number })[];
  const items = rows.map((r) => {
    const value = r.price * r.qty;
    return { ticker: r.ticker, name: r.name, color: r.color, qty: r.qty, price: r.price, value, cost: r.cost, profit: value - r.cost, profitPct: r.cost ? ((value - r.cost) / r.cost) * 100 : 0, dayChange: (r.price - r.open_price) * r.qty };
  });
  const value = items.reduce((s, i) => s + i.value, 0);
  const cost = items.reduce((s, i) => s + i.cost, 0);
  return { items, value, cost, profit: value - cost, profitPct: cost ? ((value - cost) / cost) * 100 : 0, dayChange: items.reduce((s, i) => s + i.dayChange, 0) };
}
