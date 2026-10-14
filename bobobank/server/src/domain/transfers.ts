import { HttpError, type Ctx } from '../context.js';
import { BANK, isValidAccount } from './bank.js';
import { findCardByPan, TARIFFS, type Tariff } from './cards.js';
import { getFx, convertCustomer, fxLegs } from './fx.js';
import { getAccount, mainAccount, notify, post, systemAccount, type AccountRow, type Leg } from './ledger.js';
import { humanMoney } from './money.js';

export const TRANSFER_MAX = 100_000_000; // 1 000 000 ₽ per operation
export const FEE_PCT = 1;
export const FEE_MAX = 150_000;

export interface UserRow {
  id: string;
  phone: string;
  name: string;
  role: string;
  tariff: Tariff;
  blocked: number;
}

export const getUser = (ctx: Ctx, id: string) => ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;

/** "Иван Петров" → "Иван П." — how recipients are shown before a transfer. */
export function shortName(name: string) {
  const [first, last] = name.trim().split(/\s+/);
  return last ? `${first} ${last[0]}.` : first;
}

export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.length === 10) d = `7${d}`;
  if (d.length === 11 && d.startsWith('8')) d = `7${d.slice(1)}`;
  return /^7\d{10}$/.test(d) ? d : null;
}

export const formatPhone = (p: string) => `+7 ${p.slice(1, 4)} ${p.slice(4, 7)}-${p.slice(7, 9)}-${p.slice(9, 11)}`;

/** Outgoing transfers to other people this month (RUB equivalent is not needed: the free limit is per tariff in ₽). */
export function monthTransfers(ctx: Ctx, userId: string, now: number): number {
  const d = new Date(now);
  const from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const r = ctx.db
    .prepare(
      `SELECT COALESCE(SUM(-e.amount), 0) s FROM entries e JOIN accounts a ON a.id = e.account_id JOIN transactions t ON t.id = e.tx_id
       WHERE a.user_id = ? AND e.amount < 0 AND e.currency = 'RUB' AND t.kind = 'transfer' AND e.created_at >= ?`,
    )
    .get(userId, from) as { s: number };
  return r.s;
}

export function transferFee(ctx: Ctx, user: UserRow, amount: number, currency: string): number {
  if (currency !== 'RUB') return 0;
  const free = TARIFFS[user.tariff]?.transferFree ?? TARIFFS.standard.transferFree;
  const used = monthTransfers(ctx, user.id, ctx.now());
  const over = Math.max(0, used + amount - Math.max(free, used));
  return Math.min(FEE_MAX, Math.ceil((over * FEE_PCT) / 100));
}

export type Recipient =
  | { type: 'phone'; phone: string }
  | { type: 'card'; pan: string }
  | { type: 'account'; number: string; bik: string; name: string; inn?: string; purpose?: string };

export interface ResolvedRecipient {
  /** Bobobank account that receives the money, or null for other banks. */
  account: AccountRow | null;
  user: UserRow | null;
  display: string;
  subtitle: string;
}

