import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createCtx, type Ctx } from './context.js';
import { openDb } from './db.js';
import { processOrders, treasuryAccount } from './domain/gos.js';
import { createUser } from './domain/users.js';

let now = Date.UTC(2026, 9, 16, 9, 0, 0);
let ctx: Ctx;
let app: FastifyInstance;
const H = { 'x-requested-with': 'bobobank' };
const GOS = 'https://gos.test';

// ---------- A stand-in for Бобуслуги (Supabase) ----------
type Person = { id: string; login: string; display_name: string; role: string; country_code: string | null; gov_country_code: string | null; banned: boolean; balance: number; passport: object | null; businesses: object[] };
let people: Map<string, Person>;
let codes: Map<string, string>;
let fines: Map<number, { id: number; user_id: string; amount: number; status: string; reason: string; kind: string; country_code: string; beneficiary_id: string | null; bank_op?: string }>;
let orders: { id: number; type: string; user_id: string; country_code: string; fine_id: number | null; amount_coins: number; amount_rub: number; reason: string | null; beneficiary_id: string | null; status: string }[];
let done: { id: number; ok: boolean; result: Record<string, unknown> }[];
let failNext: string | null;
let calls: string[];
const RATE = 10000;

function person(id: string, login: string, extra: Partial<Person> = {}): Person {
  return {
    id, login, display_name: login, role: 'citizen', country_code: 'BOBO', gov_country_code: null, banned: false, balance: 1000,
    passport: { number: '1234 321 123 4321 321 1234', country_code: 'BOBO', last_name: 'Псянская', first_name: 'Алиса', birth_date: '2000-05-24' },
    businesses: [{ id: 7, number: '123 321', country_code: 'BOBO', name: 'Бобо-кофе', org_type: 'ИП', inn: '123412341234' }],
    ...extra,
  };
}

async function supabase(url: string, init: RequestInit): Promise<Response> {
  const u = new URL(url);
  const fn = u.pathname.replace('/rest/v1/rpc/', '');
  calls.push(fn);
  const a = init.body ? JSON.parse(String(init.body)) : {};
  const err = (m: string, status = 400) => Response.json({ message: m }, { status });
  if (u.pathname === '/auth/v1/user') {
    const token = String((init.headers as Record<string, string>).authorization).slice(7);
    return token.startsWith('tok-') ? Response.json({ id: token.slice(4) }) : err('bad jwt', 401);
  }
  if (failNext === fn) {
    failNext = null;
    return err('E_GOS_DOWN', 500);
  }
  switch (fn) {
    case 'svc_redeem_code': {
      const uid = codes.get(a.p_code);
      if (!uid) return err('E_BAD_CODE');
      codes.delete(a.p_code);
      return Response.json(people.get(uid));
    }
    case 'svc_person':
      return people.has(a.p_user) ? Response.json(people.get(a.p_user)) : err('E_NOT_FOUND');
    case 'svc_settings':
      return Response.json({ psy_rub_rate: RATE, countries: [{ code: 'BOBO', name: 'Бобокаунтри', psy_name: 'Бобо' }] });
    case 'svc_fine': {
      const f = fines.get(a.p_id);
      if (!f) return err('E_NOT_FOUND');
      const p = people.get(f.user_id)!;
      return Response.json({ ...f, login: p.login, display_name: p.display_name, country_name: 'Бобокаунтри', amount_rub: f.amount * RATE });
    }
    case 'svc_fine_paid': {
      const f = fines.get(a.p_id)!;
      if (f.status === 'paid' && f.bank_op === a.p_op) return Response.json({ ok: true });
      if (f.status !== 'unpaid') return err('E_BAD_STATUS');
      Object.assign(f, { status: 'paid', bank_op: a.p_op });
      return Response.json({ ok: true });
    }
    case 'svc_exchange': {
      const p = people.get(a.p_user)!;
      if (p.balance + a.p_coins < 0) return err('E_NO_MONEY');
      p.balance += a.p_coins;
      return Response.json({ ok: true, balance: p.balance });
    }
    case 'svc_exchange_revert':
      return Response.json({ ok: true });
    case 'svc_pull_orders': {
      const out = orders.filter((o) => o.status === 'pending');
      out.forEach((o) => (o.status = 'sent'));
      return Response.json(out);
    }
    case 'svc_order_done':
      done.push({ id: a.p_id, ok: a.p_ok, result: a.p_result });
      orders.find((o) => o.id === a.p_id)!.status = a.p_ok ? 'done' : 'failed';
      return Response.json({ ok: true });
  }
  return err('E_UNKNOWN', 404);
}

