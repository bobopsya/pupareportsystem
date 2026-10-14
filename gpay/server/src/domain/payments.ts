import { ApiError, type Ctx } from '../context.js';
import { iso, newId, randomDigits, randomString, safeJson } from '../util.js';
import { BRAND_TITLE, brandOf, findGameCard, luhn, OUTCOMES, type Outcome } from './cards.js';
import { feeFor, METHODS, shopFees, type MethodType } from './fees.js';
import { cryptoAmount, getRates } from './fx.js';
import { formatAmount, isCurrency, LIMITS, money } from './money.js';
import { parseReceiptRequest, registerReceipt } from './receipts.js';
import { enqueue } from './webhooks.js';

export interface ShopRow {
  id: number;
  owner_id: string;
  name: string;
  legal_name: string;
  inn: string;
  tax_system: string;
  site: string;
  color: string;
  status: string;
  methods: string;
  fees: string;
  return_url: string;
  default_vat: string;
  kkt_rn: string;
  fn_number: string;
  fd_counter: number;
  shift_no: number;
  created_at: number;
}

export interface PaymentRow {
  id: string;
  shop_id: number;
  status: 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled';
  amount: number;
  currency: string;
  fee: number;
  refunded: number;
  description: string;
  capture: number;
  paid: number;
  method_type: MethodType | null;
  method: string | null;
  metadata: string;
  receipt: string | null;
  return_url: string | null;
  customer_email: string | null;
  cancellation: string | null;
  link_id: string | null;
  attempts: number;
  pending_action: string | null;
  processing_until: number | null;
  source: string;
  created_at: number;
  expires_at: number;
  authorized_at: number | null;
  captured_at: number | null;
  capture_deadline: number | null;
}

/** How long the buyer has to pay a pending payment. */
export const PAYMENT_TTL_MS = 60 * 60 * 1000;
/** Two-stage payments are cancelled automatically if not captured in time. */
export const CAPTURE_TTL_MS = 7 * 24 * 3600 * 1000;
export const MAX_ATTEMPTS = 5;
/** Simulated processing time of asynchronous methods. */
export const PROCESSING_MS: Record<Exclude<MethodType, 'bank_card'>, number> = { sbp: 9_000, installments: 11_000, crypto: 14_000 };
/** How long the issuer "takes" to confirm a card that requires 3-D Secure. */
export const BANK_CHECK_MS = { min: 3_000, max: 5_000 };

export const getShop = (ctx: Ctx, id: number) => ctx.db.prepare('SELECT * FROM shops WHERE id = ?').get(id) as ShopRow | undefined;
export const getPaymentRow = (ctx: Ctx, id: string) => ctx.db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as PaymentRow | undefined;
export const shopMethods = (shop: ShopRow) => safeJson<MethodType[]>(shop.methods, [...METHODS]).filter((m) => (METHODS as readonly string[]).includes(m));

export function addEvent(ctx: Ctx, paymentId: string, type: string, data: Record<string, unknown> = {}) {
  ctx.db.prepare('INSERT INTO payment_events(payment_id, ts, type, data) VALUES(?,?,?,?)').run(paymentId, ctx.now(), type, JSON.stringify(data));
}

// ---------- Creation ----------

export interface CreatePaymentInput {
  amount: number;
  currency: string;
  description?: string;
  capture?: boolean;
  returnUrl?: string;
  metadata?: Record<string, string>;
  receipt?: unknown;
  customerEmail?: string;
  linkId?: string;
  source: 'api' | 'link' | 'dashboard';
}

