export const CURRENCY_SYMBOL: Record<string, string> = { RUB: '₽', USD: '$', EUR: '€' };

/** 150000, 'RUB' → "1 500 ₽" (kopecks only when non-zero, unless `exact`). */
export function money(minor: number, currency = 'RUB', opts: { exact?: boolean; sign?: boolean } = {}) {
  const v = minor / 100;
  const frac = opts.exact || minor % 100 !== 0 ? 2 : 0;
  const s = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: frac, maximumFractionDigits: frac }).format(Math.abs(v));
  const sign = minor < 0 ? '−' : opts.sign && minor > 0 ? '+' : '';
  return `${sign}${s} ${CURRENCY_SYMBOL[currency] ?? currency}`;
}

/** Compact axis labels: 12 400 → "12,4 тыс". */
export function compact(minor: number) {
  const v = minor / 100;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} тыс`;
  return v.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

const tz = 'Europe/Moscow';
export const dateTime = (ts: number) => new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(ts).replace(',', '');
export const dateTimeSec = (ts: number) => new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(ts);
export const shortDate = (ts: number) => new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric', month: 'short' }).format(ts).replace('.', '');
export const longDate = (ts: number) => new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric', month: 'long', year: 'numeric' }).format(ts);

export function ago(ts: number, now = Date.now()) {
  const s = Math.round((now - ts) / 1000);
  if (s < 45) return 'только что';
  if (s < 3600) return `${Math.round(s / 60)} мин назад`;
  if (s < 86400) return `${Math.round(s / 3600)} ч назад`;
  return dateTime(ts);
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** "1500,5" / "1 500.50" → "1500.50" for the API, or null. */
export function toAmount(s: string): string | null {
  const v = s.replace(/\s| /g, '').replace(',', '.');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(v) || Number(v) <= 0) return null;
  return Number(v).toFixed(2);
}

export const REASONS: Record<string, string> = {
  insufficient_funds: 'Недостаточно средств',
  card_expired: 'Истёк срок карты',
  issuer_unavailable: 'Банк недоступен',
  general_decline: 'Отказ банка',
  invalid_csc: 'Неверный CVC',
  card_blocked: 'Карта заблокирована',
  limit_exceeded: 'Превышен лимит',
  '3d_secure_failed': 'Не пройден 3-D Secure',
  expired_on_confirmation: 'Истёк срок оплаты',
  expired_on_capture: 'Истёк срок подтверждения',
  canceled_by_merchant: 'Отменён магазином',
  too_many_attempts: 'Много неудачных попыток',
};

export const METHOD_TITLE: Record<string, string> = { bank_card: 'Карта', sbp: 'СБП', installments: 'Частями', crypto: 'Крипта' };
