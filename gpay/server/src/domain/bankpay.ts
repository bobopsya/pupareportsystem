import { ApiError, type Ctx } from '../context.js';
import { newId, randomString, safeJson, sha256 } from '../util.js';
import { bankCards, bankEnabled, bankRequest } from './bank.js';
import { BRAND_TITLE, brandOf } from './cards.js';
import { formatAmount } from './money.js';
import {
  addEvent, authorize, balances, cancelByMerchant, capturePayment, checkRefund, decline, getPaymentRow, getShop, refundPayment, resultOf, serializePayout,
  shopMethods, type CardInput, type PaymentRow, type PayoutRow, type PayResult, type ShopRow,
} from './payments.js';
import { enqueue } from './webhooks.js';

/** Bobobank's BIK, shown as the payer bank in SBP details. */
export const BANK_BIK = '044599909';
export const BANK_NAME = 'Bobobank';

interface BankAuth {
  status: 'approved' | 'captured' | 'pending' | 'declined';
  authorization_id?: string;
  expires_at?: number;
  reason?: string;
  message?: string;
}

/** True when the number belongs to a Bobobank card (checked against the bank's hash list). */
export async function isBankCard(ctx: Ctx, pan: string): Promise<boolean> {
  if (!bankEnabled(ctx)) return false;
  const h = sha256(pan);
  const list = await bankCards(ctx);
  if (list.hashes.includes(h)) return true;
  if (!list.bins.includes(pan.slice(0, 6))) return false;
  return (await bankCards(ctx, true)).hashes.includes(h);
}

/** Card payment with a Bobobank card: the bank checks the balance and may ask the owner to confirm in its app. */
export async function payWithBankCard(ctx: Ctx, p: PaymentRow, card: CardInput): Promise<PayResult> {
  const pan = card.pan.replace(/\D/g, '');
  const brand = brandOf(pan);
  if (!brand) throw new ApiError(400, 'card_not_supported', 'Карта не поддерживается');
  const shop = getShop(ctx, p.shop_id)!;
  const last4 = pan.slice(-4);
  const method = {
    type: 'bank_card',
    id: newId('pm', 20),
    saved: false,
    title: `${BRAND_TITLE[brand]} •• ${last4}`,
    card: { first6: pan.slice(0, 6), last4, expiry_month: String(card.expMonth).padStart(2, '0'), expiry_year: String(card.expYear), card_type: BRAND_TITLE[brand], issuer_country: 'RU', issuer_name: BANK_NAME },
  };
  addEvent(ctx, p.id, 'attempt', { method: method.title });
  const r = await bankRequest<BankAuth>(
    ctx,
    'POST',
    '/internal/v1/authorize',
    {
      pan, exp_month: card.expMonth, exp_year: card.expYear % 100, cvc: card.csc, amount: p.amount, currency: p.currency, capture: !!p.capture, payment_id: p.id,
      merchant: { name: shop.name, shop_id: shop.id, mcc: shop.mcc, inn: shop.inn, site: shop.site || undefined },
    },
    `auth:${p.id}:${p.attempts}:${sha256(pan).slice(0, 12)}`,
  );
  if (!r.ok) return decline(ctx, p, 'issuer_unavailable', r.data.error ?? 'Банк не смог обработать платёж.', method.title);
  const a = r.data;
  const fresh = getPaymentRow(ctx, p.id)!;
  if (a.status === 'declined') return decline(ctx, fresh, a.reason ?? 'general_decline', a.message ?? 'Банк отклонил операцию.', method.title);
  if (a.status === 'pending') {
    ctx.db
      .prepare('UPDATE payments SET method_type = ?, method = ?, bank_auth_id = ?, pending_action = ? WHERE id = ?')
      .run('bank_card', JSON.stringify({ ...method, three_d_secure: true }), a.authorization_id, JSON.stringify({ type: 'bank_confirm', until: a.expires_at, bank: BANK_NAME }), p.id);
    addEvent(ctx, p.id, '3ds_required', { method: method.title, bank: BANK_NAME });
    return { result: 'processing', until: a.expires_at ?? ctx.now() + 300_000 };
  }
  authorize(ctx, fresh, method, { funding: 'bank', bankAuthId: a.authorization_id });
  return resultOf(ctx, p.id);
}

