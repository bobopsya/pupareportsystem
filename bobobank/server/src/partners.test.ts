import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createCtx, type Ctx } from './context.js';
import { openDb } from './db.js';
import { getAccount, move, systemAccount } from './domain/ledger.js';
import { sign } from './domain/signing.js';

let now = Date.UTC(2026, 9, 14, 9, 0, 0);
let ctx: Ctx;
let app: FastifyInstance;
const SECRET = 'transport-secret';
const H = { 'x-requested-with': 'bobobank' };

beforeEach(async () => {
  now = Date.UTC(2026, 9, 14, 9, 0, 0);
  const cfg = loadConfig({ COOKIE_SECURE: '0', PUBLIC_URL: 'https://bank.test', BANK_GPAY_SECRET: 'gpay-secret', TRANSPORT_PUBLIC_URL: 'https://taxi.test', BANK_TRANSPORT_SECRET: SECRET, TELECOM_PUBLIC_URL: 'https://telecom.test', BANK_TELECOM_SECRET: 'telecom-secret' });
  ctx = createCtx(openDb(null), cfg, () => now);
  app = await buildApp(ctx);
});

async function client(phone = '+7 900 111-22-33', name = 'Иван Петров') {
  const code = await app.inject({ method: 'POST', url: '/api/auth/code', headers: H, payload: { phone } });
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', headers: H, payload: { phone, code: code.json().code, name, birthDate: '1995-05-20', password: 'password123' } });
  const headers = { ...H, cookie: String(res.headers['set-cookie']).split(';')[0] };
  const home = (await app.inject({ url: '/api/home', headers })).json();
  return { headers, main: home.accounts[0] as { id: string; number: string }, userId: res.json().user.id as string };
}

function fund(accountId: string, rub: number) {
  move(ctx, systemAccount(ctx, 'capital', 'RUB'), getAccount(ctx, accountId)!, rub * 100, 'test', { to: { title: 'Пополнение' } });
}

function partner(method: 'GET' | 'POST', path: string, body?: object, opts: { secret?: string; key?: string; client?: string } = {}) {
  const raw = body ? JSON.stringify(body) : '';
  return app.inject({
    method,
    url: path,
    headers: {
      'content-type': 'application/json',
      'x-partner-client': opts.client ?? 'transport',
      'x-bank-signature': sign(opts.secret ?? SECRET, method, path, raw, Math.floor(now / 1000)),
      ...(opts.key ? { 'idempotence-key': opts.key } : {}),
    },
    payload: body ? raw : undefined,
  });
}

async function link(c: Awaited<ReturnType<typeof client>>, limit?: number) {
  const r = await app.inject({ method: 'POST', url: '/api/partners/transport/authorize', headers: c.headers, payload: { accountId: c.main.id, state: 'st1', limit } });
  expect(r.statusCode).toBe(200);
  const url = new URL(r.json().redirect);
  expect(url.origin + url.pathname).toBe('https://taxi.test/api/auth/bank/callback');
  expect(url.searchParams.get('state')).toBe('st1');
  return url.searchParams.get('code')!;
}

const available = async (c: { headers: Record<string, string> }) => (await app.inject({ url: '/api/home', headers: c.headers })).json().accounts[0].available as number;

function assertLedger() {
  const bad = ctx.db.prepare(`SELECT tx_id, currency, SUM(amount) s FROM entries GROUP BY tx_id, currency HAVING s != 0`).all();
  expect(bad).toEqual([]);
}

describe('Войти через Bobobank', () => {
  it('код одноразовый, отдаёт имя и привязку; чужая подпись не проходит', async () => {
    const c = await client();
    expect((await app.inject({ url: '/api/partners/transport', headers: c.headers })).json()).toMatchObject({ name: 'Бобо.Транспорт', limit: 10_000_00 });
    expect((await app.inject({ url: '/api/partners/evil', headers: c.headers })).statusCode).toBe(404);
    const code = await link(c);
    expect((await partner('POST', '/internal/partner/v1/auth/redeem', { code }, { secret: 'gpay-secret' })).statusCode).toBe(401);
    expect((await partner('POST', '/internal/partner/v1/auth/redeem', { code }, { client: 'gpay' })).statusCode).toBe(401);
    const r = await partner('POST', '/internal/partner/v1/auth/redeem', { code });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ user: { id: c.userId, name: 'Иван Петров', phoneMasked: '+7 ••• ••• 22-33' }, mandate: { accountLast4: c.main.number.slice(-4), limit: 10_000_00, usable: true } });
    expect((await partner('POST', '/internal/partner/v1/auth/redeem', { code })).statusCode).toBe(400);
    // GPAY's secret still works for GPAY routes, and doesn't open partner routes.
    expect((await app.inject({ url: '/internal/v1/health', headers: { 'x-bank-signature': sign('gpay-secret', 'GET', '/internal/v1/health', '', Math.floor(now / 1000)) } })).statusCode).toBe(200);
  });

  it('просроченный код не работает', async () => {
    const code = await link(await client());
    now += 6 * 60_000;
    expect((await partner('POST', '/internal/partner/v1/auth/redeem', { code })).json().code).toBe('bad_code');
  });
});

