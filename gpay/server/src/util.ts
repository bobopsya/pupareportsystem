import crypto from 'node:crypto';

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function randomString(len: number, alphabet = B62): string {
  const out: string[] = [];
  const max = 256 - (256 % alphabet.length);
  while (out.length < len) {
    for (const b of crypto.randomBytes(len * 2)) {
      if (b < max && out.length < len) out.push(alphabet[b % alphabet.length]);
    }
  }
  return out.join('');
}

export const newId = (prefix: string, len = 24) => `${prefix}_${randomString(len)}`;

export function randomDigits(len: number): string {
  return randomString(len, '0123456789');
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function hmacHex(key: string, data: string) {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

export function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : undefined);
