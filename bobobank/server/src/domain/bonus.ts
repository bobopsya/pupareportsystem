import { HttpError, type Ctx } from '../context.js';
import { safeJson } from '../util.js';
import { CASHBACK_CATEGORIES, CATEGORIES, type Category } from './bank.js';
import { TARIFFS, type Tariff } from './cards.js';
import { mainAccount, move, notify, systemAccount } from './ledger.js';

/** Raised-cashback categories chosen for a month: { "2026-10": ["groceries", "restaurants", "travel"] }. */
export type CashbackChoice = Record<string, Category[]>;
export const RAISED_CATEGORIES = 3;

export const monthKey = (ts: number) => new Date(ts).toISOString().slice(0, 7);

export function chosenCategories(cashbackJson: string, now: number): Category[] {
  return safeJson<CashbackChoice>(cashbackJson, {})[monthKey(now)] ?? [];
}

export function chooseCategories(ctx: Ctx, userId: string, cats: string[]) {
  const unique = [...new Set(cats)].filter((c): c is Category => (CASHBACK_CATEGORIES as string[]).includes(c));
  if (unique.length !== RAISED_CATEGORIES) throw new HttpError(400, `Выберите ровно ${RAISED_CATEGORIES} категории`);
  const row = ctx.db.prepare('SELECT cashback FROM users WHERE id = ?').get(userId) as { cashback: string };
  const all = safeJson<CashbackChoice>(row.cashback, {});
  const key = monthKey(ctx.now());
  if (all[key]?.length) throw new HttpError(400, 'Категории на этот месяц уже выбраны. Новые можно выбрать с 1-го числа.');
  all[key] = unique;
  ctx.db.prepare('UPDATE users SET cashback = ? WHERE id = ?').run(JSON.stringify(all), userId);
  return unique;
}

export function monthAccrued(ctx: Ctx, userId: string, now: number): number {
  const d = new Date(now);
  const from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  return (ctx.db.prepare('SELECT COALESCE(SUM(amount), 0) s FROM bonus_log WHERE user_id = ? AND amount > 0 AND created_at >= ?').get(userId, from) as { s: number }).s;
}

/** Bonuses for a card purchase (amount in rubles' minor units). Returns accrued hundredths of a bonus. */
export function accrueCashback(ctx: Ctx, userId: string, rubAmount: number, category: Category, merchant: string): number {
  const u = ctx.db.prepare('SELECT tariff, cashback FROM users WHERE id = ?').get(userId) as { tariff: Tariff; cashback: string } | undefined;
  if (!u) return 0;
  const t = TARIFFS[u.tariff] ?? TARIFFS.standard;
  const raised = chosenCategories(u.cashback, ctx.now()).includes(category);
  const pct = raised ? t.cashbackRaised : t.cashbackBase;
  const room = Math.max(0, t.cashbackCap - monthAccrued(ctx, userId, ctx.now()));
  const pts = Math.min(room, Math.floor((rubAmount * pct) / 100));
  if (pts <= 0) return 0;
  ctx.db.prepare('UPDATE users SET bonus = bonus + ? WHERE id = ?').run(pts, userId);
  ctx.db.prepare('INSERT INTO bonus_log(user_id, amount, title, category, created_at) VALUES(?,?,?,?,?)').run(userId, pts, `${merchant} · ${pct}%`, category, ctx.now());
  return pts;
}

/** Takes back bonuses for a refunded purchase (never below zero). */
export function reverseCashback(ctx: Ctx, userId: string, pts: number, merchant: string) {
  if (pts <= 0) return;
  const { bonus } = ctx.db.prepare('SELECT bonus FROM users WHERE id = ?').get(userId) as { bonus: number };
  const take = Math.min(bonus, pts);
  if (!take) return;
  ctx.db.prepare('UPDATE users SET bonus = bonus - ? WHERE id = ?').run(take, userId);
  ctx.db.prepare('INSERT INTO bonus_log(user_id, amount, title, created_at) VALUES(?,?,?,?)').run(userId, -take, `Возврат покупки: ${merchant}`, ctx.now());
}

/** Bonuses → rubles on the main account, 1 : 1. */
export function redeemBonus(ctx: Ctx, userId: string, amount: number) {
  const { bonus } = ctx.db.prepare('SELECT bonus FROM users WHERE id = ?').get(userId) as { bonus: number };
  if (amount <= 0 || amount > bonus) throw new HttpError(400, 'Недостаточно бонусов');
  if (amount < 10_000) throw new HttpError(400, 'Обменять можно от 100 бонусов');
  const acc = mainAccount(ctx, userId);
  if (!acc) throw new HttpError(400, 'Нет рублёвого счёта для зачисления');
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE users SET bonus = bonus - ? WHERE id = ?').run(amount, userId);
    ctx.db.prepare('INSERT INTO bonus_log(user_id, amount, title, created_at) VALUES(?,?,?,?)').run(userId, -amount, 'Обмен на рубли', ctx.now());
    move(ctx, systemAccount(ctx, 'bonus', 'RUB'), acc, amount, 'bonus_redeem', { to: { title: 'Бобобонусы', subtitle: 'Обмен бонусов на рубли', category: 'bonus' }, initiatorId: userId });
  })();
  notify(ctx, userId, 'bonus', 'Бонусы обменяны на рубли', `${(amount / 100).toFixed(0)} ₽ зачислены на счёт`);
}

export const CATEGORY_LIST = Object.entries(CATEGORIES).map(([id, c]) => ({ id, title: c.title }));
