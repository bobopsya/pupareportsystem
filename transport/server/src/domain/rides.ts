import { HttpError, type Ctx } from '../context.js';
import { newId, safeJson } from '../util.js';
import { bank, type BankCharge } from './bank.js';
import { newCar, newDriver, type Car, type Driver } from './fleet.js';
import { along, distance, inMoscow, offset, pathLength, slice, type LatLon } from './geo.js';
import { route } from './maps.js';
import { getSettings, priceOf, surgeAt, tariffOf, waitingPrice, type Tariff, type TariffId } from './tariffs.js';

export interface Point {
  lat: number;
  lon: number;
  title: string;
  subtitle: string;
}

export type RideStatus = 'searching' | 'driver_coming' | 'arrived' | 'in_ride' | 'completed' | 'cancelled';
export const ACTIVE: RideStatus[] = ['searching', 'driver_coming', 'arrived', 'in_ride'];

export interface RideRow {
  id: string;
  user_id: string;
  status: RideStatus;
  tariff: TariffId;
  from_json: string;
  to_json: string;
  distance_m: number;
  duration_s: number;
  route: string;
  surge: number;
  price: number;
  child_seat: number;
  comment: string;
  time_scale: number;
  hold_amount: number;
  hold_id: string | null;
  bank_op: 'capture' | 'void' | null;
  bank_status: 'none' | 'held' | 'captured' | 'voided' | 'failed';
  bank_error: string | null;
  final_price: number | null;
  wait_paid_s: number;
  cancel_fee: number;
  driver: string | null;
  car: string | null;
  car_route: string | null;
  car_duration_s: number | null;
  assign_at: number;
  assigned_at: number | null;
  arrive_at: number | null;
  arrived_at: number | null;
  started_at: number | null;
  finish_at: number | null;
  finished_at: number | null;
  cancelled_at: number | null;
  cancelled_by: string | null;
  progress: number | null;
  rating: number | null;
  tip: number;
  tip_status: string | null;
  created_at: number;
}

/** The customer may change their mind for free for 2 minutes after a car is assigned. */
export const FREE_CANCEL_MS = 2 * 60_000;
const ESTIMATE_TTL = 15 * 60_000;
/** Hold = estimate × 1.2: room for paid waiting. The final charge never exceeds it. */
export const HOLD_FACTOR = 1.2;
const MIN_LEG_MS = 15_000;
const MAX_PICKUP_MS = 150_000;

export const getRide = (ctx: Ctx, id: string) => ctx.db.prepare('SELECT * FROM rides WHERE id = ?').get(id) as RideRow | undefined;

export function ownRide(ctx: Ctx, userId: string, id: string): RideRow {
  const r = getRide(ctx, id);
  if (!r || r.user_id !== userId) throw new HttpError(404, 'Поездка не найдена');
  return r;
}

export const currentRide = (ctx: Ctx, userId: string) =>
  ctx.db.prepare(`SELECT * FROM rides WHERE user_id = ? AND status IN ('searching','driver_coming','arrived','in_ride') ORDER BY created_at DESC LIMIT 1`).get(userId) as RideRow | undefined;

function checkPoint(p: Point, what: string): LatLon {
  const ll: LatLon = [p.lat, p.lon];
  if (!inMoscow(ll)) throw new HttpError(400, `${what}: Бобо.Транспорт пока работает только в Москве`, 'outside');
  return ll;
}

// ---- Estimate ----

