import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createCtx, type Ctx } from './context.js';
import { openDb } from './db.js';
import { tickCalls } from './domain/comm.js';
import { tick } from './domain/lines.js';
import { formatNumber, normalize, numberPrice } from './domain/numbers.js';
import { verify } from './domain/signing.js';

let now = Date.UTC(2026, 9, 14, 11, 0, 0);
let ctx: Ctx;
let app: FastifyInstance;
const SECRET = 'telecom-secret';
const H = { 'x-requested-with': 'bobtelecom' };
const DAY = 86_400_000;

/** Fake Bobobank: one account per bank user, charges by external id (at most once), refunds. */
let funds: Record<string, number>;
let charges: Map<string, { id: string; mandate: string; amount: number; refunded: number }>;
let bankLog: { path: string; body: Record<string, unknown> }[];
let bankDown: boolean;

beforeEach(async () => {
  now = Date.UTC(2026, 9, 14, 11, 0, 0);
  const cfg = loadConfig({ COOKIE_SECURE: '0', PUBLIC_URL: 'https://telecom.test', BANK_INTERNAL_URL: 'http://bank.internal', BANK_PUBLIC_URL: 'https://bank.test', BANK_TELECOM_SECRET: SECRET });
  ctx = createCtx(openDb(null), cfg, () => now);
  let seed = 7;
  ctx.random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  funds = {};
  charges = new Map();
  bankLog = [];
  bankDown = false;
  ctx.bankHttp = async (url, init) => {
    if (bankDown) throw new Error('down');
    const path = new URL(url).pathname;
    const raw = String(init.body ?? '');
    const headers = init.headers as Record<string, string>;
    if (headers['x-partner-client'] !== 'telecom' || !verify(SECRET, headers['x-bank-signature'], String(init.method), path, raw, Math.floor(now / 1000))) return Response.json({ error: 'sig' }, { status: 401 });
    const body = raw ? JSON.parse(raw) : {};
    bankLog.push({ path, body });
    let m: RegExpMatchArray | null;
    if (path.endsWith('/auth/redeem')) {
      const u = String(body.code).replace('code-', '');
      funds[`mnd_${u}`] ??= 5000_00;
      const name = u === '1' ? 'Иван Петров' : 'Мария Смирнова';
      return Response.json({ user: { id: `bank_${u}`, name, phoneMasked: '+7 ••• ••• 22-33' }, mandate: { id: `mnd_${u}`, status: 'active', usable: true, accountLast4: '4242', accountName: 'Текущий', limit: 5000_00, available: funds[`mnd_${u}`] } });
    }
    if ((m = path.match(/mandates\/(\w+)\/charges$/))) {
      const key = `${m[1]}:${body.external_id}`;
      const prev = charges.get(key);
      if (prev) return Response.json({ id: prev.id, status: 'captured', amount: prev.amount, captured: prev.amount, refunded: prev.refunded });
      if (funds[m[1]] < body.amount) return Response.json({ error: 'Недостаточно средств на счёте Bobobank', code: 'insufficient_funds' }, { status: 402 });
      funds[m[1]] -= body.amount;
      const c = { id: `pch_${charges.size + 1}`, mandate: m[1], amount: body.amount as number, refunded: 0 };
      charges.set(key, c);
      return Response.json({ id: c.id, status: 'captured', amount: c.amount, captured: c.amount, refunded: 0 });
    }
    if ((m = path.match(/charges\/(\w+)\/refund$/))) {
      const c = [...charges.values()].find((x) => x.id === m![1])!;
      c.refunded += body.amount;
      funds[c.mandate] += body.amount;
      return Response.json({ id: c.id, status: 'captured', amount: c.amount, captured: c.amount, refunded: c.refunded });
    }
    if ((m = path.match(/mandates\/(\w+)$/))) return Response.json({ id: m[1], status: 'active', usable: true, accountLast4: '4242', accountName: 'Текущий', limit: 5000_00, available: funds[m[1]] });
    return Response.json({ error: 'not found' }, { status: 404 });
  };
  app = await buildApp(ctx);
});

