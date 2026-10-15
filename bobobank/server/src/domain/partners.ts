import { HttpError, type Ctx } from '../context.js';
import { newId, randomString, sha256 } from '../util.js';
import { categoryOfMcc, type Category } from './bank.js';
import { accrueCashback } from './bonus.js';
import { assertDebitAllowed, available, createHold, getAccount, notify, post, releaseHold, systemAccount, type AccountRow, type SystemCode } from './ledger.js';
import { humanMoney } from './money.js';
import { getUser } from './transfers.js';

/** Services that sign people in with Bobobank and charge a linked account («Войти через Bobobank»). */
export interface Partner {
  client: string;
  name: string;
  /** What the consent page promises. */
  scope: string;
  redirect: string;
  secret: string;
  system: SystemCode;
  category: Category;
  /** Default and maximum limit per charge, kopecks. */
  limit: number;
  maxLimit: number;
}

export function partners(ctx: Ctx): Record<string, Partner> {
  const out: Record<string, Partner> = {};
  const { transportPublicUrl, transportSecret } = ctx.cfg;
  if (transportPublicUrl && transportSecret) {
    out.transport = {
      client: 'transport',
      name: 'Бобо.Транспорт',
      scope: 'получит ваше имя и сможет списывать со счёта оплату поездок, плату за отмену и чаевые',
      redirect: `${transportPublicUrl}/api/auth/bank/callback`,
      secret: transportSecret,
      system: 'transport',
      category: categoryOfMcc(4121),
      limit: 10_000_00,
      maxLimit: 50_000_00,
    };
  }
  return out;
}

export function partnerOf(ctx: Ctx, client: string): Partner {
  const p = partners(ctx)[client];
  if (!p) throw new HttpError(404, 'Сервис не подключён к Bobobank');
  return p;
}

export interface MandateRow {
  id: string;
  user_id: string;
  client: string;
  account_id: string;
  limit_per_tx: number;
  status: 'active' | 'revoked';
  created_at: number;
  revoked_at: number | null;
}

export interface ChargeRow {
  id: string;
  mandate_id: string;
  hold_id: string | null;
  external_id: string;
  amount: number;
  captured: number;
  refunded: number;
  title: string;
  status: 'held' | 'captured' | 'voided';
  tx_id: string | null;
  created_at: number;
}

const CODE_TTL = 5 * 60_000;
/** A ride can wait for a car and drive for a while; abandoned holds go back to the customer. */
export const PARTNER_HOLD_TTL = 3 * 3600_000;
const CHARGEABLE: AccountRow['kind'][] = ['current', 'savings', 'business', 'credit_card', 'kids'];

export const getMandate = (ctx: Ctx, id: string) => ctx.db.prepare('SELECT * FROM mandates WHERE id = ?').get(id) as MandateRow | undefined;
export const getCharge = (ctx: Ctx, id: string) => ctx.db.prepare('SELECT * FROM partner_charges WHERE id = ?').get(id) as ChargeRow | undefined;

function chargeableAccount(ctx: Ctx, userId: string, accountId: string): AccountRow {
  const acc = getAccount(ctx, accountId);
  if (!acc || acc.user_id !== userId || acc.status !== 'open') throw new HttpError(404, 'Счёт не найден');
  if (!CHARGEABLE.includes(acc.kind) || acc.currency !== 'RUB') throw new HttpError(400, 'Привязать можно рублёвый текущий, накопительный или кредитный счёт');
  return acc;
}

/** The customer allowed the service to charge an account: a new mandate (the old one is replaced) and a one-time code for the redirect. */
export function grantMandate(ctx: Ctx, userId: string, client: string, accountId: string, limit: number | undefined, state: string) {
  const p = partnerOf(ctx, client);
  const acc = chargeableAccount(ctx, userId, accountId);
  const lim = limit ?? p.limit;
  if (!Number.isInteger(lim) || lim < 100_00 || lim > p.maxLimit) throw new HttpError(400, `Лимит — от 100 ₽ до ${humanMoney(p.maxLimit, 'RUB')}`);
  const id = newId('mnd', 16);
  const code = randomString(32);
  const now = ctx.now();
  ctx.db.transaction(() => {
    ctx.db.prepare(`UPDATE mandates SET status = 'revoked', revoked_at = ? WHERE user_id = ? AND client = ? AND status = 'active'`).run(now, userId, client);
    ctx.db.prepare('INSERT INTO mandates(id, user_id, client, account_id, limit_per_tx, created_at) VALUES(?,?,?,?,?,?)').run(id, userId, client, acc.id, lim, now);
    ctx.db.prepare('INSERT INTO partner_codes(code_hash, client, mandate_id, expires_at) VALUES(?,?,?,?)').run(sha256(code), client, id, now + CODE_TTL);
  })();
  notify(ctx, userId, 'partner', `${p.name} подключён`, `Оплата будет списываться со счёта •• ${acc.number.slice(-4)}, не больше ${humanMoney(lim, 'RUB')} за раз`);
  const url = new URL(p.redirect);
  url.searchParams.set('code', code);
  url.searchParams.set('state', state);
  return { redirect: url.toString(), mandateId: id };
}

