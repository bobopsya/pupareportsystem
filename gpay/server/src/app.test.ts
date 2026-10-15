import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createCtx, type Ctx } from './context.js';
import { openDb } from './db.js';
import { brandOf, luhn } from './domain/cards.js';
import { convert, DEFAULT_RATES } from './domain/fx.js';
import { parseAmount } from './domain/money.js';
import { tick } from './domain/payments.js';
import { vatOf } from './domain/receipts.js';
import { deliverDue, signature } from './domain/webhooks.js';
import { resetBankCache } from './domain/bank.js';
import { tickBank } from './domain/bankpay.js';
import { sign as bankSign } from './domain/signing.js';
import { hmacHex, sha256 } from './util.js';

let now = Date.UTC(2026, 9, 13, 9, 0, 0);
let ctx: Ctx;
let app: FastifyInstance;
let sent: { url: string; init: RequestInit }[];
let hookStatus = 200;
let calls: { method: string; url: string; body: unknown; key?: string }[];
let authStatus: string;
let authReply: Record<string, unknown>;
let requestStatus: string;
const BANK_PAN = '2204551234567891';
const BANK_PAN2 = '2204559876543217';

beforeEach(async () => {
  now = Date.UTC(2026, 9, 13, 9, 0, 0);
  resetBankCache();
  const cfg = loadConfig({ COOKIE_SECURE: '0', PUBLIC_URL: 'https://pay.test', WEBHOOK_ALLOW_PRIVATE: '1', BANK_INTERNAL_URL: 'http://bank.internal', BANK_PUBLIC_URL: 'https://bank.test', BANK_GPAY_SECRET: 'shared' });
  ctx = createCtx(openDb(null), cfg, () => now);
  sent = [];
  hookStatus = 200;
  ctx.http = async (url, init) => {
    sent.push({ url, init });
    return new Response('ok', { status: hookStatus });
  };
  calls = [];
  authStatus = 'pending';
  authReply = { status: 'captured', authorization_id: 'auth_1' };
  requestStatus = 'pending';
  // A stand-in for Bobobank's internal API.
  ctx.bankHttp = async (url, init) => {
    const path = url.replace('http://bank.internal', '');
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: String(init.method), url: path, body, key: (init.headers as Record<string, string>)['idempotence-key'] });
    if (path === '/internal/v1/cards') return Response.json({ hashes: [sha256(BANK_PAN), sha256(BANK_PAN2)], bins: ['220455'] });
    if (path === '/internal/v1/authorize') {
      if (body.pan === BANK_PAN2) return Response.json({ status: 'pending', authorization_id: 'auth_1', expires_at: now + 300_000 });
      return Response.json(authReply);
    }
    if (path === '/internal/v1/authorizations/auth_1') return Response.json({ id: 'auth_1', status: authStatus, reason: authStatus === 'declined' ? 'declined_by_customer' : null });
    if (path === '/internal/v1/requests') {
      if (body.phone !== '79991234567') return Response.json({ error: 'Клиент с таким номером не найден' }, { status: 404 });
      return Response.json({ id: 'req_1', status: 'pending', expires_at: now + 300_000 });
    }
    if (path === '/internal/v1/requests/req_1') return Response.json({ id: 'req_1', status: requestStatus });
    if (path === '/internal/v1/links/claim') return Response.json({ account: { number: '40802810000001234567', name: 'ИП Петров', holder: 'ИП Петров', currency: 'RUB' } });
    return Response.json({ status: 'succeeded' });
  };
  app = await buildApp(ctx);
});

const H = { 'x-requested-with': 'gpay' };

async function merchant() {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', headers: H, payload: { email: 'shop@example.com', name: 'Иван', password: 'password123' } });
  expect(res.statusCode).toBe(200);
  const cookie = String(res.headers['set-cookie']).split(';')[0];
  const headers = { ...H, cookie };
  const shop = await app.inject({ method: 'POST', url: '/api/m/shops', headers, payload: { name: 'Кофейня', legalName: 'ООО «Кофейня»', inn: '7700000001', taxSystem: 'usn_income', site: 'coffee.example' } });
  expect(shop.statusCode).toBe(200);
  const shopId = shop.json().shop.id as number;
  const key = await app.inject({ method: 'POST', url: `/api/m/shops/${shopId}/keys`, headers, payload: { name: 'backend' } });
  return { headers, shopId, secret: key.json().secret as string };
}