async function login(n = 1) {
  const start = await app.inject({ url: '/api/auth/bank/start' });
  const loc = new URL(start.headers.location as string);
  expect(loc.searchParams.get('client')).toBe('telecom');
  const state = loc.searchParams.get('state')!;
  const cb = await app.inject({ url: `/api/auth/bank/callback?code=code-${n}&state=${state}`, headers: { cookie: String(start.headers['set-cookie']).split(';')[0] } });
  expect(cb.headers.location).toBe('/?connected=1');
  const sid = ([] as string[]).concat(cb.headers['set-cookie'] as string[]).find((c) => c.startsWith('bk_sid='))!.split(';')[0];
  return { ...H, cookie: sid };
}

const get = async (h: Record<string, string>, url: string) => (await app.inject({ url, headers: h })).json();
const post = (h: Record<string, string>, url: string, payload: object = {}) => app.inject({ method: 'POST', url, headers: h, payload });

async function subscribe(h: Record<string, string>, tariff = 'base', kind: 'plain' | 'beautiful' = 'plain') {
  const { numbers } = await get(h, `/api/numbers?kind=${kind}&tariff=${tariff}`);
  expect(numbers.length).toBeGreaterThan(3);
  const r = await post(h, '/api/line', { number: numbers[0].number, tariff });
  expect(r.statusCode, r.body).toBe(200);
  return { line: r.json(), offered: numbers[0] };
}

async function advance(ms: number, step = 60_000) {
  for (let t = 0; t < ms; t += step) {
    now += step;
    tickCalls(ctx);
    await tick(ctx);
  }
}

describe('номера', () => {
  it('нормализация, формат и цена красивых номеров', () => {
    expect(normalize('+7 (999) 123-45-67')).toBe('79991234567');
    expect(normalize('89991234567')).toBe('79991234567');
    expect(normalize('12345')).toBeNull();
    expect(formatNumber('79991234567')).toBe('+7 999 123-45-67');
    expect(numberPrice('79991234567')).toBe(1000);
    expect(numberPrice('79997777777')).toBe(5000);
    expect(numberPrice('79001230000')).toBe(3000);
    expect(numberPrice('79001237777')).toBe(3000);
    expect(numberPrice('79001234500')).toBe(500);
    expect(numberPrice('79001938274')).toBe(0);
  });
});

