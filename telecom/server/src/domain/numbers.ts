import { HttpError, type Ctx } from '../context.js';

/** Codes after +7 that Бобтелеком hands out. */
const CODES = ['900', '901', '902', '904', '908', '950', '951', '958', '977', '999'];
/** The sender of service messages. */
export const SYSTEM_SENDER = 'BOBTEL';

/** «+7 (999) 123-45-67», «89991234567», «9991234567» → «79991234567». */
export function normalize(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.length === 10 && d[0] === '9') d = '7' + d;
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  return /^79\d{9}$/.test(d) ? d : null;
}

export const formatNumber = (n: string) => (n === SYSTEM_SENDER ? 'Бобтелеком' : /^7\d{10}$/.test(n) ? `+7 ${n.slice(1, 4)} ${n.slice(4, 7)}-${n.slice(7, 9)}-${n.slice(9)}` : n);

/** A «красивый» number costs extra: the more regular its last seven digits, the more. Rubles. */
export function numberPrice(n: string): number {
  const d = n.slice(4);
  const same = (s: string) => s.split('').every((c) => c === s[0]);
  const run = (s: string) => '0123456789'.includes(s) || '9876543210'.includes(s);
  if (same(d)) return 5000;
  if (same(d.slice(3)) || d.slice(3) === '0000') return 3000;
  if (d.slice(1, 3) + d.slice(1, 3) + d.slice(1, 3) === d.slice(1) || (d.slice(1, 4) === d.slice(4, 7) && d[0] === d[1])) return 1500;
  if (d.slice(3, 5) === d.slice(5, 7) || run(d.slice(3))) return 1000;
  if (same(d.slice(4)) || d.slice(5) === '00') return 500;
  return 0;
}

export const isTaken = (ctx: Ctx, n: string) => !!ctx.db.prepare(`SELECT 1 FROM lines WHERE number = ? AND status != 'closed'`).get(n);

const digit = (ctx: Ctx) => String(Math.floor(ctx.random() * 10));
const digits = (ctx: Ctx, k: number) => Array.from({ length: k }, () => digit(ctx)).join('');
const code = (ctx: Ctx) => CODES[Math.floor(ctx.random() * CODES.length)];

/** Free numbers to choose from: plain ones, beautiful ones or ending with the digits typed. */
export function offerNumbers(ctx: Ctx, kind: 'plain' | 'beautiful', q = '', premium = false) {
  const want = q.replace(/\D/g, '').slice(0, 7);
  const out = new Map<string, number>();
  for (let i = 0; i < 400 && out.size < 8; i++) {
    let n: string;
    if (want) n = `7${code(ctx)}${digits(ctx, 7 - want.length)}${want}`;
    else if (kind === 'plain') n = `7${code(ctx)}${digits(ctx, 7)}`;
    else {
      const [a, b, c] = [digit(ctx), digit(ctx), digit(ctx)];
      const shapes = [`${a}${b}${c}0000`, `${a}${b}${c}${b}${b}${b}${b}`, `${a}${b}${c}${a}${b}${c}${c}`, `${a}${b}${c}${b}${c}${b}${c}`, `${a}${b}${c}1234`, `${a}${b}${c}${b}${c}00`, `${a}${a}${a}${a}${a}${a}${a}`, `${a}${b}${c}${c}${c}${c}${c}`];
      n = `7${code(ctx)}${shapes[Math.floor(ctx.random() * shapes.length)]}`;
    }
    const price = numberPrice(n);
    if (!want && kind === 'plain' && price > 0) continue;
    if (!want && kind === 'beautiful' && price === 0) continue;
    if (!out.has(n) && !isTaken(ctx, n)) out.set(n, price);
  }
  return [...out].map(([number, price]) => ({ number, formatted: formatNumber(number), price: premium ? Math.round(price / 2) : price })).sort((a, b) => a.price - b.price);
}

export function assertFree(ctx: Ctx, n: string) {
  if (isTaken(ctx, n)) throw new HttpError(409, 'Этот номер уже заняли — выберите другой', 'number_taken');
}
