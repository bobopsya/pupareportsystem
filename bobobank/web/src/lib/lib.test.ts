import { describe, expect, it } from 'vitest';
import { parsePaymentRef } from '../app/Payments';
import { formatAccount, formatPan, formatPhoneInput, money, phoneDigits, toAmount } from './format';

describe('format', () => {
  it('formats phone numbers as the user types', () => {
    expect(formatPhoneInput('89001112233')).toBe('+7 900 111-22-33');
    expect(formatPhoneInput('900')).toBe('+7 900');
    expect(formatPhoneInput('1239041888800')).toBe('+123 904 188-88-00');
    expect(formatPhoneInput('12')).toBe('+12');
    expect(phoneDigits('+7 900 111-22-33')).toBe('79001112233');
  });
  it('formats card and account numbers', () => {
    expect(formatPan('2204551234567891')).toBe('2204 5512 3456 7891');
    expect(formatAccount('40817810100001234567')).toBe('40817 810 1 0000 1234567');
  });
  it('formats and parses money', () => {
    const plain = (v: string) => v.replace(/\s/g, ' ');
    expect(plain(money(129000))).toBe('1 290 ₽');
    expect(plain(money(-50, 'USD'))).toBe('−0,50 $');
    expect(toAmount('1 290,5')).toBe('1290.50');
  });
  it('reads GPAY payment ids from QR links', () => {
    expect(parsePaymentRef('https://bank.example/sbp/pay?payment=pay_ABC123')).toBe('pay_ABC123');
    expect(parsePaymentRef('https://pay.example/pay/pay_XYZ')).toBe('pay_XYZ');
    expect(parsePaymentRef('pay_Q1w2')).toBe('pay_Q1w2');
    expect(parsePaymentRef('привет')).toBeNull();
  });
});
