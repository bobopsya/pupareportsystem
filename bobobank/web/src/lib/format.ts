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

/** "+7 900 123-45-67" as the user types. */
export function formatPhoneInput(raw: string) {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('8')) d = `7${d.slice(1)}`;
  if (d && !d.startsWith('7')) d = `7${d}`;
  d = d.slice(0, 11);
  const p = [d.slice(1, 4), d.slice(4, 7), d.slice(7, 9), d.slice(9, 11)];
  let out = '+7';
  if (p[0]) out += ` ${p[0]}`;
  if (p[1]) out += ` ${p[1]}`;
  if (p[2]) out += `-${p[2]}`;
  if (p[3]) out += `-${p[3]}`;
  return d ? out : '';
}

export const phoneDigits = (s: string) => s.replace(/\D/g, '');

/** "4276 1234 5678 9012" as the user types. */
export const formatPan = (s: string) => s.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');

/** "40817810…" grouped for reading: 40817 810 1 0000 1234567. */
export const formatAccount = (n: string) => n.replace(/^(\d{5})(\d{3})(\d)(\d{4})(\d{7})$/, '$1 $2 $3 $4 $5');

export const dayTitle = (ts: number, now = Date.now()) => {
  const d = new Date(ts).toLocaleDateString('ru-RU', { timeZone: tz });
  if (d === new Date(now).toLocaleDateString('ru-RU', { timeZone: tz })) return 'Сегодня';
  if (d === new Date(now - 86400000).toLocaleDateString('ru-RU', { timeZone: tz })) return 'Вчера';
  return new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric', month: 'long', weekday: 'long' }).format(ts);
};

export const timeOnly = (ts: number) => new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(ts);

export const monthTitle = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const s = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, 1)).replace(' г.', '');
  return s[0].toUpperCase() + s.slice(1);
};

/** Bonuses are stored like kopecks: 645 → "6,45". */
export const bonus = (v: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(v / 100);
