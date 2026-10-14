import { HttpError, type Ctx } from '../context.js';
import { getSetting, setSetting, type DB } from '../db.js';
import { CURRENCIES } from './money.js';
import { post, type AccountRow, systemAccount } from './ledger.js';

/** Central rates (rubles per unit) and the bank's spread in percent (split between buy and sell). */
export interface FxSettings {
  USD: number;
  EUR: number;
  spread: number;
  updatedAt: number;
}

export const DEFAULT_FX: FxSettings = { USD: 81.4, EUR: 94.85, spread: 3, updatedAt: 0 };

export const getFx = (db: DB): FxSettings => ({ ...DEFAULT_FX, ...getSetting<Partial<FxSettings>>(db, 'fx', {}) });
export const setFx = (db: DB, fx: Omit<FxSettings, 'updatedAt'>, now: number) => setSetting(db, 'fx', { ...fx, updatedAt: now });

const mid = (fx: FxSettings, c: string) => (c === 'RUB' ? 1 : fx[c as 'USD' | 'EUR']);

/** Rubles per unit at which the bank sells (customer buys) and buys (customer sells) a currency. */
export function board(fx: FxSettings) {
  return (['USD', 'EUR'] as const).map((c) => ({
    currency: c,
    cb: fx[c],
    buy: Math.round(fx[c] * (1 - fx.spread / 200) * 100) / 100,
    sell: Math.round(fx[c] * (1 + fx.spread / 200) * 100) / 100,
  }));
}

/** Converts `amount` (minor units of `from`) into `to` at customer rates: the bank's spread always applies. */
export function convertCustomer(fx: FxSettings, amount: number, from: string, to: string): { result: number; rate: number } {
  if (from === to) return { result: amount, rate: 1 };
  const half = fx.spread / 200;
  const rubPerFrom = from === 'RUB' ? 1 : mid(fx, from) * (1 - half);
  const rubPerTo = to === 'RUB' ? 1 : mid(fx, to) * (1 + half);
  const result = Math.floor((amount * rubPerFrom) / rubPerTo);
  return { result, rate: rubPerFrom / rubPerTo };
}

/** How much of `from` is needed to get exactly `amount` of `to` (card purchases in a foreign currency). */
export function costIn(fx: FxSettings, amount: number, to: string, from: string): number {
  if (from === to) return amount;
  const half = fx.spread / 200;
  const rubPerFrom = from === 'RUB' ? 1 : mid(fx, from) * (1 - half);
  const rubPerTo = to === 'RUB' ? 1 : mid(fx, to) * (1 + half);
  return Math.ceil((amount * rubPerTo) / rubPerFrom);
}

/** Legs that route money through the bank's FX position when two accounts have different currencies. */
export function fxLegs(ctx: Ctx, fromCur: string, fromAmount: number, toCur: string, toAmount: number) {
  if (fromCur === toCur) return [];
  return [
    { account: systemAccount(ctx, 'fx', fromCur), amount: fromAmount },
    { account: systemAccount(ctx, 'fx', toCur), amount: -toAmount },
  ];
}

export function exchange(ctx: Ctx, userId: string, from: AccountRow, to: AccountRow, amount: number) {
  if (from.currency === to.currency) throw new HttpError(400, 'Выберите счета в разных валютах');
  if (!CURRENCIES.includes(from.currency as never) || !CURRENCIES.includes(to.currency as never)) throw new HttpError(400, 'Валюта не поддерживается');
  const fx = getFx(ctx.db);
  const { result, rate } = convertCustomer(fx, amount, from.currency, to.currency);
  if (result <= 0) throw new HttpError(400, 'Слишком маленькая сумма для обмена');
  const desc = `Обмен ${from.currency} → ${to.currency}`;
  const txId = post(ctx, {
    kind: 'fx',
    description: desc,
    initiatorId: userId,
    meta: { rate, amount, result },
    legs: [
      { account: from, amount: -amount, title: 'Обмен валюты', subtitle: `${from.currency} → ${to.currency}`, category: 'fx' },
      ...fxLegs(ctx, from.currency, amount, to.currency, result),
      { account: to, amount: result, title: 'Обмен валюты', subtitle: `${from.currency} → ${to.currency}`, category: 'fx' },
    ],
  });
  return { txId, result, rate };
}