const maskPhone = (phone: string) => `+7 ••• ••• ${phone.slice(-4, -2)}-${phone.slice(-2)}`;

export function mandateInfo(ctx: Ctx, m: MandateRow) {
  const acc = getAccount(ctx, m.account_id)!;
  let avail = 0;
  let usable = m.status === 'active';
  try {
    assertDebitAllowed(ctx, acc);
    avail = Math.max(0, available(ctx, acc));
  } catch {
    usable = false;
  }
  return { id: m.id, status: m.status, usable, accountLast4: acc.number.slice(-4), accountName: acc.name, limit: m.limit_per_tx, available: Math.min(avail, m.limit_per_tx) };
}

/** The service's server exchanges the code from the redirect for the customer and the mandate. */
export function redeemCode(ctx: Ctx, client: string, code: string) {
  const row = ctx.db.prepare('SELECT * FROM partner_codes WHERE code_hash = ?').get(sha256(code)) as { client: string; mandate_id: string; expires_at: number; used_at: number | null } | undefined;
  if (!row || row.client !== client || row.used_at || row.expires_at < ctx.now()) throw new HttpError(400, 'Код входа не найден или устарел', 'bad_code');
  ctx.db.prepare('UPDATE partner_codes SET used_at = ? WHERE code_hash = ?').run(ctx.now(), sha256(code));
  const m = getMandate(ctx, row.mandate_id)!;
  const u = getUser(ctx, m.user_id)!;
  return { user: { id: u.id, name: u.name, phoneMasked: maskPhone(u.phone) }, mandate: mandateInfo(ctx, m) };
}

export function partnerMandate(ctx: Ctx, client: string, id: string): MandateRow {
  const m = getMandate(ctx, id);
  if (!m || m.client !== client) throw new HttpError(404, 'Привязка не найдена');
  return m;
}

export function partnerCharge(ctx: Ctx, client: string, id: string): { c: ChargeRow; m: MandateRow } {
  const c = getCharge(ctx, id);
  const m = c && getMandate(ctx, c.mandate_id);
  if (!c || !m || m.client !== client) throw new HttpError(404, 'Списание не найдено');
  return { c, m };
}

/** Freezes money for an order. The same external_id returns the same hold (retries are safe). */
export function holdCharge(ctx: Ctx, client: string, mandateId: string, amount: number, externalId: string, title: string): ChargeRow {
  const m = partnerMandate(ctx, client, mandateId);
  const prev = ctx.db.prepare('SELECT * FROM partner_charges WHERE mandate_id = ? AND external_id = ?').get(m.id, externalId) as ChargeRow | undefined;
  if (prev) return prev;
  if (m.status !== 'active') throw new HttpError(403, 'Привязка к Bobobank отключена. Привяжите счёт заново.', 'mandate_revoked');
  if (amount > m.limit_per_tx) throw new HttpError(402, `Сумма больше лимита ${humanMoney(m.limit_per_tx, 'RUB')}. Измените лимит в Bobobank.`, 'limit_exceeded');
  return placeHold(ctx, partnerOf(ctx, client), m, amount, externalId, title);
}