describe('холды и списания по привязке', () => {
  it('холд уменьшает доступное, списание — точная цена, остаток отпускается, кешбэк «Транспорт»', async () => {
    const c = await client();
    fund(c.main.id, 5000);
    const { mandate } = (await partner('POST', '/internal/partner/v1/auth/redeem', { code: await link(c) })).json();
    const h = await partner('POST', `/internal/partner/v1/mandates/${mandate.id}/holds`, { amount: 600_00, external_id: 'ride_1', title: 'Поездка' }, { key: 'k1' });
    expect(h.statusCode).toBe(200);
    expect(h.json()).toMatchObject({ status: 'held', amount: 600_00 });
    expect(await available(c)).toBe(4400_00);
    // Retry with the same external_id is the same hold.
    expect((await partner('POST', `/internal/partner/v1/mandates/${mandate.id}/holds`, { amount: 600_00, external_id: 'ride_1', title: 'Поездка' })).json().id).toBe(h.json().id);
    expect(await available(c)).toBe(4400_00);

    const cap = await partner('POST', `/internal/partner/v1/holds/${h.json().id}/capture`, { amount: 487_00, title: 'Поездка', subtitle: 'Тверская ул. → Арбат' }, { key: 'c1' });
    expect(cap.json()).toMatchObject({ status: 'captured', captured: 487_00 });
    expect(await available(c)).toBe(4513_00);
    expect((await partner('POST', `/internal/partner/v1/holds/${h.json().id}/capture`, { amount: 487_00 }, { key: 'c1' })).json().status).toBe('captured');
    expect(await available(c)).toBe(4513_00);
    const e = ctx.db.prepare(`SELECT title, subtitle, category FROM entries WHERE account_id = ? AND amount < 0`).get(c.main.id);
    expect(e).toEqual({ title: 'Бобо.Транспорт', subtitle: 'Тверская ул. → Арбат', category: 'transport' });
    const sys = ctx.db.prepare(`SELECT balance FROM accounts WHERE system_code = 'transport:RUB'`).get() as { balance: number };
    expect(sys.balance).toBe(487_00);
    const cashback = ctx.db.prepare('SELECT bonus FROM users WHERE id = ?').get(c.userId) as { bonus: number };
    expect(cashback.bonus).toBeGreaterThan(0);

    // Partial refund, not more than charged.
    expect((await partner('POST', `/internal/partner/v1/charges/${h.json().id}/refund`, { amount: 500_00 })).statusCode).toBe(400);
    expect((await partner('POST', `/internal/partner/v1/charges/${h.json().id}/refund`, { amount: 87_00 })).json().refunded).toBe(87_00);
    expect(await available(c)).toBe(4600_00);
    assertLedger();
  });

  it('нехватка денег — 402, отмена снимает холд, лимит и отзыв привязки', async () => {
    const c = await client();
    fund(c.main.id, 300);
    const { mandate } = (await partner('POST', '/internal/partner/v1/auth/redeem', { code: await link(c, 500_00) })).json();
    expect((await partner('GET', `/internal/partner/v1/mandates/${mandate.id}`)).json()).toMatchObject({ available: 300_00, limit: 500_00 });
    const poor = await partner('POST', `/internal/partner/v1/mandates/${mandate.id}/holds`, { amount: 400_00, external_id: 'r1' });
    expect(poor.statusCode).toBe(402);
    expect(poor.json().code).toBe('insufficient_funds');
    fund(c.main.id, 1000);
    expect((await partner('POST', `/internal/partner/v1/mandates/${mandate.id}/holds`, { amount: 600_00, external_id: 'r2' })).json().code).toBe('limit_exceeded');
    const h = (await partner('POST', `/internal/partner/v1/mandates/${mandate.id}/holds`, { amount: 400_00, external_id: 'r3' })).json();
    expect(await available(c)).toBe(900_00);
    expect((await partner('POST', `/internal/partner/v1/holds/${h.id}/void`)).json().status).toBe('voided');
    expect(await available(c)).toBe(1300_00);
    expect((await partner('POST', `/internal/partner/v1/holds/${h.id}/capture`, { amount: 100 })).statusCode).toBe(409);

    // Tips: one-step charge.
    expect((await partner('POST', `/internal/partner/v1/mandates/${mandate.id}/charges`, { amount: 50_00, external_id: 'tip1', title: 'Чаевые', subtitle: 'Чаевые водителю' })).json()).toMatchObject({ status: 'captured', captured: 50_00 });

    const list = (await app.inject({ url: '/api/mandates', headers: c.headers })).json().mandates;
    expect(list).toEqual([expect.objectContaining({ client: 'transport', name: 'Бобо.Транспорт', limit: 500_00, spent: 50_00 })]);
    expect((await app.inject({ method: 'PATCH', url: `/api/mandates/${mandate.id}`, headers: c.headers, payload: { limit: 1000_00 } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/mandates/${mandate.id}`, headers: c.headers })).statusCode).toBe(200);
    expect((await partner('POST', `/internal/partner/v1/mandates/${mandate.id}/holds`, { amount: 100_00, external_id: 'r4' })).json().code).toBe('mandate_revoked');
    expect((await app.inject({ url: '/api/mandates', headers: c.headers })).json().mandates).toEqual([]);
    assertLedger();
  });

  it('чужую привязку менять нельзя; повторная привязка заменяет старую', async () => {
    const a = await client();
    const b = await client('+7 900 222-33-44', 'Пётр Сидоров');
    const { mandate } = (await partner('POST', '/internal/partner/v1/auth/redeem', { code: await link(a) })).json();
    expect((await app.inject({ method: 'DELETE', url: `/api/mandates/${mandate.id}`, headers: b.headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: `/api/mandates/${mandate.id}`, headers: a.headers, payload: { accountId: b.main.id } })).statusCode).toBe(404);
    const second = (await partner('POST', '/internal/partner/v1/auth/redeem', { code: await link(a) })).json().mandate;
    expect((await partner('GET', `/internal/partner/v1/mandates/${mandate.id}`)).json().status).toBe('revoked');
    expect((await partner('GET', `/internal/partner/v1/mandates/${second.id}`)).json().status).toBe('active');
  });
});

describe('крупные суммы — подтверждение в приложении', () => {
  it('сумма выше лимита ждёт подтверждения; одобрение замораживает деньги на счёте привязки', async () => {
    const c = await client();
    fund(c.main.id, 2_000_000);
    const { mandate } = (await partner('POST', '/internal/partner/v1/auth/redeem', { code: await link(c, 5000_00) })).json();
    // Without allow_confirmation the old answer stays.
    expect((await partner('POST', `/internal/partner/v1/mandates/${mandate.id}/holds`, { amount: 1_240_000_00, external_id: 'jet0', title: 'Джет' })).json().code).toBe('limit_exceeded');
    const r = await partner('POST', `/internal/partner/v1/mandates/${mandate.id}/holds`, { amount: 1_240_000_00, external_id: 'jet1', title: 'Частный джет Внуково-3 → Сочи', allow_confirmation: true }, { key: 'j1' });
    expect(r.statusCode).toBe(200);
    const conf = r.json().confirmation;
    expect(r.json()).toMatchObject({ status: 'confirmation_required', confirmation: { status: 'pending', amount: 1_240_000_00, url: `https://bank.test/connect/confirm?id=${conf.id}` } });
    // A retry returns the same request.
    expect((await partner('POST', `/internal/partner/v1/mandates/${mandate.id}/holds`, { amount: 1_240_000_00, external_id: 'jet1', title: 'x', allow_confirmation: true })).json().confirmation.id).toBe(conf.id);
    expect(await available(c)).toBe(2_000_000_00);

    const pulse = (await app.inject({ url: '/api/pulse', headers: c.headers })).json();
    expect(pulse.partnerRequests).toEqual([expect.objectContaining({ id: conf.id, name: 'Бобо.Транспорт', amount: 1_240_000_00, title: 'Частный джет Внуково-3 → Сочи' })]);
    // Someone else cannot approve it.
    const other = await client('+7 900 333-44-55', 'Чужой Человек');
    expect((await app.inject({ method: 'POST', url: `/api/partner-requests/${conf.id}`, headers: other.headers, payload: { approve: true } })).statusCode).toBe(404);

    const ok = await app.inject({ method: 'POST', url: `/api/partner-requests/${conf.id}`, headers: c.headers, payload: { approve: true } });
    expect(ok.json()).toMatchObject({ status: 'approved' });
    expect(await available(c)).toBe(2_000_000_00 - 1_240_000_00);
    const st = (await partner('GET', `/internal/partner/v1/confirmations/${conf.id}`)).json();
    expect(st).toMatchObject({ status: 'approved', charge: { status: 'held', amount: 1_240_000_00 } });
    expect((await app.inject({ method: 'POST', url: `/api/partner-requests/${conf.id}`, headers: c.headers, payload: { approve: true } })).statusCode).toBe(400);
    // The confirmed hold is captured like any other, here for less.
    expect((await partner('POST', `/internal/partner/v1/holds/${st.charge.id}/capture`, { amount: 1_100_000_00, title: 'Джет', subtitle: 'VKO → AER' })).json().captured).toBe(1_100_000_00);
    expect(await available(c)).toBe(2_000_000_00 - 1_100_000_00);
    assertLedger();
  });

  it('отказ, истечение срока, нехватка денег и потолок', async () => {
    const c = await client();
    fund(c.main.id, 300_000);
    const { mandate } = (await partner('POST', '/internal/partner/v1/auth/redeem', { code: await link(c, 5000_00) })).json();
    const ask = async (ext: string, amount: number) => partner('POST', `/internal/partner/v1/mandates/${mandate.id}/holds`, { amount, external_id: ext, title: 'Вертолёт', allow_confirmation: true });
    const a = (await ask('h1', 150_000_00)).json().confirmation;
    expect((await app.inject({ method: 'POST', url: `/api/partner-requests/${a.id}`, headers: c.headers, payload: { approve: false } })).json().status).toBe('declined');
    expect((await partner('GET', `/internal/partner/v1/confirmations/${a.id}`)).json()).toMatchObject({ status: 'declined', charge: null });

    const b = (await ask('h2', 150_000_00)).json().confirmation;
    now += 11 * 60_000;
    expect((await partner('GET', `/internal/partner/v1/confirmations/${b.id}`)).json().status).toBe('expired');
    expect((await app.inject({ method: 'POST', url: `/api/partner-requests/${b.id}`, headers: c.headers, payload: { approve: true } })).json().error).toMatch(/истекло/);

    expect((await ask('h3', 400_000_00)).json().code).toBe('insufficient_funds');
    expect((await ask('h4', 60_000_000_00)).statusCode).toBe(400);
    expect(await available(c)).toBe(300_000_00);
  });
});

describe('второй партнёр — Бобтелеком', () => {
  it('своя привязка и подпись; списание абонплаты в категорию «ЖКХ и связь», повтор не списывает дважды', async () => {
    const c = await client();
    fund(c.main.id, 3000);
    const info = (await app.inject({ url: '/api/partners/telecom', headers: c.headers })).json();
    expect(JSON.stringify(info)).toContain('Бобтелеком');
    const r = await app.inject({ method: 'POST', url: '/api/partners/telecom/authorize', headers: c.headers, payload: { accountId: c.main.id, state: 's' } });
    const code = new URL(r.json().redirect);
    expect(code.origin).toBe('https://telecom.test');
    // The transport secret does not sign telecom requests.
    expect((await partner('POST', '/internal/partner/v1/auth/redeem', { code: code.searchParams.get('code') }, { client: 'telecom' })).statusCode).toBe(401);
    const red = await partner('POST', '/internal/partner/v1/auth/redeem', { code: code.searchParams.get('code') }, { client: 'telecom', secret: 'telecom-secret' });
    const mandate = red.json().mandate;
    expect(mandate.limit).toBe(5_000_00);
    const charge = () => partner('POST', `/internal/partner/v1/mandates/${mandate.id}/charges`, { amount: 549_00, external_id: 'sub_1_1', title: 'Абонентская плата' }, { client: 'telecom', secret: 'telecom-secret', key: 'sub_1_1' });
    expect((await charge()).json()).toMatchObject({ status: 'captured', amount: 549_00 });
    expect((await charge()).json()).toMatchObject({ status: 'captured' });
    expect(await available(c)).toBe(3000_00 - 549_00);
    const hist = JSON.stringify((await app.inject({ url: '/api/history', headers: c.headers })).json());
    expect(hist).toContain('Бобтелеком');
    expect(hist).toContain('utilities');
  });
});