function api(secret: string, method: 'GET' | 'POST', url: string, payload?: unknown, idem?: string) {
  return app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${secret}`, ...(idem ? { 'idempotence-key': idem } : {}) }, payload: payload as object });
}

const newPayment = (secret: string, extra: object = {}, idem = `k-${Math.random()}`) =>
  api(secret, 'POST', '/payments', { amount: { value: '1500.00', currency: 'RUB' }, description: 'Заказ №1', confirmation: { type: 'redirect', return_url: 'https://coffee.example/ok' }, ...extra }, idem);

const card = (pan: string) => ({ pan, expMonth: 12, expYear: 2030, csc: '123', email: 'buyer@example.com' });
const pay = (id: string, body: object, path = 'card') => app.inject({ method: 'POST', url: `/api/checkout/payments/${id}/${path}`, headers: H, payload: body });

describe('domain helpers', () => {
  it('validates card numbers and brands', () => {
    expect(luhn(BANK_PAN)).toBe(true);
    expect(luhn('2204551234567892')).toBe(false);
    expect(brandOf('2200000000000004')).toBe('mir');
    expect(brandOf('2221000000000009')).toBe('mastercard');
    expect(brandOf('6200000000000005')).toBe('unionpay');
    expect(brandOf('340000000000009')).toBeNull();
  });

  it('parses amounts and computes VAT and FX', () => {
    expect(parseAmount('1500.5')).toBe(150050);
    expect(() => parseAmount('1,5')).toThrow();
    expect(() => parseAmount('0.00')).toThrow();
    expect(vatOf(12200, 'vat22')).toBe(2200);
    expect(vatOf(11000, 'vat10')).toBe(1000);
    expect(vatOf(10000, 'none')).toBe(0);
    expect(convert(DEFAULT_RATES, 10000, 'USD', 'RUB')).toBe(Math.round(10000 * DEFAULT_RATES.USD));
  });

  it('signs webhooks with HMAC-SHA256 over "t.body"', () => {
    expect(signature('whsec_x', 100, '{}')).toBe(`t=100,v1=${hmacHex('whsec_x', '100.{}')}`);
  });
});

describe('API v1', () => {
  it('requires a valid key', async () => {
    const res = await api('sk_live_wrong', 'GET', '/me');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ type: 'error', code: 'invalid_credentials' });
  });

  it('creates a payment with Idempotence-Key and replays it', async () => {
    const { secret, shopId } = await merchant();
    expect((await newPayment(secret, {}, '')).json().code).toBe('invalid_request');
    const a = await newPayment(secret, {}, 'same');
    const b = await newPayment(secret, {}, 'same');
    expect(a.statusCode).toBe(200);
    expect(b.json().id).toBe(a.json().id);
    expect(a.json()).toMatchObject({ status: 'pending', paid: false, amount: { value: '1500.00', currency: 'RUB' }, recipient: { account_id: String(shopId) } });
    expect(a.json().confirmation.confirmation_url).toBe(`https://pay.test/pay/${a.json().id}`);
    const conflict = await api(secret, 'POST', '/payments', { amount: { value: '1.00', currency: 'RUB' } }, 'same');
    expect(conflict.statusCode).toBe(400);
    const list = await api(secret, 'GET', '/payments?limit=1');
    expect(list.json().items).toHaveLength(1);
  });

  it('validates receipt totals', async () => {
    const { secret } = await merchant();
    const bad = await newPayment(secret, { receipt: { customer: { email: 'a@b.ru' }, items: [{ description: 'Кофе', quantity: 1, amount: { value: '100.00', currency: 'RUB' }, vat_code: 'vat22' }] } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().parameter).toBe('receipt.items');
  });
});