beforeEach(async () => {
  now = Date.UTC(2026, 9, 16, 9, 0, 0);
  const cfg = loadConfig({ COOKIE_SECURE: '0', PUBLIC_URL: 'https://bank.test', SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_KEY: 'eyJservice', SUPABASE_ANON_KEY: 'anon', GOS_PUBLIC_URL: GOS });
  ctx = createCtx(openDb(null), cfg, () => now);
  people = new Map([['u-alice', person('u-alice', 'alice')], ['u-bob', person('u-bob', 'bob', { passport: null, businesses: [] })]]);
  codes = new Map();
  fines = new Map();
  orders = [];
  done = [];
  failNext = null;
  calls = [];
  ctx.http = supabase;
  app = await buildApp(ctx);
});

const cookieOf = (res: { headers: Record<string, unknown> }, name: string) => {
  const all = ([] as string[]).concat(res.headers['set-cookie'] as string | string[]);
  return all.find((c) => c.startsWith(`${name}=`))!.split(';')[0];
};

/** «Войти через Бобуслуги»: start → (Бобуслуги give a code) → callback. Returns where the bank sent the browser. */
async function gosSignIn(uid: string, cookie = '') {
  const start = await app.inject({ url: `/api/auth/gos/start?next=/app${cookie ? '&link=1' : ''}`, headers: cookie ? { cookie } : {} });
  expect(start.statusCode).toBe(302);
  const loc = String(start.headers.location);
  expect(loc.startsWith(`${GOS}/#/connect?client=bank&state=`)).toBe(true);
  const state = decodeURIComponent(loc.split('state=')[1]);
  const code = `code-${Math.random()}`;
  codes.set(code, uid);
  const gosCookie = cookieOf(start, 'bb_gos');
  const cb = await app.inject({ url: `/api/auth/gos/callback?code=${code}&state=${encodeURIComponent(state)}`, headers: { cookie: [cookie, gosCookie].filter(Boolean).join('; ') } });
  return cb;
}

async function register(uid: string, phone: string) {
  const cb = await gosSignIn(uid);
  expect(String(cb.headers.location)).toMatch(/^\/register\?gos=/);
  const ticket = decodeURIComponent(String(cb.headers.location).split('gos=')[1]);
  const pre = (await app.inject({ url: `/api/auth/gos/ticket?t=${encodeURIComponent(ticket)}` })).json();
  const { code } = (await app.inject({ method: 'POST', url: '/api/auth/code', headers: H, payload: { phone } })).json();
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', headers: H, payload: { phone, code, name: 'Кто угодно', birthDate: '1990-01-01', password: 'password123', gosTicket: ticket } });
  expect(res.statusCode).toBe(200);
  const headers = { ...H, cookie: cookieOf(res, 'bb_sid') };
  const home = (await app.inject({ url: '/api/home', headers })).json();
  return { pre, headers, home, main: home.accounts[0], userId: res.json().user.id as string };
}

async function adminH() {
  // Staff accounts are created with the CLI, without Бобуслуги.
  await createUser(ctx, '79990000001', 'Админ Банка', 'password123', { role: 'admin' });
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { phone: '79990000001', password: 'password123' } });
  return { ...H, cookie: cookieOf(res, 'bb_sid') };
}

const credit = async (admin: Record<string, string>, accountId: string, amount: string) =>
  app.inject({ method: 'POST', url: `/api/admin/accounts/${accountId}/adjust`, headers: admin, payload: { direction: 'credit', amount, title: 'Зарплата' } });

