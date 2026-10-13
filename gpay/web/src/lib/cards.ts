export type Brand = 'visa' | 'mastercard' | 'mir' | 'unionpay';

export function luhn(pan: string): boolean {
  if (!/^\d{12,19}$/.test(pan)) return false;
  let sum = 0;
  for (let i = 0; i < pan.length; i++) {
    let d = Number(pan[pan.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Brand by BIN; recognises a few unsupported schemes too, so the form can say so. */
export function brandOf(pan: string): Brand | 'amex' | 'jcb' | null {
  if (/^220[0-4]/.test(pan)) return 'mir';
  if (/^4/.test(pan)) return 'visa';
  const p4 = Number(pan.slice(0, 4).padEnd(4, '0'));
  if (/^5[1-5]/.test(pan) || (pan.length >= 4 && p4 >= 2221 && p4 <= 2720)) return 'mastercard';
  if (/^62/.test(pan)) return 'unionpay';
  if (/^3[47]/.test(pan)) return 'amex';
  if (/^35/.test(pan)) return 'jcb';
  return null;
}

export const formatPan = (digits: string) => digits.replace(/(\d{4})(?=\d)/g, '$1 ');

export async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
