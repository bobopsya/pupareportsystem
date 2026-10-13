import type { Ctx } from '../context.js';
import { ApiError } from '../context.js';
import { hmacHex, newId, randomDigits, safeJson } from '../util.js';
import { formatAmount, parseAmount } from './money.js';

export const VAT_CODES = ['none', 'vat0', 'vat5', 'vat7', 'vat10', 'vat22', 'vat105', 'vat107', 'vat110', 'vat122'] as const;
export type VatCode = (typeof VAT_CODES)[number];

export const VAT_LABEL: Record<VatCode, string> = {
  none: 'БЕЗ НДС',
  vat0: 'НДС 0%',
  vat5: 'НДС 5%',
  vat7: 'НДС 7%',
  vat10: 'НДС 10%',
  vat22: 'НДС 22%',
  vat105: 'НДС 5/105',
  vat107: 'НДС 7/107',
  vat110: 'НДС 10/110',
  vat122: 'НДС 22/122',
};

/** Rate applied to a VAT-inclusive sum. */
const VAT_RATE: Record<VatCode, number> = { none: 0, vat0: 0, vat5: 5, vat7: 7, vat10: 10, vat22: 22, vat105: 5, vat107: 7, vat110: 10, vat122: 22 };

export const vatOf = (sum: number, code: VatCode) => Math.round((sum * VAT_RATE[code]) / (100 + VAT_RATE[code]));

export const TAX_SYSTEMS = { osn: 'ОСН', usn_income: 'УСН доход', usn_income_outcome: 'УСН доход - расход', esn: 'ЕСХН', patent: 'ПСН' } as const;
export type TaxSystem = keyof typeof TAX_SYSTEMS;

export const SUBJECTS = { commodity: 'ТОВАР', service: 'УСЛУГА', job: 'РАБОТА', excise: 'ПОДАКЦИЗНЫЙ ТОВАР', payment: 'ПЛАТЕЖ', another: 'ИНОЙ ПРЕДМЕТ РАСЧЕТА' } as const;
export const MODES = { full_payment: 'ПОЛНЫЙ РАСЧЕТ', full_prepayment: 'ПРЕДОПЛАТА 100%', partial_prepayment: 'ПРЕДОПЛАТА', advance: 'АВАНС' } as const;

/** Receipt request as stored on a payment (validated API input). */
export interface ReceiptRequest {
  customer: { email?: string; phone?: string; full_name?: string };
  items: { description: string; quantity: number; price: number; vat_code: VatCode; payment_subject: keyof typeof SUBJECTS; payment_mode: keyof typeof MODES }[];
}

/** Validates the `receipt` object from the API and checks that items add up to the payment amount. */
export function parseReceiptRequest(input: unknown, amount: number, currency: string): ReceiptRequest {
  const r = input as { customer?: Record<string, unknown>; items?: unknown[] };
  if (!r || typeof r !== 'object') throw new ApiError(400, 'invalid_request', 'receipt должен быть объектом', 'receipt');
  const cust = (r.customer ?? {}) as Record<string, unknown>;
  const email = typeof cust.email === 'string' ? cust.email.trim() : undefined;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'invalid_request', 'Некорректный email покупателя', 'receipt.customer.email');
  if (!Array.isArray(r.items) || r.items.length === 0 || r.items.length > 100) throw new ApiError(400, 'invalid_request', 'receipt.items: от 1 до 100 позиций', 'receipt.items');
  let total = 0;
  const items = r.items.map((raw, i) => {
    const it = raw as Record<string, unknown>;
    const p = `receipt.items[${i}]`;
    const description = String(it.description ?? '').trim();
    if (!description || description.length > 128) throw new ApiError(400, 'invalid_request', 'Название позиции: от 1 до 128 символов', `${p}.description`);
    const quantity = Number(it.quantity ?? 1);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 99999) throw new ApiError(400, 'invalid_request', 'Некорректное количество', `${p}.quantity`);
    const amt = it.amount as { value?: unknown; currency?: unknown } | undefined;
    if (amt?.currency && amt.currency !== currency) throw new ApiError(400, 'invalid_request', 'Валюта позиции должна совпадать с валютой платежа', `${p}.amount.currency`);
    const price = parseAmount(amt?.value, `${p}.amount.value`);
    const vat_code = (it.vat_code ?? 'vat22') as VatCode;
    if (!VAT_CODES.includes(vat_code)) throw new ApiError(400, 'invalid_request', `vat_code: одно из ${VAT_CODES.join(', ')}`, `${p}.vat_code`);
    const payment_subject = (it.payment_subject ?? 'commodity') as keyof typeof SUBJECTS;
    if (!(payment_subject in SUBJECTS)) throw new ApiError(400, 'invalid_request', `payment_subject: одно из ${Object.keys(SUBJECTS).join(', ')}`, `${p}.payment_subject`);
    const payment_mode = (it.payment_mode ?? 'full_payment') as keyof typeof MODES;
    if (!(payment_mode in MODES)) throw new ApiError(400, 'invalid_request', `payment_mode: одно из ${Object.keys(MODES).join(', ')}`, `${p}.payment_mode`);
    total += Math.round(price * quantity);
    return { description, quantity, price, vat_code, payment_subject, payment_mode };
  });
  if (total !== amount) {
    throw new ApiError(400, 'invalid_request', `Сумма позиций чека (${formatAmount(total)}) не совпадает с суммой платежа (${formatAmount(amount)})`, 'receipt.items');
  }
  return { customer: { email, phone: typeof cust.phone === 'string' ? cust.phone : undefined, full_name: typeof cust.full_name === 'string' ? cust.full_name : undefined }, items };
}

