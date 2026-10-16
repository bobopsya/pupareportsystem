import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createCtx, type Ctx } from './context.js';
import { openDb } from './db.js';
import { along, bearing, decodePolyline, distance, pathLength, type LatLon } from './domain/geo.js';
import { tick } from './domain/rides.js';
import { priceOf, saveSettings, surgeAt, waitingPrice, DEFAULT_SETTINGS } from './domain/tariffs.js';
import { verify } from './domain/signing.js';

let now = Date.UTC(2026, 9, 14, 11, 0, 0); // 14:00 in Moscow, Wednesday
let ctx: Ctx;
let app: FastifyInstance;
const SECRET = 'transport-secret';
const H = { 'x-requested-with': 'bobotransport' };

/** Fake Bobobank: mandates and holds in memory, checks the signature like the real one. */
let bankLog: { path: string; body: Record<string, unknown> }[];
let funds: number;
let holds: Map<string, { amount: number; status: string; captured: number }>;
let geoCalls: string[];

function encode(path: LatLon[]): string {
  let out = '';
  let pl = 0;
  let pn = 0;
  const enc = (v: number) => {
    let x = v < 0 ? ~(v << 1) : v << 1;
    while (x >= 0x20) {
      out += String.fromCharCode((0x20 | (x & 0x1f)) + 63);
      x >>= 5;
    }
    out += String.fromCharCode(x + 63);
  };
  for (const [lat, lon] of path) {
    const a = Math.round(lat * 1e6);
    const b = Math.round(lon * 1e6);
    enc(a - pl);
    enc(b - pn);
    pl = a;
    pn = b;
  }
  return out;
}