describe('вход и KYC через Бобуслуги', () => {
  it('регистрация только с Бобопаспортом: ФИО и дата рождения из паспорта, бизнес-счёт из реестра', async () => {
    // Without a ticket the bank refuses.
    const { code } = (await app.inject({ method: 'POST', url: '/api/auth/code', headers: H, payload: { phone: '+79001112233' } })).json();
    const plain = await app.inject({ method: 'POST', url: '/api/auth/register', headers: H, payload: { phone: '+79001112233', code, name: 'Иван Петров', birthDate: '1990-01-01', password: 'password123' } });
    expect(plain.json()).toMatchObject({ code: 'gos_required' });
    // Without a passport the ticket is not enough.
    const bobCb = await gosSignIn('u-bob');
    const bobTicket = decodeURIComponent(String(bobCb.headers.location).split('gos=')[1]);
    const noPass = await app.inject({ method: 'POST', url: '/api/auth/register', headers: H, payload: { phone: '+79001112233', code, name: 'Боб', birthDate: '1990-01-01', password: 'password123', gosTicket: bobTicket } });
    expect(noPass.json()).toMatchObject({ code: 'gos_required' });

    const a = await register('u-alice', '+79005556677');
    expect(a.pre).toMatchObject({ login: 'alice', name: 'Алиса Псянская', birthDate: '2000-05-24' });
    expect(a.home.profile).toMatchObject({ name: 'Алиса Псянская', birthDate: '2000-05-24', gos: { ok: true, linked: true, login: 'alice' } });

    const typed = await app.inject({ method: 'POST', url: '/api/accounts', headers: a.headers, payload: { kind: 'business', businessType: 'ip', legalName: 'Левый', inn: '123456789012' } });
    expect(typed.statusCode).toBe(400);
    const biz = await app.inject({ method: 'POST', url: '/api/accounts', headers: a.headers, payload: { kind: 'business', businessId: 7 } });
    expect(biz.json().account).toMatchObject({ name: 'ИП Бобо-кофе', number: expect.stringMatching(/^40802/) });

    // Signing in again with Бобуслуги logs the same customer in.
    const again = await gosSignIn('u-alice');
    expect(again.headers.location).toBe('/app');
    expect(cookieOf(again, 'bb_sid')).toBeTruthy();
  });

  it('вход без cookie состояния отклоняется', async () => {
    const start = await app.inject({ url: '/api/auth/gos/start' });
    const state = decodeURIComponent(String(start.headers.location).split('state=')[1]);
    codes.set('c1', 'u-alice');
    const cb = await app.inject({ url: `/api/auth/gos/callback?code=c1&state=${encodeURIComponent(state)}` });
    expect(String(cb.headers.location)).toMatch(/^\/login\?gosError=/);
  });

  it('старый клиент без Бобуслуг не может открывать продукты, пока не подключит', async () => {
    const id = await createUser(ctx, '79007778899', 'Старый Клиент', 'password123', { birthDate: '1990-01-01' });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { phone: '79007778899', password: 'password123' } });
    const headers = { ...H, cookie: cookieOf(login, 'bb_sid') };
    const blocked = await app.inject({ method: 'POST', url: '/api/accounts', headers, payload: { kind: 'current', currency: 'USD' } });
    expect(blocked.json()).toMatchObject({ code: 'kyc_required' });
    const link = await gosSignIn('u-alice', headers.cookie);
    expect(link.headers.location).toBe('/app/profile?gos=linked');
    const ok = await app.inject({ method: 'POST', url: '/api/accounts', headers, payload: { kind: 'current', currency: 'USD' } });
    expect(ok.statusCode).toBe(200);
    expect(ctx.db.prepare('SELECT gos_uid FROM users WHERE id = ?').get(id)).toEqual({ gos_uid: 'u-alice' });
  });
});