function placeHold(ctx: Ctx, p: Partner, m: MandateRow, amount: number, externalId: string, title: string): ChargeRow {
  const acc = getAccount(ctx, m.account_id)!;
  let holdId: string;
  try {
    holdId = createHold(ctx, acc, amount, `${p.name}: ${title}`.slice(0, 120), p.category, PARTNER_HOLD_TTL, null);
  } catch (e) {
    if (e instanceof HttpError && e.code === 'insufficient_funds') throw new HttpError(402, 'Недостаточно средств на счёте Bobobank', 'insufficient_funds');
    if (e instanceof HttpError && e.code === 'account_closed') throw new HttpError(403, 'Привязанный счёт закрыт. Привяжите счёт заново.', 'mandate_revoked');
    throw e;
  }
  const id = newId('pch', 16);
  ctx.db.prepare(`INSERT INTO partner_charges(id, mandate_id, hold_id, external_id, amount, title, status, created_at) VALUES(?,?,?,?,?,?,'held',?)`).run(id, m.id, holdId, externalId, amount, title.slice(0, 200), ctx.now());
  return getCharge(ctx, id)!;
}

// ---- Large amounts: the customer confirms each one in the bank app ----

/** Upper bound for one confirmed hold (a long jet flight). */
export const CONFIRM_MAX = 50_000_000_00;
export const CONFIRM_TTL = 10 * 60_000;

export interface ConfirmationRow {
  id: string;
  mandate_id: string;
  external_id: string;
  amount: number;
  title: string;
  status: 'pending' | 'approved' | 'declined' | 'expired';
  charge_id: string | null;
  expires_at: number;
  decided_at: number | null;
  created_at: number;
}

function freshConfirmation(ctx: Ctx, id: string): ConfirmationRow | undefined {
  ctx.db.prepare(`UPDATE partner_confirmations SET status = 'expired' WHERE id = ? AND status = 'pending' AND expires_at <= ?`).run(id, ctx.now());
  return ctx.db.prepare('SELECT * FROM partner_confirmations WHERE id = ?').get(id) as ConfirmationRow | undefined;
}

export function confirmationView(ctx: Ctx, c: ConfirmationRow) {
  const charge = c.charge_id ? getCharge(ctx, c.charge_id) : undefined;
  return {
    id: c.id,
    status: c.status,
    amount: c.amount,
    expires_at: c.expires_at,
    url: `${ctx.cfg.publicUrl}/connect/confirm?id=${c.id}`,
    charge: charge ? { id: charge.id, status: charge.status, amount: charge.amount, captured: charge.captured, refunded: charge.refunded, external_id: charge.external_id } : null,
  };
}

/** A hold above the mandate limit waits for the customer's approval in the app. */
export function requestConfirmation(ctx: Ctx, client: string, mandateId: string, amount: number, externalId: string, title: string) {
  const p = partnerOf(ctx, client);
  const m = partnerMandate(ctx, client, mandateId);
  const prev = ctx.db.prepare('SELECT id FROM partner_confirmations WHERE mandate_id = ? AND external_id = ?').get(m.id, externalId) as { id: string } | undefined;
  if (prev) return confirmationView(ctx, freshConfirmation(ctx, prev.id)!);
  if (m.status !== 'active') throw new HttpError(403, 'Привязка к Bobobank отключена. Привяжите счёт заново.', 'mandate_revoked');
  if (amount > CONFIRM_MAX) throw new HttpError(402, `Сумма больше ${humanMoney(CONFIRM_MAX, 'RUB')}`, 'limit_exceeded');
  const acc = getAccount(ctx, m.account_id)!;
  assertDebitAllowed(ctx, acc);
  if (available(ctx, acc) < amount) throw new HttpError(402, 'Недостаточно средств на счёте Bobobank', 'insufficient_funds');
  const id = newId('pcf', 16);
  const now = ctx.now();
  ctx.db
    .prepare(`INSERT INTO partner_confirmations(id, mandate_id, external_id, amount, title, status, expires_at, created_at) VALUES(?,?,?,?,?,'pending',?,?)`)
    .run(id, m.id, externalId, amount, title.slice(0, 200), now + CONFIRM_TTL, now);
  notify(ctx, m.user_id, 'partner', `Подтвердите ${humanMoney(amount, 'RUB')}`, `${p.name}: ${title}`, { confirmationId: id });
  return confirmationView(ctx, freshConfirmation(ctx, id)!);
}

export function partnerConfirmation(ctx: Ctx, client: string, id: string) {
  const c = freshConfirmation(ctx, id);
  const m = c && getMandate(ctx, c.mandate_id);
  if (!c || !m || m.client !== client) throw new HttpError(404, 'Запрос не найден');
  return confirmationView(ctx, c);
}