beforeEach(async () => {
  now = Date.UTC(2026, 9, 14, 11, 0, 0);
  const cfg = loadConfig({ COOKIE_SECURE: '0', PUBLIC_URL: 'https://taxi.test', BANK_INTERNAL_URL: 'http://bank.internal', BANK_PUBLIC_URL: 'https://bank.test', BANK_TRANSPORT_SECRET: SECRET });
  ctx = createCtx(openDb(null), cfg, () => now);
  let seed = 1;
  ctx.random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  bankLog = [];
  funds = 5000_00;
  holds = new Map();
  geoCalls = [];
  // Real time is the default; tests run taxis ×6 and flights ×30.
  saveSettings(ctx, { surgeMode: 'fixed', surgeFixed: 1, timeScale: 6, airTimeScale: 30 });
  ctx.bankHttp = async (url, init) => {
    const path = new URL(url).pathname;
    const raw = String(init.body ?? '');
    const headers = init.headers as Record<string, string>;
    if (headers['x-partner-client'] !== 'transport' || !verify(SECRET, headers['x-bank-signature'], String(init.method), path, raw, Math.floor(now / 1000))) return Response.json({ error: 'sig' }, { status: 401 });
    const body = raw ? JSON.parse(raw) : {};
    bankLog.push({ path, body });
    const held = () => [...holds.values()].filter((h) => h.status === 'held').reduce((s, h) => s + h.amount, 0);
    let m: RegExpMatchArray | null;
    if (path.endsWith('/auth/redeem')) {
      if (body.code !== 'good-code-123') return Response.json({ error: 'Код входа не найден или устарел', code: 'bad_code' }, { status: 400 });
      return Response.json({ user: { id: 'bank_u1', name: 'Иван Петров', phoneMasked: '+7 ••• ••• 22-33' }, mandate: { id: 'mnd_1', status: 'active', usable: true, accountLast4: '4242', accountName: 'Текущий', limit: 10_000_00, available: funds } });
    }
    if ((m = path.match(/mandates\/(\w+)\/(holds|charges)$/))) {
      const amount = body.amount as number;
      if (funds - held() < amount) return Response.json({ error: 'Недостаточно средств на счёте Bobobank', code: 'insufficient_funds' }, { status: 402 });
      const id = `pch_${holds.size + 1}`;
      if (m[2] === 'charges') {
        funds -= amount;
        holds.set(id, { amount, status: 'captured', captured: amount });
      } else holds.set(id, { amount, status: 'held', captured: 0 });
      return Response.json({ id, status: holds.get(id)!.status, amount, captured: holds.get(id)!.captured, refunded: 0 });
    }
    if ((m = path.match(/holds\/(\w+)\/(capture|void)$/))) {
      const h = holds.get(m[1])!;
      if (m[2] === 'capture') {
        funds -= body.amount as number;
        Object.assign(h, { status: 'captured', captured: body.amount });
      } else h.status = 'voided';
      return Response.json({ id: m[1], status: h.status, amount: h.amount, captured: h.captured, refunded: 0 });
    }
    if ((m = path.match(/mandates\/(\w+)$/))) return Response.json({ id: m[1], status: 'active', usable: true, accountLast4: '4242', accountName: 'Текущий', limit: 10_000_00, available: funds - held() });
    return Response.json({ error: 'not found' }, { status: 404 });
  };
  // Fake OSRM (a straight polyline, 7 km per 10 minutes) and Nominatim.
  ctx.geoHttp = async (url) => {
    geoCalls.push(url);
    const u = new URL(url);
    if (u.pathname.startsWith('/route/')) {
      const [a, b] = u.pathname.split('/').pop()!.split(';').map((s) => s.split(',').map(Number).reverse() as LatLon);
      const pts: LatLon[] = Array.from({ length: 11 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / 10, a[1] + ((b[1] - a[1]) * i) / 10]);
      const d = distance(a, b) * 1.3;
      return Response.json({ code: 'Ok', routes: [{ distance: d, duration: d / (7000 / 600), geometry: encode(pts) }] });
    }
    if (u.pathname === '/search') {
      return Response.json([
        { lat: '55.7570', lon: '37.6150', name: '', display_name: 'Тверская улица, 1, Москва', category: 'building', address: { road: 'Тверская улица', house_number: '1', suburb: 'Тверской район', city: 'Москва' } },
        { lat: '59.93', lon: '30.31', name: 'Не Москва', display_name: 'Санкт-Петербург', address: {} },
      ]);
    }
    if (u.pathname === '/reverse') return Response.json({ lat: u.searchParams.get('lat'), lon: u.searchParams.get('lon'), display_name: 'Арбат, 10', address: { road: 'улица Арбат', house_number: '10', suburb: 'Арбат', city: 'Москва' } });
    return new Response('nope', { status: 404 });
  };
  app = await buildApp(ctx);
});

const FROM = { lat: 55.7575, lon: 37.6156, title: 'Тверская улица, 1', subtitle: 'Москва' };
const TO = { lat: 55.7494, lon: 37.5917, title: 'улица Арбат, 10', subtitle: 'Москва' };

async function login() {
  const start = await app.inject({ url: '/api/auth/bank/start' });
  expect(start.statusCode).toBe(302);
  const loc = new URL(start.headers.location as string);
  expect(loc.origin + loc.pathname).toBe('https://bank.test/connect');
  expect(loc.searchParams.get('client')).toBe('transport');
  const state = loc.searchParams.get('state')!;
  const stateCookie = String(start.headers['set-cookie']).split(';')[0];
  const cb = await app.inject({ url: `/api/auth/bank/callback?code=good-code-123&state=${state}`, headers: { cookie: stateCookie } });
  expect(cb.headers.location).toBe('/?connected=1');
  const sid = ([] as string[]).concat(cb.headers['set-cookie'] as string[]).find((c) => c.startsWith('bt_sid='))!.split(';')[0];
  return { ...H, cookie: sid };
}