export async function estimate(ctx: Ctx, userId: string | null, from: Point, to: Point) {
  const a = checkPoint(from, 'Откуда');
  const b = checkPoint(to, 'Куда');
  if (distance(a, b) < 150) throw new HttpError(400, 'Точки слишком близко — тут можно дойти пешком', 'too_close');
  const r = await route(ctx, a, b);
  const s = getSettings(ctx);
  const surge = surgeAt(ctx);
  const tariffs = s.tariffs.map((t) => ({
    id: t.id,
    title: t.title,
    price: priceOf(t, r.distance, r.duration, surge),
    eta: t.etaMin[0] + Math.floor(ctx.random() * (t.etaMin[1] - t.etaMin[0] + 1)),
    seats: t.seats,
    cars: t.cars.slice(0, 3),
  }));
  const id = newId('est', 16);
  ctx.db
    .prepare('INSERT INTO estimates(id, user_id, from_json, to_json, distance_m, duration_s, route, approx, surge, prices, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, userId, JSON.stringify(from), JSON.stringify(to), r.distance, r.duration, JSON.stringify(r.path), r.approx ? 1 : 0, surge, JSON.stringify(tariffs), ctx.now());
  return { id, distance: r.distance, duration: r.duration, route: r.path, approx: !!r.approx, surge, childSeat: s.childSeat * 100, tariffs, timeScale: s.timeScale };
}

// ---- Order ----

export async function createRide(ctx: Ctx, user: { id: string; mandateId: string | null }, input: { estimateId: string; tariff: TariffId; childSeat?: boolean; comment?: string }) {
  if (!user.mandateId) throw new HttpError(403, 'Привяжите счёт Bobobank, чтобы вызвать машину', 'no_mandate');
  if (currentRide(ctx, user.id)) throw new HttpError(409, 'У вас уже есть активная поездка', 'has_ride');
  const est = ctx.db.prepare('SELECT * FROM estimates WHERE id = ?').get(input.estimateId) as
    | { user_id: string | null; from_json: string; to_json: string; distance_m: number; duration_s: number; route: string; surge: number; created_at: number }
    | undefined;
  if (!est || (est.user_id && est.user_id !== user.id) || ctx.now() - est.created_at > ESTIMATE_TTL) throw new HttpError(409, 'Цена устарела — пересчитываем', 'estimate_expired');
  const s = getSettings(ctx);
  const t = tariffOf(ctx, input.tariff);
  if (!t) throw new HttpError(400, 'Нет такого тарифа');
  const seat = input.childSeat && t.id !== 'kids' ? s.childSeat : 0;
  const price = priceOf(t, est.distance_m, est.duration_s, est.surge, seat);
  const hold = Math.ceil((price * HOLD_FACTOR) / 100) * 100;
  const id = newId('ride', 12);
  const to = safeJson<Point>(est.to_json, { lat: 0, lon: 0, title: '', subtitle: '' });

  const charge = await bank<BankCharge>(ctx, 'POST', `/mandates/${user.mandateId}/holds`, { amount: hold, external_id: id, title: `Поездка до «${to.title}»` }, `hold_${id}`).catch((e) => {
    if (e instanceof HttpError && e.code === 'mandate_revoked') ctx.db.prepare('UPDATE users SET mandate_id = NULL WHERE id = ?').run(user.id);
    if (e instanceof HttpError && e.code === 'insufficient_funds') throw new HttpError(402, `Недостаточно средств: на время поездки заморозим ${Math.round(hold / 100)} ₽. Пополните счёт в Bobobank.`, 'insufficient_funds');
    throw e;
  });
  const now = ctx.now();
  ctx.db
    .prepare(
      `INSERT INTO rides(id, user_id, status, tariff, from_json, to_json, distance_m, duration_s, route, surge, price, child_seat, comment, time_scale, hold_amount, hold_id, bank_status, assign_at, created_at)
       VALUES(?,?,'searching',?,?,?,?,?,?,?,?,?,?,?,?,?,'held',?,?)`,
    )
    .run(id, user.id, t.id, est.from_json, est.to_json, est.distance_m, est.duration_s, est.route, est.surge, price, seat ? 1 : 0, (input.comment ?? '').slice(0, 200), s.timeScale, hold, charge.id, now + 3000 + Math.floor(ctx.random() * 5000), now);
  return getRide(ctx, id)!;
}

// ---- Time-driven stages ----

async function assign(ctx: Ctx, r: RideRow) {
  const from = safeJson<Point>(r.from_json, { lat: 0, lon: 0, title: '', subtitle: '' });
  const a: LatLon = [from.lat, from.lon];
  const start = offset(a, 700 + ctx.random() * 1800, ctx.random() * 360);
  const way = await route(ctx, start, a);
  const t = tariffOf(ctx, r.tariff)!;
  const now = ctx.now();
  const ms = Math.min(MAX_PICKUP_MS, Math.max(MIN_LEG_MS, (way.duration * 1000) / r.time_scale));
  const driver: Driver = newDriver(ctx);
  const car: Car = newCar(ctx, t.cars);
  ctx.db
    .prepare(`UPDATE rides SET status = 'driver_coming', driver = ?, car = ?, car_route = ?, car_duration_s = ?, assigned_at = ?, arrive_at = ? WHERE id = ? AND status = 'searching'`)
    .run(JSON.stringify(driver), JSON.stringify(car), JSON.stringify(way.path), way.duration, now, now + ms, r.id);
}

/** The passenger got in: paid waiting is counted in game minutes after the free ones. */
export function board(ctx: Ctx, r: RideRow, at = ctx.now()) {
  if (r.status !== 'arrived') throw new HttpError(409, 'Машина ещё не приехала', 'bad_status');
  const s = getSettings(ctx);
  const waitedGameS = ((at - (r.arrived_at ?? at)) / 1000) * r.time_scale;
  const paid = Math.max(0, Math.round(waitedGameS - s.freeWaitMin * 60));
  const ms = Math.max(MIN_LEG_MS * 1.5, (r.duration_s * 1000) / r.time_scale);
  ctx.db.prepare(`UPDATE rides SET status = 'in_ride', started_at = ?, finish_at = ?, wait_paid_s = ? WHERE id = ? AND status = 'arrived'`).run(at, at + ms, paid, r.id);
}

/** End of the ride (at the destination, or earlier when the passenger asked to stop). */
export function complete(ctx: Ctx, r: RideRow, fraction: number, at = ctx.now()) {
  if (r.status !== 'in_ride') throw new HttpError(409, 'Поездка не идёт', 'bad_status');
  const t = tariffOf(ctx, r.tariff)!;
  const seat = r.child_seat ? getSettings(ctx).childSeat : 0;
  const f = Math.min(1, Math.max(0, fraction));
  const ride = f >= 1 ? r.price : priceOf(t, r.distance_m * f, r.duration_s * f, r.surge, seat);
  const total = Math.min(r.hold_amount, ride + waitingPrice(t, r.wait_paid_s));
  ctx.db.prepare(`UPDATE rides SET status = 'completed', finished_at = ?, final_price = ?, progress = ?, bank_op = 'capture' WHERE id = ? AND status = 'in_ride'`).run(at, total, f, r.id);
}

export function cancel(ctx: Ctx, r: RideRow, by: 'user' | 'admin' | 'system' = 'user') {
  if (r.status === 'in_ride') throw new HttpError(409, 'Поездка уже идёт — можно попросить остановиться', 'bad_status');
  if (!ACTIVE.includes(r.status)) throw new HttpError(409, 'Поездка уже завершена', 'bad_status');
  const s = getSettings(ctx);
  const now = ctx.now();
  let fee = 0;
  if (by === 'user' && (r.status === 'arrived' || (r.status === 'driver_coming' && r.assigned_at && now - r.assigned_at >= FREE_CANCEL_MS))) {
    const t = tariffOf(ctx, r.tariff)!;
    const waitedGameS = r.status === 'arrived' && r.arrived_at ? ((now - r.arrived_at) / 1000) * r.time_scale - s.freeWaitMin * 60 : 0;
    fee = Math.min(r.hold_amount, s.cancelFee * 100 + waitingPrice(t, waitedGameS));
  }
  ctx.db
    .prepare(`UPDATE rides SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_fee = ?, final_price = ?, bank_op = ? WHERE id = ? AND status = ?`)
    .run(now, by, fee, fee, fee ? 'capture' : 'void', r.id, r.status);
  return fee;
}

const short = (p: Point) => p.title || 'Точка на карте';

/** Charge or release the hold. Network errors are retried on the next tick; a refusal is final. */
export async function settle(ctx: Ctx, r: RideRow) {
  if (!r.bank_op || !r.hold_id) return;
  const from = safeJson<Point>(r.from_json, {} as Point);
  const to = safeJson<Point>(r.to_json, {} as Point);
  try {
    let c: BankCharge;
    if (r.bank_op === 'void' || !r.final_price) {
      c = await bank<BankCharge>(ctx, 'POST', `/holds/${r.hold_id}/void`, undefined, `void_${r.id}`);
    } else {
      const title = r.status === 'cancelled' ? 'Плата за отмену' : 'Поездка';
      c = await bank<BankCharge>(ctx, 'POST', `/holds/${r.hold_id}/capture`, { amount: r.final_price, title, subtitle: `${short(from)} → ${short(to)}` }, `capture_${r.id}`);
    }
    ctx.db.prepare('UPDATE rides SET bank_op = NULL, bank_status = ?, bank_error = NULL WHERE id = ?').run(c.status, r.id);
  } catch (e) {
    const err = e as HttpError;
    const final = err.statusCode && err.statusCode < 500 && err.code !== 'bank_disabled';
    ctx.db.prepare(`UPDATE rides SET bank_error = ?${final ? `, bank_op = NULL, bank_status = 'failed'` : ''} WHERE id = ?`).run(String(err.message).slice(0, 300), r.id);
  }
}

const busy = new Set<string>();

/** Every 2 seconds: assigns cars, moves rides through the stages, settles with the bank. */
export async function tick(ctx: Ctx) {
  const now = ctx.now();
  const s = getSettings(ctx);
  const due = ctx.db.prepare(`SELECT * FROM rides WHERE status = 'searching' AND assign_at <= ?`).all(now) as RideRow[];
  await Promise.all(
    due.filter((r) => !busy.has(r.id)).map(async (r) => {
      busy.add(r.id);
      try {
        await assign(ctx, r);
      } finally {
        busy.delete(r.id);
      }
    }),
  );
  ctx.db.prepare(`UPDATE rides SET status = 'arrived', arrived_at = arrive_at WHERE status = 'driver_coming' AND arrive_at <= ?`).run(now);
  for (const r of ctx.db.prepare(`SELECT * FROM rides WHERE status = 'arrived' AND arrived_at <= ?`).all(now - s.autoBoardS * 1000) as RideRow[]) {
    board(ctx, r, r.arrived_at! + s.autoBoardS * 1000);
  }
  for (const r of ctx.db.prepare(`SELECT * FROM rides WHERE status = 'in_ride' AND finish_at <= ?`).all(now) as RideRow[]) complete(ctx, r, 1, r.finish_at!);

  const pending = ctx.db.prepare('SELECT * FROM rides WHERE bank_op IS NOT NULL').all() as RideRow[];
  await Promise.all(
    pending.filter((r) => !busy.has(r.id)).map(async (r) => {
      busy.add(r.id);
      try {
        await settle(ctx, r);
      } finally {
        busy.delete(r.id);
      }
    }),
  );
  ctx.db.prepare('DELETE FROM estimates WHERE created_at < ?').run(now - 2 * ESTIMATE_TTL);
}

export async function rate(ctx: Ctx, r: RideRow, mandateId: string | null, stars: number, tip: number) {
  if (r.status !== 'completed') throw new HttpError(409, 'Оценить можно после поездки', 'bad_status');
  if (r.rating) throw new HttpError(409, 'Вы уже оценили эту поездку', 'already');
  if (tip > 0) {
    if (!mandateId) throw new HttpError(403, 'Привяжите счёт Bobobank, чтобы оставить чаевые', 'no_mandate');
    const driver = safeJson<Driver | null>(r.driver, null);
    await bank<BankCharge>(ctx, 'POST', `/mandates/${mandateId}/charges`, { amount: tip, external_id: `tip_${r.id}`, title: 'Чаевые', subtitle: `Чаевые водителю${driver ? ` ${driver.name}` : ''}` }, `tip_${r.id}`);
  }
  ctx.db.prepare(`UPDATE rides SET rating = ?, tip = ?, tip_status = ? WHERE id = ?`).run(stars, tip, tip ? 'captured' : null, r.id);
}

// ---- What the app shows ----

interface Motion {
  path: LatLon[];
  startAt: number;
  endAt: number;
}

export function serializeRide(ctx: Ctx, r: RideRow) {
  const now = ctx.now();
  const s = getSettings(ctx);
  const t = tariffOf(ctx, r.tariff) as Tariff | undefined;
  const path = safeJson<LatLon[]>(r.route, []);
  const carPath = safeJson<LatLon[]>(r.car_route, []);
  const from = safeJson<Point>(r.from_json, {} as Point);
  let motion: Motion | null = null;
  let car: { pos: LatLon; heading: number } | null = null;
  let etaS: number | null = null;
  let left: LatLon[] = path;
  if (r.status === 'driver_coming' && r.assigned_at && r.arrive_at) {
    const f = (now - r.assigned_at) / (r.arrive_at - r.assigned_at);
    car = along(carPath, f);
    motion = { path: carPath, startAt: r.assigned_at, endAt: r.arrive_at };
    etaS = Math.max(0, Math.round((r.car_duration_s ?? 0) * (1 - f)));
  } else if (r.status === 'arrived') {
    car = { pos: [from.lat, from.lon], heading: carPath.length > 1 ? along(carPath, 1).heading : 0 };
  } else if (r.status === 'in_ride' && r.started_at && r.finish_at) {
    const f = (now - r.started_at) / (r.finish_at - r.started_at);
    car = along(path, f);
    motion = { path, startAt: r.started_at, endAt: r.finish_at };
    etaS = Math.max(0, Math.round(r.duration_s * (1 - f)));
    left = slice(path, f);
  } else if (r.status === 'completed') {
    left = r.progress !== null && r.progress < 1 ? slice(path, 0, r.progress) : path;
  }
  const waitedGameS = r.status === 'arrived' && r.arrived_at ? Math.round(((now - r.arrived_at) / 1000) * r.time_scale) : 0;
  return {
    id: r.id,
    status: r.status,
    tariff: { id: r.tariff, title: t?.title ?? r.tariff, waitPerMin: (t?.waitPerMin ?? 0) * 100 },
    from,
    to: safeJson<Point>(r.to_json, {} as Point),
    distance: r.distance_m,
    duration: r.duration_s,
    route: left,
    fullRoute: path,
    surge: r.surge,
    price: r.price,
    holdAmount: r.hold_amount,
    finalPrice: r.final_price,
    cancelFee: r.cancel_fee,
    childSeat: !!r.child_seat,
    comment: r.comment,
    driver: safeJson<Driver | null>(r.driver, null),
    car: safeJson<Car | null>(r.car, null),
    position: car,
    motion,
    etaS,
    waiting: r.status === 'arrived' ? { waitedS: waitedGameS, freeS: s.freeWaitMin * 60, autoBoardAt: (r.arrived_at ?? now) + s.autoBoardS * 1000 } : null,
    freeCancelUntil: r.status === 'searching' ? null : r.status === 'driver_coming' && r.assigned_at ? r.assigned_at + FREE_CANCEL_MS : r.status === 'arrived' ? now : null,
    cancelFeeNow: s.cancelFee * 100,
    timeScale: r.time_scale,
    bank: { status: r.bank_status, pending: !!r.bank_op, error: r.bank_status === 'failed' ? r.bank_error : null },
    rating: r.rating,
    tip: r.tip,
    progress: r.progress,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    cancelledAt: r.cancelled_at,
    cancelledBy: r.cancelled_by,
    now,
  };
}

export function historyItem(ctx: Ctx, r: RideRow) {
  const t = tariffOf(ctx, r.tariff);
  return {
    id: r.id,
    status: r.status,
    tariff: t?.title ?? r.tariff,
    from: safeJson<Point>(r.from_json, {} as Point),
    to: safeJson<Point>(r.to_json, {} as Point),
    amount: r.final_price ?? 0,
    car: safeJson<Car | null>(r.car, null),
    rating: r.rating,
    tip: r.tip,
    distance: Math.round(r.distance_m * (r.progress ?? 1)),
    createdAt: r.created_at,
    finishedAt: r.finished_at ?? r.cancelled_at,
    bankStatus: r.bank_status,
  };
}

/** Background cars around the passenger: a picture only, they move along real roads near the pin. */
export async function nearCars(ctx: Ctx, p: LatLon) {
  const cell: LatLon = [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];
  const bucket = Math.floor(ctx.now() / 600_000);
  const key = `near:${cell[0]},${cell[1]}:${bucket}`;
  const row = ctx.db.prepare('SELECT value FROM geo_cache WHERE key = ?').get(key) as { value: string } | undefined;
  if (row) return JSON.parse(row.value) as unknown[];
  const routes = await Promise.all([0, 1, 2].map((i) => route(ctx, offset(cell, 900, i * 120 + ctx.random() * 60), offset(cell, 900, i * 120 + 180 + ctx.random() * 60)).catch(() => null)));
  const cars: { id: string; path: LatLon[]; speed: number; phase: number; tariff: string }[] = [];
  const kinds = ['econom', 'econom', 'econom', 'comfort', 'comfort', 'comfort_plus', 'business'];
  for (const r of routes) {
    if (!r || r.path.length < 2) continue;
    const len = pathLength(r.path);
    for (let i = 0; i < 3 + Math.floor(ctx.random() * 2); i++) {
      const a = ctx.random() * 0.7;
      const piece = slice(r.path, a, Math.min(1, a + Math.min(0.3, 800 / Math.max(len, 1))));
      cars.push({ id: `bg${cars.length}`, path: piece, speed: 6 + ctx.random() * 6, phase: ctx.random(), tariff: kinds[Math.floor(ctx.random() * kinds.length)] });
    }
  }
  ctx.db.prepare('INSERT OR REPLACE INTO geo_cache(key, value, created_at) VALUES(?,?,?)').run(key, JSON.stringify(cars), ctx.now());
  return cars;
}