export interface FiscalReceipt {
  kind: 'income' | 'income_return';
  currency: string;
  seller: { name: string; legalName: string; inn: string; site: string; taxSystem: string };
  items: { name: string; quantity: number; price: number; sum: number; vat: string; vatSum: number; subject: string; mode: string }[];
  total: number;
  vatTotals: { label: string; sum: number }[];
  method: string;
  customerEmail: string | null;
  kkt: { rn: string; zn: string; fn: string; fd: number; fpd: string; shift: number; checkNo: number; ts: number };
  ofd: { name: string; inn: string; site: string };
  qr: string;
}

interface ShopRow {
  id: number;
  name: string;
  legal_name: string;
  inn: string;
  tax_system: string;
  site: string;
  default_vat: string;
  kkt_rn: string;
  fn_number: string;
}

interface PaymentLike {
  id: string;
  amount: number;
  currency: string;
  description: string;
  receipt: string | null;
  customer_email: string | null;
  method_type: string | null;
}

/** Moscow time in the YYYYMMDDTHHMM form used by receipt QR codes. */
function qrTime(ts: number) {
  const d = new Date(ts + 3 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

export const newKktNumbers = () => ({ rn: `000${randomDigits(13)}`, fn: `7380440${randomDigits(9)}` });

/**
 * Registers a fiscal receipt for a captured payment or a refund. Amount is the receipt total;
 * for partial refunds/captures the items are scaled down to a single line when they no longer match.
 */
export function registerReceipt(ctx: Ctx, shop: ShopRow, p: PaymentLike, kind: FiscalReceipt['kind'], amount: number, refundId: string | null = null): string {
  const now = ctx.now();
  const req = safeJson<ReceiptRequest | null>(p.receipt, null);
  let lines: ReceiptRequest['items'] =
    req?.items ?? [{ description: p.description || 'Оплата заказа', quantity: 1, price: amount, vat_code: shop.default_vat as VatCode, payment_subject: 'commodity', payment_mode: 'full_payment' }];
  const linesTotal = lines.reduce((s, it) => s + Math.round(it.price * it.quantity), 0);
  if (linesTotal !== amount) {
    const first = lines[0];
    lines = [{ ...first, description: lines.length === 1 ? first.description : p.description || 'Оплата заказа', quantity: 1, price: amount }];
  }
  const items = lines.map((it) => {
    const sum = Math.round(it.price * it.quantity);
    return { name: it.description, quantity: it.quantity, price: it.price, sum, vat: VAT_LABEL[it.vat_code], vatSum: vatOf(sum, it.vat_code), subject: SUBJECTS[it.payment_subject], mode: MODES[it.payment_mode] };
  });
  const vatMap = new Map<string, number>();
  for (const it of items) vatMap.set(it.vat, (vatMap.get(it.vat) ?? 0) + it.vatSum);

  const fd = ctx.db.prepare('UPDATE shops SET fd_counter = fd_counter + 1 WHERE id = ? RETURNING fd_counter, shift_no').get(shop.id) as { fd_counter: number; shift_no: number };
  const fpd = String(parseInt(hmacHex(ctx.secret, `${shop.fn_number}|${fd.fd_counter}|${now}|${amount}|${kind}`).slice(0, 10), 16) % 10_000_000_000).padStart(10, '0');
  const receipt: FiscalReceipt = {
    kind,
    currency: p.currency,
    seller: { name: shop.name, legalName: shop.legal_name, inn: shop.inn, site: shop.site, taxSystem: TAX_SYSTEMS[shop.tax_system as TaxSystem] ?? shop.tax_system },
    items,
    total: amount,
    vatTotals: [...vatMap].map(([label, sum]) => ({ label, sum })),
    method: 'БЕЗНАЛИЧНЫМИ',
    customerEmail: req?.customer.email ?? p.customer_email ?? null,
    kkt: { rn: shop.kkt_rn, zn: `00${String(shop.id).padStart(8, '0')}${shop.fn_number.slice(-4)}`, fn: shop.fn_number, fd: fd.fd_counter, fpd, shift: fd.shift_no, checkNo: ((fd.fd_counter - 1) % 500) + 1, ts: now },
    ofd: { name: 'GPAY ОФД', inn: '7704418820', site: `${ctx.cfg.publicUrl}/receipts` },
    qr: `t=${qrTime(now)}&s=${formatAmount(amount)}&fn=${shop.fn_number}&i=${fd.fd_counter}&fp=${fpd}&n=${kind === 'income' ? 1 : 2}`,
  };
  const id = newId('rcp', 20);
  ctx.db.prepare('INSERT INTO receipts(id, shop_id, payment_id, refund_id, type, data, created_at) VALUES(?,?,?,?,?,?,?)').run(id, shop.id, p.id, refundId, kind, JSON.stringify(receipt), now);
  return id;
}

export function serializeReceipt(row: { id: string; payment_id: string; refund_id: string | null; type: string; data: string; created_at: number }, publicUrl: string) {
  const r = JSON.parse(row.data) as FiscalReceipt;
  return {
    id: row.id,
    type: row.type === 'income' ? 'payment' : 'refund',
    payment_id: row.payment_id,
    refund_id: row.refund_id ?? undefined,
    status: 'succeeded',
    fiscal_document_number: String(r.kkt.fd),
    fiscal_storage_number: r.kkt.fn,
    fiscal_attribute: r.kkt.fpd,
    registered_at: new Date(r.kkt.ts).toISOString(),
    fiscal_provider_id: 'gpay-ofd',
    total: { value: formatAmount(r.total), currency: r.currency },
    items: r.items.map((it) => ({ description: it.name, quantity: it.quantity.toFixed(2), amount: { value: formatAmount(it.price), currency: r.currency }, vat: it.vat })),
    url: `${publicUrl}/r/${row.id}`,
  };
}
