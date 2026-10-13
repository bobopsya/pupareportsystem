import { ApiError, type Ctx } from '../context.js';
import { iso, newId, randomString, safeJson } from '../util.js';
import { isCurrency, LIMITS, money } from './money.js';
import { parseReceiptRequest } from './receipts.js';
import type { ShopRow } from './payments.js';

export interface LinkRow {
  id: string;
  shop_id: number;
  slug: string;
  kind: 'link' | 'invoice';
  title: string;
  description: string;
  amount: number | null;
  min_amount: number | null;
  max_amount: number | null;
  currency: string;
  reusable: number;
  uses: number;
  paid_count: number;
  paid_total: number;
  active: number;
  expires_at: number | null;
  items: string | null;
  customer: string | null;
  created_at: number;
}

export interface LinkInput {
  kind: 'link' | 'invoice';
  title: string;
  description?: string;
  amount?: number | null;
  minAmount?: number | null;
  maxAmount?: number | null;
  currency: string;
  reusable?: boolean;
  expiresAt?: number | null;
  receipt?: unknown;
  customer?: { email?: string; name?: string };
}

export function createLink(ctx: Ctx, shop: ShopRow, input: LinkInput): LinkRow {
  if (!isCurrency(input.currency)) throw new ApiError(400, 'invalid_request', 'Валюта: RUB, USD или EUR', 'currency');
  const title = input.title.trim();
  if (!title || title.length > 100) throw new ApiError(400, 'invalid_request', 'Название: от 1 до 100 символов', 'title');
  if ((input.description ?? '').length > 500) throw new ApiError(400, 'invalid_request', 'Описание: до 500 символов', 'description');
  const lim = LIMITS[input.currency];
  for (const [k, v] of [['amount', input.amount], ['min_amount', input.minAmount], ['max_amount', input.maxAmount]] as const) {
    if (v != null && (v < lim.min || v > lim.max)) throw new ApiError(400, 'invalid_request', `Сумма вне допустимого диапазона`, k);
  }
  if (input.kind === 'invoice' && !input.amount) throw new ApiError(400, 'invalid_request', 'Для счёта нужна фиксированная сумма', 'amount');
  if (input.expiresAt && input.expiresAt <= ctx.now()) throw new ApiError(400, 'invalid_request', 'Срок действия уже прошёл', 'expires_at');
  const receipt = input.receipt && input.amount ? parseReceiptRequest(input.receipt, input.amount, input.currency) : null;
  const id = newId('lnk', 20);
  let slug = randomString(10);
  while (ctx.db.prepare('SELECT 1 FROM payment_links WHERE slug = ?').get(slug)) slug = randomString(10);
  ctx.db
    .prepare(
      `INSERT INTO payment_links(id, shop_id, slug, kind, title, description, amount, min_amount, max_amount, currency, reusable, expires_at, items, customer, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, shop.id, slug, input.kind, title, input.description ?? '', input.amount ?? null, input.amount ? null : input.minAmount ?? null, input.amount ? null : input.maxAmount ?? null, input.currency, input.kind === 'invoice' ? 0 : input.reusable === false ? 0 : 1, input.expiresAt ?? null, receipt ? JSON.stringify(receipt) : null, input.customer ? JSON.stringify(input.customer) : null, ctx.now());
  return ctx.db.prepare('SELECT * FROM payment_links WHERE id = ?').get(id) as LinkRow;
}

export function linkState(ctx: Ctx, l: LinkRow): 'active' | 'paid' | 'expired' | 'disabled' {
  if (!l.reusable && l.paid_count > 0) return 'paid';
  if (!l.active) return 'disabled';
  if (l.expires_at && l.expires_at <= ctx.now()) return 'expired';
  return 'active';
}

export function serializeLink(ctx: Ctx, l: LinkRow) {
  return {
    id: l.id,
    type: l.kind,
    status: linkState(ctx, l),
    url: `${ctx.cfg.publicUrl}/l/${l.slug}`,
    title: l.title,
    description: l.description || undefined,
    amount: l.amount ? money(l.amount, l.currency) : undefined,
    min_amount: l.min_amount ? money(l.min_amount, l.currency) : undefined,
    max_amount: l.max_amount ? money(l.max_amount, l.currency) : undefined,
    currency: l.currency,
    reusable: !!l.reusable,
    expires_at: iso(l.expires_at),
    customer: safeJson(l.customer, undefined),
    stats: { opened: l.uses, paid_count: l.paid_count, paid_total: money(l.paid_total, l.currency) },
    created_at: iso(l.created_at),
  };
}
