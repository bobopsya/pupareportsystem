import { HttpError, type Ctx } from '../context.js';
import { decrypt, encrypt, newId, randomDigits, safeJson, sha256 } from '../util.js';
import { getAccount, type AccountRow } from './ledger.js';

export const NETWORKS = ['mir', 'visa', 'mastercard', 'unionpay'] as const;
export type Network = (typeof NETWORKS)[number];
export const NETWORK_TITLE: Record<Network, string> = { mir: 'МИР', visa: 'Visa', mastercard: 'Mastercard', unionpay: 'UnionPay' };

/** Bobobank's own BIN ranges. GPAY accepts only numbers it can find among issued cards, never arbitrary ones. */
export const BINS: Record<Network, string> = { mir: '220455', visa: '410533', mastercard: '539921', unionpay: '625877' };

export const TARIFFS = {
  standard: { title: 'Бобокарта', fee: 0, cashbackBase: 0.5, cashbackRaised: 3, cashbackCap: 300_000, transferFree: 10_000_000 },
  prime: { title: 'Bobo Prime', fee: 39_900, cashbackBase: 1.5, cashbackRaised: 7, cashbackCap: 1_500_000, transferFree: 100_000_000 },
  kids: { title: 'Детская', fee: 0, cashbackBase: 1, cashbackRaised: 3, cashbackCap: 100_000, transferFree: 1_000_000 },
} as const;
export type Tariff = keyof typeof TARIFFS;

export const DESIGNS = {
  green: 'Зелёная',
  black: 'Чёрная',
  white: 'Белая',
  silver: 'Серебряная',
  prime: 'Prime',
  kids: 'Детская',
} as const;
export type Design = keyof typeof DESIGNS;

export interface CardLimits {
  /** Per-month purchase limit in account currency (0 = no limit). */
  monthly: number;
  online: boolean;
}

export interface CardRow {
  id: string;
  user_id: string;
  account_id: string;
  network: Network;
  kind: 'debit' | 'credit';
  form: 'plastic' | 'virtual';
  tariff: Tariff;
  design: Design;
  holder: string;
  pan_enc: string;
  pan_hash: string;
  first6: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  cvc_enc: string;
  status: 'active' | 'frozen' | 'blocked' | 'closed';
  status_reason: string | null;
  limits: string;
  confirm_purchases: number;
  created_at: number;
}

