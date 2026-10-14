import type { DB } from '../db.js';

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

/** What happens when a game card is charged. */
export const OUTCOMES = {
  success: { title: 'Успешная оплата' },
  three_ds: { title: 'Успех после проверки банком (3-D Secure)' },
  insufficient_funds: { title: 'Недостаточно средств', party: 'payment_network', message: 'Недостаточно средств на карте. Пополните баланс или выберите другую карту.' },
  card_expired: { title: 'Истёк срок действия карты', party: 'issuer', message: 'Срок действия карты истёк. Оплатите другой картой.' },
  issuer_unavailable: { title: 'Банк-эмитент недоступен', party: 'issuer', message: 'Банк, выпустивший карту, не отвечает. Попробуйте ещё раз через несколько минут.' },
  general_decline: { title: 'Отказ банка', party: 'issuer', message: 'Банк отклонил операцию. Обратитесь в банк или выберите другую карту.' },
  invalid_csc: { title: 'Неверный CVC', party: 'payment_network', message: 'Неверный код CVC/CVV. Проверьте три цифры на обороте карты.' },
  card_blocked: { title: 'Карта заблокирована', party: 'issuer', message: 'Карта заблокирована банком. Выберите другую карту.' },
  limit_exceeded: { title: 'Превышен лимит', party: 'issuer', message: 'Превышен лимит операций по карте. Измените лимит в приложении банка.' },
} as const satisfies Record<string, { title: string; party?: string; message?: string }>;

export type Outcome = keyof typeof OUTCOMES;
export const isOutcome = (o: unknown): o is Outcome => typeof o === 'string' && o in OUTCOMES;

export const DEFAULT_GAME_CARDS: { pan: string; outcome: Outcome; label: string }[] = [
  { pan: '4111111111111111', outcome: 'success', label: 'Visa · успех' },
  { pan: '5555555555554444', outcome: 'success', label: 'Mastercard · успех' },
  { pan: '2200000000000004', outcome: 'success', label: 'МИР · успех' },
  { pan: '6200000000000005', outcome: 'success', label: 'UnionPay · успех' },
  { pan: '4000000000003220', outcome: 'three_ds', label: 'Visa · 3-D Secure' },
  { pan: '2200000000000053', outcome: 'three_ds', label: 'МИР · 3-D Secure' },
  { pan: '4000000000009995', outcome: 'insufficient_funds', label: 'Недостаточно средств' },
  { pan: '4000000000000069', outcome: 'card_expired', label: 'Истёк срок карты' },
  { pan: '4000000000000119', outcome: 'issuer_unavailable', label: 'Банк недоступен' },
  { pan: '4000000000000002', outcome: 'general_decline', label: 'Отказ банка' },
  { pan: '4000000000000127', outcome: 'invalid_csc', label: 'Неверный CVC' },
  { pan: '5105105105105100', outcome: 'card_blocked', label: 'Карта заблокирована' },
  { pan: '2200000000000012', outcome: 'limit_exceeded', label: 'Превышен лимит' },
];

export function seedGameCards(db: DB, now: number) {
  const { c } = db.prepare('SELECT COUNT(*) c FROM game_cards').get() as { c: number };
  if (c > 0) return;
  const ins = db.prepare('INSERT INTO game_cards(pan, outcome, label, created_at) VALUES(?,?,?,?)');
  for (const card of DEFAULT_GAME_CARDS) ins.run(card.pan, card.outcome, card.label, now);
}

export interface GameCard {
  pan: string;
  outcome: Outcome;
  label: string;
}

export function findGameCard(db: DB, pan: string): GameCard | undefined {
  return db.prepare('SELECT pan, outcome, label FROM game_cards WHERE pan = ?').get(pan) as GameCard | undefined;
}
