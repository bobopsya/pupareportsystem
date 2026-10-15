const tz = 'Europe/Moscow';

/** 41200 → «412 ₽»; kopecks only when there are any. */
export function rub(minor: number) {
  const exact = minor % 100 !== 0;
  return `${(minor / 100).toLocaleString('ru-RU', { minimumFractionDigits: exact ? 2 : 0, maximumFractionDigits: exact ? 2 : 0 })} ₽`;
}

export const km = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} м` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0).replace('.', ',')} км`);

export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export const minutes = (s: number) => {
  const m = Math.max(1, Math.round(s / 60));
  return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`;
};

export const clock = (ts: number) => new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(ts);
export const dayTime = (ts: number) => new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(ts).replace(' в ', ', ');
export const dayLabel = (ts: number) => {
  const d = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric', month: 'long' });
  const today = d.format(Date.now());
  const yesterday = d.format(Date.now() - 86400_000);
  const s = d.format(ts);
  return s === today ? 'Сегодня' : s === yesterday ? 'Вчера' : s;
};
