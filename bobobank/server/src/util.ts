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

/** AES-256-GCM for card numbers and CVC at rest (key derived from the server secret). */
export function encrypt(secret: string, plain: string): string {
  const key = crypto.createHash('sha256').update(`${secret}:card-data`).digest();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(secret: string, data: string): string {
  const key = crypto.createHash('sha256').update(`${secret}:card-data`).digest();
  const [iv, tag, enc] = data.split('.').map((s) => Buffer.from(s, 'base64url'));
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

export const DAY = 24 * 3600_000;
