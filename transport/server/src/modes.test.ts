import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createCtx, type Ctx } from './context.js';
import { openDb } from './db.js';
import { airPrice, greatCircle } from './domain/air.js';
import { arrivals, headwayMin, setBusRoutes, vehicles, type BusRoute } from './domain/buses.js';
import { distance, offset, pathLength, type LatLon } from './domain/geo.js';
import { tick } from './domain/rides.js';
import { verify } from './domain/signing.js';
import { DEFAULT_HELICOPTERS, DEFAULT_JETS, saveSettings } from './domain/tariffs.js';

let now = Date.UTC(2026, 9, 14, 11, 0, 0); // 14:00 in Moscow, Wednesday
let ctx: Ctx;
let app: FastifyInstance;
const SECRET = 'transport-secret';
const H = { 'x-requested-with': 'bobotransport' };
const LIMIT = 10_000_00;

/** Fake Bobobank: holds above the mandate limit wait for a confirmation the test answers. */
let funds: number;
let log: { path: string; body: Record<string, unknown> }[];
let charges: Map<string, { amount: number; status: string; captured: number }>;
let confirmations: Map<string, { amount: number; status: string; chargeId: string | null }>;

function line(id: number, ref: string, start: LatLon, heading: number, stops: number, gap = 600, extra: Partial<BusRoute> = {}): BusRoute {
  const path: LatLon[] = Array.from({ length: (stops - 1) * 4 + 1 }, (_, i) => offset(start, (i * gap) / 4, heading));
  return {
    id, kind: 'bus', ref, name: `Автобус ${ref}`, from: 'Начало', to: 'Конец', colour: '#027fff', fare: 83_00, night: false, electric: true,
    length: Math.round(pathLength(path)), path,
    stops: Array.from({ length: stops }, (_, i) => ({ name: `Остановка ${ref}-${i + 1}`, lat: path[i * 4][0], lon: path[i * 4][1], at: Math.round(i * gap) })),
    ...extra,
  };
}