async function order(h: Record<string, string>, tariff = 'econom', extra: object = {}) {
  const est = await app.inject({ method: 'POST', url: '/api/rides/estimate', headers: h, payload: { from: FROM, to: TO } });
  expect(est.statusCode).toBe(200);
  const e = est.json();
  const r = await app.inject({ method: 'POST', url: '/api/rides', headers: h, payload: { estimateId: e.id, tariff, ...extra } });
  return { e, r };
}

async function advance(ms: number, step = 2000) {
  for (let t = 0; t < ms; t += step) {
    now += step;
    await tick(ctx);
  }
}

/** Moves the clock in 1-second steps until the ride reaches the status. */
async function until(h: Record<string, string>, status: string, maxMs = 20 * 60_000) {
  for (let t = 0; t < maxMs; t += 1000) {
    const r = await current(h);
    if (r?.status === status) return r;
    now += 1000;
    await tick(ctx);
  }
  throw new Error(`ride never reached ${status}`);
}

const current = async (h: Record<string, string>) => (await app.inject({ url: '/api/rides/current', headers: h })).json().ride;

describe('геометрия и цены', () => {
  it('полилиния, положение на маршруте и азимут', () => {
    const path: LatLon[] = [[55.75, 37.6], [55.76, 37.6], [55.76, 37.62]];
    expect(decodePolyline(encode(path))).toEqual(path);
    expect(bearing([55.75, 37.6], [55.76, 37.6])).toBeCloseTo(0, 0);
    expect(bearing([55.76, 37.6], [55.76, 37.62])).toBeCloseTo(90, 0);
    const half = along(path, 0.5);
    expect(pathLength([path[0], path[1], half.pos])).toBeCloseTo(pathLength(path) / 2, 0);
    expect(half.heading).toBeCloseTo(90, 0);
    expect(along(path, 2).pos).toEqual(path[2]);
  });

  it('тарифы: посадка + км + минуты, минимум, коэффициент, ожидание', () => {
    const econom = DEFAULT_SETTINGS.tariffs[0];
    expect(priceOf(econom, 10_000, 1200, 1)).toBe((199 + 240 + 280) * 100);
    expect(priceOf(econom, 500, 60, 1)).toBe(399_00);
    expect(priceOf(econom, 10_000, 1200, 1.5)).toBe(Math.round(719 * 1.5) * 100);
    expect(priceOf(econom, 10_000, 1200, 1, 200)).toBe(919_00);
    expect(waitingPrice(econom, 61)).toBe(36_00);
    saveSettings(ctx, { surgeMode: 'auto' });
    for (let h = 0; h < 48; h++) {
      const k = surgeAt(ctx, now + h * 1800_000);
      expect(k).toBeGreaterThanOrEqual(1);
      expect(k).toBeLessThanOrEqual(1.8);
    }
  });
});

