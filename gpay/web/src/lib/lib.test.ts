import { describe, expect, it } from 'vitest';
import { brandOf, formatPan, luhn } from './cards';
import { money, plural, toAmount } from './format';

describe('cards', () => {
  it('detects brands and validates numbers', () => {
    expect(brandOf('2200')).toBe('mir');
    expect(brandOf('5555')).toBe('mastercard');
    expect(brandOf('2720')).toBe('mastercard');
    expect(brandOf('62')).toBe('unionpay');
    expect(brandOf('37')).toBe('amex');
    expect(luhn('4111111111111111')).toBe(true);
    expect(formatPan('4111111111111111')).toBe('4111 1111 1111 1111');
  });
});

describe('format', () => {
  it('formats money', () => {
    expect(money(150000)).toBe('1 500 ₽');
    expect(money(150050, 'USD')).toBe('1 500,50 $');
    expect(money(-100, 'EUR')).toBe('−1 €');
  });
  it('parses user amounts', () => {
    expect(toAmount('1 500,5')).toBe('1500.50');
    expect(toAmount('abc')).toBeNull();
    expect(toAmount('0')).toBeNull();
  });
  it('pluralizes', () => {
    expect(plural(1, 'платёж', 'платежа', 'платежей')).toBe('платёж');
    expect(plural(3, 'платёж', 'платежа', 'платежей')).toBe('платежа');
    expect(plural(11, 'платёж', 'платежа', 'платежей')).toBe('платежей');
  });
});
