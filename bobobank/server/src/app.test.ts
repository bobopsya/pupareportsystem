import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createCtx, type Ctx } from './context.js';
import { openDb } from './db.js';
import { accountKey, BANK, isValidAccount } from './domain/bank.js';
import { luhn } from './domain/cards.js';
import { annuity, computeScore } from './domain/credit.js';
import { sign } from './domain/signing.js';
import { tick } from './domain/tick.js';

let now = Date.UTC(2026, 9, 14, 9, 0, 0);
let ctx: Ctx;
let app: FastifyInstance;
const SECRET = 'test-shared-secret';
let gpayCalls: { url: string; body: string }[];
let gpayStatus = 200;

beforeEach(async () => {
  now = Date.UTC(2026, 9, 14, 9, 0, 0);
  const cfg = loadConfig({ COOKIE_SECURE: '0', PUBLIC_URL: 'https://bank.test', BANK_GPAY_SECRET: SECRET, GPAY_INTERNAL_URL: 'http://gpay.internal' });
  ctx = createCtx(openDb(null), cfg, () => now);
  gpayCalls = [];
  gpayStatus = 200;
  ctx.http = async (url, init) => {
    gpayCalls.push({ url, body: String(init.body ?? '') });
    if (url.includes('/internal/bank/payments/') && !/\/(sbp|bobopay)$/.test(url)) {
      return Response.json({ id: 'pay_test123456', status: 'pending', amount: 129000, currency: 'RUB', description: 'Заказ', merchant: { name: 'Кофейня', mcc: 5814, shop_id: 412038 }, sbp: true, bobopay: true });
    }
    return Response.json(gpayStatus === 200 ? { status: 'succeeded' } : { error: 'Платёж уже оплачен' }, { status: gpayStatus });
  };
  app = await buildApp(ctx);
});

const H = { 'x-requested-with': 'bobobank' };

/** Moves the clock forward and keeps test sessions alive (they expire after a day of inactivity). */
function travel(ms: number) {
  now += ms;
  ctx.db.prepare('UPDATE sessions SET last_seen = ?, created_at = ?').run(now, now);
}

async function client(phone = '+7 900 111-22-33', name = 'Иван Петров') {
  const code = await app.inject({ method: 'POST', url: '/api/auth/code', headers: H, payload: { phone } });
  expect(code.statusCode).toBe(200);
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', headers: H, payload: { phone, code: code.json().code, name, birthDate: '1995-05-20', password: 'password123' } });
  expect(res.statusCode).toBe(200);
  const headers = { ...H, cookie: String(res.headers['set-cookie']).split(';')[0] };
  const home = (await app.inject({ url: '/api/home', headers })).json();
  return { headers, home, main: home.accounts[0], card: home.cards[0], userId: res.json().user.id as string };
}

async function admin() {
  const { headers, userId } = await client('+7 999 000-00-01', 'Админ Банка');
  ctx.db.prepare(`UPDATE users SET role = 'admin' WHERE id = ?`).run(userId);
  return headers;
}

const credit = async (adminH: Record<string, string>, accountId: string, amount: string) =>
  app.inject({ method: 'POST', url: `/api/admin/accounts/${accountId}/adjust`, headers: adminH, payload: { direction: 'credit', amount, title: 'Зарплата' } });

function internal(method: 'GET' | 'POST', path: string, body?: object, opts: { secret?: string; key?: string } = {}) {
  const raw = body ? JSON.stringify(body) : '';
  return app.inject({
    method,
    url: path,
    headers: { 'content-type': 'application/json', 'x-bank-signature': sign(opts.secret ?? SECRET, method, path, raw, Math.floor(now / 1000)), ...(opts.key ? { 'idempotence-key': opts.key } : {}) },
    payload: body ? raw : undefined,
  });
}

/** Ledger invariant: every transaction balances to zero in each currency, balances equal the sum of entries. */
function assertLedger() {
  const bad = ctx.db.prepare('SELECT tx_id, currency, SUM(amount) s FROM entries GROUP BY tx_id, currency HAVING s != 0').all();
  expect(bad).toEqual([]);
  const drift = ctx.db.prepare('SELECT a.id FROM accounts a WHERE a.balance != (SELECT COALESCE(SUM(amount), 0) FROM entries e WHERE e.account_id = a.id)').all();
  expect(drift).toEqual([]);
}

