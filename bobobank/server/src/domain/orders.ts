import { HttpError, type Ctx } from '../context.js';
import { newId, randomString, safeJson } from '../util.js';
import { categoryOfMcc } from './bank.js';
import { gpayRequest } from './gpay.js';
import { available, getAccount, mainAccount, notify, post, systemAccount, type AccountRow } from './ledger.js';
import { humanMoney } from './money.js';
import { formatPhone, getUser, normalizePhone, shortName } from './transfers.js';

/** A GPAY order as the bank sees it. */
export interface GpayOrder {
  id: string;
  status: string;
  amount: number;
  currency: string;
  description: string;
  merchant: { name: string; inn?: string; mcc?: number; shop_id: number; site?: string };
  sbp: boolean;
  bobopay?: boolean;
  return_url?: string | null;
}

export type OrderMethod = 'sbp' | 'bobopay';
export const METHOD_LABEL: Record<OrderMethod, string> = { sbp: 'Оплата по QR-коду СБП', bobopay: 'Bobo Pay' };
export const PAYABLE_KINDS = ['current', 'savings', 'business', 'credit_card', 'kids'];
export const REQUEST_TTL_MS = 5 * 60_000;

export async function loadOrder(ctx: Ctx, id: string): Promise<GpayOrder> {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw new HttpError(404, 'Платёж не найден');
  return gpayRequest<GpayOrder>(ctx, 'GET', `/internal/bank/payments/${id}`);
}

function checkPayable(ctx: Ctx, order: Pick<GpayOrder, 'id' | 'currency'>, acc: AccountRow) {
  if (acc.currency !== order.currency) throw new HttpError(400, `Оплата — со счёта в ${order.currency}`);
  if (!PAYABLE_KINDS.includes(acc.kind) || acc.status !== 'open') throw new HttpError(400, 'С этого счёта нельзя платить');
  if (ctx.db.prepare(`SELECT 1 FROM sbp_payments WHERE external_id = ? AND status = 'succeeded'`).get(order.id)) throw new HttpError(400, 'Этот заказ уже оплачен');
}