const bankPost = (path: string, payload: object) => {
  const raw = JSON.stringify(payload);
  return app.inject({ method: 'POST', url: path, headers: { 'content-type': 'application/json', 'x-bank-signature': bankSign('shared', 'POST', path, raw, Math.floor(now / 1000)) }, payload: raw });
};
const paySbp = (id: string, method: 'sbp' | 'bobopay' = 'sbp') => bankPost(`/internal/bank/payments/${id}/${method}`, { operation_id: 'B123', payer: { name: 'Иван П.' } });

describe('checkout', () => {
  it('pays with a Bobobank card, registers a receipt and notifies the webhook', async () => {
    const { secret, headers, shopId } = await merchant();
    await app.inject({ method: 'POST', url: `/api/m/shops/${shopId}/webhooks`, headers, payload: { url: 'https://hooks.example/gpay', events: ['payment.succeeded'] } });
    const p = (await newPayment(secret)).json();
    const res = await pay(p.id, card(BANK_PAN));
    expect(res.json().result.result).toBe('succeeded');
    expect(calls.find((c) => c.url === '/internal/v1/authorize')!.body).toMatchObject({ pan: BANK_PAN, amount: 150000, currency: 'RUB', capture: true, merchant: { name: 'Кофейня', mcc: 5999 } });
    const got = (await api(secret, 'GET', `/payments/${p.id}`)).json();
    expect(got).toMatchObject({ status: 'succeeded', paid: true, test: false, payment_method: { type: 'bank_card', card: { last4: '7891', card_type: 'МИР', issuer_name: 'Bobobank' } } });
    expect(got.income_amount.value).toBe('1458.00'); // 2.8 % fee
    const receipts = (await api(secret, 'GET', `/receipts?payment_id=${p.id}`)).json().items;
    expect(receipts).toHaveLength(1);
    expect(receipts[0].fiscal_document_number).toBe('1');

    await deliverDue(ctx);
    expect(sent).toHaveLength(1);
    const h = sent[0].init.headers as Record<string, string>;
    const body = String(sent[0].init.body);
    const [t] = h['GPAY-Signature'].split(',');
    const hook = ctx.db.prepare('SELECT secret FROM webhooks').get() as { secret: string };
    expect(h['GPAY-Signature']).toBe(signature(hook.secret, Number(t.slice(2)), body));
    expect(JSON.parse(body)).toMatchObject({ event: 'payment.succeeded', object: { id: p.id } });
  });

  it('rejects cards that are not Bobobank cards without contacting the bank', async () => {
    const { secret } = await merchant();
    const p = (await newPayment(secret)).json();
    const res = await pay(p.id, card('4111111111111111'));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('card_not_supported');
    expect(calls.some((c) => c.url === '/internal/v1/authorize')).toBe(false);
    const cards = (await app.inject({ url: '/api/checkout/cards' })).json();
    expect(cards.hashes).toEqual([sha256(BANK_PAN), sha256(BANK_PAN2)]);
    expect(cards.bankBins).toEqual(['220455']);
    expect((await app.inject({ url: '/api/public/cards' })).statusCode).toBe(404);
  });

  it('shows the bank decline and cancels after too many attempts', async () => {
    const { secret } = await merchant();
    const p = (await newPayment(secret)).json();
    authReply = { status: 'declined', reason: 'insufficient_funds', message: 'Недостаточно средств' };
    const r1 = (await pay(p.id, card(BANK_PAN))).json();
    expect(r1.result).toMatchObject({ result: 'declined', reason: 'insufficient_funds', canceled: false });
    expect(r1.payment.lastDecline.reason).toBe('insufficient_funds');
    for (let i = 0; i < 4; i++) await pay(p.id, card(BANK_PAN));
    const got = (await api(secret, 'GET', `/payments/${p.id}`)).json();
    expect(got.status).toBe('canceled');
    expect(got.cancellation_details).toEqual({ party: 'gpay', reason: 'too_many_attempts' });
  });

  it('waits for confirmation in the bank app', async () => {
    const { secret } = await merchant();
    const p = (await newPayment(secret)).json();
    const r = (await pay(p.id, card(BANK_PAN2))).json();
    expect(r.result.result).toBe('processing');
    expect(r.payment.action).toMatchObject({ type: 'bank_confirm', bank: 'Bobobank' });
    await tickBank(ctx);
    expect((await app.inject({ url: `/api/checkout/payments/${p.id}` })).json().payment.status).toBe('pending');
    authStatus = 'captured';
    await tickBank(ctx);
    const got = (await api(secret, 'GET', `/payments/${p.id}`)).json();
    expect(got.status).toBe('succeeded');
    expect(got.authorization_details.three_d_secure.applied).toBe(true);
  });

  it('shows a decline when the owner rejects the purchase in the app', async () => {
    const { secret } = await merchant();
    const p = (await newPayment(secret)).json();
    await pay(p.id, card(BANK_PAN2));
    authStatus = 'declined';
    await tickBank(ctx);
    const pub = (await app.inject({ url: `/api/checkout/payments/${p.id}` })).json().payment;
    expect(pub).toMatchObject({ status: 'pending', action: null, lastDecline: { message: 'Покупка отклонена в приложении банка.' } });
  });

  it('accepts SBP payments made in the bank app over the signed internal API', async () => {
    const { secret } = await merchant();
    const p = (await newPayment(secret, { capture: false })).json();
    const pub = (await app.inject({ url: `/api/checkout/payments/${p.id}` })).json().payment;
    expect(pub.bobopayUrl).toBe(`https://bank.test/sbp/pay?payment=${p.id}&method=bobopay`);
    const path = `/internal/bank/payments/${p.id}/sbp`;
    const unsigned = await app.inject({ method: 'POST', url: path, headers: { 'content-type': 'application/json' }, payload: '{}' });
    expect(unsigned.statusCode).toBe(401);
    const info = await app.inject({ url: `/internal/bank/payments/${p.id}`, headers: { 'x-bank-signature': bankSign('shared', 'GET', `/internal/bank/payments/${p.id}`, '', Math.floor(now / 1000)) } });
    expect(info.json()).toMatchObject({ amount: 150000, sbp: true, bobopay: true, merchant: { name: 'Кофейня' } });
    expect((await paySbp(p.id)).json().status).toBe('succeeded');
    const paid = (await api(secret, 'GET', `/payments/${p.id}`)).json();
    expect(paid).toMatchObject({ status: 'succeeded', test: false, payment_method: { type: 'sbp', title: 'СБП · Bobobank' } });
    expect(paid.income_amount.value).toBe('1489.50'); // 0.7 %
    expect((await paySbp(p.id)).statusCode).toBe(400);
  });

  it('accepts the Bobo Pay button and refunds through the bank', async () => {
    const { secret } = await merchant();
    const p = (await newPayment(secret)).json();
    expect((await paySbp(p.id, 'bobopay')).json().status).toBe('succeeded');
    const paid = (await api(secret, 'GET', `/payments/${p.id}`)).json();
    expect(paid).toMatchObject({ status: 'succeeded', payment_method: { type: 'bobopay', title: 'Bobo Pay' } });
    expect(paid.income_amount.value).toBe('1477.50'); // 1.5 %
    const rf = await api(secret, 'POST', '/refunds', { payment_id: p.id, amount: { value: '100.00', currency: 'RUB' } }, 'rf-bp');
    expect(rf.statusCode).toBe(200);
    expect(calls.find((c) => c.url === `/internal/v1/sbp/${p.id}/refund`)!.body).toMatchObject({ amount: 10000 });
  });

  it('sends a Bobo Pay request by phone and completes when the customer approves it', async () => {
    const { secret } = await merchant();
    const p = (await newPayment(secret)).json();
    const bad = await pay(p.id, { phone: '+7 900 000-00-00', email: 'buyer@example.com' }, 'bobopay');
    expect(bad.statusCode).toBe(400);
    expect(JSON.stringify(bad.json())).toContain('не найден');
    const r = (await pay(p.id, { phone: '+7 999 123-45-67', email: 'buyer@example.com' }, 'bobopay')).json();
    expect(r.result.result).toBe('processing');
    expect(r.payment).toMatchObject({ methodType: 'bobopay', action: { type: 'bank_confirm' } });
    expect(calls.findLast((c) => c.url === '/internal/v1/requests')!.body).toMatchObject({ phone: '79991234567', payment_id: p.id, amount: 150000, merchant: { name: 'Кофейня' } });
    await tickBank(ctx);
    expect((await api(secret, 'GET', `/payments/${p.id}`)).json().status).toBe('pending');
    requestStatus = 'paid';
    await tickBank(ctx);
    const got = (await api(secret, 'GET', `/payments/${p.id}`)).json();
    expect(got).toMatchObject({ status: 'succeeded', test: false, payment_method: { type: 'bobopay' } });
    await api(secret, 'POST', '/refunds', { payment_id: p.id, amount: { value: '10.00', currency: 'RUB' } }, 'rf-req');
    expect(calls.some((c) => c.url === `/internal/v1/sbp/${p.id}/refund`)).toBe(true);
  });

  it('lets the customer try again after declining a phone request', async () => {
    const { secret } = await merchant();
    const p = (await newPayment(secret)).json();
    await pay(p.id, { phone: '79991234567', email: 'buyer@example.com' }, 'bobopay');
    requestStatus = 'declined';
    await tickBank(ctx);
    const pub = (await app.inject({ url: `/api/checkout/payments/${p.id}` })).json().payment;
    expect(pub).toMatchObject({ status: 'pending', action: null, lastDecline: { message: 'Покупка отклонена в приложении банка.' } });
  });

  it('expires unpaid payments', async () => {
    const { secret } = await merchant();
    const p = (await newPayment(secret)).json();
    now += 61 * 60_000;
    tick(ctx);
    expect((await api(secret, 'GET', `/payments/${p.id}`)).json().cancellation_details.reason).toBe('expired_on_confirmation');
  });

  it('two-stage: partial capture then partial refund with a return receipt and PDF', async () => {
    const { secret } = await merchant();
    authReply = { status: 'approved', authorization_id: 'auth_1' };
    const p = (await newPayment(secret, { capture: false })).json();
    await pay(p.id, card(BANK_PAN));
    expect(calls.find((c) => c.url === '/internal/v1/authorize')!.body).toMatchObject({ capture: false });
    expect((await api(secret, 'GET', `/payments/${p.id}`)).json().status).toBe('waiting_for_capture');
    const cap = await api(secret, 'POST', `/payments/${p.id}/capture`, { amount: { value: '1000.00', currency: 'RUB' } }, 'cap1');
    expect(cap.json()).toMatchObject({ status: 'succeeded', amount: { value: '1000.00' } });
    expect(calls.find((c) => c.url === '/internal/v1/authorizations/auth_1/capture')!.body).toMatchObject({ amount: 100000 });
    const rf = await api(secret, 'POST', '/refunds', { payment_id: p.id, amount: { value: '400.00', currency: 'RUB' } }, 'rf1');
    expect(rf.json()).toMatchObject({ status: 'succeeded', amount: { value: '400.00' } });
    expect(calls.find((c) => c.url === '/internal/v1/authorizations/auth_1/refund')!.body).toMatchObject({ amount: 40000 });
    const tooMuch = await api(secret, 'POST', '/refunds', { payment_id: p.id, amount: { value: '700.00', currency: 'RUB' } }, 'rf2');
    expect(tooMuch.statusCode).toBe(400);
    const receipts = (await api(secret, 'GET', `/receipts?payment_id=${p.id}`)).json().items;
    expect(receipts.map((r: { type: string }) => r.type).sort()).toEqual(['payment', 'refund']);
    const pdf = await app.inject({ url: `/api/checkout/receipts/${receipts[0].id}/pdf` });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    const q = await app.inject({ url: `/api/checkout/payments/${p.id}/quittance.pdf` });
    expect(q.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('pays through a single-use invoice link', async () => {
    const { headers, shopId } = await merchant();
    const link = await app.inject({ method: 'POST', url: `/api/m/shops/${shopId}/links`, headers, payload: { kind: 'invoice', title: 'Счёт №7', currency: 'RUB', items: [{ description: 'Торт', quantity: 2, price: '450.00', vat_code: 'vat10' }], customer: { email: 'b@ex.ru' } } });
    expect(link.statusCode).toBe(200);
    const slug = link.json().link.url.split('/').pop();
    const start = (await app.inject({ method: 'POST', url: `/api/checkout/links/${slug}/pay`, headers: H, payload: {} })).json();
    const again = (await app.inject({ method: 'POST', url: `/api/checkout/links/${slug}/pay`, headers: H, payload: {} })).json();
    expect(again.paymentId).toBe(start.paymentId);
    expect((await pay(start.paymentId, card(BANK_PAN))).json().result.result).toBe('succeeded');
    const info = (await app.inject({ url: `/api/checkout/links/${slug}` })).json();
    expect(info.link.state).toBe('paid');
    const pmt = (await app.inject({ url: `/api/checkout/payments/${start.paymentId}` })).json().payment;
    expect(pmt.amount).toBe(90000);
    const rc = (await app.inject({ url: `/api/checkout/receipts/${pmt.receipts[0].id}` })).json().receipt;
    expect(rc.items[0]).toMatchObject({ name: 'Торт', quantity: 2, sum: 90000, vat: 'НДС 10%' });
  });

  it('refuses new payments when the bank is not connected', async () => {
    const { secret } = await merchant();
    ctx.cfg.bankSecret = '';
    const res = await newPayment(secret);
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('bank_unavailable');
  });
});

describe('cabinet', () => {
  it('isolates shops between merchants and protects admin routes', async () => {
    const a = await merchant();
    const other = await app.inject({ method: 'POST', url: '/api/auth/register', headers: H, payload: { email: 'b@example.com', name: 'Пётр', password: 'password123' } });
    const cookie = String(other.headers['set-cookie']).split(';')[0];
    expect((await app.inject({ url: `/api/m/shops/${a.shopId}/payments`, headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/admin/stats', headers: { cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/m/shops', headers: { cookie }, payload: {} })).statusCode).toBe(403); // no CSRF header
  });

  it('reports analytics and pays out to the linked Bobobank account only', async () => {
    const { secret, headers, shopId } = await merchant();
    const p = (await newPayment(secret)).json();
    await pay(p.id, card(BANK_PAN));
    const an = (await app.inject({ url: `/api/m/shops/${shopId}/analytics?days=7`, headers })).json();
    expect(an.kpi).toMatchObject({ turnover: 150000, count: 1, conversion: 1 });
    const bal = (await app.inject({ url: `/api/m/shops/${shopId}/payouts`, headers })).json().balances.find((b: { currency: string }) => b.currency === 'RUB');
    expect(bal).toMatchObject({ available: 145800, live: 145800, test: 0 });
    const toCard = await app.inject({ method: 'POST', url: `/api/m/shops/${shopId}/payouts`, headers, payload: { amount: '100.00', currency: 'RUB', destination: 'card', cardLast4: '1234' } });
    expect(toCard.statusCode).toBe(400);
    const v1Card = await api(secret, 'POST', '/payouts', { amount: { value: '100.00', currency: 'RUB' }, payout_destination: { type: 'bank_card', card_last4: '1234' } }, 'po-card');
    expect(v1Card.statusCode).toBe(400);
    const noAcc = await app.inject({ method: 'POST', url: `/api/m/shops/${shopId}/payouts`, headers, payload: { amount: '100.00', currency: 'RUB', destination: 'bobobank' } });
    expect(noAcc.statusCode).toBe(400);
    const link = await app.inject({ method: 'POST', url: `/api/m/shops/${shopId}/bank-link`, headers, payload: { code: '1234-5678' } });
    expect(link.json().payoutAccount.number).toBe('40802810000001234567');
    const po = await app.inject({ method: 'POST', url: `/api/m/shops/${shopId}/payouts`, headers, payload: { amount: '1000.00', currency: 'RUB', destination: 'bobobank' } });
    expect(po.json().payout.status).toBe('succeeded');
    expect(calls.find((c) => c.url === '/internal/v1/credits')!.body).toMatchObject({ amount: 100000, destination: { type: 'account', number: '40802810000001234567' } });
    const over = await app.inject({ method: 'POST', url: `/api/m/shops/${shopId}/payouts`, headers, payload: { amount: '1000.00', currency: 'RUB', destination: 'bobobank' } });
    expect(over.statusCode).toBe(400);
    const logs = (await app.inject({ url: `/api/m/shops/${shopId}/logs`, headers })).json().items;
    expect(logs.length).toBeGreaterThan(0);
  });

  it('refuses a refund the shop balance cannot cover', async () => {
    const { secret, headers, shopId } = await merchant();
    const p = (await newPayment(secret)).json();
    await pay(p.id, card(BANK_PAN));
    await app.inject({ method: 'POST', url: `/api/m/shops/${shopId}/bank-link`, headers, payload: { code: '1234-5678' } });
    await app.inject({ method: 'POST', url: `/api/m/shops/${shopId}/payouts`, headers, payload: { amount: '1000.00', currency: 'RUB', destination: 'bobobank' } });
    const rub = async () => (await app.inject({ url: `/api/m/shops/${shopId}/payouts`, headers })).json().balances.find((b: { currency: string }) => b.currency === 'RUB').available;
    expect(await rub()).toBe(45800);
    const full = await api(secret, 'POST', '/refunds', { payment_id: p.id }, 'rf-full');
    expect(full.statusCode).toBe(400);
    expect(full.json().code).toBe('insufficient_funds');
    const cab = await app.inject({ method: 'POST', url: `/api/m/shops/${shopId}/payments/${p.id}/refund`, headers, payload: { amount: '500.00' } });
    expect(cab.statusCode).toBe(400);
    expect(await rub()).toBe(45800);
    const part = await api(secret, 'POST', '/refunds', { payment_id: p.id, amount: { value: '458.00', currency: 'RUB' } }, 'rf-part');
    expect(part.statusCode).toBe(200);
    expect(await rub()).toBe(0);
  });
});

describe('llms.txt', () => {
  it('serves the AI-agent guide with real addresses and fees', async () => {
    const index = await app.inject({ url: '/llms.txt' });
    expect(index.statusCode).toBe(200);
    expect(index.headers['content-type']).toContain('text/plain');
    expect(index.body).toContain('https://pay.test/llms-full.txt');
    const full = await app.inject({ url: '/llms-full.txt' });
    expect(full.statusCode).toBe(200);
    expect(full.body).not.toContain('{{');
    expect(full.body).toContain('https://pay.test/api/v1/payments');
    expect(full.body).toContain('Host: pay.test');
    expect(full.body).toContain('`payment.succeeded`');
    expect(full.body).toContain('(`sbp`) | 0,7%');
    expect(full.body).toContain('(`bobopay`) | 1,5%');
    expect(full.body).not.toContain('4111');
  });
});

describe('Бобуслуги', () => {
  let gosCalls: { fn: string; args: Record<string, unknown> }[];
  let codesMap: Map<string, string>;
  const person = {
    id: 'u-alice', login: 'alice', display_name: 'alice', banned: false,
    passport: { first_name: 'Алиса', last_name: 'Псянская' },
    businesses: [{ id: 7, number: '123 321', country_code: 'BOBO', name: 'Бобо-кофе', org_type: 'ИП', inn: '123412341234' }],
  };

  beforeEach(async () => {
    const cfg = loadConfig({
      COOKIE_SECURE: '0', PUBLIC_URL: 'https://pay.test', WEBHOOK_ALLOW_PRIVATE: '1', BANK_INTERNAL_URL: 'http://bank.internal', BANK_PUBLIC_URL: 'https://bank.test', BANK_GPAY_SECRET: 'shared',
      SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_KEY: 'sb_secret_x', GOS_PUBLIC_URL: 'https://gos.test',
    });
    const bankHttp = ctx.bankHttp;
    ctx = createCtx(openDb(null), cfg, () => now);
    ctx.bankHttp = bankHttp;
    ctx.http = async () => new Response('ok');
    gosCalls = [];
    codesMap = new Map();
    ctx.gosHttp = async (url, init) => {
      const fn = new URL(url).pathname.replace('/rest/v1/rpc/', '');
      const args = JSON.parse(String(init.body));
      gosCalls.push({ fn, args });
      expect((init.headers as Record<string, string>).apikey).toBe('sb_secret_x');
      if (fn === 'svc_redeem_code') return codesMap.has(args.p_code) ? Response.json(person) : Response.json({ message: 'E_BAD_CODE' }, { status: 400 });
      if (fn === 'svc_person') return Response.json(person);
      if (fn === 'svc_gpay_shop') return args.p_doc === 7 || args.p_doc === null ? Response.json({ ok: true }) : Response.json({ message: 'E_NOT_FOUND' }, { status: 400 });
      return Response.json({ ok: true });
    };
    app = await buildApp(ctx);
  });

  async function signIn() {
    const start = await app.inject({ url: '/api/auth/gos/start?next=/app/new' });
    expect(String(start.headers.location)).toMatch(/^https:\/\/gos\.test\/#\/connect\?client=gpay&state=/);
    const state = decodeURIComponent(String(start.headers.location).split('state=')[1]);
    const gosCookie = String(([] as string[]).concat(start.headers['set-cookie'] as string).find((c) => c.startsWith('gp_gos=')));
    codesMap.set('c1', 'u-alice');
    const cb = await app.inject({ url: `/api/auth/gos/callback?code=c1&state=${encodeURIComponent(state)}`, headers: { cookie: gosCookie.split(';')[0] } });
    expect(cb.headers.location).toBe('/app/new');
    const sid = String(([] as string[]).concat(cb.headers['set-cookie'] as string).find((c) => c.startsWith('gp_sid=')));
    return { ...H, cookie: sid.split(';')[0] };
  }

  it('вход через Бобуслуги создаёт продавца, магазин привязывается к бизнесу и сразу уходит на Бобуслуги', async () => {
    const headers = await signIn();
    const me = (await app.inject({ url: '/api/auth/me', headers })).json().user;
    expect(me).toMatchObject({ name: 'Алиса Псянская', gosLinked: true });
    const gos = (await app.inject({ url: '/api/m/gos', headers })).json();
    expect(gos).toMatchObject({ enabled: true, linked: true, businesses: [{ id: 7, inn: '123412341234' }] });

    const shop = await app.inject({ method: 'POST', url: '/api/m/shops', headers, payload: { name: 'Кофейня', legalName: 'что угодно', inn: '7700000001', taxSystem: 'usn_income', site: 'bobo.coffee', gosBusinessId: 7 } });
    expect(shop.json().shop).toMatchObject({ legalName: 'ИП Бобо-кофе', inn: '123412341234', gosBusinessId: 7 });
    expect(gosCalls.find((c) => c.fn === 'svc_gpay_shop')!.args).toMatchObject({ p_user: 'u-alice', p_doc: 7, p_name: 'Кофейня', p_site: 'bobo.coffee' });
    const id = shop.json().shop.id;
    // INN of a linked shop is not edited by hand.
    await app.inject({ method: 'PATCH', url: `/api/m/shops/${id}`, headers, payload: { inn: '7700000001' } });
    expect((await app.inject({ url: `/api/m/shops/${id}`, headers })).json().shop.inn).toBe('123412341234');
    expect((await app.inject({ method: 'POST', url: `/api/m/shops/${id}/gos-business`, headers, payload: { businessId: 99 } })).statusCode).toBe(404);

    // Turnover goes to Бобуслуги for the turnover tax.
    const key = (await app.inject({ method: 'POST', url: `/api/m/shops/${id}/keys`, headers, payload: { name: 'k' } })).json().secret;
    const p = (await api(key, 'POST', '/payments', { amount: { value: '1500.00', currency: 'RUB' }, description: 'Заказ', confirmation: { type: 'redirect', return_url: 'https://bobo.coffee/' } }, 'k1')).json();
    ctx.db.prepare(`UPDATE payments SET status = 'succeeded', funding = 'bank', created_at = ? WHERE id = ?`).run(now - 3600_000 * 12, p.id);
    now += 86400_000;
    const { syncTurnover } = await import('./domain/gos.js');
    expect(await syncTurnover(ctx)).toBe(1);
    expect(gosCalls.find((c) => c.fn === 'svc_gpay_turnover')!.args).toMatchObject({ p_shop: id, p_month_rub: 150000 });
    expect(await syncTurnover(ctx)).toBe(0);
  });
});