describe('requisites', () => {
  it('generates valid account numbers and Luhn card numbers', async () => {
    const { main, card, headers } = await client();
    expect(isValidAccount(BANK.bik, main.number)).toBe(true);
    expect(accountKey(BANK.bik, main.number)).toBe(Number(main.number[8]));
    const pan = (await app.inject({ method: 'POST', url: `/api/cards/${card.id}/reveal`, headers })).json().pan as string;
    expect(luhn(pan)).toBe(true);
    expect(pan.startsWith('220455')).toBe(true);
  });
});

describe('money', () => {
  it('credits, transfers by phone with fees beyond the free limit, and keeps the ledger balanced', async () => {
    const adminH = await admin();
    const a = await client();
    const b = await client('+7 900 444-55-66', 'Мария Смирнова');
    expect((await credit(adminH, a.main.id, '150000.00')).statusCode).toBe(200);
    const q = await app.inject({ method: 'POST', url: '/api/transfers/quote', headers: a.headers, payload: { fromAccountId: a.main.id, recipient: { type: 'phone', phone: '89004445566' }, amount: '1000.00' } });
    expect(q.json()).toMatchObject({ display: 'Мария С.', fee: 0, bank: 'Bobobank' });
    const t = await app.inject({ method: 'POST', url: '/api/transfers', headers: a.headers, payload: { fromAccountId: a.main.id, recipient: { type: 'phone', phone: '+79004445566' }, amount: '1000.00', comment: 'За обед' } });
    expect(t.statusCode).toBe(200);
    // 100 000 ₽ a month are free on the standard tariff; 1% is charged on the part above the limit.
    const big = await app.inject({ method: 'POST', url: '/api/transfers', headers: a.headers, payload: { fromAccountId: a.main.id, recipient: { type: 'phone', phone: '+79004445566' }, amount: '100000.00' } });
    expect(big.json().fee).toBe(1_000); // 1% of the 1 000 ₽ above the limit
    const bHome = (await app.inject({ url: '/api/home', headers: b.headers })).json();
    expect(bHome.accounts[0].balance).toBe(10_100_000);
    const over = await app.inject({ method: 'POST', url: '/api/transfers', headers: a.headers, payload: { fromAccountId: a.main.id, recipient: { type: 'phone', phone: '+79004445566' }, amount: '100000.00' } });
    expect(over.statusCode).toBe(400);
    expect(over.json().code).toBe('insufficient_funds');
    assertLedger();
  });

  it('remembers recipients even when the transfer had a message, and keeps favourites', async () => {
    const adminH = await admin();
    const a = await client();
    const b = await client('+7 900 444-55-66', 'Мария Смирнова');
    await credit(adminH, a.main.id, '5000.00');
    await app.inject({ method: 'POST', url: '/api/transfers', headers: a.headers, payload: { fromAccountId: a.main.id, recipient: { type: 'phone', phone: '+79004445566' }, amount: '100.00', comment: 'За обед' } });
    await app.inject({ method: 'POST', url: '/api/transfers', headers: a.headers, payload: { fromAccountId: a.main.id, recipient: { type: 'card_id', cardId: b.card.id }, amount: '50.00' } });
    const recent = (await app.inject({ url: '/api/transfers/recent', headers: a.headers })).json().items;
    expect(recent).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Мария С.', type: 'phone', phone: '79004445566' }),
      expect.objectContaining({ name: 'Мария С.', type: 'card', cardId: b.card.id }),
    ]));
    const fav = await app.inject({ method: 'POST', url: '/api/favorites', headers: a.headers, payload: { title: 'Маша', type: 'phone', value: '8 900 444-55-66', amount: '300.00' } });
    expect(fav.json().favorite).toMatchObject({ title: 'Маша', value: '79004445566', amount: 30000 });
    const list = (await app.inject({ url: '/api/favorites', headers: a.headers })).json().items;
    expect(list).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: `/api/favorites/${list[0].id}`, headers: a.headers })).statusCode).toBe(200);
    assertLedger();
  });

  it('exchanges currency with the spread and refuses to overdraw', async () => {
    const adminH = await admin();
    const a = await client();
    await credit(adminH, a.main.id, '10000.00');
    const usd = (await app.inject({ method: 'POST', url: '/api/accounts', headers: a.headers, payload: { kind: 'current', currency: 'USD' } })).json().account;
    const ex = await app.inject({ method: 'POST', url: '/api/fx/exchange', headers: a.headers, payload: { fromAccountId: a.main.id, toAccountId: usd.id, amount: '8263.80' } });
    expect(ex.statusCode).toBe(200);
    expect(ex.json().result).toBe(10_002); // 8263.80 ₽ / (81.4 × 1.015) = $100.02
    assertLedger();
  });

  it('arrest holds the amount, a debit block stops transfers, lifting restores them', async () => {
    const adminH = await admin();
    const a = await client();
    await credit(adminH, a.main.id, '5000.00');
    const arrest = await app.inject({ method: 'POST', url: '/api/admin/restrictions', headers: adminH, payload: { userId: a.userId, accountId: a.main.id, type: 'arrest', amount: '4000.00', reason: 'fssp', comment: 'ИП №12345/26/77001' } });
    expect(arrest.statusCode).toBe(200);
    const home = (await app.inject({ url: '/api/home', headers: a.headers })).json();
    expect(home.accounts[0].available).toBe(100_000);
    expect(home.restrictions[0]).toMatchObject({ type: 'arrest', reasonTitle: expect.stringContaining('ФССП') });
    const block = await app.inject({ method: 'POST', url: '/api/admin/restrictions', headers: adminH, payload: { userId: a.userId, type: 'block_debit', reason: 'aml' } });
    const t = await app.inject({ method: 'POST', url: '/api/transfers', headers: a.headers, payload: { fromAccountId: a.main.id, recipient: { type: 'own', accountId: a.main.id }, amount: '10.00' } });
    expect(t.statusCode).toBeGreaterThanOrEqual(400);
    const chat = (await app.inject({ url: '/api/chat', headers: a.headers })).json();
    expect(chat.messages.some((m: { author: string }) => m.author === 'system')).toBe(true);
    await app.inject({ method: 'POST', url: `/api/admin/restrictions/${block.json().id}/lift`, headers: adminH, payload: {} });
    await app.inject({ method: 'POST', url: `/api/admin/restrictions/${arrest.json().id}/lift`, headers: adminH, payload: {} });
    expect((await app.inject({ url: '/api/home', headers: a.headers })).json().accounts[0].available).toBe(500_000);
  });
});