/** Polls Bobobank for purchases waiting for the owner's confirmation in the app. */
export async function tickBank(ctx: Ctx) {
  if (!bankEnabled(ctx)) return;
  const rows = ctx.db.prepare(`SELECT * FROM payments WHERE status = 'pending' AND bank_auth_id IS NOT NULL AND pending_action LIKE '%bank_confirm%' LIMIT 50`).all() as PaymentRow[];
  for (const p of rows) {
    let r;
    try {
      r = await bankRequest<{ status: string; reason?: string }>(ctx, 'GET', `/internal/v1/authorizations/${p.bank_auth_id}`);
    } catch {
      continue;
    }
    const fresh = getPaymentRow(ctx, p.id)!;
    if (fresh.status !== 'pending' || !fresh.pending_action?.includes('bank_confirm')) continue;
    const method = safeJson<Record<string, unknown>>(fresh.method, {});
    if (r.data.status === 'captured' || r.data.status === 'approved') {
      addEvent(ctx, p.id, '3ds_passed', { method: method.title, bank: BANK_NAME });
      authorize(ctx, fresh, method, { funding: 'bank', bankAuthId: p.bank_auth_id! });
    } else if (r.data.status !== 'pending') {
      ctx.db.prepare('UPDATE payments SET method_type = NULL, method = NULL, bank_auth_id = NULL, pending_action = NULL WHERE id = ?').run(p.id);
      const msg =
        r.data.reason === 'declined_by_customer' ? 'Покупка отклонена в приложении банка.'
        : r.data.status === 'expired' ? 'Покупка не подтверждена в приложении банка вовремя.'
        : 'Банк отклонил операцию.';
      decline(ctx, getPaymentRow(ctx, p.id)!, r.data.status === 'expired' ? '3d_secure_failed' : 'general_decline', msg, String(method.title ?? ''));
    }
  }
}

const bankError = (data: { error?: string }, fallback: string) => new ApiError(400, 'bank_declined', `Bobobank: ${data.error ?? fallback}`);

/** Two-stage payments: the bank turns the hold into a charge before GPAY marks the payment captured. */
export async function captureWithBank(ctx: Ctx, shop: ShopRow, p: PaymentRow, amount?: number) {
  if (p.status === 'waiting_for_capture' && p.bank_auth_id) {
    const r = await bankRequest(ctx, 'POST', `/internal/v1/authorizations/${p.bank_auth_id}/capture`, { amount: amount ?? p.amount }, `capture:${p.id}`);
    if (!r.ok) throw bankError(r.data, 'не удалось списать деньги');
  }
  return capturePayment(ctx, shop, p, amount);
}

export async function cancelWithBank(ctx: Ctx, p: PaymentRow) {
  if ((p.status === 'waiting_for_capture' || p.status === 'pending') && p.bank_auth_id) {
    await bankRequest(ctx, 'POST', `/internal/v1/authorizations/${p.bank_auth_id}/void`, {}, `void:${p.id}`).catch(() => {});
  }
  return cancelByMerchant(ctx, p);
}

/** Refund: Bobobank money goes back to the buyer's card or account first, then GPAY records the refund. */
export async function refundWithBank(ctx: Ctx, shop: ShopRow, p: PaymentRow, amount: number | undefined, description = '') {
  const sum = checkRefund(ctx, shop, p, amount, description);
  const id = newId('rf');
  if (p.funding === 'bank') {
    const path = p.bank_auth_id ? `/internal/v1/authorizations/${p.bank_auth_id}/refund` : `/internal/v1/sbp/${p.id}/refund`;
    const r = await bankRequest(ctx, 'POST', path, { amount: sum, refund_id: id }, `refund:${id}`);
    if (!r.ok) throw bankError(r.data, 'возврат не выполнен');
  }
  return refundPayment(ctx, shop, p, sum, description, id);
}

export interface PayoutAccount {
  number: string;
  name: string;
  holder: string;
  currency: string;
  linkedAt: number;
}

export const payoutAccount = (shop: ShopRow) => safeJson<PayoutAccount | null>(shop.payout_account, null);

/** Connects the shop to a Bobobank account by the one-time code from the bank app. */
export async function linkBankAccount(ctx: Ctx, shop: ShopRow, code: string): Promise<PayoutAccount> {
  const r = await bankRequest<{ account: Omit<PayoutAccount, 'linkedAt'> }>(ctx, 'POST', '/internal/v1/links/claim', { code, shop_id: shop.id, shop_name: shop.name });
  if (!r.ok) throw new ApiError(400, 'invalid_request', r.data.error ?? 'Код не подошёл', 'code');
  const acc = { ...r.data.account, linkedAt: ctx.now() };
  ctx.db.prepare('UPDATE shops SET payout_account = ? WHERE id = ?').run(JSON.stringify(acc), shop.id);
  return acc;
}

