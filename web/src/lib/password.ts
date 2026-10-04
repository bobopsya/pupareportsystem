import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import { adjacencyGraphs, dictionary } from '@zxcvbn-ts/language-common';

let zxcvbn: ZxcvbnFactory | null = null;
function engine() {
  zxcvbn ??= new ZxcvbnFactory({ dictionary, graphs: adjacencyGraphs });
  return zxcvbn;
}

export const STRENGTH_LABEL = ['Очень слабый', 'Слабый', 'Средний', 'Хороший', 'Сильный'];

/** 0..4 (zxcvbn score). */
export function strength(password: string): number {
  if (!password) return 0;
  return engine().check(password.slice(0, 100)).score;
}

export interface GenOptions {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
  avoidAmbiguous: boolean;
}

export const DEFAULT_GEN: GenOptions = { length: 20, lower: true, upper: true, digits: true, symbols: true, avoidAmbiguous: true };

const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/~',
};
const AMBIGUOUS = /[Il1O0o|`'"]/g;

function randInt(max: number) {
  // Rejection sampling to avoid modulo bias.
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0]! >= limit);
  return buf[0]! % max;
}

export function generatePassword(o: GenOptions): string {
  const groups = (Object.keys(SETS) as (keyof typeof SETS)[])
    .filter((k) => o[k])
    .map((k) => (o.avoidAmbiguous ? SETS[k].replace(AMBIGUOUS, '') : SETS[k]));
  if (!groups.length) return '';
  const all = groups.join('');
  const length = Math.max(o.length, groups.length);
  // One character from each selected group, the rest from the union, then shuffle.
  const chars = groups.map((g) => g[randInt(g.length)]!);
  while (chars.length < length) chars.push(all[randInt(all.length)]!);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}