/** Debits the customer for a GPAY order; returns the record used for refunds. */
function charge(ctx: Ctx, userId: string, acc: AccountRow, order: Pick<GpayOrder, 'id' | 'amount' | 'currency' | 'merchant'>, method: OrderMethod, opId: string) {
  const category = categoryOfMcc(order.merchant.mcc);
  const txId = post(ctx, {
    kind: method === 'sbp' ? 'sbp_payment' : 'bobopay',
    description: `${method === 'sbp' ? 'Оплата СБП' : 'Bobo Pay'}: ${order.merchant.name}`,
    initiatorId: userId,
    meta: { paymentId: order.id, operationId: opId, merchant: { name: order.merchant.name, inn: order.merchant.inn } },
    legs: [
      { account: acc, amount: -order.amount, title: order.merchant.name, subtitle: METHOD_LABEL[method], category },
      { account: systemAccount(ctx, 'gpay', order.currency), amount: order.amount },
    ],
  });
  const id = newId('sbp', 16);
  ctx.db
    .prepare('INSERT INTO sbp_payments(id, external_id, user_id, account_id, amount, currency, merchant, status, tx_id, created_at, method) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, order.id, userId, acc.id, order.amount, order.currency, JSON.stringify(order.merchant), 'processing', txId, ctx.now(), method);
  return { id, txId, category };
}

function reverse(ctx: Ctx, rec: { id: string; txId: string; category: ReturnType<typeof categoryOfMcc> }, acc: AccountRow, order: Pick<GpayOrder, 'id' | 'amount' | 'currency' | 'merchant'>) {
  post(ctx, {
    kind: 'sbp_reversal',
    description: `Отмена оплаты: ${order.merchant.name}`,
    meta: { paymentId: order.id },
    legs: [
      { account: systemAccount(ctx, 'gpay', order.currency), amount: -order.amount },
      { account: getAccount(ctx, acc.id)!, amount: order.amount, title: order.merchant.name, subtitle: 'Отмена оплаты', category: rec.category },
    ],
  });
  ctx.db.prepare(`UPDATE sbp_payments SET status = 'failed' WHERE id = ?`).run(rec.id);
}

/** SBP or Bobo Pay from the app (QR code / button): the bank pays and tells GPAY right away. */
export async function payOrder(ctx: Ctx, userId: string, acc: AccountRow, orderId: string, method: OrderMethod) {
  const order = await loadOrder(ctx, orderId);
  if (order.status !== 'pending') throw new HttpError(400, order.status === 'succeeded' ? 'Этот заказ уже оплачен' : 'Платёж больше нельзя оплатить');
  if (method === 'sbp' ? !order.sbp : order.bobopay === false) throw new HttpError(400, 'Магазин не принимает этот способ оплаты');
  checkPayable(ctx, order, acc);
  const opId = `B${randomString(19, '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ')}`;
  const rec = charge(ctx, userId, acc, order, method, opId);
  const user = getUser(ctx, userId)!;
  try {
    await gpayRequest(ctx, 'POST', `/internal/bank/payments/${order.id}/${method}`, { operation_id: opId, payer: { name: shortName(user.name), phone: formatPhone(user.phone).replace(/\d{2}-\d{2}$/, '**-**') } });
  } catch (e) {
    // GPAY refused or is down: the money goes back at once.
    reverse(ctx, rec, acc, order);
    throw e;
  }
  ctx.db.prepare(`UPDATE sbp_payments SET status = 'succeeded' WHERE id = ?`).run(rec.id);
  notify(ctx, userId, 'purchase', `−${humanMoney(order.amount, order.currency)}`, `${order.merchant.name} · ${method === 'sbp' ? 'СБП' : 'Bobo Pay'}`);
  const entry = ctx.db.prepare('SELECT id FROM entries WHERE tx_id = ? AND account_id = ?').get(rec.txId, acc.id) as { id: number };
  return { entryId: entry.id, returnUrl: order.return_url ?? null };
}

// ---------- Bobo Pay by phone: GPAY asks, the customer confirms in the app ----------

export interface RequestRow {
  id: string;
  external_id: string;
  user_id: string;
  amount: number;
  currency: string;
  merchant: string;
  description: string;
  status: 'pending' | 'paid' | 'declined' | 'expired';
  account_id: string | null;
  tx_id: string | null;
  created_at: number;
  expires_at: number;
}

export function createRequest(ctx: Ctx, input: { phone: string; paymentId: string; amount: number; currency: string; merchant: GpayOrder['merchant']; description: string }) {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new HttpError(400, 'Некорректный номер телефона');
  const u = ctx.db.prepare(`SELECT id FROM users WHERE phone = ? AND blocked = 0`).get(phone) as { id: string } | undefined;
  if (!u) throw new HttpError(404, 'Номер не зарегистрирован в Bobobank');
  if (ctx.db.prepare(`SELECT 1 FROM sbp_payments WHERE external_id = ? AND status = 'succeeded'`).get(input.paymentId)) throw new HttpError(400, 'Этот заказ уже оплачен');
  ctx.db.prepare(`UPDATE payment_requests SET status = 'expired' WHERE external_id = ? AND status = 'pending'`).run(input.paymentId);
  const id = newId('req', 20);
  const now = ctx.now();
  ctx.db
    .prepare('INSERT INTO payment_requests(id, external_id, user_id, amount, currency, merchant, description, status, created_at, expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(id, input.paymentId, u.id, input.amount, input.currency, JSON.stringify(input.merchant), input.description, 'pending', now, now + REQUEST_TTL_MS);
  notify(ctx, u.id, 'purchase_confirm', `Оплата ${humanMoney(input.amount, input.currency)} в ${input.merchant.name}`, 'Подтвердите оплату через Bobo Pay', { requestId: id });
  return getRequest(ctx, id)!;
}

export const getRequest = (ctx: Ctx, id: string) => ctx.db.prepare('SELECT * FROM payment_requests WHERE id = ?').get(id) as RequestRow | undefined;

export function pendingRequests(ctx: Ctx, userId: string) {
  return (ctx.db.prepare(`SELECT * FROM payment_requests WHERE user_id = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at`).all(userId, ctx.now()) as RequestRow[]).map((r) => ({
    id: r.id,
    amount: r.amount,
    currency: r.currency,
    merchant: safeJson<GpayOrder['merchant']>(r.merchant, { name: 'Магазин', shop_id: 0 }),
    description: r.description,
    expiresAt: r.expires_at,
  }));
}

/** The customer's answer: on approval the money is debited now and GPAY picks the result up. */
export function decideRequest(ctx: Ctx, userId: string, id: string, approve: boolean, accountId?: string) {
  const r = getRequest(ctx, id);
  if (!r || r.user_id !== userId) throw new HttpError(404, 'Запрос не найден');
  if (r.status !== 'pending') throw new HttpError(400, 'Запрос уже обработан');
  if (r.expires_at <= ctx.now()) throw new HttpError(400, 'Время на подтверждение истекло');
  if (!approve) {
    ctx.db.prepare(`UPDATE payment_requests SET status = 'declined', decided_at = ? WHERE id = ?`).run(ctx.now(), id);
    return { status: 'declined' as const };
  }
  const acc = accountId ? getAccount(ctx, accountId) : mainAccount(ctx, userId);
  if (!acc || acc.user_id !== userId) throw new HttpError(404, 'Счёт не найден');
  const order = { id: r.external_id, amount: r.amount, currency: r.currency, merchant: safeJson<GpayOrder['merchant']>(r.merchant, { name: 'Магазин', shop_id: 0 }) };
  checkPayable(ctx, order, acc);
  if (available(ctx, acc) < r.amount) throw new HttpError(400, 'Недостаточно средств', 'insufficient_funds');
  ctx.db.transaction(() => {
    const rec = charge(ctx, userId, acc, order, 'bobopay', `R${randomString(19, '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ')}`);
    ctx.db.prepare(`UPDATE sbp_payments SET status = 'succeeded' WHERE id = ?`).run(rec.id);
    ctx.db.prepare(`UPDATE payment_requests SET status = 'paid', account_id = ?, tx_id = ?, decided_at = ? WHERE id = ?`).run(acc.id, rec.txId, ctx.now(), id);
  })();
  return { status: 'paid' as const };
}

export function expireRequests(ctx: Ctx) {
  ctx.db.prepare(`UPDATE payment_requests SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?`).run(ctx.now());
}