export function resolveRecipient(ctx: Ctx, r: Recipient, currency: string): ResolvedRecipient {
  if (r.type === 'phone') {
    const phone = normalizePhone(r.phone);
    if (!phone) throw new HttpError(400, 'Некорректный номер телефона');
    const u = ctx.db.prepare(`SELECT * FROM users WHERE phone = ? AND role = 'client'`).get(phone) as UserRow | undefined;
    if (!u) throw new HttpError(404, 'Получатель с таким номером не найден в Bobobank');
    const acc = currency === 'RUB'
      ? mainAccount(ctx, u.id)
      : (ctx.db.prepare(`SELECT * FROM accounts WHERE user_id = ? AND kind = 'current' AND currency = ? AND status = 'open' ORDER BY created_at LIMIT 1`).get(u.id, currency) as AccountRow | undefined);
    if (!acc) throw new HttpError(400, `У получателя нет счёта в ${currency}`);
    return { account: acc, user: u, display: shortName(u.name), subtitle: `Перевод по номеру ${formatPhone(phone)}` };
  }
  if (r.type === 'card') {
    const pan = r.pan.replace(/\D/g, '');
    const card = findCardByPan(ctx, pan);
    if (!card || card.status === 'closed') throw new HttpError(404, 'Карта не найдена. Переводы по номеру карты доступны на карты Bobobank.');
    const acc = getAccount(ctx, card.account_id)!;
    const u = getUserSafe(ctx, card.user_id);
    return { account: acc, user: u, display: shortName(u.name), subtitle: `Перевод на карту •• ${card.last4}` };
  }
  const number = r.number.replace(/\s/g, '');
  if (!/^\d{9}$/.test(r.bik)) throw new HttpError(400, 'БИК — 9 цифр');
  if (!isValidAccount(r.bik, number)) throw new HttpError(400, 'Номер счёта не прошёл проверку по БИК — проверьте реквизиты');
  if (r.bik === BANK.bik) {
    const acc = ctx.db.prepare(`SELECT * FROM accounts WHERE number = ? AND user_id IS NOT NULL`).get(number) as AccountRow | undefined;
    if (!acc || acc.status !== 'open') throw new HttpError(404, 'Счёт получателя не найден в Bobobank');
    const u = getUserSafe(ctx, acc.user_id!);
    return { account: acc, user: u, display: r.name || shortName(u.name), subtitle: r.purpose || `Перевод на счёт ${number.slice(0, 5)}…${number.slice(-4)}` };
  }
  return { account: null, user: null, display: r.name, subtitle: r.purpose || `Перевод в другой банк, БИК ${r.bik}` };
}

function getUserSafe(ctx: Ctx, id: string) {
  const u = getUser(ctx, id);
  if (!u) throw new HttpError(404, 'Получатель не найден');
  return u;
}

/** Transfer to another person (or another bank). Same-currency only for other people; own accounts convert. */
export function transfer(ctx: Ctx, sender: UserRow, from: AccountRow, to: ResolvedRecipient, amount: number, comment = ''): { txId: string; fee: number } {
  if (amount > TRANSFER_MAX) throw new HttpError(400, `Максимальная сумма перевода — ${humanMoney(TRANSFER_MAX, 'RUB')}`);
  if (to.account && to.account.id === from.id) throw new HttpError(400, 'Нельзя перевести на тот же счёт');
  const own = to.user?.id === sender.id;
  const fee = own ? 0 : transferFee(ctx, sender, amount, from.currency);
  const fx = getFx(ctx.db);
  const target = to.account ?? systemAccount(ctx, 'external', from.currency);
  const credited = target.currency === from.currency ? amount : convertCustomer(fx, amount, from.currency, target.currency).result;
  const senderTitle = own ? 'Между своими счетами' : to.display;
  const legs: Leg[] = [
    { account: from, amount: -(amount + fee), title: senderTitle, subtitle: comment || to.subtitle, category: 'transfers' },
    ...fxLegs(ctx, from.currency, amount, target.currency, credited),
    { account: target, amount: credited, title: own ? 'Между своими счетами' : shortName(sender.name), subtitle: comment || (own ? `Со счёта •• ${from.number.slice(-4)}` : 'Входящий перевод'), category: own ? 'transfers' : 'income' },
  ];
  if (fee) legs.push({ account: systemAccount(ctx, 'fees', from.currency), amount: fee });
  const txId = post(ctx, { kind: own ? 'own_transfer' : 'transfer', description: `Перевод ${senderTitle}`, initiatorId: sender.id, meta: { comment, fee, to: to.display }, legs });
  if (to.user && !own) notify(ctx, to.user.id, 'income', `+${humanMoney(credited, target.currency)}`, `${shortName(sender.name)}: ${comment || 'перевод'}`, { txId });
  return { txId, fee };
}