describe('подключение и абонплата', () => {
  it('вход через Bobobank, номер и первый месяц списаны; повтор не подключает второй номер', async () => {
    const h = await login();
    expect((await get(h, '/api/line')).line).toBeNull();
    const { line, offered } = await subscribe(h);
    expect(offered.price).toBe(0);
    expect(line).toMatchObject({ status: 'active', tariff: { id: 'base', price: 549 }, left: { minutes: 600, mb: 25 * 1024, sms: 100 }, nextCharge: { amount: 549 } });
    expect(line.periodEnd - line.periodStart).toBe(30 * DAY);
    expect(funds.mnd_1).toBe(5000_00 - 549_00);
    expect(bankLog.at(-1)).toMatchObject({ body: { amount: 549_00, external_id: `sub_${line.id}_1` } });
    expect((await post(h, '/api/line', { number: '79001234567', tariff: 'mini' })).json().code).toBe('has_line');
    const chats = (await get(h, '/api/chats')).chats;
    expect(chats[0]).toMatchObject({ name: 'Бобтелеком', system: true, unread: 1 });
    expect(chats[0].last.text).toContain('Добро пожаловать');
  });

  it('красивый номер — отдельное списание; нет денег на месяц — деньги за номер возвращаются, номер свободен', async () => {
    const h = await login();
    funds.mnd_1 = 3200_00;
    const { numbers } = await get(h, '/api/numbers?kind=beautiful');
    const pick = numbers.find((n: { price: number }) => n.price === 3000) ?? numbers.at(-1);
    const r = await post(h, '/api/line', { number: pick.number, tariff: 'base' });
    if (pick.price + 549 > 3200) {
      expect(r.json().code).toBe('insufficient_funds');
      expect(funds.mnd_1).toBe(3200_00);
      expect((await get(h, '/api/line')).line).toBeNull();
    }
    funds.mnd_1 = 10_000_00;
    const ok = await post(h, '/api/line', { number: pick.number, tariff: 'base' });
    expect(ok.statusCode).toBe(200);
    expect(funds.mnd_1).toBe(10_000_00 - pick.price * 100 - 549_00);
    const hist = await get(h, '/api/history');
    expect(hist.charges.filter((c: { status: string }) => c.status === 'paid').map((c: { kind: string }) => c.kind).sort()).toEqual(['number', 'subscription']);
    const pdf = await app.inject({ url: `/api/charges/${hist.charges[0].id}/receipt.pdf`, headers: h });
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    // Somebody else cannot take the same number.
    const h2 = await login(2);
    expect((await post(h2, '/api/line', { number: pick.number, tariff: 'mini' })).json().code).toBe('number_taken');
  });

  it('через месяц — новое списание и свежие пакеты; нет денег — блок, после пополнения — снова работает', async () => {
    const h = await login();
    const { line } = await subscribe(h, 'mini');
    await post(h, '/api/line/addons', { id: 'gb10' });
    expect((await get(h, '/api/line')).line.left.mb).toBeGreaterThan(14 * 1024);
    await advance(30 * DAY, 3600_000);
    let l = (await get(h, '/api/line')).line;
    expect(l).toMatchObject({ status: 'active', left: { minutes: 200, sms: 50 } });
    expect(l.left.mb).toBeLessThanOrEqual(5 * 1024);
    expect(l.periodStart).toBe(line.periodEnd);
    expect(bankLog.filter((x) => x.body.external_id === `sub_${line.id}_2`)).toHaveLength(1);

    funds.mnd_1 = 100_00;
    await advance(30 * DAY, 3600_000);
    l = (await get(h, '/api/line')).line;
    expect(l).toMatchObject({ status: 'blocked', blockReason: 'debt' });
    expect((await post(h, '/api/sms', { to: '79001112233', text: 'hi' })).json().code).toBe('blocked');
    expect((await get(h, '/api/chats')).chats[0].last.text).toContain('Номер заблокирован');
    expect((await post(h, '/api/line/pay')).json().code).toBe('insufficient_funds');

    funds.mnd_1 = 1000_00;
    l = (await post(h, '/api/line/pay')).json();
    expect(l.status).toBe('active');
    expect(l.periodStart).toBe(now);
    expect(funds.mnd_1).toBe(1000_00 - 299_00);
  });

  it('смена тарифа: сразу — с оплатой и новым периодом; со следующего — без списания', async () => {
    const h = await login();
    await subscribe(h, 'mini');
    let l = (await post(h, '/api/line/tariff', { tariff: 'unlim', when: 'next' })).json();
    expect(l).toMatchObject({ tariff: { id: 'mini' }, nextTariff: { id: 'unlim' }, nextCharge: { amount: 999 } });
    expect(funds.mnd_1).toBe(5000_00 - 299_00);
    l = (await post(h, '/api/line/tariff', { tariff: 'premium', when: 'now' })).json();
    expect(l).toMatchObject({ tariff: { id: 'premium' }, nextTariff: null, left: { minutes: -1, mb: -1, sms: -1 } });
    expect(l.roamingUntil).toBe(now + 7 * DAY);
    expect(funds.mnd_1).toBe(5000_00 - 299_00 - 1999_00);
  });

  it('банк недоступен — не блокируем, пробуем снова через минуту', async () => {
    const h = await login();
    const { line } = await subscribe(h, 'mini');
    bankDown = true;
    now = line.periodEnd;
    await tick(ctx);
    expect((await get(h, '/api/line')).line.status).toBe('active');
    bankDown = false;
    now += 61_000;
    await tick(ctx);
    expect((await get(h, '/api/line')).line.periodStart).toBe(line.periodEnd);
  });
});