const confirmationForUser = (ctx: Ctx, c: ConfirmationRow) => {
  const m = getMandate(ctx, c.mandate_id)!;
  const acc = getAccount(ctx, m.account_id)!;
  const p = partners(ctx)[m.client];
  return { id: c.id, status: c.status, client: m.client, name: p?.name ?? m.client, returnUrl: p ? new URL(p.redirect).origin : null, title: c.title, amount: c.amount, expiresAt: c.expires_at, accountLast4: acc.number.slice(-4), accountName: acc.name, available: Math.max(0, available(ctx, acc)) };
};

export function pendingPartnerRequests(ctx: Ctx, userId: string) {
  const rows = ctx.db
    .prepare(`SELECT c.* FROM partner_confirmations c JOIN mandates m ON m.id = c.mandate_id WHERE m.user_id = ? AND c.status = 'pending' AND c.expires_at > ? ORDER BY c.created_at`)
    .all(userId, ctx.now()) as ConfirmationRow[];
  return rows.map((c) => confirmationForUser(ctx, c));
}

export function userConfirmation(ctx: Ctx, userId: string, id: string) {
  const c = freshConfirmation(ctx, id);
  const m = c && getMandate(ctx, c.mandate_id);
  if (!c || !m || m.user_id !== userId) throw new HttpError(404, 'Запрос не найден');
  return confirmationForUser(ctx, c);
}

/** The customer's answer: approval freezes the money on the mandate's account now. */
export function decideConfirmation(ctx: Ctx, userId: string, id: string, approve: boolean) {
  const c = freshConfirmation(ctx, id);
  const m = c && getMandate(ctx, c.mandate_id);
  if (!c || !m || m.user_id !== userId) throw new HttpError(404, 'Запрос не найден');
  if (c.status === 'expired') throw new HttpError(400, 'Время на подтверждение истекло');
  if (c.status !== 'pending') throw new HttpError(400, 'Запрос уже обработан');
  if (!approve) {
    ctx.db.prepare(`UPDATE partner_confirmations SET status = 'declined', decided_at = ? WHERE id = ?`).run(ctx.now(), id);
    return confirmationForUser(ctx, freshConfirmation(ctx, id)!);
  }
  if (m.status !== 'active') throw new HttpError(400, 'Сервис отключён от Bobobank');
  const charge = placeHold(ctx, partnerOf(ctx, m.client), m, c.amount, c.external_id, c.title);
  ctx.db.prepare(`UPDATE partner_confirmations SET status = 'approved', charge_id = ?, decided_at = ? WHERE id = ?`).run(charge.id, ctx.now(), id);
  return confirmationForUser(ctx, freshConfirmation(ctx, id)!);
}

/** Charges the final price (not more than the hold) and releases the rest. */
export function captureCharge(ctx: Ctx, client: string, id: string, amount: number, title: string, subtitle: string): ChargeRow {
  const p = partnerOf(ctx, client);
  const { c, m } = partnerCharge(ctx, client, id);
  if (c.status === 'captured') return c;
  if (c.status !== 'held') throw new HttpError(409, 'Холд уже снят', 'bad_status');
  if (amount > c.amount) throw new HttpError(400, 'Сумма списания больше холда', 'too_much');
  if (amount === 0) return voidCharge(ctx, client, id);
  const acc = getAccount(ctx, m.account_id)!;
  const txId = post(ctx, {
    kind: 'partner_purchase',
    description: `${p.name}: ${title}`,
    meta: { client, chargeId: c.id, externalId: c.external_id },
    holdId: c.hold_id ?? undefined,
    legs: [
      { account: acc, amount: -amount, title: p.name, subtitle: subtitle || title, category: p.category },
      { account: systemAccount(ctx, p.system, 'RUB'), amount },
    ],
  });
  ctx.db.prepare(`UPDATE partner_charges SET status = 'captured', captured = ?, tx_id = ?, title = ? WHERE id = ?`).run(amount, txId, title.slice(0, 200), c.id);
  accrueCashback(ctx, m.user_id, amount, p.category, p.name);
  notify(ctx, m.user_id, 'purchase', `−${humanMoney(amount, 'RUB')}`, `${p.name}: ${subtitle || title}`);
  return getCharge(ctx, c.id)!;
}

