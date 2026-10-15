import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError, type Ctx } from '../context.js';
import { METHOD_TITLE } from '../domain/fees.js';
import { getRates } from '../domain/fx.js';
import { linkState, type LinkRow } from '../domain/links.js';
import { formatAmount, LIMITS, parseAmount } from '../domain/money.js';
import {
  abortAsync, createPayment, getShop, loadPayment, MAX_ATTEMPTS, setEmail, shopMethods, type PaymentRow,
} from '../domain/payments.js';
import type { FiscalReceipt, ReceiptRequest } from '../domain/receipts.js';
import { quittancePdf, receiptPdf } from '../pdf.js';
import { safeJson, sha256 } from '../util.js';
import { bankCards } from '../domain/bank.js';
import { isBankCard, payWithBankCard, requestBobopay } from '../domain/bankpay.js';

function publicShop(ctx: Ctx, shopId: number) {
  const s = getShop(ctx, shopId)!;
  return { id: s.id, name: s.name, legalName: s.legal_name, inn: s.inn, site: s.site, color: s.color, methods: shopMethods(s), active: s.status === 'active' };
}

function lastDecline(ctx: Ctx, id: string) {
  const ev = ctx.db.prepare(`SELECT type, data FROM payment_events WHERE payment_id = ? ORDER BY id DESC LIMIT 1`).get(id) as { type: string; data: string } | undefined;
  return ev?.type === 'attempt_failed' ? safeJson<{ reason: string; message: string }>(ev.data, { reason: '', message: '' }) : null;
}

export function publicPayment(ctx: Ctx, p: PaymentRow) {
  const receipt = safeJson<ReceiptRequest | null>(p.receipt, null);
  const action = safeJson<{ type: string; until?: number; bank?: string } | null>(p.pending_action, null);
  const method = safeJson<Record<string, unknown> | null>(p.method, null);
  const receipts = ctx.db.prepare('SELECT id, type, refund_id, created_at FROM receipts WHERE payment_id = ? ORDER BY created_at').all(p.id) as { id: string; type: string; refund_id: string | null; created_at: number }[];
  return {
    id: p.id,
    status: p.status,
    amount: p.amount,
    currency: p.currency,
    refunded: p.refunded,
    description: p.description,
    items: receipt?.items.map((it) => ({ name: it.description, quantity: it.quantity, price: it.price })) ?? null,
    customerEmail: p.customer_email,
    createdAt: p.created_at,
    expiresAt: p.expires_at,
    capturedAt: p.captured_at,
    returnUrl: p.return_url,
    attemptsLeft: MAX_ATTEMPTS - p.attempts,
    action: action?.type === 'processing' ? { type: 'processing', until: p.processing_until } : action?.type === 'bank_confirm' ? { type: 'bank_confirm', until: action.until, bank: action.bank } : null,
    funding: p.funding,
    sbpBankUrl: ctx.cfg.bankPublicUrl ? `${ctx.cfg.bankPublicUrl}/sbp/pay?payment=${p.id}` : null,
    bobopayUrl: ctx.cfg.bankPublicUrl ? `${ctx.cfg.bankPublicUrl}/sbp/pay?payment=${p.id}&method=bobopay` : null,
    method: method ? { type: method.type, title: method.title, phone: method.phone, sbp: method.type === 'sbp' ? { operationId: method.sbp_operation_id } : undefined } : null,
    methodType: p.method_type,
    cancellation: safeJson(p.cancellation, null),
    lastDecline: p.status === 'pending' ? lastDecline(ctx, p.id) : null,
    receipts: receipts.map((r) => ({ id: r.id, type: r.type, createdAt: r.created_at })),
  };
}

function payable(ctx: Ctx, id: string): PaymentRow {
  const p = loadPayment(ctx, id);
  if (!p) throw new ApiError(404, 'not_found', 'Платёж не найден');
  return p;
}