describe('связь между абонентами', () => {
  it('SMS: чаты, непрочитанные, остаток SMS; чужим номерам писать нельзя', async () => {
    const a = await login(1);
    const b = await login(2);
    const la = (await subscribe(a, 'mini')).line;
    const lb = (await subscribe(b, 'base')).line;
    const s = await post(a, '/api/sms', { to: lb.formatted, text: 'Привет!' });
    expect(s.statusCode).toBe(200);
    expect((await get(a, '/api/line')).line.left.sms).toBe(49);
    expect((await get(b, '/api/line')).unread).toBe(2);
    const chat = (await get(b, '/api/chats')).chats.find((c: { number: string }) => c.number === la.number);
    expect(chat).toMatchObject({ name: 'Иван П.', unread: 1, last: { text: 'Привет!', mine: false } });
    const conv = await get(b, `/api/chats/${la.number}`);
    expect(conv.messages).toHaveLength(1);
    expect((await get(b, '/api/line')).unread).toBe(1);
    expect((await post(a, '/api/sms', { to: '79000000001', text: 'x' })).json().code).toBe('not_subscriber');
  });

  it('звонок: входящий у адресата, ответ, разговор 2:05 — списано 3 минуты у звонящего', async () => {
    const a = await login(1);
    const b = await login(2);
    await subscribe(a, 'mini');
    const lb = (await subscribe(b, 'base')).line;
    const call = (await post(a, '/api/calls', { to: lb.number })).json();
    expect(call).toMatchObject({ status: 'ringing', direction: 'out', name: 'Мария С.' });
    const incoming = (await get(b, '/api/line')).call;
    expect(incoming).toMatchObject({ id: call.id, status: 'ringing', direction: 'in', name: 'Иван П.' });
    // Busy while talking.
    expect((await post(a, '/api/calls', { to: lb.number })).json().code).toBe('in_call');
    expect((await post(b, `/api/calls/${call.id}/answer`)).json().status).toBe('active');
    now += 125_000;
    const end = (await post(b, `/api/calls/${call.id}/end`)).json();
    expect(end).toMatchObject({ status: 'ended', seconds: 125 });
    expect((await get(a, '/api/line')).line.left.minutes).toBe(197);
    expect((await get(b, '/api/line')).line.left.minutes).toBe(600);
    expect((await get(a, '/api/calls')).calls[0]).toMatchObject({ status: 'ended', billedMin: 3 });
  });

  it('без ответа 30 секунд — пропущенный; кончились минуты — звонок обрывается', async () => {
    const a = await login(1);
    const b = await login(2);
    const la = (await subscribe(a, 'mini')).line;
    const lb = (await subscribe(b, 'base')).line;
    const c1 = (await post(a, '/api/calls', { to: lb.number })).json();
    await advance(31_000, 1000);
    expect((await get(b, '/api/calls')).calls[0]).toMatchObject({ id: c1.id, status: 'missed', direction: 'in' });

    ctx.db.prepare('UPDATE lines SET minutes_left = 2 WHERE id = ?').run(la.id);
    const c2 = (await post(a, '/api/calls', { to: lb.number })).json();
    await post(b, `/api/calls/${c2.id}/answer`);
    await advance(5 * 60_000, 5000);
    expect((await get(a, '/api/calls')).calls[0]).toMatchObject({ status: 'ended', seconds: 120 });
    expect((await get(a, '/api/line')).line.left.minutes).toBe(0);
    expect((await post(a, '/api/calls', { to: lb.number })).json().code).toBe('no_minutes');
  });
});

describe('админка', () => {
  it('обзор, блокировка номера администратором и тарифы', async () => {
    const h = await login();
    const { line } = await subscribe(h, 'base');
    ctx.db.prepare(`UPDATE users SET role = 'admin'`).run();
    expect(await get(h, '/api/admin/overview')).toMatchObject({ users: 1, active: 1, revenueMonth: 549_00 });
    await post(h, `/api/admin/lines/${line.id}/block`, { block: true });
    expect((await get(h, '/api/line')).line).toMatchObject({ status: 'blocked', blockReason: 'admin' });
    // An admin block is not lifted by the billing.
    await advance(3 * 3600_000, 3600_000);
    expect((await get(h, '/api/line')).line.status).toBe('blocked');
    await post(h, `/api/admin/lines/${line.id}/block`, { block: false });
    expect((await get(h, '/api/line')).line.status).toBe('active');
    const s = await get(h, '/api/admin/settings');
    s.tariffs[0].price = 199;
    const put = await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: h, payload: s });
    expect(put.json().tariffs[0].price).toBe(199);
    expect((await get(h, '/api/tariffs')).tariffs[0].price).toBe(199);
  });
});