describe('штрафы, обмен, поручения', () => {
  it('оплата штрафа рублями: деньги в казну, при отказе Бобуслуг — возврат', async () => {
    const admin = await adminH();
    const a = await register('u-alice', '+79005556677');
    await credit(admin, a.main.id, '50000.00');
    fines.set(1, { id: 1, user_id: 'u-alice', amount: 3, status: 'unpaid', reason: 'Парковка', kind: 'fine', country_code: 'BOBO', beneficiary_id: null });
    fines.set(2, { id: 2, user_id: 'u-alice', amount: 1, status: 'unpaid', reason: 'Шум', kind: 'fine', country_code: 'BOBO', beneficiary_id: null });
    expect((await app.inject({ url: '/api/gos/fines/1', headers: a.headers })).json().fine).toMatchObject({ amount: 3, amountRub: 30000, status: 'unpaid' });
    const pay = await app.inject({ method: 'POST', url: '/api/gos/fines/1/pay', headers: a.headers, payload: { accountId: a.main.id, return: `${GOS}/#/cabinet/fines` } });
    expect(pay.json()).toMatchObject({ ok: true, returnUrl: `${GOS}/#/cabinet/fines` });
    expect(fines.get(1)!.status).toBe('paid');
    expect(treasuryAccount(ctx, 'BOBO').balance).toBe(30000);
    expect((await app.inject({ method: 'POST', url: '/api/gos/fines/1/pay', headers: a.headers, payload: { accountId: a.main.id } })).statusCode).toBe(400);

    failNext = 'svc_fine_paid';
    const failed = await app.inject({ method: 'POST', url: '/api/gos/fines/2/pay', headers: a.headers, payload: { accountId: a.main.id, return: 'https://evil.test/' } });
    expect(failed.statusCode).toBe(400);
    const home = (await app.inject({ url: '/api/home', headers: a.headers })).json();
    expect(home.accounts[0].balance).toBe(5_000_000 - 30000);
    expect(treasuryAccount(ctx, 'BOBO').balance).toBe(30000);
  });

  it('обмен псякоинов в обе стороны со спредом 1 %, откат при сбое', async () => {
    const admin = await adminH();
    const a = await register('u-alice', '+79005556677');
    await credit(admin, a.main.id, '10000.00');
    const info = (await app.inject({ url: '/api/gos/exchange', headers: a.headers })).json();
    expect(info).toMatchObject({ linked: true, rate: RATE, coins: 1000, sell: 9900, buy: 10100 });
    const sell = await app.inject({ method: 'POST', url: '/api/gos/exchange', headers: a.headers, payload: { accountId: a.main.id, coins: 10, direction: 'to_rub' } });
    expect(sell.json()).toMatchObject({ rub: 99000 });
    expect(people.get('u-alice')!.balance).toBe(990);
    const buy = await app.inject({ method: 'POST', url: '/api/gos/exchange', headers: a.headers, payload: { accountId: a.main.id, coins: 5, direction: 'to_psy' } });
    expect(buy.json()).toMatchObject({ rub: 50500 });
    expect(people.get('u-alice')!.balance).toBe(995);
    failNext = 'svc_exchange';
    const failed = await app.inject({ method: 'POST', url: '/api/gos/exchange', headers: a.headers, payload: { accountId: a.main.id, coins: 5, direction: 'to_psy' } });
    expect(failed.statusCode).toBe(400);
    const bal = (await app.inject({ url: '/api/home', headers: a.headers })).json().accounts[0].balance;
    expect(bal).toBe(1_000_000 + 99000 - 50500);
    const tooMuch = await app.inject({ method: 'POST', url: '/api/gos/exchange', headers: a.headers, payload: { accountId: a.main.id, coins: 100000, direction: 'to_rub' } });
    expect(tooMuch.json().error).toBe('Недостаточно псякоинов');
  });

  it('поручения: арест, снятие ареста, взыскание и зарплата из казны', async () => {
    const admin = await adminH();
    const a = await register('u-alice', '+79005556677');
    await credit(admin, a.main.id, '1000.00');
    people.set('u-pres', person('u-pres', 'pres', { role: 'president', gov_country_code: 'BOBO' }));
    orders.push({ id: 1, type: 'arrest', user_id: 'u-alice', country_code: 'BOBO', fine_id: 9, amount_coins: 5, amount_rub: 50000, reason: 'Долг', beneficiary_id: null, status: 'pending' });
    orders.push({ id: 2, type: 'salary', user_id: 'u-alice', country_code: 'BOBO', fine_id: null, amount_coins: 1, amount_rub: 10000, reason: null, beneficiary_id: null, status: 'pending' });
    orders.push({ id: 3, type: 'arrest', user_id: 'u-nobody', country_code: 'BOBO', fine_id: 10, amount_coins: 1, amount_rub: 1, reason: null, beneficiary_id: null, status: 'pending' });
    await processOrders(ctx);
    expect(done.map((d) => [d.id, d.ok])).toEqual([[1, true], [2, false], [3, false]]);
    expect(done[1].result.error).toMatch(/не хватает на зарплату/);
    const home = (await app.inject({ url: '/api/home', headers: a.headers })).json();
    expect(home.accounts[0].available).toBe(100_000 - 50_000);
    expect(home.restrictions).toEqual([expect.objectContaining({ type: 'arrest' })]);

    // The fine is paid on Бобуслуги → a lift order arrives.
    orders.push({ id: 4, type: 'lift', user_id: 'u-alice', country_code: 'BOBO', fine_id: 9, amount_coins: 5, amount_rub: 0, reason: null, beneficiary_id: null, status: 'pending' });
    // Collect: money goes to the treasury, then the fine is marked paid.
    fines.set(11, { id: 11, user_id: 'u-alice', amount: 2, status: 'unpaid', reason: 'Налог', kind: 'tax', country_code: 'BOBO', beneficiary_id: null });
    orders.push({ id: 5, type: 'collect', user_id: 'u-alice', country_code: 'BOBO', fine_id: 11, amount_coins: 2, amount_rub: 20000, reason: 'Налог', beneficiary_id: null, status: 'pending' });
    // Salary now that the treasury has money.
    orders.push({ id: 6, type: 'salary', user_id: 'u-alice', country_code: 'BOBO', fine_id: null, amount_coins: 1, amount_rub: 10000, reason: null, beneficiary_id: null, status: 'pending' });
    await processOrders(ctx);
    expect(done.slice(3).map((d) => [d.id, d.ok])).toEqual([[4, true], [5, true], [6, true]]);
    expect(fines.get(11)!.status).toBe('paid');
    const after = (await app.inject({ url: '/api/home', headers: a.headers })).json();
    expect(after.restrictions).toEqual([]);
    expect(after.accounts[0].balance).toBe(100_000 - 20_000 + 10_000);
    expect(treasuryAccount(ctx, 'BOBO').balance).toBe(10_000);

    // Repeated delivery of a finished order is not executed twice.
    orders.find((o) => o.id === 6)!.status = 'pending';
    await processOrders(ctx);
    expect((await app.inject({ url: '/api/home', headers: a.headers })).json().accounts[0].balance).toBe(90_000);
  });
});