beforeEach(async () => {
  now = Date.UTC(2026, 9, 14, 11, 0, 0);
  ctx = createCtx(openDb(null), loadConfig({ COOKIE_SECURE: '0', BANK_INTERNAL_URL: 'http://bank.internal', BANK_PUBLIC_URL: 'https://bank.test', BANK_TRANSPORT_SECRET: SECRET }), () => now);
  let seed = 7;
  ctx.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  funds = 5_000_000_00;
  log = [];
  charges = new Map();
  confirmations = new Map();
  ctx.bankHttp = async (url, init) => {
    const path = new URL(url).pathname;
    const raw = String(init.body ?? '');
    const h = init.headers as Record<string, string>;
    if (!verify(SECRET, h['x-bank-signature'], String(init.method), path, raw, Math.floor(now / 1000))) return Response.json({ error: 'sig' }, { status: 401 });
    const body = raw ? JSON.parse(raw) : {};
    log.push({ path, body });
    const held = () => [...charges.values()].filter((c) => c.status === 'held').reduce((s, c) => s + c.amount, 0);
    const view = (id: string) => ({ id, ...charges.get(id), refunded: 0 });
    let m: RegExpMatchArray | null;
    if (path.endsWith('/auth/redeem')) return Response.json({ user: { id: 'bank_u1', name: 'Иван Петров', phoneMasked: '+7 ••• ••• 22-33' }, mandate: { id: 'mnd_1', status: 'active', usable: true, accountLast4: '4242', accountName: 'Текущий', limit: LIMIT, available: funds } });
    if ((m = path.match(/mandates\/\w+\/(holds|charges)$/))) {
      const amount = body.amount as number;
      if (funds - held() < amount) return Response.json({ error: 'Недостаточно средств на счёте Bobobank', code: 'insufficient_funds' }, { status: 402 });
      if (m[1] === 'holds' && amount > LIMIT && body.allow_confirmation) {
        const id = `pcf_${confirmations.size + 1}`;
        confirmations.set(id, { amount, status: 'pending', chargeId: null });
        return Response.json({ status: 'confirmation_required', confirmation: { id, status: 'pending', amount, expires_at: now + 600_000, url: `https://bank.test/connect/confirm?id=${id}`, charge: null } });
      }
      const id = `pch_${charges.size + 1}`;
      charges.set(id, m[1] === 'charges' ? { amount, status: 'captured', captured: amount } : { amount, status: 'held', captured: 0 });
      if (m[1] === 'charges') funds -= amount;
      return Response.json(view(id));
    }
    if ((m = path.match(/confirmations\/(\w+)$/))) {
      const c = confirmations.get(m[1])!;
      return Response.json({ id: m[1], status: c.status, amount: c.amount, expires_at: now, url: '', charge: c.chargeId ? view(c.chargeId) : null });
    }
    if ((m = path.match(/holds\/(\w+)\/(capture|void)$/))) {
      const c = charges.get(m[1])!;
      if (m[2] === 'capture') {
        funds -= body.amount as number;
        Object.assign(c, { status: 'captured', captured: body.amount });
      } else c.status = 'voided';
      return Response.json(view(m[1]));
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  };
  ctx.geoHttp = async () => new Response('offline', { status: 503 });
  saveSettings(ctx, { timeScale: 6, airTimeScale: 30 });
  app = await buildApp(ctx);
  setBusRoutes([line(101, 'т1', [55.74, 37.6], 0, 10), line(102, 'н9', [55.74, 37.61], 0, 6, 600, { night: true }), line(103, '77', [55.70, 37.5], 90, 6)]);
});

/** A customer who came back from «Войти через Bobobank». */
async function login() {
  const start = await app.inject({ url: '/api/auth/bank/start' });
  const state = new URL(start.headers.location as string).searchParams.get('state');
  const cb = await app.inject({ url: `/api/auth/bank/callback?code=good-code-123&state=${state}`, headers: { cookie: String(start.headers['set-cookie']).split(';')[0] } });
  const sid = ([] as string[]).concat(cb.headers['set-cookie'] as string[]).find((c) => c.startsWith('bt_sid='))!.split(';')[0];
  return { ...H, cookie: sid };
}

async function advance(ms: number, step = 2000) {
  for (let t = 0; t < ms; t += step) {
    now += step;
    await tick(ctx);
  }
}

const current = async (h: Record<string, string>) => (await app.inject({ url: '/api/rides/current', headers: h })).json().ride;
async function until(h: Record<string, string>, status: string, maxMs = 30 * 60_000) {
  for (let t = 0; t < maxMs; t += 1000) {
    const r = await current(h);
    if (r?.status === status) return r;
    now += 1000;
    await tick(ctx);
  }
  throw new Error(`never reached ${status}`);
}

describe('автобусы', () => {
  it('расписание: интервал днём и ночью, автобусы на линии по времени', () => {
    const [day, night] = [line(1, '1', [55.75, 37.6], 0, 5), line(2, 'н1', [55.75, 37.6], 0, 5, 600, { night: true })];
    expect(headwayMin(day, now)).toBe(8);
    expect(headwayMin(night, now)).toBeNull();
    const oneAm = Date.UTC(2026, 9, 14, 22, 0, 0);
    expect(headwayMin(night, oneAm)).toBe(20);
    expect(headwayMin(day, Date.UTC(2026, 9, 14, 23, 30, 0))).toBeNull();
    // Arrivals at a stop are a headway apart, and a bus is on the line at its time.
    const [a, b] = arrivals(ctx, day, 2, now, 2);
    expect(b.at - a.at).toBe((8 * 60_000) / 6);
    expect(a.at).toBeGreaterThanOrEqual(now);
    now = a.at;
    const v = vehicles(ctx, day, now).find((x) => Math.round(x.dep) === Math.round(a.dep))!;
    expect(distance(v.pos, [day.stops[2].lat, day.stops[2].lon])).toBeLessThan(5);
  });

  it('поиск: ближайшие остановки пешком, только прямые маршруты; ночные днём не ходят', async () => {
    const from: LatLon = offset([55.74, 37.6], 1300, 0); // near stop 3 of т1
    const to: LatLon = offset([55.74, 37.6], 4100, 0); // near stop 8
    const p = (await app.inject({ method: 'POST', url: '/api/bus/plan', headers: H, payload: { from: { lat: from[0], lon: from[1] }, to: { lat: to[0], lon: to[1] } } })).json();
    expect(p.options.map((o: { ref: string }) => o.ref)).toEqual(['т1']);
    expect(p.options[0]).toMatchObject({ board: { idx: 2 }, alight: { idx: 7 }, stops: 5, fare: 83_00, distance: 3000 });
    expect(p.options[0].waitS).toBeGreaterThanOrEqual(p.options[0].walkS);
    // The other direction has no bus: the line goes one way.
    const back = (await app.inject({ method: 'POST', url: '/api/bus/plan', headers: H, payload: { from: { lat: to[0], lon: to[1] }, to: { lat: from[0], lon: from[1] } } })).json();
    expect(back.options).toEqual([]);
    const stops = (await app.inject({ url: '/api/bus/stops?s=55.735&w=37.59&n=55.79&e=37.62' })).json().stops;
    expect(stops.length).toBe(16);
    const board = (await app.inject({ url: `/api/bus/stops/${stops[0].id}` })).json();
    expect(board.lines[0]).toMatchObject({ ref: 'т1', to: 'Конец' });
    expect(board.lines[0].minutes).toHaveLength(2);
    const live = (await app.inject({ url: '/api/bus/live?s=55.7&w=37.4&n=55.9&e=37.7' })).json().buses;
    expect(live.every((b: { ref: string }) => b.ref !== 'н9')).toBe(true);
  });

  it('поездка: ждём автобус, при посадке списывается проезд один раз, едем до остановки', async () => {
    const h = await login();
    const from: LatLon = offset([55.74, 37.6], 1300, 0);
    const to: LatLon = offset([55.74, 37.6], 4100, 0);
    const p = (await app.inject({ method: 'POST', url: '/api/bus/plan', headers: h, payload: { from: { lat: from[0], lon: from[1] }, to: { lat: to[0], lon: to[1] } } })).json();
    const r = (await app.inject({ method: 'POST', url: '/api/rides/bus', headers: h, payload: { estimateId: p.id, option: 0 } })).json();
    expect(r).toMatchObject({ mode: 'bus', status: 'waiting_bus', price: 83_00, bus: { ref: 'т1', board: { name: 'Остановка т1-3' }, alight: { name: 'Остановка т1-8' } } });
    expect(r.motion.path.length).toBeGreaterThan(1);
    expect(log.some((x) => x.path.includes('/charges'))).toBe(false);
    await until(h, 'bus_arrived');
    expect(log.some((x) => x.path.includes('/charges'))).toBe(false);
    const on = (await app.inject({ method: 'POST', url: `/api/rides/${r.id}/board`, headers: h })).json();
    expect(on).toMatchObject({ status: 'on_bus', bank: { status: 'captured' } });
    await tick(ctx);
    expect(log.filter((x) => x.path.endsWith('/charges'))).toEqual([{ path: '/internal/partner/v1/mandates/mnd_1/charges', body: expect.objectContaining({ amount: 83_00, external_id: `bus_${r.id}`, title: 'Автобус т1', subtitle: 'Остановка т1-3 → Остановка т1-8' }) }]);
    await advance(60 * 60_000);
    expect((await current(h)).status).toBe('on_bus');
    const done = (await app.inject({ method: 'POST', url: `/api/rides/${r.id}/arrive`, headers: h })).json();
    expect(done).toMatchObject({ status: 'completed', finalPrice: 83_00 });
    expect((await app.inject({ method: 'POST', url: `/api/rides/${r.id}/rate`, headers: h, payload: { stars: 5, tip: 50_00 } })).statusCode).toBe(400);
    const hist = (await app.inject({ url: '/api/rides', headers: h })).json().rides[0];
    expect(hist).toMatchObject({ mode: 'bus', tariff: 'Автобус т1', amount: 83_00, colour: '#027fff' });
    expect((await app.inject({ url: `/api/rides/${r.id}/receipt.pdf`, headers: h })).headers['content-type']).toBe('application/pdf');
  });

  it('нет денег на проезд — не пускают; автобус уходит через 2 минуты, ждём следующий', async () => {
    const h = await login();
    funds = 50_00;
    const p = (await app.inject({ method: 'POST', url: '/api/bus/plan', headers: h, payload: { from: { lat: 55.7517, lon: 37.6 }, to: { lat: 55.777, lon: 37.6 } } })).json();
    const r = (await app.inject({ method: 'POST', url: '/api/rides/bus', headers: h, payload: { estimateId: p.id, option: 0 } })).json();
    const here = await until(h, 'bus_arrived');
    const no = await app.inject({ method: 'POST', url: `/api/rides/${r.id}/board`, headers: h });
    expect(no.statusCode).toBe(402);
    expect(no.json().error).toMatch(/Недостаточно средств/);
    expect((await current(h)).status).toBe('bus_arrived');
    expect(here.busLeavesAt - now).toBeLessThanOrEqual((120 * 1000) / 6);
    // The bus leaves; the next one is a headway later.
    now = here.busLeavesAt;
    await tick(ctx);
    const next = await current(h);
    expect(next.status).toBe('waiting_bus');
    expect(next.etaS).toBeGreaterThan(0);
  });
});

describe('вертолёты и джеты', () => {
  it('цены: вертолёт минимум полчаса, джет с перегоном; дальность классов; дуга большого круга', async () => {
    const r44 = DEFAULT_HELICOPTERS[0];
    expect(airPrice('heli', r44, 20)).toBe(37_500_00); // 20 km is shorter than the 30-minute minimum
    const light = DEFAULT_JETS[0];
    const hours = 1400 / 700 + 20 / 60 + 0.5;
    expect(airPrice('jet', light, 1400)).toBe(Math.round((350_000 * hours) / 100) * 100 * 100);
    const arc = greatCircle([55.6, 37.27], [43.4, 132.15]);
    expect(arc[0]).toEqual([55.6, 37.27]);
    expect(arc[arc.length - 1]).toEqual([43.4, 132.15]);
    // The arc to Vladivostok goes north of the straight line on the map.
    expect(arc[32][0]).toBeGreaterThan((55.6 + 43.4) / 2 + 5);
    const q = (await app.inject({ method: 'POST', url: '/api/air/estimate', headers: H, payload: { kind: 'jet', from: 'VKO', to: 'VVO' } })).json();
    expect(q.options.map((o: { id: string; available: boolean }) => [o.id, o.available])).toEqual([['light', false], ['midsize', false], ['supermid', false], ['heavy', true]]);
    expect((await app.inject({ method: 'POST', url: '/api/air/estimate', headers: H, payload: { kind: 'heli', from: 'HPM', to: 'HPM' } })).json().code).toBe('too_close');
  });

  it('джет дороже лимита: подтверждение в Bobobank → подготовка → посадка → полёт → списание точной цены', async () => {
    const h = await login();
    const q = (await app.inject({ method: 'POST', url: '/api/air/estimate', headers: h, payload: { kind: 'jet', from: 'VKO', to: 'AER' } })).json();
    const heavy = q.options.find((o: { id: string }) => o.id === 'heavy');
    const r = (await app.inject({ method: 'POST', url: '/api/rides/air', headers: h, payload: { estimateId: q.id, classId: 'heavy' } })).json();
    expect(r).toMatchObject({ mode: 'jet', status: 'awaiting_payment', price: heavy.price, confirmation: { url: 'https://bank.test/connect/confirm?id=pcf_1' }, air: { model: 'Gulfstream G650', from: 'VKO', to: 'AER' } });
    expect(r.car.plate).toMatch(/^RA-\d{5}$/);
    await tick(ctx);
    expect((await current(h)).status).toBe('awaiting_payment');
    // The customer approves in the bank app.
    charges.set('pch_99', { amount: heavy.price, status: 'held', captured: 0 });
    Object.assign(confirmations.get('pcf_1')!, { status: 'approved', chargeId: 'pch_99' });
    await tick(ctx);
    expect((await current(h)).status).toBe('preparing');
    const boarding = await until(h, 'boarding');
    expect(boarding.position.pos).toEqual([q.from.lat, q.from.lon]);
    await advance(60 * 60_000, 60_000);
    expect((await current(h)).status).toBe('boarding');
    expect((await app.inject({ method: 'POST', url: `/api/rides/${r.id}/board`, headers: h })).json().status).toBe('in_flight');
    now += 5000;
    const flying = await current(h);
    expect(flying.fullRoute).toHaveLength(65);
    expect(flying.motion).toBeNull();
    const done = (await app.inject({ method: 'POST', url: `/api/rides/${r.id}/arrive`, headers: h })).json();
    expect(done).toMatchObject({ status: 'completed', finalPrice: heavy.price, bank: { status: 'captured' } });
    expect(log.at(-1)).toMatchObject({ path: '/internal/partner/v1/holds/pch_99/capture', body: { amount: heavy.price, title: 'Частный джет' } });
  });

  it('отказ в банке отменяет заказ; отмена на посадке — 10 %', async () => {
    const h = await login();
    let q = (await app.inject({ method: 'POST', url: '/api/air/estimate', headers: h, payload: { kind: 'heli', from: 'HPM', to: 'ZIA' } })).json();
    let r = (await app.inject({ method: 'POST', url: '/api/rides/air', headers: h, payload: { estimateId: q.id, classId: 'h145' } })).json();
    confirmations.get('pcf_1')!.status = 'declined';
    await tick(ctx);
    expect((await app.inject({ url: `/api/rides/${r.id}`, headers: h })).json()).toMatchObject({ status: 'cancelled', bank: { error: 'Оплата отклонена в Bobobank' } });

    // A cheap helicopter fits the limit: no confirmation needed.
    q = (await app.inject({ method: 'POST', url: '/api/air/estimate', headers: h, payload: { kind: 'heli', from: 'HPM', to: 'POD' } })).json();
    const r44 = q.options.find((o: { id: string }) => o.id === 'r44');
    expect(r44.price).toBeLessThanOrEqual(LIMIT * 4);
    r = (await app.inject({ method: 'POST', url: '/api/rides/air', headers: h, payload: { estimateId: q.id, classId: 'r44' } })).json();
    if (r.status === 'awaiting_payment') {
      charges.set('pch_77', { amount: r44.price, status: 'held', captured: 0 });
      Object.assign(confirmations.get('pcf_2')!, { status: 'approved', chargeId: 'pch_77' });
      await tick(ctx);
    }
    await until(h, 'boarding');
    const c = (await app.inject({ method: 'POST', url: `/api/rides/${r.id}/cancel`, headers: h })).json();
    expect(c).toMatchObject({ status: 'cancelled', cancelFee: Math.round(r44.price / 10 / 100) * 100 });
  });

  it('по умолчанию время настоящее: полёт длится столько, сколько летит борт, подготовка — полчаса', async () => {
    saveSettings(ctx, { timeScale: 1, airTimeScale: 1 });
    const h = await login();
    const q = (await app.inject({ method: 'POST', url: '/api/air/estimate', headers: h, payload: { kind: 'heli', from: 'HPM', to: 'VKO3' } })).json();
    const r44 = q.options.find((o: { id: string }) => o.id === 'r44');
    const r = (await app.inject({ method: 'POST', url: '/api/rides/air', headers: h, payload: { estimateId: q.id, classId: 'r44' } })).json();
    charges.set('pch_55', { amount: r44.price, status: 'held', captured: 0 });
    Object.assign(confirmations.get('pcf_1')!, { status: 'approved', chargeId: 'pch_55' });
    await tick(ctx);
    const prep = await current(h);
    expect(prep.status).toBe('preparing');
    expect(prep.boardingUntil - now).toBe(15 * 60_000);
    now = prep.boardingUntil;
    await tick(ctx);
    expect((await current(h)).status).toBe('boarding');
    const fly = (await app.inject({ method: 'POST', url: `/api/rides/${r.id}/takeoff`, headers: h })).json();
    expect(fly.finishAt - now).toBe(r44.durationS * 1000);
    expect(r44.durationS).toBeGreaterThan(15 * 60);
  });
});
