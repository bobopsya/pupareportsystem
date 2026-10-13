import { ApiError } from '../context.js';

export const CURRENCIES = ['RUB', 'USD', 'EUR'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const isCurrency = (c: unknown): c is Currency => typeof c === 'string' && (CURRENCIES as readonly string[]).includes(c);

/** "1500.00" → 150000 minor units. */
export function parseAmount(value: unknown, parameter = 'amount.value'): number {
  const s = typeof value === 'number' ? value.toFixed(2) : String(value ?? '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) throw new ApiError(400, 'invalid_request', 'Некорректная сумма: ожидается строка вида "1500.00"', parameter);
  const [int, frac = ''] = s.split('.');
  const minor = Number(int) * 100 + Number(frac.padEnd(2, '0'));
  if (minor <= 0) throw new ApiError(400, 'invalid_request', 'Сумма должна быть больше нуля', parameter);
  return minor;
}

export const formatAmount = (minor: number) => (minor / 100).toFixed(2);

export const money = (minor: number, currency: string) => ({ value: formatAmount(minor), currency });

const SYMBOL: Record<string, string> = { RUB: '₽', USD: '$', EUR: '€' };

/** Human form for receipts and notifications: "1 500,00 ₽". */
export function humanMoney(minor: number, currency: string) {
  const [i, f] = formatAmount(minor).split('.');
  const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${int},${f} ${SYMBOL[currency] ?? currency}`;
}

/** Per-currency limits for one payment (minor units). */
export const LIMITS: Record<Currency, { min: number; max: number }> = {
  RUB: { min: 100, max: 100_000_000 },
  USD: { min: 50, max: 1_000_000 },
  EUR: { min: 50, max: 1_000_000 },
};