export function registerCheckoutRoutes(app: FastifyInstance, ctx: Ctx) {
  /** SHA-256 of Bobobank card numbers: the page rejects anything else before it leaves the browser. */
  app.get('/api/checkout/cards', async (req) => {
    const fresh = (req.query as { fresh?: string }).fresh === '1';
    const bank = await bankCards(ctx, fresh);
    return { hashes: bank.hashes, bankBins: bank.bins };
  });

  app.get<{ Params: { id: string } }>('/api/checkout/payments/:id', async (req) => {
    const p = payable(ctx, req.params.id);
    return { payment: publicPayment(ctx, p), shop: publicShop(ctx, p.shop_id), rates: getRates(ctx.db), methodTitles: METHOD_TITLE };
  });

  const cardBody = z.object({
    pan: z.string().max(25),
    expMonth: z.coerce.number().int().min(1).max(12),
    expYear: z.coerce.number().int().min(2000).max(2100),
    csc: z.string().max(4),
    holder: z.string().max(60).optional(),
    email: z.string().max(200).optional(),
  });
  app.post<{ Params: { id: string } }>('/api/checkout/payments/:id/card', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const body = cardBody.parse(req.body);
    const p = payable(ctx, req.params.id);
    const pan = body.pan.replace(/\D/g, '');
    assertMethod(p, 'bank_card');
    if (!(await isBankCard(ctx, pan))) throw new ApiError(400, 'card_not_supported', 'Карта не поддерживается');
    setEmail(ctx, p, body.email);
    const result = await payWithBankCard(ctx, p, body);
    return { result, payment: publicPayment(ctx, loadPayment(ctx, p.id)!) };
  });

  /** Status checks before the bank is asked: the order is still payable and the shop accepts the method. */
  const assertMethod = (p: PaymentRow, type: 'bank_card' | 'bobopay') => {
    if (p.status !== 'pending') throw new ApiError(400, 'invalid_state', 'Платёж уже не ожидает оплаты');
    if (p.pending_action?.includes('bank_confirm')) throw new ApiError(400, 'invalid_state', 'Платёж ждёт подтверждения в приложении банка');
    const shop = getShop(ctx, p.shop_id)!;
    if (shop.status !== 'active') throw new ApiError(403, 'forbidden', 'Магазин временно не принимает платежи');
    if (!shopMethods(shop).includes(type)) throw new ApiError(400, 'invalid_request', 'Этот способ оплаты недоступен');
  };

  /** Bobo Pay by phone: a request pops up in the customer's Bobobank app. */
  app.post<{ Params: { id: string } }>('/api/checkout/payments/:id/bobopay', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const body = z.object({ phone: z.string().max(30), email: z.string().max(200).optional() }).parse(req.body);
    const p = payable(ctx, req.params.id);
    assertMethod(p, 'bobopay');
    if (body.phone.replace(/\D/g, '').length !== 11) throw new ApiError(400, 'invalid_request', 'Введите номер телефона полностью', 'phone');
    setEmail(ctx, p, body.email);
    const result = await requestBobopay(ctx, p, body.phone);
    return { result, payment: publicPayment(ctx, loadPayment(ctx, p.id)!) };
  });

  app.post<{ Params: { id: string } }>('/api/checkout/payments/:id/reset', async (req) => {
    const p = payable(ctx, req.params.id);
    abortAsync(ctx, p);
    return { payment: publicPayment(ctx, loadPayment(ctx, p.id)!) };
  });

  // ---------- Payment links ----------
  const getLink = (slug: string) => {
    const l = ctx.db.prepare('SELECT * FROM payment_links WHERE slug = ?').get(slug) as LinkRow | undefined;
    if (!l) throw new ApiError(404, 'not_found', 'Ссылка на оплату не найдена');
    return l;
  };

  app.get<{ Params: { slug: string } }>('/api/checkout/links/:slug', async (req) => {
    const l = getLink(req.params.slug);
    const items = safeJson<ReceiptRequest | null>(l.items, null);
    return {
      link: {
        slug: l.slug, kind: l.kind, title: l.title, description: l.description, amount: l.amount, minAmount: l.min_amount ?? LIMITS[l.currency as 'RUB'].min,
        maxAmount: l.max_amount ?? LIMITS[l.currency as 'RUB'].max, currency: l.currency, state: linkState(ctx, l), expiresAt: l.expires_at,
        items: items?.items.map((it) => ({ name: it.description, quantity: it.quantity, price: it.price })) ?? null, customer: safeJson(l.customer, null),
      },
      shop: publicShop(ctx, l.shop_id),
    };
  });

  app.post<{ Params: { slug: string } }>('/api/checkout/links/:slug/pay', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const body = z.object({ amount: z.string().max(20).optional(), email: z.string().max(200).optional() }).parse(req.body);
    const l = getLink(req.params.slug);
    const state = linkState(ctx, l);
    if (state !== 'active') throw new ApiError(400, 'invalid_state', state === 'paid' ? 'Счёт уже оплачен' : state === 'expired' ? 'Срок действия ссылки истёк' : 'Ссылка отключена продавцом');
    let amount = l.amount;
    if (!amount) {
      amount = parseAmount(body.amount, 'amount');
      if ((l.min_amount && amount < l.min_amount) || (l.max_amount && amount > l.max_amount)) throw new ApiError(400, 'invalid_request', 'Сумма вне допустимого диапазона', 'amount');
    }
    // An unpaid invoice reuses its pending payment instead of creating a new one on every visit.
    if (!l.reusable) {
      const open = ctx.db.prepare(`SELECT id FROM payments WHERE link_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`).get(l.id) as { id: string } | undefined;
      if (open && loadPayment(ctx, open.id)?.status === 'pending') return { paymentId: open.id };
    }
    const shop = getShop(ctx, l.shop_id)!;
    const customer = safeJson<{ email?: string } | null>(l.customer, null);
    const stored = safeJson<ReceiptRequest | null>(l.items, null);
    const receipt = stored && {
      customer: { email: body.email || customer?.email },
      items: stored.items.map((it) => ({ ...it, amount: { value: formatAmount(it.price), currency: l.currency } })),
    };
    const p = createPayment(ctx, shop, {
      amount, currency: l.currency, description: l.title.slice(0, 128), receipt: receipt ?? undefined,
      customerEmail: body.email || customer?.email, linkId: l.id, source: 'link',
    });
    ctx.db.prepare('UPDATE payment_links SET uses = uses + 1 WHERE id = ?').run(l.id);
    return { paymentId: p.id };
  });

  // ---------- Receipts and confirmations (capability URLs) ----------
  const getReceipt = (id: string) => {
    const r = ctx.db.prepare('SELECT * FROM receipts WHERE id = ?').get(id) as { id: string; shop_id: number; payment_id: string; type: string; data: string; created_at: number } | undefined;
    if (!r) throw new ApiError(404, 'not_found', 'Чек не найден');
    return r;
  };

  app.get<{ Params: { id: string } }>('/api/checkout/receipts/:id', async (req) => {
    const r = getReceipt(req.params.id);
    return { id: r.id, paymentId: r.payment_id, receipt: JSON.parse(r.data) as FiscalReceipt, shop: publicShop(ctx, r.shop_id) };
  });

  app.get<{ Params: { id: string } }>('/api/checkout/receipts/:id/pdf', async (req, reply) => {
    const r = getReceipt(req.params.id);
    const data = JSON.parse(r.data) as FiscalReceipt;
    const pdf = await receiptPdf(data);
    return reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="gpay-check-${data.kkt.fd}.pdf"`).send(pdf);
  });

  const quittance = (p: PaymentRow) => {
    if (p.status !== 'succeeded') throw new ApiError(400, 'invalid_state', 'Квитанция доступна только для успешного платежа');
    const s = getShop(ctx, p.shop_id)!;
    const m = safeJson<{ type: string; title?: string; card?: { card_type: string; last4: string }; authorization?: { rrn: string; auth_code: string }; sbp_operation_id?: string }>(p.method, { type: '' });
    return {
      shopName: s.name, legalName: s.legal_name, inn: s.inn, amount: p.amount, fee: p.fee, currency: p.currency, description: p.description, status: p.status,
      method: m.card ? `${m.card.card_type} •• ${m.card.last4}` : m.title ?? METHOD_TITLE[m.type as 'sbp'] ?? m.type,
      paymentId: p.id, operationId: m.sbp_operation_id ?? `${p.shop_id}${String(p.captured_at)}`, rrn: m.authorization?.rrn ?? '', authCode: m.authorization?.auth_code ?? '', ts: p.captured_at ?? p.created_at, refunded: p.refunded,
    };
  };

  app.get<{ Params: { id: string } }>('/api/checkout/payments/:id/quittance', async (req) => ({ quittance: quittance(payable(ctx, req.params.id)), shop: publicShop(ctx, payable(ctx, req.params.id).shop_id) }));

  app.get<{ Params: { id: string } }>('/api/checkout/payments/:id/quittance.pdf', async (req, reply) => {
    const pdf = await quittancePdf(quittance(payable(ctx, req.params.id)));
    return reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="gpay-${req.params.id}.pdf"`).send(pdf);
  });
}