export function voidCharge(ctx: Ctx, client: string, id: string): ChargeRow {
  const { c } = partnerCharge(ctx, client, id);
  if (c.status === 'voided') return c;
  if (c.status !== 'held') throw new HttpError(409, 'Деньги уже списаны — используйте возврат', 'bad_status');
  if (c.hold_id) releaseHold(ctx, c.hold_id);
  ctx.db.prepare(`UPDATE partner_charges SET status = 'voided' WHERE id = ?`).run(c.id);
  return getCharge(ctx, c.id)!;
}

/** One-step charge without a separate hold (tips after the ride). */
export function chargeNow(ctx: Ctx, client: string, mandateId: string, amount: number, externalId: string, title: string, subtitle: string): ChargeRow {
  const c = holdCharge(ctx, client, mandateId, amount, externalId, title);
  return c.status === 'held' ? captureCharge(ctx, client, c.id, amount, title, subtitle) : c;
}

export function refundCharge(ctx: Ctx, client: string, id: string, amount: number): ChargeRow {
  const p = partnerOf(ctx, client);
  const { c, m } = partnerCharge(ctx, client, id);
  if (c.status !== 'captured') throw new HttpError(409, 'Возврат возможен только после списания', 'bad_status');
  if (amount > c.captured - c.refunded) throw new HttpError(400, 'Сумма возврата больше списанной', 'too_much');
  let acc = getAccount(ctx, m.account_id)!;
  if (acc.status !== 'open') acc = ctx.db.prepare(`SELECT * FROM accounts WHERE user_id = ? AND kind = 'current' AND currency = 'RUB' AND status = 'open' LIMIT 1`).get(m.user_id) as AccountRow;
  if (!acc) throw new HttpError(409, 'У клиента нет открытого рублёвого счёта');
  post(ctx, {
    kind: 'partner_refund',
    description: `Возврат от ${p.name}`,
    meta: { client, chargeId: c.id, amount },
    legs: [
      { account: systemAccount(ctx, p.system, 'RUB'), amount: -amount },
      { account: acc, amount, title: p.name, subtitle: `Возврат: ${c.title}`, category: p.category },
    ],
  });
  ctx.db.prepare('UPDATE partner_charges SET refunded = refunded + ? WHERE id = ?').run(amount, c.id);
  notify(ctx, m.user_id, 'refund', `Возврат ${humanMoney(amount, 'RUB')}`, `${p.name} вернул деньги`);
  return getCharge(ctx, c.id)!;
}

/** «Подключённые сервисы» in the profile. */
export function userMandates(ctx: Ctx, userId: string) {
  const ps = partners(ctx);
  const rows = ctx.db.prepare(`SELECT * FROM mandates WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC`).all(userId) as MandateRow[];
  return rows.map((m) => {
    const spent = (ctx.db.prepare(`SELECT COALESCE(SUM(captured - refunded), 0) s FROM partner_charges c JOIN mandates m ON m.id = c.mandate_id WHERE m.user_id = ? AND m.client = ?`).get(userId, m.client) as { s: number }).s;
    return { ...mandateInfo(ctx, m), client: m.client, name: ps[m.client]?.name ?? m.client, accountId: m.account_id, createdAt: m.created_at, spent };
  });
}

export function updateMandate(ctx: Ctx, userId: string, id: string, patch: { accountId?: string; limit?: number }) {
  const m = getMandate(ctx, id);
  if (!m || m.user_id !== userId || m.status !== 'active') throw new HttpError(404, 'Подключение не найдено');
  const p = partnerOf(ctx, m.client);
  if (patch.accountId) chargeableAccount(ctx, userId, patch.accountId);
  if (patch.limit !== undefined && (!Number.isInteger(patch.limit) || patch.limit < 100_00 || patch.limit > p.maxLimit)) throw new HttpError(400, `Лимит — от 100 ₽ до ${humanMoney(p.maxLimit, 'RUB')}`);
  ctx.db.prepare('UPDATE mandates SET account_id = COALESCE(?, account_id), limit_per_tx = COALESCE(?, limit_per_tx) WHERE id = ?').run(patch.accountId ?? null, patch.limit ?? null, id);
}

export function revokeMandate(ctx: Ctx, userId: string, id: string) {
  const m = getMandate(ctx, id);
  if (!m || m.user_id !== userId) throw new HttpError(404, 'Подключение не найдено');
  ctx.db.prepare(`UPDATE mandates SET status = 'revoked', revoked_at = ? WHERE id = ? AND status = 'active'`).run(ctx.now(), id);
}
