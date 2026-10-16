import crypto from 'node:crypto';

/** Requests from Бобо.Транспорт to the bank: X-Bank-Signature: t=<unix>,v1=hex(HMAC-SHA256(secret, "t.METHOD.path.body")). */
export const SIGNATURE_HEADER = 'x-bank-signature';
export const MAX_SKEW_S = 300;

export function sign(secret: string, method: string, path: string, body: string, t = Math.floor(Date.now() / 1000)) {
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${method.toUpperCase()}.${path}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

export function verify(secret: string, header: string | undefined, method: string, path: string, body: string, nowS = Math.floor(Date.now() / 1000)): boolean {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(nowS - t) > MAX_SKEW_S || !parts.v1) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${method.toUpperCase()}.${path}.${body}`).digest('hex');
  const a = Buffer.from(parts.v1, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
