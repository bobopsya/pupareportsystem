export type Brand = 'visa' | 'mastercard' | 'mir' | 'unionpay';

export const BRAND_TITLE: Record<Brand, string> = { visa: 'Visa', mastercard: 'Mastercard', mir: 'МИР', unionpay: 'UnionPay' };

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

export function brandOf(pan: string): Brand | null {
  if (/^220[0-4]/.test(pan)) return 'mir';
  if (/^4/.test(pan)) return 'visa';
  const p4 = Number(pan.slice(0, 4));
  if (/^5[1-5]/.test(pan) || (p4 >= 2221 && p4 <= 2720)) return 'mastercard';
  if (/^62/.test(pan)) return 'unionpay';
  return null;
}