/** Payout of Bobobank money to the linked account: credited instantly by the bank. */
export async function payoutToBank(ctx: Ctx, shop: ShopRow, amount: number, currency: string): Promise<PayoutRow> {
  const acc = payoutAccount(shop);
  if (!acc) throw new ApiError(400, 'invalid_request', 'Подключите счёт Bobobank в настройках магазина');
  const bal = balances(ctx, shop.id).find((b) => b.currency === currency);
  if (!bal || amount > bal.live) throw new ApiError(400, 'insufficient_funds', `Недостаточно средств: доступно к выводу в Bobobank ${formatAmount(Math.max(0, bal?.live ?? 0))} ${currency}`);
  const id = newId('po');
  const now = ctx.now();
  const destination = { type: 'bobobank', account_number: `${acc.number.slice(0, 5)}…${acc.number.slice(-4)}`, holder: acc.holder };
  ctx.db.prepare(`INSERT INTO payouts(id, shop_id, amount, currency, destination, status, processing_until, created_at, funding) VALUES(?,?,?,?,?,'pending',NULL,?,'bank')`).run(id, shop.id, amount, currency, JSON.stringify(destination), now);
  try {
    const r = await bankRequest(ctx, 'POST', '/internal/v1/credits', { destination: { type: 'account', number: acc.number }, amount, currency, payout_id: id, shop: { id: shop.id, name: shop.name } }, `payout:${id}`);
    if (!r.ok) throw bankError(r.data, 'выплата не принята');
  } catch (e) {
    ctx.db.prepare(`UPDATE payouts SET status = 'canceled', completed_at = ? WHERE id = ?`).run(ctx.now(), id);
    throw e;
  }
  ctx.db.prepare(`UPDATE payouts SET status = 'succeeded', completed_at = ? WHERE id = ?`).run(ctx.now(), id);
  const po = ctx.db.prepare('SELECT * FROM payouts WHERE id = ?').get(id) as PayoutRow;
  enqueue(ctx, shop.id, 'payout.succeeded', serializePayout(po));
  return po;
}

/** What the bank app shows before the customer pays a GPAY order by SBP. */
export function sbpInfo(ctx: Ctx, p: PaymentRow) {
  const shop = getShop(ctx, p.shop_id)!;
  return {
    id: p.id,
    status: p.status,
    amount: p.amount,
    currency: p.currency,
    description: p.description,
    merchant: { name: shop.name, inn: shop.inn, mcc: shop.mcc, shop_id: shop.id, site: shop.site || undefined },
    sbp: shop.status === 'active' && shopMethods(shop).includes('sbp') && p.currency === 'RUB',
    return_url: p.return_url,
  };
}

/** Bobobank paid the order by SBP: the payment succeeds at once (SBP is always single-stage). */
export function sbpPaidByBank(ctx: Ctx, p: PaymentRow, input: { operationId: string; payer?: { name?: string; phone?: string } }) {
  const info = sbpInfo(ctx, p);
  if (p.status !== 'pending') throw new ApiError(400, 'invalid_state', p.status === 'succeeded' ? 'Заказ уже оплачен' : 'Платёж больше нельзя оплатить');
  if (!info.sbp) throw new ApiError(400, 'invalid_request', 'Магазин не принимает оплату через СБП');
  // The buyer may have started "another bank" on the checkout; the real payment wins.
  ctx.db.prepare('UPDATE payments SET processing_until = NULL, pending_action = NULL, bank_auth_id = NULL WHERE id = ?').run(p.id);
  const method = {
    type: 'sbp',
    id: newId('pm', 20),
    saved: false,
    title: `СБП · ${BANK_NAME}`,
    sbp_operation_id: input.operationId || `B${randomString(31, '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ')}`,
    payer_bank_details: { bank_id: '100000000909', bic: BANK_BIK, name: BANK_NAME },
    payer: input.payer,
  };
  addEvent(ctx, p.id, 'attempt', { method: method.title });
  authorize(ctx, { ...getPaymentRow(ctx, p.id)!, capture: 1 }, method, { funding: 'bank' });
  return getPaymentRow(ctx, p.id)!;
}