describe('API для страниц Бобуслуг', () => {
  it('CORS только для сайта Бобуслуг, вход по токену Supabase, выписка и справка о доходах', async () => {
    const admin = await adminH();
    const a = await register('u-alice', '+79005556677');
    await credit(admin, a.main.id, '1500.00');
    const pre = await app.inject({ method: 'OPTIONS', url: '/api/gos/v1/summary', headers: { origin: GOS, 'access-control-request-method': 'GET' } });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe(GOS);
    const evil = await app.inject({ method: 'OPTIONS', url: '/api/gos/v1/summary', headers: { origin: 'https://evil.test' } });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();

    expect((await app.inject({ url: '/api/gos/v1/summary' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/gos/v1/summary', headers: { authorization: 'Bearer bad' } })).statusCode).toBe(401);
    const s = await app.inject({ url: '/api/gos/v1/summary', headers: { origin: GOS, authorization: 'Bearer tok-u-alice' } });
    expect(s.headers['access-control-allow-origin']).toBe(GOS);
    expect(s.json()).toMatchObject({ linked: true, client: { name: 'Алиса Псянская' }, accounts: [expect.objectContaining({ balance: 150_000 })] });
    expect((await app.inject({ url: '/api/gos/v1/summary', headers: { authorization: 'Bearer tok-u-bob' } })).json()).toMatchObject({ linked: false });

    const st = await app.inject({ url: `/api/gos/v1/statement?account=${a.main.id}&from=${now - 86400_000}&to=${now + 1000}`, headers: { authorization: 'Bearer tok-u-alice' } });
    expect(st.json()).toMatchObject({ opening: 0, closing: 150_000, income: 150_000 });
    const inc = await app.inject({ url: '/api/gos/v1/income?months=3', headers: { authorization: 'Bearer tok-u-alice' } });
    expect(inc.json()).toMatchObject({ total: 150_000, months: [expect.anything(), expect.anything(), { month: 'Октябрь 2026', amount: 150_000 }] });

    // Treasury: staff of the country only.
    expect((await app.inject({ url: '/api/gos/v1/treasury/BOBO', headers: { authorization: 'Bearer tok-u-alice' } })).statusCode).toBe(403);
    people.set('u-pres', person('u-pres', 'pres', { role: 'president', gov_country_code: 'BOBO' }));
    expect((await app.inject({ url: '/api/gos/v1/treasury/BOBO', headers: { authorization: 'Bearer tok-u-pres' } })).json()).toMatchObject({ balance: 0 });
  });
});
