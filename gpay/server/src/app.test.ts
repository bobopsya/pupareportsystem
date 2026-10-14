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
import { hmacHex, sha256 } from './util.js';

let now = Date.UTC(2026, 9, 13, 9, 0, 0);
let ctx: Ctx;
let app: FastifyInstance;
let sent: { url: string; init: RequestInit }[];
let hookStatus = 200;

beforeEach(async () => {
  now = Date.UTC(2026, 9, 13, 9, 0, 0);
  const cfg = loadConfig({ COOKIE_SECURE: '0', PUBLIC_URL: 'https://pay.test', WEBHOOK_ALLOW_PRIVATE: '1' });
  ctx = createCtx(openDb(null), cfg, () => now);
  sent = [];
  hookStatus = 200;
  ctx.http = async (url, init) => {
    sent.push({ url, init });
    return new Response('ok', { status: hookStatus });
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
    expect(luhn('4111111111111111')).toBe(true);
    expect(luhn('4111111111111112')).toBe(false);
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

describe('checkout', () => {
  it('pays with a game card, registers a receipt and notifies the webhook', async () => {
    const { secret, headers, shopId } = await merchant();
    await app.inject({ method: 'POST', url: `/api/m/shops/${shopId}/webhooks`, headers, payload: { url: 'https://hooks.example/gpay', events: ['payment.succeeded'] } });
    const p = (await newPayment(secret)).json();
    const res = await pay(p.id, card('4111 1111 1111 1111'));
    expect(res.json().result.result).toBe('succeeded');
    const got = (await api(secret, 'GET', `/payments/${p.id}`)).json();
    expect(got).toMatchObject({ status: 'succeeded', paid: true, payment_method: { type: 'bank_card', card: { last4: '1111', card_type: 'Visa' } } });
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

  it('rejects cards outside the game list without charging', async () => {
    const { secret } = await merchant();
    const p = (await newPayment(secret)).json();
    const res = await pay(p.id, card('4242424242424242'));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('card_not_supported');
    const hashes = (await app.inject({ url: '/api/checkout/cards' })).json().hashes;
    expect(hashes).toContain(sha256('4111111111111111'));
  });

  it('declines by card number and cancels after too many attempts', async () => {
    const { secret } = await merchant();
    const p = (await newPayment(secret)).json();
    const r1 = (await pay(p.id, card('4000000000009995'))).json();
    expect(r1.result).toMatchObject({ result: 'declined', reason: 'insufficient_funds', canceled: false });
    expect(r1.payment.lastDecline.reason).toBe('insufficient_funds');
    for (let i = 0; i < 4; i++) await pay(p.id, card('4000000000000002'));
    const got = (await api(secret, 'GET', `/payments/${p.id}`)).json();
    expect(got.status).toBe('canceled');
    expect(got.cancellation_details).toEqual({ party: 'gpay', reason: 'too_many_attempts' });
  });

  it('confirms 3-D Secure cards with the bank after a few seconds', async () => {
    const { secret } = await merchant();
    const p = (await newPayment(secret)).json();
    const r = (await pay(p.id, card('4000000000003220'))).json();
    expect(r.result.result).toBe('processing');
    expect(r.result.until - now).toBeGreaterThanOrEqual(3000);
    expect(r.result.until - now).toBeLessThanOrEqual(5000);
    expect(r.payment.action).toEqual({ type: 'processing', until: r.result.until });
    now += 2_000;
    expect((await app.inject({ url: `/api/checkout/payments/${p.id}` })).json().payment.status).toBe('pending');
    now += 3_100;
    expect((await app.inject({ url: `/api/checkout/payments/${p.id}` })).json().payment.status).toBe('succeeded');
    const got = (await api(secret, 'GET', `/payments/${p.id}`)).json();
    expect(got.authorization_details.three_d_secure.applied).toBe(true);
  });

  it('completes SBP after the processing delay', async () => {
    const { secret } = await merchant();
    const p = (await newPayment(secret)).json();
    expect((await pay(p.id, { type: 'sbp' }, 'async')).json().result.result).toBe('processing');
    now += 5_000;
    expect((await app.inject({ url: `/api/checkout/payments/${p.id}` })).json().payment.status).toBe('pending');
    now += 10_000;
    expect((await app.inject({ url: `/api/checkout/payments/${p.id}` })).json().payment.status).toBe('succeeded');
    const got = (await api(secret, 'GET', `/payments/${p.id}`)).json();
    expect(got.payment_method.type).toBe('sbp');
    expect(got.income_amount.value).toBe('1489.50'); // 0.7 %
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
    const p = (await newPayment(secret, { capture: false })).json();
    await pay(p.id, card('2200000000000004'));
    expect((await api(secret, 'GET', `/payments/${p.id}`)).json().status).toBe('waiting_for_capture');
    const cap = await api(secret, 'POST', `/payments/${p.id}/capture`, { amount: { value: '1000.00', currency: 'RUB' } }, 'cap1');
    expect(cap.json()).toMatchObject({ status: 'succeeded', amount: { value: '1000.00' } });
    const rf = await api(secret, 'POST', '/refunds', { payment_id: p.id, amount: { value: '400.00', currency: 'RUB' } }, 'rf1');
    expect(rf.json()).toMatchObject({ status: 'succeeded', amount: { value: '400.00' } });
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
    expect((await pay(start.paymentId, card('5555555555554444'))).json().result.result).toBe('succeeded');
    const info = (await app.inject({ url: `/api/checkout/links/${slug}` })).json();
    expect(info.link.state).toBe('paid');
    const pmt = (await app.inject({ url: `/api/checkout/payments/${start.paymentId}` })).json().payment;
    expect(pmt.amount).toBe(90000);
    const rc = (await app.inject({ url: `/api/checkout/receipts/${pmt.receipts[0].id}` })).json().receipt;
    expect(rc.items[0]).toMatchObject({ name: 'Торт', quantity: 2, sum: 90000, vat: 'НДС 10%' });
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

  it('reports analytics and pays out the balance', async () => {
    const { secret, headers, shopId } = await merchant();
    const p = (await newPayment(secret)).json();
    await pay(p.id, card('4111111111111111'));
    const an = (await app.inject({ url: `/api/m/shops/${shopId}/analytics?days=7`, headers })).json();
    expect(an.kpi).toMatchObject({ turnover: 150000, count: 1, conversion: 1 });
    expect(an.balances.find((b: { currency: string }) => b.currency === 'RUB').available).toBe(145800);
    const po = await app.inject({ method: 'POST', url: `/api/m/shops/${shopId}/payouts`, headers, payload: { amount: '1000.00', currency: 'RUB', cardLast4: '1234' } });
    expect(po.json().payout.status).toBe('pending');
    const over = await app.inject({ method: 'POST', url: `/api/m/shops/${shopId}/payouts`, headers, payload: { amount: '1000.00', currency: 'RUB', cardLast4: '1234' } });
    expect(over.statusCode).toBe(400);
    now += 10_000;
    tick(ctx);
    const list = (await app.inject({ url: `/api/m/shops/${shopId}/payouts`, headers })).json();
    expect(list.items[0].status).toBe('succeeded');
    const logs = (await app.inject({ url: `/api/m/shops/${shopId}/logs`, headers })).json().items;
    expect(logs.length).toBeGreaterThan(0);
  });
});

describe('llms.txt', () => {
  it('serves the AI-agent guide with real addresses, cards and fees', async () => {
    const index = await app.inject({ url: '/llms.txt' });
    expect(index.statusCode).toBe(200);
    expect(index.headers['content-type']).toContain('text/plain');
    expect(index.body).toContain('https://pay.test/llms-full.txt');
    const full = await app.inject({ url: '/llms-full.txt' });
    expect(full.statusCode).toBe(200);
    expect(full.body).not.toContain('{{');
    expect(full.body).toContain('https://pay.test/api/v1/payments');
    expect(full.body).toContain('Host: pay.test');
    expect(full.body).toContain('`4111 1111 1111 1111`');
    expect(full.body).toContain('`payment.succeeded`');
    expect(full.body).toContain('(`sbp`) | 0,7%');
  });
});