export function luhnDigit(partial: string): number {
  let sum = 0;
  for (let i = 0; i < partial.length; i++) {
    let d = Number(partial[partial.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

export function luhn(pan: string): boolean {
  return /^\d{12,19}$/.test(pan) && luhnDigit(pan.slice(0, -1)) === Number(pan.at(-1));
}

const TRANSLIT: Record<string, string> = {
  а: 'A', б: 'B', в: 'V', г: 'G', д: 'D', е: 'E', ё: 'E', ж: 'ZH', з: 'Z', и: 'I', й: 'I', к: 'K', л: 'L', м: 'M', н: 'N', о: 'O', п: 'P', р: 'R', с: 'S', т: 'T', у: 'U', ф: 'F', х: 'KH', ц: 'TS', ч: 'CH', ш: 'SH', щ: 'SHCH', ъ: 'IE', ы: 'Y', ь: '', э: 'E', ю: 'IU', я: 'IA',
};

/** "Иван Петров" → "IVAN PETROV" (ICAO transliteration, as on Russian cards). */
export function embossName(name: string): string {
  return name
    .toLowerCase()
    .split('')
    .map((c) => TRANSLIT[c] ?? c.toUpperCase())
    .join('')
    .replace(/[^A-Z \-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 26);
}

export function issueCard(ctx: Ctx, opts: { userId: string; account: AccountRow; network: Network; kind: 'debit' | 'credit'; form: 'plastic' | 'virtual'; tariff: Tariff; design: Design; holder: string }): CardRow {
  const now = new Date(ctx.now());
  let pan = '';
  for (let tries = 0; tries < 20; tries++) {
    const partial = BINS[opts.network] + randomDigits(9);
    pan = partial + luhnDigit(partial);
    if (!ctx.db.prepare('SELECT 1 FROM cards WHERE pan_hash = ?').get(sha256(pan))) break;
  }
  const cvc = randomDigits(3);
  const id = newId('card', 16);
  const limits: CardLimits = { monthly: opts.tariff === 'kids' ? 1_500_000 : 0, online: true };
  ctx.db
    .prepare(
      `INSERT INTO cards(id, user_id, account_id, network, kind, form, tariff, design, holder, pan_enc, pan_hash, first6, last4, exp_month, exp_year, cvc_enc, status, limits, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?)`,
    )
    .run(
      id, opts.userId, opts.account.id, opts.network, opts.kind, opts.form, opts.tariff, opts.design, embossName(opts.holder) || 'BOBOBANK CLIENT',
      encrypt(ctx.secret, pan), sha256(pan), pan.slice(0, 6), pan.slice(-4), now.getUTCMonth() + 1, (now.getUTCFullYear() + 4) % 100,
      encrypt(ctx.secret, cvc), JSON.stringify(limits), ctx.now(),
    );
  return getCard(ctx, id)!;
}

export const getCard = (ctx: Ctx, id: string) => ctx.db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as CardRow | undefined;

export function ownedCard(ctx: Ctx, userId: string, id: string): CardRow {
  const c = getCard(ctx, id);
  if (!c || c.user_id !== userId) throw new HttpError(404, 'Карта не найдена');
  return c;
}

export const findCardByPan = (ctx: Ctx, pan: string) => ctx.db.prepare('SELECT * FROM cards WHERE pan_hash = ?').get(sha256(pan)) as CardRow | undefined;

export function cardExpired(c: CardRow, now: number): boolean {
  const d = new Date(now);
  const y = d.getUTCFullYear() % 100;
  const m = d.getUTCMonth() + 1;
  return c.exp_year < y || (c.exp_year === y && c.exp_month < m);
}

export const STATUS_TITLE: Record<CardRow['status'], string> = { active: 'Активна', frozen: 'Заморожена', blocked: 'Заблокирована банком', closed: 'Закрыта' };

export function serializeCard(ctx: Ctx, c: CardRow) {
  const acc = getAccount(ctx, c.account_id);
  return {
    id: c.id,
    network: c.network,
    networkTitle: NETWORK_TITLE[c.network],
    kind: c.kind,
    form: c.form,
    tariff: c.tariff,
    tariffTitle: TARIFFS[c.tariff].title,
    design: c.design,
    holder: c.holder,
    masked: `${c.first6.slice(0, 4)} ${c.first6.slice(4)}•• •••• ${c.last4}`,
    last4: c.last4,
    exp: `${String(c.exp_month).padStart(2, '0')}/${String(c.exp_year).padStart(2, '0')}`,
    status: c.status,
    statusReason: c.status_reason,
    limits: safeJson<CardLimits>(c.limits, { monthly: 0, online: true }),
    confirmPurchases: !!c.confirm_purchases,
    accountId: c.account_id,
    accountNumber: acc?.number,
    currency: acc?.currency ?? 'RUB',
    createdAt: c.created_at,
  };
}

export function revealCard(ctx: Ctx, c: CardRow) {
  return { pan: decrypt(ctx.secret, c.pan_enc), cvc: decrypt(ctx.secret, c.cvc_enc), exp: `${String(c.exp_month).padStart(2, '0')}/${String(c.exp_year).padStart(2, '0')}`, holder: c.holder };
}

/** Purchases this calendar month on the card (for the monthly limit), in account currency. */
export function monthSpent(ctx: Ctx, cardId: string, now: number): number {
  const d = new Date(now);
  const from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const spent = ctx.db.prepare(`SELECT COALESCE(SUM(-amount), 0) s FROM entries WHERE card_id = ? AND amount < 0 AND created_at >= ?`).get(cardId, from) as { s: number };
  const held = ctx.db.prepare(`SELECT COALESCE(SUM(amount), 0) s FROM holds WHERE card_id = ? AND status = 'active'`).get(cardId) as { s: number };
  return spent.s + held.s;
}
