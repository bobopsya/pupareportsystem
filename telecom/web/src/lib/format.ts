const tz = 'Europe/Moscow';

/** 41200 → «412 ₽»; kopecks only when there are any. */
export function rub(minor: number) {
  const exact = minor % 100 !== 0;
  return `${(minor / 100).toLocaleString('ru-RU', { minimumFractionDigits: exact ? 2 : 0, maximumFractionDigits: exact ? 2 : 0 })} ₽`;
}


export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}


export const clock = (ts: number) => new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(ts);
export const dayTime = (ts: number) => new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(ts).replace(' в ', ', ');
export const dayLabel = (ts: number) => {
  const d = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric', month: 'long' });
  const today = d.format(Date.now());
  const yesterday = d.format(Date.now() - 86400_000);
  const s = d.format(ts);
  return s === today ? 'Сегодня' : s === yesterday ? 'Вчера' : s;
};

/** Megabytes → «12,5 ГБ» / «640 МБ». */
export const data = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(mb >= 10 * 1024 ? 0 : 1).replace('.', ',')} ГБ` : `${Math.round(mb)} МБ`);
/** 125 → «2:05». */
export const talk = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const day = (ts: number) => new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric', month: 'long' }).format(ts);
/** «+123 999 123-45-67» as one types: digits only, grouped; the +123 code is added by itself. */
export function typePhone(raw: string) {
  let d = raw.replace(/\D/g, '');
  if (d && !d.startsWith('123') && !'123'.startsWith(d)) d = '123' + d;
  d = d.slice(0, 13);
  const p = [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9), d.slice(9, 11), d.slice(11, 13)];
  let out = d ? `+${p[0]}` : '';
  if (p[1]) out += ` ${p[1]}`;
  if (p[2]) out += ` ${p[2]}`;
  if (p[3]) out += `-${p[3]}`;
  if (p[4]) out += `-${p[4]}`;
  return out;
}
export const phoneDigits = (s: string) => s.replace(/\D/g, '');
/** Full Бобтелеком number: +123 and ten digits. */
export const fullNumber = (s: string) => phoneDigits(s).length === 13;
export const formatNumber = (n: string) => typePhone(n);