describe('вход через Bobobank', () => {
  it('без state из cookie вход не проходит; с ним — пользователь и привязка', async () => {
    const bad = await app.inject({ url: '/api/auth/bank/callback?code=good-code-123&state=forged' });
    expect(bad.headers.location).toMatch(/auth_error/);
    const h = await login();
    expect((await app.inject({ url: '/api/me', headers: h })).json().user).toMatchObject({ name: 'Иван Петров', linked: true, accountLast4: '4242' });
    expect((await app.inject({ url: '/api/me/account', headers: h })).json()).toMatchObject({ linked: true, available: 5000_00 });
    expect((await app.inject({ method: 'POST', url: '/api/rides', headers: { ...H }, payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/rides', headers: { cookie: h.cookie }, payload: {} })).statusCode).toBe(403);
  });
});

describe('поездка', () => {
  it('от вызова до чека: холд ×1.2, машина едет, итог списан, остаток отпущен', async () => {
    const h = await login();
    const { e, r } = await order(h);
    expect(r.statusCode).toBe(200);
    const econom = e.tariffs.find((t: { id: string }) => t.id === 'econom');
    expect(r.json()).toMatchObject({ status: 'searching', price: econom.price, holdAmount: Math.ceil((econom.price * 1.2) / 100) * 100 });
    expect(bankLog.at(-1)).toMatchObject({ path: '/internal/partner/v1/mandates/mnd_1/holds', body: { amount: r.json().holdAmount } });
    // One active ride at a time.
    expect((await order(h)).r.json().code).toBe('has_ride');

    await advance(9000);
    let ride = await current(h);
    expect(ride.status).toBe('driver_coming');
    expect(ride.car.plate).toMatch(/^[АВЕКМНОРСТУХ] \d{3} [АВЕКМНОРСТУХ]{2} \d{2,3}$/);
    expect(ride.driver.rating).toBeGreaterThan(4.7);
    expect(ride.motion.path.length).toBeGreaterThan(2);
    expect(ride.etaS).toBeGreaterThan(0);

    ride = await until(h, 'arrived');
    expect(ride.position.pos).toEqual([FROM.lat, FROM.lon]);
    expect((await app.inject({ method: 'POST', url: `/api/rides/${ride.id}/board`, headers: h })).json().status).toBe('in_ride');

    // No timer on the way: the ride waits for «Мы приехали».
    await advance(60 * 60_000, 60_000);
    ride = await current(h);
    expect(ride.status).toBe('in_ride');
    expect(ride.motion).toBeNull();
    ride = (await app.inject({ method: 'POST', url: `/api/rides/${ride.id}/arrive`, headers: h })).json();
    expect(ride).toMatchObject({ status: 'completed', finalPrice: econom.price, bank: { status: 'captured' } });
    expect(bankLog.at(-1)).toMatchObject({ path: expect.stringMatching(/holds\/pch_1\/capture$/), body: { amount: econom.price, subtitle: 'Тверская улица, 1 → улица Арбат, 10' } });
    expect(funds).toBe(5000_00 - econom.price);

    const rate = await app.inject({ method: 'POST', url: `/api/rides/${ride.id}/rate`, headers: h, payload: { stars: 5, tip: 50_00 } });
    expect(rate.json()).toMatchObject({ rating: 5, tip: 50_00 });
    expect(bankLog.at(-1)).toMatchObject({ path: '/internal/partner/v1/mandates/mnd_1/charges', body: { amount: 50_00, external_id: `tip_${ride.id}` } });
    expect((await app.inject({ method: 'POST', url: `/api/rides/${ride.id}/rate`, headers: h, payload: { stars: 1, tip: 0 } })).statusCode).toBe(409);

    const pdf = await app.inject({ url: `/api/rides/${ride.id}/receipt.pdf`, headers: h });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    const hist = (await app.inject({ url: '/api/rides', headers: h })).json();
    expect(hist.stats).toMatchObject({ rides: 1, spent: econom.price });
    expect(hist.rides[0]).toMatchObject({ status: 'completed', amount: econom.price, tip: 50_00 });
    expect((await current(h))).toBeNull();
  });

  it('отмена до машины — бесплатно; после приезда — плата за отмену', async () => {
    const h = await login();
    let { r } = await order(h);
    let c = await app.inject({ method: 'POST', url: `/api/rides/${r.json().id}/cancel`, headers: h });
    expect(c.json()).toMatchObject({ status: 'cancelled', cancelFee: 0, bank: { status: 'voided' } });
    expect(funds).toBe(5000_00);

    ({ r } = await order(h));
    await until(h, 'arrived');
    now += 10_000; // 1 game minute: still free waiting
    c = await app.inject({ method: 'POST', url: `/api/rides/${r.json().id}/cancel`, headers: h });
    expect(c.json()).toMatchObject({ status: 'cancelled', cancelFee: 199_00, finalPrice: 199_00, bank: { status: 'captured' } });
    expect(funds).toBe(5000_00 - 199_00);
  });

  it('машина ждёт, пока не нажмёте «Я сел»; ожидание сверх бесплатного — платное', async () => {
    const h = await login();
    const { e, r } = await order(h, 'comfort');
    await until(h, 'arrived');
    // 5 game minutes of waiting (50 s at ×6): 3 free, 2 paid → 2 × 24 ₽.
    await advance(50_000, 1000);
    expect((await current(h)).status).toBe('arrived');
    expect((await app.inject({ method: 'POST', url: `/api/rides/${r.json().id}/board`, headers: h })).json().status).toBe('in_ride');
    const s = await app.inject({ method: 'POST', url: `/api/rides/${r.json().id}/arrive`, headers: h });
    const comfort = e.tariffs.find((t: { id: string }) => t.id === 'comfort');
    // 5+ minutes waited: 3 free, the rest paid by the started minute (24 ₽).
    const extra = s.json().finalPrice - comfort.price;
    expect(s.json().status).toBe('completed');
    expect(extra).toBeGreaterThanOrEqual(48_00);
    expect(extra % 24_00).toBe(0);
  });

  it('заказной автобус — как такси: тарифы автобусов, «Я сел» → «Мы приехали»', async () => {
    const h = await login();
    const { e, r } = await order(h, 'minibus');
    const buses = e.tariffs.filter((t: { vehicle: string }) => t.vehicle === 'bus').map((t: { id: string }) => t.id);
    expect(buses).toEqual(['minibus', 'bus', 'bus_business']);
    expect(e.tariffs.find((t: { id: string }) => t.id === 'bus').cars[0]).toContain('НефАЗ');
    const minibus = e.tariffs.find((t: { id: string }) => t.id === 'minibus');
    expect(r.json()).toMatchObject({ mode: 'taxi', price: minibus.price, tariff: { id: 'minibus', title: 'Микроавтобус', vehicle: 'bus' } });
    await until(h, 'arrived');
    expect((await app.inject({ method: 'POST', url: `/api/rides/${r.json().id}/board`, headers: h })).json().status).toBe('in_ride');
    const done = (await app.inject({ method: 'POST', url: `/api/rides/${r.json().id}/arrive`, headers: h })).json();
    expect(done).toMatchObject({ status: 'completed', finalPrice: minibus.price });
  });

  it('денег не хватает — машину не ищем; вне Москвы не возим', async () => {
    const h = await login();
    funds = 100_00;
    const { r } = await order(h);
    expect(r.statusCode).toBe(402);
    expect(r.json().error).toMatch(/Пополните счёт/);
    expect(await current(h)).toBeNull();
    const far = await app.inject({ method: 'POST', url: '/api/rides/estimate', headers: h, payload: { from: FROM, to: { lat: 59.93, lon: 30.31, title: 'Питер' } } });
    expect(far.json().code).toBe('outside');
  });
});

describe('адреса', () => {
  it('поиск только по Москве, с кешем; обратный геокодинг', async () => {
    const a = (await app.inject({ url: '/api/geo/search?q=тверская 1' })).json().items;
    expect(a).toEqual([{ title: 'Тверская улица, 1', subtitle: 'Тверской район, Москва', lat: 55.757, lon: 37.615 }]);
    await app.inject({ url: '/api/geo/search?q=Тверская  1' });
    expect(geoCalls.filter((u) => u.includes('/search')).length).toBe(1);
    expect(new URL(geoCalls[0]).searchParams.get('bounded')).toBe('1');
    const r = (await app.inject({ url: '/api/geo/reverse?lat=55.7494&lon=37.5917' })).json();
    expect(r.title).toBe('улица Арбат, 10');
    expect((await app.inject({ url: '/api/geo/reverse?lat=59.93&lon=30.31' })).json().outside).toBe(true);
    const cars = (await app.inject({ url: '/api/cars/near?lat=55.75&lon=37.61' })).json().cars;
    expect(cars.length).toBeGreaterThanOrEqual(6);
  });
});