export function createPayment(ctx: Ctx, shop: ShopRow, input: CreatePaymentInput): PaymentRow {
  if (shop.status !== 'active') throw new ApiError(403, 'forbidden', 'Магазин заблокирован, приём платежей приостановлен');
  if (!isCurrency(input.currency)) throw new ApiError(400, 'invalid_request', 'Валюта: RUB, USD или EUR', 'amount.currency');
  const lim = LIMITS[input.currency];
  if (input.amount < lim.min || input.amount > lim.max) {
    throw new ApiError(400, 'invalid_request', `Сумма должна быть от ${formatAmount(lim.min)} до ${formatAmount(lim.max)} ${input.currency}`, 'amount.value');
  }
  const description = (input.description ?? '').trim();
  if (description.length > 128) throw new ApiError(400, 'invalid_request', 'description: не длиннее 128 символов', 'description');
  const metadata = input.metadata ?? {};
  if (Object.keys(metadata).length > 16) throw new ApiError(400, 'invalid_request', 'metadata: не больше 16 ключей', 'metadata');
  for (const [k, v] of Object.entries(metadata)) {
    if (k.length > 32 || typeof v !== 'string' || v.length > 512) throw new ApiError(400, 'invalid_request', 'metadata: ключ до 32 символов, значение — строка до 512 символов', `metadata.${k}`);
  }
  if (input.returnUrl && !/^https?:\/\/\S+$/.test(input.returnUrl)) throw new ApiError(400, 'invalid_request', 'return_url должен быть http(s) URL', 'confirmation.return_url');
  const receipt = input.receipt === undefined || input.receipt === null ? null : parseReceiptRequest(input.receipt, input.amount, input.currency);

  const now = ctx.now();
  const id = newId('pay');
  ctx.db
    .prepare(
      `INSERT INTO payments(id, shop_id, status, amount, currency, description, capture, metadata, receipt, return_url, customer_email, link_id, source, created_at, expires_at)
       VALUES(?,?,'pending',?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, shop.id, input.amount, input.currency, description, input.capture === false ? 0 : 1, JSON.stringify(metadata), receipt ? JSON.stringify(receipt) : null, input.returnUrl || shop.return_url || null, receipt?.customer.email ?? input.customerEmail ?? null, input.linkId ?? null, input.source, now, now + PAYMENT_TTL_MS);
  addEvent(ctx, id, 'created', { source: input.source, amount: formatAmount(input.amount), currency: input.currency });
  return getPaymentRow(ctx, id)!;
}

// ---------- Serialization (public API shape) ----------

export function serializePayment(ctx: Ctx, p: PaymentRow) {
  const method = safeJson<Record<string, unknown> | null>(p.method, null);
  const auth = method?.authorization as Record<string, unknown> | undefined;
  return {
    id: p.id,
    status: p.status,
    paid: !!p.paid,
    amount: money(p.amount, p.currency),
    income_amount: p.paid ? money(p.amount - p.fee, p.currency) : undefined,
    description: p.description || undefined,
    recipient: { account_id: String(p.shop_id), gateway_id: `${p.shop_id}01` },
    payment_method: method ? { ...method, authorization: undefined } : undefined,
    captured_at: iso(p.captured_at),
    created_at: iso(p.created_at),
    expires_at: p.status === 'pending' ? iso(p.expires_at) : p.status === 'waiting_for_capture' ? iso(p.capture_deadline) : undefined,
    confirmation: p.status === 'pending' ? { type: 'redirect', confirmation_url: `${ctx.cfg.publicUrl}/pay/${p.id}`, return_url: p.return_url ?? undefined } : undefined,
    test: false,
    refunded_amount: p.refunded ? money(p.refunded, p.currency) : undefined,
    refundable: p.status === 'succeeded' && p.refunded < p.amount,
    receipt_registration: p.status === 'succeeded' ? 'succeeded' : p.receipt ? 'pending' : undefined,
    metadata: safeJson<Record<string, string>>(p.metadata, {}),
    cancellation_details: safeJson<Record<string, string> | undefined>(p.cancellation, undefined),
    authorization_details: auth,
  };
}

// ---------- State transitions ----------

function notify(ctx: Ctx, p: PaymentRow, event: 'payment.waiting_for_capture' | 'payment.succeeded' | 'payment.canceled') {
  const fresh = getPaymentRow(ctx, p.id)!;
  enqueue(ctx, p.shop_id, event, serializePayment(ctx, fresh));
}

function onCaptured(ctx: Ctx, shop: ShopRow, p: PaymentRow) {
  registerReceipt(ctx, shop, p, 'income', p.amount);
  if (p.link_id) {
    ctx.db.prepare('UPDATE payment_links SET paid_count = paid_count + 1, paid_total = paid_total + ?, active = CASE WHEN reusable = 1 THEN active ELSE 0 END WHERE id = ?').run(p.amount, p.link_id);
  }
}

/** Funds were authorized by the (simulated) payment network. */
function authorize(ctx: Ctx, p: PaymentRow, method: Record<string, unknown>) {
  const shop = getShop(ctx, p.shop_id)!;
  const type = method.type as MethodType;
  const fee = feeFor(p.amount, shopFees(ctx.db, shop.fees)[type]);
  const now = ctx.now();
  const authorization = { rrn: randomDigits(12), auth_code: randomDigits(6), three_d_secure: { applied: !!method.three_d_secure } };
  const stored = { ...method, three_d_secure: undefined, authorization };
  if (p.capture) {
    ctx.db
      .prepare(`UPDATE payments SET status = 'succeeded', paid = 1, fee = ?, method_type = ?, method = ?, pending_action = NULL, processing_until = NULL, authorized_at = ?, captured_at = ? WHERE id = ?`)
      .run(fee, type, JSON.stringify(stored), now, now, p.id);
    addEvent(ctx, p.id, 'succeeded', { method: method.title ?? type, fee: formatAmount(fee) });
    onCaptured(ctx, shop, getPaymentRow(ctx, p.id)!);
    notify(ctx, p, 'payment.succeeded');
  } else {
    ctx.db
      .prepare(`UPDATE payments SET status = 'waiting_for_capture', paid = 1, fee = ?, method_type = ?, method = ?, pending_action = NULL, processing_until = NULL, authorized_at = ?, capture_deadline = ? WHERE id = ?`)
      .run(fee, type, JSON.stringify(stored), now, now + CAPTURE_TTL_MS, p.id);
    addEvent(ctx, p.id, 'authorized', { method: method.title ?? type });
    notify(ctx, p, 'payment.waiting_for_capture');
  }
}

export function cancelPayment(ctx: Ctx, p: PaymentRow, party: 'merchant' | 'payment_network' | 'issuer' | 'gpay', reason: string) {
  ctx.db
    .prepare(`UPDATE payments SET status = 'canceled', paid = 0, fee = 0, pending_action = NULL, processing_until = NULL, cancellation = ? WHERE id = ?`)
    .run(JSON.stringify({ party, reason }), p.id);
  addEvent(ctx, p.id, 'canceled', { party, reason });
  notify(ctx, p, 'payment.canceled');
}

/** Applies time-based transitions: finished async processing, expiry, capture deadline. */
export function settle(ctx: Ctx, p: PaymentRow): PaymentRow {
  const now = ctx.now();
  if (p.status === 'pending' && p.processing_until && now >= p.processing_until) {
    const method = safeJson<Record<string, unknown>>(p.method, {});
    if (method.type === 'bank_card') addEvent(ctx, p.id, '3ds_passed', { method: method.title });
    if (method.type === 'crypto') {
      const crypto = method.crypto as Record<string, unknown>;
      method.crypto = { ...crypto, tx_hash: randomString(64, '0123456789abcdef'), confirmations: crypto.asset === 'BTC' ? 3 : 20 };
    }
    authorize(ctx, p, method);
  } else if (p.status === 'pending' && now >= p.expires_at) {
    cancelPayment(ctx, p, 'gpay', 'expired_on_confirmation');
  } else if (p.status === 'waiting_for_capture' && p.capture_deadline && now >= p.capture_deadline) {
    cancelPayment(ctx, p, 'gpay', 'expired_on_capture');
  } else return p;
  return getPaymentRow(ctx, p.id)!;
}

export function loadPayment(ctx: Ctx, id: string): PaymentRow | undefined {
  const p = getPaymentRow(ctx, id);
  return p ? settle(ctx, p) : undefined;
}

function assertPayable(ctx: Ctx, p: PaymentRow, type: MethodType) {
  if (p.status !== 'pending') throw new ApiError(400, 'invalid_state', 'Платёж уже не ожидает оплаты');
  if (p.processing_until) throw new ApiError(400, 'invalid_state', 'Платёж уже обрабатывается');
  const shop = getShop(ctx, p.shop_id)!;
  if (shop.status !== 'active') throw new ApiError(403, 'forbidden', 'Магазин временно не принимает платежи');
  if (!shopMethods(shop).includes(type)) throw new ApiError(400, 'invalid_request', 'Этот способ оплаты недоступен');
}

function setEmail(ctx: Ctx, p: PaymentRow, email?: string) {
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200) ctx.db.prepare('UPDATE payments SET customer_email = ? WHERE id = ?').run(email, p.id);
}

export type PayResult =
  | { result: 'succeeded' | 'waiting_for_capture' }
  | { result: 'processing'; until: number }
  | { result: 'declined'; reason: string; message: string; canceled: boolean };

function decline(ctx: Ctx, p: PaymentRow, reason: string, message: string, title?: string): PayResult {
  const attempts = p.attempts + 1;
  ctx.db.prepare('UPDATE payments SET attempts = ?, pending_action = NULL WHERE id = ?').run(attempts, p.id);
  addEvent(ctx, p.id, 'attempt_failed', { reason, message, method: title });
  if (attempts >= MAX_ATTEMPTS) {
    cancelPayment(ctx, getPaymentRow(ctx, p.id)!, 'gpay', 'too_many_attempts');
    return { result: 'declined', reason, message: `${message} Превышено число попыток, платёж отменён.`, canceled: true };
  }
  return { result: 'declined', reason, message, canceled: false };
}

const resultOf = (ctx: Ctx, id: string): PayResult => ({ result: getPaymentRow(ctx, id)!.status === 'waiting_for_capture' ? 'waiting_for_capture' : 'succeeded' });

export interface CardInput {
  pan: string;
  expMonth: number;
  expYear: number;
  csc: string;
  holder?: string;
  email?: string;
}

export function payWithCard(ctx: Ctx, p: PaymentRow, card: CardInput): PayResult {
  assertPayable(ctx, p, 'bank_card');
  const pan = card.pan.replace(/\D/g, '');
  const brand = brandOf(pan);
  const game = luhn(pan) && brand ? findGameCard(ctx.db, pan) : undefined;
  if (!game || !brand) throw new ApiError(400, 'card_not_supported', 'Карта не поддерживается');
  if (!/^\d{3}$/.test(card.csc)) throw new ApiError(400, 'invalid_request', 'Неверный CVC', 'csc');
  setEmail(ctx, p, card.email);
  const last4 = pan.slice(-4);
  const method = {
    type: 'bank_card',
    id: newId('pm', 20),
    saved: false,
    title: `${BRAND_TITLE[brand]} •• ${last4}`,
    card: { first6: pan.slice(0, 6), last4, expiry_month: String(card.expMonth).padStart(2, '0'), expiry_year: String(card.expYear), card_type: BRAND_TITLE[brand], issuer_country: 'RU', issuer_name: 'GPAY Bank' },
  };
  const now = new Date(ctx.now());
  const expired = card.expYear < now.getUTCFullYear() || (card.expYear === now.getUTCFullYear() && card.expMonth < now.getUTCMonth() + 1);
  const outcome: Outcome = expired ? 'card_expired' : game.outcome;
  addEvent(ctx, p.id, 'attempt', { method: method.title });

  if (outcome === 'success') {
    authorize(ctx, p, method);
    return resultOf(ctx, p.id);
  }
  if (outcome === 'three_ds') {
    // The issuer confirms the purchase on its side (3-D Secure) — the buyer just waits a few seconds.
    const until = ctx.now() + BANK_CHECK_MS.min + Math.floor(Math.random() * (BANK_CHECK_MS.max - BANK_CHECK_MS.min));
    ctx.db
      .prepare('UPDATE payments SET method_type = ?, method = ?, processing_until = ?, pending_action = ? WHERE id = ?')
      .run('bank_card', JSON.stringify({ ...method, three_d_secure: true }), until, JSON.stringify({ type: 'processing' }), p.id);
    addEvent(ctx, p.id, '3ds_required', { method: method.title });
    return { result: 'processing', until };
  }
  const o = OUTCOMES[outcome];
  return decline(ctx, p, outcome, o.message, method.title);
}

export interface AsyncInput {
  type: 'sbp' | 'installments' | 'crypto';
  asset?: 'BTC' | 'USDT';
  phone?: string;
  email?: string;
}

/** SBP / installments / crypto: the buyer "pays" elsewhere and the payment completes after a short delay. */
export function startAsync(ctx: Ctx, p: PaymentRow, input: AsyncInput): PayResult {
  assertPayable(ctx, p, input.type);
  setEmail(ctx, p, input.email);
  let method: Record<string, unknown>;
  if (input.type === 'sbp') {
    method = { type: 'sbp', id: newId('pm', 20), saved: false, title: 'СБП', sbp_operation_id: `A${randomString(31, '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ')}`, payer_bank_details: { bank_id: `100000000${randomDigits(3)}`, bic: `0445${randomDigits(5)}` } };
  } else if (input.type === 'installments') {
    const digits = (input.phone ?? '').replace(/\D/g, '');
    if (digits.length !== 11) throw new ApiError(400, 'invalid_request', 'Укажите номер телефона', 'phone');
    const part = Math.ceil(p.amount / 4);
    method = { type: 'installments', id: newId('pm', 20), saved: false, title: 'Оплата частями · 4 платежа', plan: { parts: 4, period_days: 14, part_amount: money(part, p.currency) }, phone: `+7 *** ***-${digits.slice(-4, -2)}-${digits.slice(-2)}` };
  } else {
    const asset = input.asset === 'BTC' ? 'BTC' : 'USDT';
    const address = asset === 'BTC' ? `bc1q${randomString(38, '023456789acdefghjklmnpqrstuvwxyz')}` : `T${randomString(33, '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz')}`;
    method = { type: 'crypto', id: newId('pm', 20), saved: false, title: asset === 'BTC' ? 'Bitcoin' : 'USDT · TRC-20', crypto: { asset, network: asset === 'BTC' ? 'bitcoin' : 'tron', address, amount: cryptoAmount(getRates(ctx.db), p.amount, p.currency, asset), tx_hash: null } };
  }
  const until = ctx.now() + PROCESSING_MS[input.type];
  ctx.db.prepare('UPDATE payments SET method_type = ?, method = ?, processing_until = ?, pending_action = ? WHERE id = ?').run(input.type, JSON.stringify(method), until, JSON.stringify({ type: 'processing' }), p.id);
  addEvent(ctx, p.id, 'processing', { method: method.title });
  return { result: 'processing', until };
}

/** Buyer went back from the SBP/crypto screen to choose another method. */
export function abortAsync(ctx: Ctx, p: PaymentRow) {
  if (p.status !== 'pending' || !p.processing_until) return;
  ctx.db.prepare('UPDATE payments SET method_type = NULL, method = NULL, processing_until = NULL, pending_action = NULL WHERE id = ?').run(p.id);
  addEvent(ctx, p.id, 'method_reset', {});
}

// ---------- Merchant operations ----------

export function capturePayment(ctx: Ctx, shop: ShopRow, p: PaymentRow, amount?: number): PaymentRow {
  if (p.status !== 'waiting_for_capture') throw new ApiError(400, 'invalid_state', `Подтвердить можно только платёж в статусе waiting_for_capture (сейчас ${p.status})`);
  const captured = amount ?? p.amount;
  if (captured <= 0 || captured > p.amount) throw new ApiError(400, 'invalid_request', 'Сумма списания не может превышать сумму авторизации', 'amount.value');
  const fee = feeFor(captured, shopFees(ctx.db, shop.fees)[p.method_type ?? 'bank_card']);
  ctx.db.prepare(`UPDATE payments SET status = 'succeeded', amount = ?, fee = ?, captured_at = ?, capture_deadline = NULL WHERE id = ?`).run(captured, fee, ctx.now(), p.id);
  addEvent(ctx, p.id, 'captured', { amount: formatAmount(captured), partial: captured < p.amount });
  const fresh = getPaymentRow(ctx, p.id)!;
  onCaptured(ctx, shop, fresh);
  notify(ctx, fresh, 'payment.succeeded');
  return getPaymentRow(ctx, p.id)!;
}

export function cancelByMerchant(ctx: Ctx, p: PaymentRow): PaymentRow {
  if (p.status !== 'pending' && p.status !== 'waiting_for_capture') throw new ApiError(400, 'invalid_state', `Отменить можно только платёж в статусе pending или waiting_for_capture (сейчас ${p.status})`);
  cancelPayment(ctx, p, 'merchant', 'canceled_by_merchant');
  return getPaymentRow(ctx, p.id)!;
}

export interface RefundRow {
  id: string;
  payment_id: string;
  shop_id: number;
  amount: number;
  currency: string;
  status: string;
  description: string;
  created_at: number;
}

export function serializeRefund(r: RefundRow) {
  return { id: r.id, payment_id: r.payment_id, status: r.status, amount: money(r.amount, r.currency), description: r.description || undefined, created_at: iso(r.created_at) };
}

export function refundPayment(ctx: Ctx, shop: ShopRow, p: PaymentRow, amount: number | undefined, description = ''): RefundRow {
  if (p.status !== 'succeeded') throw new ApiError(400, 'invalid_state', 'Вернуть можно только успешный платёж');
  const left = p.amount - p.refunded;
  const sum = amount ?? left;
  if (left <= 0) throw new ApiError(400, 'invalid_state', 'Платёж уже полностью возвращён');
  if (sum <= 0 || sum > left) throw new ApiError(400, 'invalid_request', `Сумма возврата не может превышать ${formatAmount(left)} ${p.currency}`, 'amount.value');
  if (description.length > 250) throw new ApiError(400, 'invalid_request', 'description: до 250 символов', 'description');
  const id = newId('rf');
  const now = ctx.now();
  ctx.db.transaction(() => {
    ctx.db.prepare(`INSERT INTO refunds(id, payment_id, shop_id, amount, currency, status, description, created_at) VALUES(?,?,?,?,?,'succeeded',?,?)`).run(id, p.id, shop.id, sum, p.currency, description, now);
    ctx.db.prepare('UPDATE payments SET refunded = refunded + ? WHERE id = ?').run(sum, p.id);
    addEvent(ctx, p.id, 'refunded', { refund_id: id, amount: formatAmount(sum), full: sum === left });
    registerReceipt(ctx, shop, p, 'income_return', sum, id);
  })();
  const r = ctx.db.prepare('SELECT * FROM refunds WHERE id = ?').get(id) as RefundRow;
  enqueue(ctx, shop.id, 'refund.succeeded', serializeRefund(r));
  return r;
}

// ---------- Balance & payouts ----------

export function balances(ctx: Ctx, shopId: number) {
  const rows = ctx.db
    .prepare(
      `SELECT c.currency,
         COALESCE((SELECT SUM(amount - fee) FROM payments WHERE shop_id = @s AND currency = c.currency AND status = 'succeeded'), 0)
       - COALESCE((SELECT SUM(amount) FROM refunds WHERE shop_id = @s AND currency = c.currency AND status = 'succeeded'), 0) AS earned,
         COALESCE((SELECT SUM(amount) FROM payouts WHERE shop_id = @s AND currency = c.currency AND status = 'succeeded'), 0) AS paid_out,
         COALESCE((SELECT SUM(amount) FROM payouts WHERE shop_id = @s AND currency = c.currency AND status = 'pending'), 0) AS in_transit,
         COALESCE((SELECT SUM(amount) FROM payments WHERE shop_id = @s AND currency = c.currency AND status = 'waiting_for_capture'), 0) AS held
       FROM (SELECT 'RUB' currency UNION ALL SELECT 'USD' UNION ALL SELECT 'EUR') c`,
    )
    .all({ s: shopId }) as { currency: string; earned: number; paid_out: number; in_transit: number; held: number }[];
  return rows.map((r) => ({ currency: r.currency, available: r.earned - r.paid_out - r.in_transit, inTransit: r.in_transit, held: r.held, paidOut: r.paid_out }));
}

export interface PayoutRow {
  id: string;
  shop_id: number;
  amount: number;
  currency: string;
  destination: string;
  status: 'pending' | 'succeeded' | 'canceled';
  processing_until: number | null;
  created_at: number;
  completed_at: number | null;
}

export function serializePayout(r: PayoutRow) {
  return { id: r.id, status: r.status, amount: money(r.amount, r.currency), payout_destination: safeJson(r.destination, {}), created_at: iso(r.created_at), succeeded_at: iso(r.completed_at) };
}

export function createPayout(ctx: Ctx, shop: ShopRow, amount: number, currency: string, destination: Record<string, string>): PayoutRow {
  const bal = balances(ctx, shop.id).find((b) => b.currency === currency);
  if (!bal || amount > bal.available) throw new ApiError(400, 'insufficient_funds', 'Недостаточно средств на балансе магазина');
  const id = newId('po');
  const now = ctx.now();
  ctx.db.prepare(`INSERT INTO payouts(id, shop_id, amount, currency, destination, status, processing_until, created_at) VALUES(?,?,?,?,?,'pending',?,?)`).run(id, shop.id, amount, currency, JSON.stringify(destination), now + 8000, now);
  return ctx.db.prepare('SELECT * FROM payouts WHERE id = ?').get(id) as PayoutRow;
}

// ---------- Background ----------

/** Advances everything that depends on time. Called every couple of seconds. */
export function tick(ctx: Ctx) {
  const now = ctx.now();
  const due = ctx.db
    .prepare(
      `SELECT * FROM payments WHERE (status = 'pending' AND ((processing_until IS NOT NULL AND processing_until <= @now) OR expires_at <= @now))
         OR (status = 'waiting_for_capture' AND capture_deadline <= @now) LIMIT 200`,
    )
    .all({ now }) as PaymentRow[];
  for (const p of due) settle(ctx, p);
  const payouts = ctx.db.prepare(`SELECT * FROM payouts WHERE status = 'pending' AND processing_until <= ?`).all(now) as PayoutRow[];
  for (const po of payouts) {
    ctx.db.prepare(`UPDATE payouts SET status = 'succeeded', completed_at = ?, processing_until = NULL WHERE id = ?`).run(now, po.id);
    enqueue(ctx, po.shop_id, 'payout.succeeded', serializePayout({ ...po, status: 'succeeded', completed_at: now }));
  }
  ctx.db.prepare('DELETE FROM idempotency WHERE created_at < ?').run(now - 24 * 3600_000);
  return due.length + payouts.length;
}
