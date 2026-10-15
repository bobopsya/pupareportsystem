import { ApiError, type Ctx } from '../context.js';
import { iso, newId, randomDigits, randomString, safeJson } from '../util.js';
import { bankEnabled, bankRequest } from './bank.js';
import { feeFor, METHODS, shopFees, type MethodType } from './fees.js';
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
  mcc: number;
  payout_account: string | null;
  gos_doc_id: number | null;
  created_at: number;
}

export type Funding = 'bank' | 'test';

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
  /** 'bank' — paid with Bobobank money (can be paid out to the bank); 'test' — game cards and simulated methods. */
  funding: Funding;
  bank_auth_id: string | null;
}

/** How long the buyer has to pay a pending payment. */
export const PAYMENT_TTL_MS = 60 * 60 * 1000;
/** Two-stage payments are cancelled automatically if not captured in time. */
export const CAPTURE_TTL_MS = 7 * 24 * 3600 * 1000;
export const MAX_ATTEMPTS = 5;

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
  if (!bankEnabled(ctx)) throw new ApiError(503, 'bank_unavailable', 'Приём платежей временно недоступен: нет связи с Bobobank');
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
    test: p.funding !== 'bank',
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

/** Funds were authorized by the payment network (simulated, or Bobobank for its own cards and SBP). */
export function authorize(ctx: Ctx, p: PaymentRow, method: Record<string, unknown>, opts: { funding?: Funding; bankAuthId?: string } = {}) {
  const shop = getShop(ctx, p.shop_id)!;
  const type = method.type as MethodType;
  const fee = feeFor(p.amount, shopFees(ctx.db, shop.fees)[type]);
  const now = ctx.now();
  const authorization = { rrn: randomDigits(12), auth_code: randomDigits(6), three_d_secure: { applied: !!method.three_d_secure } };
  const stored = { ...method, three_d_secure: undefined, authorization };
  ctx.db.prepare('UPDATE payments SET funding = ?, bank_auth_id = ? WHERE id = ?').run(opts.funding ?? 'test', opts.bankAuthId ?? null, p.id);
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
  // A Bobobank hold (or an unanswered confirmation) is released right away.
  if (p.bank_auth_id?.startsWith('auth_') && bankEnabled(ctx)) void bankRequest(ctx, 'POST', `/internal/v1/authorizations/${p.bank_auth_id}/void`, {}, `void:${p.id}`).catch(() => {});
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
    authorize(ctx, p, safeJson<Record<string, unknown>>(p.method, {}));
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
  if (safeJson<{ type?: string } | null>(p.pending_action, null)?.type === 'bank_confirm') throw new ApiError(400, 'invalid_state', 'Платёж ждёт подтверждения в приложении банка');
  const shop = getShop(ctx, p.shop_id)!;
  if (shop.status !== 'active') throw new ApiError(403, 'forbidden', 'Магазин временно не принимает платежи');
  if (!shopMethods(shop).includes(type)) throw new ApiError(400, 'invalid_request', 'Этот способ оплаты недоступен');
}

export function setEmail(ctx: Ctx, p: PaymentRow, email?: string) {
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200) ctx.db.prepare('UPDATE payments SET customer_email = ? WHERE id = ?').run(email, p.id);
}

export type PayResult =
  | { result: 'succeeded' | 'waiting_for_capture' }
  | { result: 'processing'; until: number }
  | { result: 'declined'; reason: string; message: string; canceled: boolean };

export function decline(ctx: Ctx, p: PaymentRow, reason: string, message: string, title?: string): PayResult {
  const attempts = p.attempts + 1;
  ctx.db.prepare('UPDATE payments SET attempts = ?, pending_action = NULL WHERE id = ?').run(attempts, p.id);
  addEvent(ctx, p.id, 'attempt_failed', { reason, message, method: title });
  if (attempts >= MAX_ATTEMPTS) {
    cancelPayment(ctx, getPaymentRow(ctx, p.id)!, 'gpay', 'too_many_attempts');
    return { result: 'declined', reason, message: `${message} Превышено число попыток, платёж отменён.`, canceled: true };
  }
  return { result: 'declined', reason, message, canceled: false };
}

export const resultOf = (ctx: Ctx, id: string): PayResult => ({ result: getPaymentRow(ctx, id)!.status === 'waiting_for_capture' ? 'waiting_for_capture' : 'succeeded' });

export interface CardInput {
  pan: string;
  expMonth: number;
  expYear: number;
  csc: string;
  holder?: string;
  email?: string;
}

