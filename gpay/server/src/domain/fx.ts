import { getSetting, setSetting, type DB } from '../db.js';

/** Rubles per one unit of each currency / crypto asset. */
export interface Rates {
  USD: number;
  EUR: number;
  BTC: number;
  USDT: number;
  updatedAt: number;
}

export const DEFAULT_RATES: Rates = { USD: 81.4, EUR: 94.85, BTC: 8_915_000, USDT: 81.55, updatedAt: 0 };

export const getRates = (db: DB): Rates => ({ ...DEFAULT_RATES, ...getSetting<Partial<Rates>>(db, 'fx_rates', {}) });

export function setRates(db: DB, rates: Omit<Rates, 'updatedAt'>, now: number) {
  setSetting(db, 'fx_rates', { ...rates, updatedAt: now });
}

const rubPer = (r: Rates, currency: string) => (currency === 'RUB' ? 1 : (r[currency as keyof Rates] as number));

/** Converts minor units between RUB/USD/EUR. */
export function convert(rates: Rates, minor: number, from: string, to: string): number {
  if (from === to) return minor;
  return Math.round((minor * rubPer(rates, from)) / rubPer(rates, to));
}

/** Crypto amount (as a decimal string) for a fiat payment. */
export function cryptoAmount(rates: Rates, minor: number, currency: string, asset: 'BTC' | 'USDT'): string {
  const rub = (minor / 100) * rubPer(rates, currency);
  const v = rub / rates[asset];
  return asset === 'BTC' ? v.toFixed(8) : (Math.ceil(v * 100) / 100).toFixed(2);
}