describe('GPAY integration', () => {
  it('rejects unsigned or badly signed internal calls', async () => {
    expect((await app.inject({ url: '/internal/v1/cards' })).statusCode).toBe(401);
    expect((await internal('GET', '/internal/v1/cards', undefined, { secret: 'wrong' })).statusCode).toBe(401);
    expect((await internal('GET', '/internal/v1/cards')).statusCode).toBe(200);
  });

  it('authorizes a card purchase after confirmation in the app, refunds it and accrues cashback', async () => {
    const adminH = await admin();
    const a = await client();
    await credit(adminH, a.main.id, '5000.00');
    const det = (await app.inject({ method: 'POST', url: `/api/cards/${a.card.id}/reveal`, headers: a.headers })).json();
    const [mm, yy] = det.exp.split('/').map(Number);
    const hashes = (await internal('GET', '/internal/v1/cards')).json().hashes;
    expect(hashes.length).toBe(2);

    const base = { pan: det.pan, exp_month: mm, exp_year: yy, cvc: det.cvc, amount: 129000, currency: 'RUB', capture: true, payment_id: 'pay_1', merchant: { name: 'Кофейня «Зерно»', mcc: 5814, shop_id: 412038 } };
    const badCvc = await internal('POST', '/internal/v1/authorize', { ...base, cvc: det.cvc === '000' ? '111' : '000' });
    expect(badCvc.json()).toMatchObject({ status: 'declined', reason: 'invalid_csc' });
    const tooMuch = await internal('POST', '/internal/v1/authorize', { ...base, amount: 900000 });
    expect(tooMuch.json()).toMatchObject({ status: 'declined', reason: 'insufficient_funds' });

    const r = await internal('POST', '/internal/v1/authorize', base, { key: 'k1' });
    expect(r.json().status).toBe('pending');
    const again = await internal('POST', '/internal/v1/authorize', base, { key: 'k1' });
    expect(again.json().authorization_id).toBe(r.json().authorization_id);
    const pulse = (await app.inject({ url: '/api/pulse', headers: a.headers })).json();
    expect(pulse.confirmations[0]).toMatchObject({ amount: 129000, merchant: { name: 'Кофейня «Зерно»' } });
    const ok = await app.inject({ method: 'POST', url: `/api/confirmations/${r.json().authorization_id}`, headers: a.headers, payload: { approve: true } });
    expect(ok.json().status).toBe('captured');
    expect((await internal('GET', `/internal/v1/authorizations/${r.json().authorization_id}`)).json().status).toBe('captured');
    let home = (await app.inject({ url: '/api/home', headers: a.headers })).json();
    expect(home.accounts[0].balance).toBe(500_000 - 129_000);
    expect(home.profile.bonus).toBe(645); // 0.5% of 1 290 ₽ = 6.45 bonuses

    const rf = await internal('POST', `/internal/v1/authorizations/${r.json().authorization_id}/refund`, { amount: 129000, refund_id: 'rf_1' });
    expect(rf.statusCode).toBe(200);
    home = (await app.inject({ url: '/api/home', headers: a.headers })).json();
    expect(home.accounts[0].balance).toBe(500_000);
    expect(home.profile.bonus).toBe(0);
    assertLedger();
  });

  it('declines frozen cards and expires unanswered confirmations', async () => {
    const adminH = await admin();
    const a = await client();
    await credit(adminH, a.main.id, '5000.00');
    const det = (await app.inject({ method: 'POST', url: `/api/cards/${a.card.id}/reveal`, headers: a.headers })).json();
    const [mm, yy] = det.exp.split('/').map(Number);
    const base = { pan: det.pan, exp_month: mm, exp_year: yy, cvc: det.cvc, amount: 10000, currency: 'RUB', capture: false, payment_id: 'pay_2', merchant: { name: 'Магазин' } };
    await app.inject({ method: 'POST', url: `/api/cards/${a.card.id}/freeze`, headers: a.headers, payload: { frozen: true } });
    expect((await internal('POST', '/internal/v1/authorize', base)).json()).toMatchObject({ status: 'declined', reason: 'card_blocked' });
    await app.inject({ method: 'POST', url: `/api/cards/${a.card.id}/freeze`, headers: a.headers, payload: { frozen: false } });
    const r = (await internal('POST', '/internal/v1/authorize', base)).json();
    now += 6 * 60_000;
    tick(ctx);
    expect((await internal('GET', `/internal/v1/authorizations/${r.authorization_id}`)).json().status).toBe('expired');
  });

  it('pays a GPAY order by SBP from the app and links a business account for payouts', async () => {
    const adminH = await admin();
    const a = await client();
    await credit(adminH, a.main.id, '5000.00');
    const pay = await app.inject({ method: 'POST', url: '/api/sbp/pay_test123456/pay', headers: a.headers, payload: { accountId: a.main.id } });
    expect(pay.statusCode).toBe(200);
    expect(gpayCalls.at(-1)!.url).toBe('http://gpay.internal/internal/bank/payments/pay_test123456/sbp');
    expect((await app.inject({ url: '/api/home', headers: a.headers })).json().accounts[0].balance).toBe(500_000 - 129_000);

    gpayStatus = 400;
    const failed = await app.inject({ method: 'POST', url: '/api/sbp/pay_test123456/pay', headers: a.headers, payload: { accountId: a.main.id } });
    expect(failed.statusCode).toBe(400);
    expect((await app.inject({ url: '/api/home', headers: a.headers })).json().accounts[0].balance).toBe(500_000 - 129_000);

    const biz = (await app.inject({ method: 'POST', url: '/api/accounts', headers: a.headers, payload: { kind: 'business', businessType: 'ip', legalName: 'Петров Иван Иванович', inn: '771234567890' } })).json().account;
    const { code } = (await app.inject({ method: 'POST', url: `/api/accounts/${biz.id}/gpay-code`, headers: a.headers, payload: {} })).json();
    const claim = await internal('POST', '/internal/v1/links/claim', { code, shop_id: 412038, shop_name: 'Кофейня' });
    expect(claim.json().account.number).toBe(biz.number);
    expect((await internal('POST', '/internal/v1/links/claim', { code, shop_id: 412038, shop_name: 'Кофейня' })).statusCode).toBe(400);
    const payout = await internal('POST', '/internal/v1/credits', { destination: { type: 'account', number: biz.number }, amount: 100000, currency: 'RUB', payout_id: 'po_1', shop: { id: 412038, name: 'Кофейня' } });
    expect(payout.json().status).toBe('succeeded');
    const acc = (await app.inject({ url: `/api/accounts/${biz.id}`, headers: a.headers })).json();
    expect(acc.account.balance).toBe(100_000);
    assertLedger();
  });
  it('pays with the Bobo Pay button and refunds to the same account', async () => {
    const adminH = await admin();
    const a = await client();
    await credit(adminH, a.main.id, '5000.00');
    const pay = await app.inject({ method: 'POST', url: '/api/sbp/pay_test123456/pay', headers: a.headers, payload: { accountId: a.main.id, method: 'bobopay' } });
    expect(pay.statusCode).toBe(200);
    // The customer goes back to the GPAY page, which forwards to the shop.
    expect(pay.json().checkoutUrl).toBe('http://gpay.internal/pay/pay_test123456');
    expect(gpayCalls.at(-1)!.url).toBe('http://gpay.internal/internal/bank/payments/pay_test123456/bobopay');
    const rf = await internal('POST', '/internal/v1/sbp/pay_test123456/refund', { amount: 29_000, refund_id: 'rf_1' }, { key: 'rf_1' });
    expect(rf.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/home', headers: a.headers })).json().accounts[0].balance).toBe(500_000 - 129_000 + 29_000);
    const over = await internal('POST', '/internal/v1/sbp/pay_test123456/refund', { amount: 200_000, refund_id: 'rf_2' }, { key: 'rf_2' });
    expect(over.statusCode).toBe(400);
    assertLedger();
  });

  it('asks the customer to approve a Bobo Pay request by phone, and declines or expires it', async () => {
    const adminH = await admin();
    const a = await client();
    await credit(adminH, a.main.id, '5000.00');
    const body = { phone: '+7 900 111-22-33', payment_id: 'pay_test123456', amount: 129_000, currency: 'RUB', description: 'Заказ', merchant: { name: 'Кофейня', shop_id: 412038, mcc: 5814 } };
    const unknown = await internal('POST', '/internal/v1/requests', { ...body, phone: '+7 900 000-00-00' }, { key: 'r0' });
    expect(unknown.statusCode).toBe(404);
    const req = (await internal('POST', '/internal/v1/requests', body, { key: 'r1' })).json();
    expect(req).toMatchObject({ status: 'pending' });
    expect(req.id).toMatch(/^req_/);
    const pulse = (await app.inject({ url: '/api/pulse', headers: a.headers })).json();
    expect(pulse.requests).toEqual([expect.objectContaining({ id: req.id, amount: 129_000 })]);
    const other = await client('+7 900 444-55-66', 'Пётр Сидоров');
    expect((await app.inject({ method: 'POST', url: `/api/requests/${req.id}`, headers: other.headers, payload: { approve: true, accountId: other.main.id } })).statusCode).toBe(404);
    const ok = await app.inject({ method: 'POST', url: `/api/requests/${req.id}`, headers: a.headers, payload: { approve: true, accountId: a.main.id } });
    expect(ok.json()).toEqual({ status: 'paid' });
    expect((await internal('GET', `/internal/v1/requests/${req.id}`)).json().status).toBe('paid');
    expect((await app.inject({ url: '/api/home', headers: a.headers })).json().accounts[0].balance).toBe(500_000 - 129_000);
    expect((await app.inject({ method: 'POST', url: `/api/requests/${req.id}`, headers: a.headers, payload: { approve: true, accountId: a.main.id } })).statusCode).toBe(400);
    // The paid order can be refunded the same way as SBP.
    expect((await internal('POST', '/internal/v1/sbp/pay_test123456/refund', { amount: 129_000, refund_id: 'rf_r' }, { key: 'rf_r' })).statusCode).toBe(200);

    const r2 = (await internal('POST', '/internal/v1/requests', { ...body, payment_id: 'pay_other1' }, { key: 'r2' })).json();
    expect((await app.inject({ method: 'POST', url: `/api/requests/${r2.id}`, headers: a.headers, payload: { approve: false } })).json()).toEqual({ status: 'declined' });
    expect((await internal('GET', `/internal/v1/requests/${r2.id}`)).json().status).toBe('declined');

    const r3 = (await internal('POST', '/internal/v1/requests', { ...body, payment_id: 'pay_other2' }, { key: 'r3' })).json();
    travel(6 * 60_000);
    expect((await internal('GET', `/internal/v1/requests/${r3.id}`)).json().status).toBe('expired');
    expect((await app.inject({ method: 'POST', url: `/api/requests/${r3.id}`, headers: a.headers, payload: { approve: true, accountId: a.main.id } })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/pulse', headers: a.headers })).json().requests).toEqual([]);
    assertLedger();
  });
});

describe('credit', () => {
  it('computes an annuity schedule that repays the principal', () => {
    const { payment, schedule } = annuity(10_000_000, 24.9, 12);
    expect(payment).toBe(949_957);
    expect(schedule.reduce((s, i) => s + i.principal, 0)).toBe(10_000_000);
  });

  it('scores higher with income and lower with overdue debt', () => {
    const base = { tenureDays: 200, income30: 8_000_000, overdue: false, monthlyDebt: 0, restricted: false };
    expect(computeScore(base)).toBeGreaterThan(650);
    expect(computeScore({ ...base, overdue: true })).toBeLessThan(560);
  });

  it('approves a loan by scoring, pays it out and collects the instalment', async () => {
    const adminH = await admin();
    const a = await client();
    travel(200 * 24 * 3600_000);
    // Scoring looks at income over the last 30 days.
    await credit(adminH, a.main.id, '100000.00');
    const ap = await app.inject({ method: 'POST', url: '/api/applications', headers: a.headers, payload: { product: 'loan', amount: '100000.00', term: 12 } });
    expect(ap.json().application.status).toBe('processing');
    now += 5000;
    tick(ctx);
    const st = (await app.inject({ url: `/api/applications/${ap.json().application.id}`, headers: a.headers })).json().application;
    expect(st.status).toBe('approved');
    await app.inject({ method: 'POST', url: `/api/applications/${st.id}/accept`, headers: a.headers, payload: {} });
    let home = (await app.inject({ url: '/api/home', headers: a.headers })).json();
    expect(home.accounts.find((x: { kind: string }) => x.kind === 'current').balance).toBe(20_000_000);
    travel(32 * 24 * 3600_000);
    tick(ctx);
    home = (await app.inject({ url: '/api/home', headers: a.headers })).json();
    expect(home.loans[0].paidCount).toBe(1);
    assertLedger();
  });

  it('opens a deposit and accrues daily interest', async () => {
    const adminH = await admin();
    const a = await client();
    await credit(adminH, a.main.id, '100000.00');
    const dep = (await app.inject({ method: 'POST', url: '/api/deposits', headers: a.headers, payload: { fromAccountId: a.main.id, amount: '100000.00', months: 3 } })).json().account;
    travel(24 * 3600_000 + 1000);
    tick(ctx);
    const d = (await app.inject({ url: `/api/accounts/${dep.id}`, headers: a.headers })).json().account;
    expect(d.balance).toBe(10_000_000 + Math.floor((10_000_000 * 18) / 100 / 365));
    assertLedger();
  });
});