/** Buyer went back from the bank confirmation screen to choose another method. */
export function abortAsync(ctx: Ctx, p: PaymentRow) {
  const bankWait = safeJson<{ type?: string } | null>(p.pending_action, null)?.type === 'bank_confirm';
  if (p.status !== 'pending' || (!p.processing_until && !bankWait)) return;
  if (bankWait && p.bank_auth_id?.startsWith('auth_') && bankEnabled(ctx)) void bankRequest(ctx, 'POST', `/internal/v1/authorizations/${p.bank_auth_id}/void`, {}, `void:${p.bank_auth_id}`).catch(() => {});
  ctx.db.prepare('UPDATE payments SET method_type = NULL, method = NULL, processing_until = NULL, pending_action = NULL, bank_auth_id = NULL WHERE id = ?').run(p.id);
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

/** Checks a refund before anything is sent to the bank; returns the refund amount. */
export function checkRefund(ctx: Ctx, shop: ShopRow, p: PaymentRow, amount: number | undefined, description = ''): number {
  if (p.status !== 'succeeded') throw new ApiError(400, 'invalid_state', 'Вернуть можно только успешный платёж');
  const left = p.amount - p.refunded;
  const sum = amount ?? left;
  if (left <= 0) throw new ApiError(400, 'invalid_state', 'Платёж уже полностью возвращён');
  if (sum <= 0 || sum > left) throw new ApiError(400, 'invalid_request', `Сумма возврата не может превышать ${formatAmount(left)} ${p.currency}`, 'amount.value');
  if (description.length > 250) throw new ApiError(400, 'invalid_request', 'description: до 250 символов', 'description');
  assertRefundCovered(ctx, shop, p, sum);
  return sum;
}

function assertRefundCovered(ctx: Ctx, shop: ShopRow, p: PaymentRow, sum: number) {
  // Refunds are paid from the shop balance of the same kind of money (bank or test).
  const b = balances(ctx, shop.id).find((x) => x.currency === p.currency);
  const available = (p.funding === 'bank' ? b?.live : b?.test) ?? 0;
  if (available < sum) {
    throw new ApiError(400, 'insufficient_funds', `Недостаточно средств на балансе магазина для возврата: доступно ${formatAmount(Math.max(available, 0))} ${p.currency}. Дождитесь новых поступлений или уменьшите сумму возврата.`, 'amount.value');
  }
}

export function refundPayment(ctx: Ctx, shop: ShopRow, p: PaymentRow, amount: number | undefined, description = '', refundId?: string): RefundRow {
  if (p.status !== 'succeeded') throw new ApiError(400, 'invalid_state', 'Вернуть можно только успешный платёж');
  const left = p.amount - p.refunded;
  const sum = amount ?? left;
  if (left <= 0) throw new ApiError(400, 'invalid_state', 'Платёж уже полностью возвращён');
  if (sum <= 0 || sum > left) throw new ApiError(400, 'invalid_request', `Сумма возврата не может превышать ${formatAmount(left)} ${p.currency}`, 'amount.value');
  if (description.length > 250) throw new ApiError(400, 'invalid_request', 'description: до 250 символов', 'description');
  const id = refundId ?? newId('rf');
  const now = ctx.now();
  ctx.db.transaction(() => {
    // Checked inside the transaction too, so two concurrent refunds cannot both pass.
    assertRefundCovered(ctx, shop, p, sum);
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

/**
 * Shop balance per currency. `live` is Bobobank money (can be paid out to the bank), `test` comes from game cards
 * and simulated methods; `available` is their sum.
 */
export function balances(ctx: Ctx, shopId: number) {
  const rows = ctx.db
    .prepare(
      `SELECT c.currency, f.funding,
         COALESCE((SELECT SUM(amount - fee) FROM payments WHERE shop_id = @s AND currency = c.currency AND status = 'succeeded' AND funding = f.funding), 0)
       - COALESCE((SELECT SUM(r.amount) FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE r.shop_id = @s AND r.currency = c.currency AND r.status = 'succeeded' AND p.funding = f.funding), 0) AS earned,
         COALESCE((SELECT SUM(amount) FROM payouts WHERE shop_id = @s AND currency = c.currency AND status = 'succeeded' AND funding = f.funding), 0) AS paid_out,
         COALESCE((SELECT SUM(amount) FROM payouts WHERE shop_id = @s AND currency = c.currency AND status = 'pending' AND funding = f.funding), 0) AS in_transit,
         COALESCE((SELECT SUM(amount) FROM payments WHERE shop_id = @s AND currency = c.currency AND status = 'waiting_for_capture' AND funding = f.funding), 0) AS held
       FROM (SELECT 'RUB' currency UNION ALL SELECT 'USD' UNION ALL SELECT 'EUR') c, (SELECT 'bank' funding UNION ALL SELECT 'test') f`,
    )
    .all({ s: shopId }) as { currency: string; funding: Funding; earned: number; paid_out: number; in_transit: number; held: number }[];
  return ['RUB', 'USD', 'EUR'].map((currency) => {
    const of = (f: Funding) => rows.find((r) => r.currency === currency && r.funding === f)!;
    const bank = of('bank');
    const test = of('test');
    const live = bank.earned - bank.paid_out - bank.in_transit;
    const testAvail = test.earned - test.paid_out - test.in_transit;
    return { currency, available: live + testAvail, live, test: testAvail, inTransit: bank.in_transit + test.in_transit, held: bank.held + test.held, paidOut: bank.paid_out + test.paid_out };
  });
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
  funding: Funding;
}

export function serializePayout(r: PayoutRow) {
  return { id: r.id, status: r.status, amount: money(r.amount, r.currency), payout_destination: safeJson(r.destination, {}), created_at: iso(r.created_at), succeeded_at: iso(r.completed_at) };
}

/** Payout of test money to a (fictional) card; Bobobank payouts go through payoutToBank. */
export function createPayout(ctx: Ctx, shop: ShopRow, amount: number, currency: string, destination: Record<string, string>): PayoutRow {
  const bal = balances(ctx, shop.id).find((b) => b.currency === currency);
  if (!bal || amount > bal.test) {
    throw new ApiError(400, 'insufficient_funds', bal && bal.live > 0 ? 'Недостаточно тестовых средств. Деньги из Bobobank выводятся на счёт в Bobobank.' : 'Недостаточно средств на балансе магазина');
  }
  const id = newId('po');
  const now = ctx.now();
  ctx.db.prepare(`INSERT INTO payouts(id, shop_id, amount, currency, destination, status, processing_until, created_at, funding) VALUES(?,?,?,?,?,'pending',?,?,'test')`).run(id, shop.id, amount, currency, JSON.stringify(destination), now + 8000, now);
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
