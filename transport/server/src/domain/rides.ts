import { HttpError, type Ctx } from '../context.js';
import { newId, safeJson } from '../util.js';
import { airQuote, registration, type AirKind } from './air.js';
import { bank, holdOrConfirm, type BankCharge, type Confirmation } from './bank.js';
import { arrivals, busRoute, busRoutes, busTravelMs, type BusOption } from './buses.js';
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

export type Mode = 'taxi' | 'bus' | 'heli' | 'jet';
export type RideStatus =
  | 'awaiting_payment'
  | 'searching' | 'driver_coming' | 'arrived' | 'in_ride'
  | 'waiting_bus' | 'bus_arrived' | 'on_bus'
  | 'preparing' | 'boarding' | 'in_flight'
  | 'completed' | 'cancelled';
export const ACTIVE: RideStatus[] = ['awaiting_payment', 'searching', 'driver_coming', 'arrived', 'in_ride', 'waiting_bus', 'bus_arrived', 'on_bus', 'preparing', 'boarding', 'in_flight'];
const ACTIVE_SQL = ACTIVE.map((x) => `'${x}'`).join(',');

/** Mode-specific details of a ride (rides.extra). */
export interface RideExtra {
  /** Bus: line, stops, the departure of the bus from the first stop. */
  bus?: { route: number; ref: string; kind: string; colour: string | null; to: string; board: BusOption['board']; alight: BusOption['alight']; dep: number; stops: number; boardAt: number; alightAt: number };
  /** Helicopter or jet: aircraft class and places. */
  air?: { kind: AirKind; classId: string; className: string; model: string; seats: number; from: string; to: string };
  /** A city bus called like a taxi: the line number on its board. */
  line?: { ref: string; colour: string | null };
}

/** «561», «м3», «т25», «н1», «с823а»: a city line number. */
export const LINE_RE = /^[а-яё]{0,2}\d{1,4}[а-яё]?$/i;
export const DEFAULT_LINE = '561';

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
  mode: Mode;
  extra: string;
  confirmation_id: string | null;
  confirm_url: string | null;
  confirm_expires_at: number | null;
}

/** The customer may change their mind for free for 2 minutes after a car is assigned. */
export const FREE_CANCEL_MS = 2 * 60_000;
const ESTIMATE_TTL = 15 * 60_000;
/** Hold = estimate × 1.2: room for paid waiting. The final charge never exceeds it. */
export const HOLD_FACTOR = 1.2;
/** Guard against zero-length stages only: durations come from OSRM and real flight times. */
const MIN_LEG_MS = 5_000;
/** City driving to the pickup point, m per game minute (~20 km/h). */
const PICKUP_M_PER_MIN = 330;

/** Real ms of a stage that lasts `gameS` game seconds at the scale. */
const realMs = (gameS: number, scale: number) => Math.max(MIN_LEG_MS, (gameS * 1000) / scale);
/** Looking for a car: 10–40 seconds. */
const searchAt = (ctx: Ctx, now: number, scale: number) => now + realMs(10 + ctx.random() * 30, scale);
const prepAt = (s: ReturnType<typeof getSettings>, kind: string, now: number) => now + realMs((kind === 'heli' ? s.heliPrepMin : s.jetPrepMin) * 60, s.airTimeScale);

export const getRide = (ctx: Ctx, id: string) => ctx.db.prepare('SELECT * FROM rides WHERE id = ?').get(id) as RideRow | undefined;

export function ownRide(ctx: Ctx, userId: string, id: string): RideRow {
  const r = getRide(ctx, id);
  if (!r || r.user_id !== userId) throw new HttpError(404, 'Поездка не найдена');
  return r;
}

export const currentRide = (ctx: Ctx, userId: string) =>
  ctx.db.prepare(`SELECT * FROM rides WHERE user_id = ? AND status IN (${ACTIVE_SQL}) ORDER BY created_at DESC LIMIT 1`).get(userId) as RideRow | undefined;

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
    vehicle: t.vehicle ?? 'car',
  }));
  const id = newId('est', 16);
  ctx.db
    .prepare('INSERT INTO estimates(id, user_id, from_json, to_json, distance_m, duration_s, route, approx, surge, prices, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, userId, JSON.stringify(from), JSON.stringify(to), r.distance, r.duration, JSON.stringify(r.path), r.approx ? 1 : 0, surge, JSON.stringify(tariffs), ctx.now());
  return { id, distance: r.distance, duration: r.duration, route: r.path, approx: !!r.approx, surge, childSeat: s.childSeat * 100, tariffs, timeScale: s.timeScale };
}

// ---- Order ----

export async function createRide(ctx: Ctx, user: { id: string; mandateId: string | null }, input: { estimateId: string; tariff: TariffId; childSeat?: boolean; comment?: string; line?: string }) {
  if (!user.mandateId) throw new HttpError(403, 'Привяжите счёт Bobobank, чтобы вызвать машину', 'no_mandate');
  if (currentRide(ctx, user.id)) throw new HttpError(409, 'У вас уже есть активная поездка', 'has_ride');
  const est = ctx.db.prepare('SELECT * FROM estimates WHERE id = ?').get(input.estimateId) as
    | { user_id: string | null; from_json: string; to_json: string; distance_m: number; duration_s: number; route: string; surge: number; prices: string; created_at: number }
    | undefined;
  if (!est || (est.user_id && est.user_id !== user.id) || ctx.now() - est.created_at > ESTIMATE_TTL) throw new HttpError(409, 'Цена устарела — пересчитываем', 'estimate_expired');
  const s = getSettings(ctx);
  const t = tariffOf(ctx, input.tariff);
  if (!t) throw new HttpError(400, 'Нет такого тарифа');
  const seat = input.childSeat && t.id !== 'kids' && t.vehicle !== 'bus' ? s.childSeat : 0;
  let line: RideExtra['line'];
  if (t.id === 'bus_city') {
    const ref = (input.line ?? DEFAULT_LINE).trim().toLowerCase();
    if (!LINE_RE.test(ref)) throw new HttpError(400, 'Номер маршрута — например 561, м3 или т25', 'bad_line');
    line = { ref, colour: busRoutes().find((x) => x.ref.toLowerCase() === ref)?.colour ?? null };
  }
  const price = priceOf(t, est.distance_m, est.duration_s, est.surge, seat);
  const hold = Math.ceil((price * HOLD_FACTOR) / 100) * 100;
  const id = newId('ride', 12);
  const to = safeJson<Point>(est.to_json, { lat: 0, lon: 0, title: '', subtitle: '' });

  const pay = await freeze(ctx, user, hold, id, `Поездка до «${to.title}»`);
  const now = ctx.now();
  // The car comes from as far as the pickup time promised on the tariff card.
  const eta = safeJson<{ id: string; eta: number }[]>(est.prices, []).find((x) => x.id === t.id)?.eta ?? 5;
  ctx.db
    .prepare(
      `INSERT INTO rides(id, user_id, status, tariff, from_json, to_json, distance_m, duration_s, route, surge, price, child_seat, comment, time_scale, hold_amount, hold_id, bank_status, assign_at, created_at, mode, confirmation_id, confirm_url, confirm_expires_at, extra)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'taxi',?,?,?,?)`,
    )
    .run(
      id, user.id, pay.charge ? 'searching' : 'awaiting_payment', t.id, est.from_json, est.to_json, est.distance_m, est.duration_s, est.route, est.surge, price, seat ? 1 : 0,
      (input.comment ?? '').slice(0, 200), s.timeScale, hold, pay.charge?.id ?? null, pay.charge ? 'held' : 'none', searchAt(ctx, now, s.timeScale), now,
      pay.confirmation?.id ?? null, pay.confirmation?.url ?? null, pay.confirmation?.expires_at ?? null, JSON.stringify({ eta, line }),
    );
  return getRide(ctx, id)!;
}

/** Freezes the money, or asks the customer to confirm a large amount in the Bobobank app. */
async function freeze(ctx: Ctx, user: { id: string; mandateId: string | null }, amount: number, rideId: string, title: string): Promise<{ charge?: BankCharge; confirmation?: Confirmation }> {
  if (!user.mandateId) throw new HttpError(403, 'Привяжите счёт Bobobank, чтобы заказать', 'no_mandate');
  return holdOrConfirm(ctx, user.mandateId, amount, rideId, title).catch((e) => {
    if (e instanceof HttpError && e.code === 'mandate_revoked') ctx.db.prepare('UPDATE users SET mandate_id = NULL WHERE id = ?').run(user.id);
    if (e instanceof HttpError && e.code === 'insufficient_funds') throw new HttpError(402, `Недостаточно средств: на время поездки заморозим ${Math.round(amount / 100).toLocaleString('ru-RU')} ₽. Пополните счёт в Bobobank.`, 'insufficient_funds');
    throw e;
  });
}


/** Helicopter or private jet: priced by flight time, paid up front (usually with a confirmation in the app). */
export async function createAirRide(ctx: Ctx, user: { id: string; mandateId: string | null }, input: { estimateId: string; classId: string }) {
  if (!user.mandateId) throw new HttpError(403, 'Привяжите счёт Bobobank, чтобы заказать', 'no_mandate');
  if (currentRide(ctx, user.id)) throw new HttpError(409, 'У вас уже есть активный заказ', 'has_ride');
  const est = ctx.db.prepare('SELECT * FROM estimates WHERE id = ?').get(input.estimateId) as
    | { user_id: string | null; from_json: string; to_json: string; distance_m: number; route: string; prices: string; created_at: number; mode: string }
    | undefined;
  if (!est || (est.mode !== 'heli' && est.mode !== 'jet') || (est.user_id && est.user_id !== user.id) || ctx.now() - est.created_at > ESTIMATE_TTL) throw new HttpError(409, 'Цена устарела — пересчитываем', 'estimate_expired');
  const kind = est.mode as AirKind;
  const opt = (JSON.parse(est.prices) as ReturnType<typeof airQuote>['options']).find((o) => o.id === input.classId);
  if (!opt || !opt.available) throw new HttpError(400, opt?.reason ?? 'Этот борт недоступен');
  const s = getSettings(ctx);
  const from = safeJson<Point & { code: string }>(est.from_json, {} as Point & { code: string });
  const to = safeJson<Point & { code: string }>(est.to_json, {} as Point & { code: string });
  const id = newId('ride', 12);
  const label = kind === 'heli' ? `Вертолёт ${opt.model}: ${from.title} → ${to.title}` : `Частный джет ${opt.model}: ${from.title} → ${to.title}`;
  const pay = await freeze(ctx, user, opt.price, id, label);
  const pilot = newDriver(ctx);
  const craft: Car = { model: opt.model, color: kind === 'heli' ? 'Чёрный' : 'Белый', colorHex: kind === 'heli' ? '#1d1d1f' : '#f4f4f2', plate: registration(ctx, kind) };
  const extra: RideExtra = { air: { kind, classId: opt.id, className: opt.title, model: opt.model, seats: opt.seats, from: from.code, to: to.code } };
  const now = ctx.now();
  ctx.db
    .prepare(
      `INSERT INTO rides(id, user_id, status, tariff, from_json, to_json, distance_m, duration_s, route, surge, price, time_scale, hold_amount, hold_id, bank_status, assign_at, created_at, mode, extra, driver, car, confirmation_id, confirm_url, confirm_expires_at)
       VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id, user.id, pay.charge ? 'preparing' : 'awaiting_payment', opt.id, est.from_json, est.to_json, est.distance_m, opt.durationS, est.route, opt.price, s.airTimeScale, opt.price,
      pay.charge?.id ?? null, pay.charge ? 'held' : 'none', prepAt(s, kind, now), now, kind, JSON.stringify(extra), JSON.stringify(pilot), JSON.stringify(craft),
      pay.confirmation?.id ?? null, pay.confirmation?.url ?? null, pay.confirmation?.expires_at ?? null,
    );
  return getRide(ctx, id)!;
}

/** A bus ride: the next bus of the line to the boarding stop; the fare is charged when the passenger gets on. */
export function createBusRide(ctx: Ctx, user: { id: string; mandateId: string | null }, input: { estimateId: string; option: number }) {
  if (!user.mandateId) throw new HttpError(403, 'Привяжите счёт Bobobank, чтобы платить за проезд', 'no_mandate');
  if (currentRide(ctx, user.id)) throw new HttpError(409, 'У вас уже есть активная поездка', 'has_ride');
  const est = ctx.db.prepare('SELECT * FROM estimates WHERE id = ?').get(input.estimateId) as { user_id: string | null; to_json: string; from_json: string; prices: string; created_at: number; mode: string } | undefined;
  if (!est || est.mode !== 'bus' || (est.user_id && est.user_id !== user.id) || ctx.now() - est.created_at > ESTIMATE_TTL) throw new HttpError(409, 'Расписание обновилось — ищем заново', 'estimate_expired');
  const o = (JSON.parse(est.prices) as BusOption[]).find((x) => x.n === input.option);
  const r = o && busRoute(o.route);
  if (!o || !r) throw new HttpError(400, 'Нет такого варианта');
  const s = getSettings(ctx);
  const now = ctx.now();
  const walkMs = (o.walkS * 1000) / s.timeScale;
  const next = arrivals(ctx, r, o.board.idx, now + walkMs, 1)[0];
  if (!next) throw new HttpError(409, 'Автобус сейчас не ходит', 'no_service');
  const rideMs = busTravelMs(ctx, r.stops[o.alight.idx].at - r.stops[o.board.idx].at);
  const id = newId('ride', 12);
  const extra: RideExtra = { bus: { route: r.id, ref: r.ref, kind: r.kind, colour: r.colour, to: r.to, board: o.board, alight: o.alight, dep: next.dep, stops: o.stops, boardAt: r.stops[o.board.idx].at, alightAt: r.stops[o.alight.idx].at } };
  const from: Point = { lat: o.board.lat, lon: o.board.lon, title: o.board.name, subtitle: `Остановка, ${o.board.walkM} м пешком` };
  const to: Point = { lat: o.alight.lat, lon: o.alight.lon, title: o.alight.name, subtitle: `Остановка, ${o.alight.walkM} м до места` };
  ctx.db
    .prepare(
      `INSERT INTO rides(id, user_id, status, tariff, from_json, to_json, distance_m, duration_s, route, surge, price, time_scale, hold_amount, bank_status, assign_at, arrive_at, finish_at, created_at, mode, extra)
       VALUES(?,?,'waiting_bus',?,?,?,?,?,?,1,?,?,0,'none',?,?,?,?,'bus',?)`,
    )
    .run(id, user.id, r.ref, JSON.stringify(from), JSON.stringify(to), o.distance, o.rideS, JSON.stringify(o.path), r.fare, s.timeScale, now, next.at, next.at + rideMs, now, JSON.stringify(extra));
  return getRide(ctx, id)!;
}

// ---- Time-driven stages ----

async function assign(ctx: Ctx, r: RideRow) {
  const from = safeJson<Point>(r.from_json, { lat: 0, lon: 0, title: '', subtitle: '' });
  const a: LatLon = [from.lat, from.lon];
  const eta = safeJson<{ eta?: number }>(r.extra, {}).eta ?? 5;
  // Roads are ~1.3× longer than the straight line: start where the route takes about the promised time.
  const start = offset(a, (eta * PICKUP_M_PER_MIN * (0.85 + ctx.random() * 0.3)) / 1.3, ctx.random() * 360);
  const way = await route(ctx, start, a);
  const t = tariffOf(ctx, r.tariff)!;
  const now = ctx.now();
  const ms = realMs(way.duration, r.time_scale);
  const driver: Driver = newDriver(ctx);
  const car: Car = newCar(ctx, t.cars);
  const line = safeJson<RideExtra>(r.extra, {}).line;
  // A city bus wears the line's colour (red when the line has none).
  if (line) Object.assign(car, { color: line.colour ? '' : 'Красный', colorHex: line.colour || '#d0021b' });
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
  const ms = realMs(r.duration_s, r.time_scale);
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

export function cancel(ctx: Ctx, r: RideRow, by: 'user' | 'admin' | 'system' | 'bank' = 'user') {
  if (r.status === 'in_ride' || r.status === 'on_bus') throw new HttpError(409, 'Поездка уже идёт — можно попросить остановиться', 'bad_status');
  if (r.status === 'in_flight') throw new HttpError(409, 'Борт уже в воздухе', 'bad_status');
  if (!ACTIVE.includes(r.status)) throw new HttpError(409, 'Поездка уже завершена', 'bad_status');
  const s = getSettings(ctx);
  const now = ctx.now();
  let fee = 0;
  // Nothing is frozen yet: a bus before boarding, a ride waiting for the bank's confirmation.
  const nothingHeld = r.status === 'waiting_bus' || r.status === 'bus_arrived' || (r.status === 'awaiting_payment' && !r.confirmation_id);
  if (r.mode === 'heli' || r.mode === 'jet') {
    if (by === 'user' && r.status === 'boarding') fee = Math.round(r.price / 10 / 100) * 100;
  } else if (by === 'user' && (r.status === 'arrived' || (r.status === 'driver_coming' && r.assigned_at && now - r.assigned_at >= FREE_CANCEL_MS))) {
    const t = tariffOf(ctx, r.tariff)!;
    const waitedGameS = r.status === 'arrived' && r.arrived_at ? ((now - r.arrived_at) / 1000) * r.time_scale - s.freeWaitMin * 60 : 0;
    fee = Math.min(r.hold_amount, s.cancelFee * 100 + waitingPrice(t, waitedGameS));
  }
  ctx.db
    .prepare(`UPDATE rides SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_fee = ?, final_price = ?, bank_op = ? WHERE id = ? AND status = ?`)
    .run(now, by, fee, fee, nothingHeld ? null : fee ? 'capture' : 'void', r.id, r.status);
  return fee;
}

const short = (p: Point) => p.title || 'Точка на карте';

/** Charge or release the hold. Network errors are retried on the next tick; a refusal is final. */
export async function settle(ctx: Ctx, r: RideRow) {
  if (!r.bank_op) return;
  // Cancelled while the bank was waiting for the customer: release the hold if they approved it after all.
  if (!r.hold_id && r.confirmation_id) {
    try {
      const c = await bank<Confirmation>(ctx, 'GET', `/confirmations/${r.confirmation_id}`);
      if (c.status === 'pending') return;
      if (c.status === 'approved' && c.charge) await bank<BankCharge>(ctx, 'POST', `/holds/${c.charge.id}/void`, undefined, `void_${r.id}`);
      ctx.db.prepare(`UPDATE rides SET bank_op = NULL, bank_status = ? WHERE id = ?`).run(c.status === 'approved' ? 'voided' : 'none', r.id);
    } catch {
      // Retried on the next tick.
    }
    return;
  }
  if (!r.hold_id) {
    ctx.db.prepare('UPDATE rides SET bank_op = NULL WHERE id = ?').run(r.id);
    return;
  }
  const from = safeJson<Point>(r.from_json, {} as Point);
  const to = safeJson<Point>(r.to_json, {} as Point);
  try {
    let c: BankCharge;
    if (r.bank_op === 'void' || !r.final_price) {
      c = await bank<BankCharge>(ctx, 'POST', `/holds/${r.hold_id}/void`, undefined, `void_${r.id}`);
    } else {
      const what = r.mode === 'heli' ? 'Вертолёт' : r.mode === 'jet' ? 'Частный джет' : 'Поездка';
      const title = r.status === 'cancelled' ? 'Плата за отмену' : what;
      c = await bank<BankCharge>(ctx, 'POST', `/holds/${r.hold_id}/capture`, { amount: r.final_price, title, subtitle: `${r.mode === 'taxi' ? '' : `${what}: `}${short(from)} → ${short(to)}` }, `capture_${r.id}`);
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
async function guarded(rows: RideRow[], fn: (r: RideRow) => Promise<void>) {
  await Promise.all(
    rows.filter((r) => !busy.has(r.id)).map(async (r) => {
      busy.add(r.id);
      try {
        await fn(r);
      } finally {
        busy.delete(r.id);
      }
    }),
  );
}

/** The customer's answer in the bank app: approved — go on; declined or expired — cancel. */
async function checkConfirmation(ctx: Ctx, r: RideRow) {
  if (!r.confirmation_id) return;
  let c: Confirmation;
  try {
    c = await bank<Confirmation>(ctx, 'GET', `/confirmations/${r.confirmation_id}`);
  } catch {
    return;
  }
  const now = ctx.now();
  if (c.status === 'approved' && c.charge) {
    const next = r.mode === 'taxi' ? 'searching' : 'preparing';
    const s = getSettings(ctx);
    const at = r.mode === 'taxi' ? searchAt(ctx, now, r.time_scale) : prepAt(s, r.mode, now);
    ctx.db.prepare(`UPDATE rides SET status = ?, hold_id = ?, bank_status = 'held', assign_at = ? WHERE id = ? AND status = 'awaiting_payment'`).run(next, c.charge.id, at, r.id);
  } else if (c.status === 'declined' || c.status === 'expired') {
    ctx.db
      .prepare(`UPDATE rides SET status = 'cancelled', cancelled_at = ?, cancelled_by = 'bank', bank_error = ? WHERE id = ? AND status = 'awaiting_payment'`)
      .run(now, c.status === 'declined' ? 'Оплата отклонена в Bobobank' : 'Оплату не подтвердили за 10 минут', r.id);
  }
}

/** How long a bus stands at the stop: the passenger has to get on in time, or wait for the next one. */
export const BUS_DWELL_S = 120;

/** «Я сел» in the bus: the fare is charged like a validator does. */
async function boardBus(ctx: Ctx, r: RideRow) {
  const u = ctx.db.prepare('SELECT mandate_id FROM users WHERE id = ?').get(r.user_id) as { mandate_id: string | null } | undefined;
  const x = safeJson<RideExtra>(r.extra, {}).bus!;
  if (!u?.mandate_id) throw new HttpError(403, 'Привязка к Bobobank отключена — привяжите счёт заново', 'no_mandate');
  const c = await bank<BankCharge>(ctx, 'POST', `/mandates/${u.mandate_id}/charges`, { amount: r.price, external_id: `bus_${r.id}`, title: `${x.kind === 'trolleybus' ? 'Троллейбус' : 'Автобус'} ${x.ref}`, subtitle: `${x.board.name} → ${x.alight.name}` }, `bus_${r.id}`);
  const now = ctx.now();
  const rideMs = busTravelMs(ctx, x.alightAt - x.boardAt);
  ctx.db.prepare(`UPDATE rides SET status = 'on_bus', started_at = ?, finish_at = ?, hold_id = ?, bank_status = 'captured', final_price = price WHERE id = ? AND status = 'bus_arrived'`).run(now, now + rideMs, c.id, r.id);
}

/** The bus left without the passenger: the ride switches to the next bus of the line. */
function nextBus(ctx: Ctx, r: RideRow) {
  const x = safeJson<RideExtra>(r.extra, {});
  const line = x.bus && busRoute(x.bus.route);
  if (!x.bus || !line) return;
  const next = arrivals(ctx, line, x.bus.board.idx, ctx.now() + 1000, 1)[0];
  if (!next) {
    ctx.db.prepare(`UPDATE rides SET status = 'cancelled', cancelled_at = ?, cancelled_by = 'system', bank_error = 'Автобусы на сегодня закончились' WHERE id = ?`).run(ctx.now(), r.id);
    return;
  }
  x.bus.dep = next.dep;
  ctx.db.prepare(`UPDATE rides SET status = 'waiting_bus', arrive_at = ?, arrived_at = NULL, extra = ? WHERE id = ? AND status = 'bus_arrived'`).run(next.at, JSON.stringify(x), r.id);
}

/** «Я сел» / «Я на борту»: the passenger gets in; the ride goes on until they press «Мы приехали». */
export async function boardRide(ctx: Ctx, r: RideRow) {
  if (r.mode === 'taxi') return board(ctx, r);
  if (r.mode === 'bus') {
    if (r.status !== 'bus_arrived') throw new HttpError(409, 'Автобус ещё не подошёл', 'bad_status');
    return boardBus(ctx, r);
  }
  return takeOff(ctx, r);
}

/** «Мы приехали» / «Я вышел» / «Прилетели». */
export function arriveRide(ctx: Ctx, r: RideRow) {
  const now = ctx.now();
  if (r.mode === 'taxi') return complete(ctx, r, 1, now);
  if (r.mode === 'bus') {
    if (r.status !== 'on_bus') throw new HttpError(409, 'Вы ещё не в автобусе', 'bad_status');
    ctx.db.prepare(`UPDATE rides SET status = 'completed', finished_at = ?, progress = 1 WHERE id = ? AND status = 'on_bus'`).run(now, r.id);
    return;
  }
  if (r.status !== 'in_flight') throw new HttpError(409, 'Борт ещё не взлетел', 'bad_status');
  ctx.db.prepare(`UPDATE rides SET status = 'completed', finished_at = ?, final_price = price, progress = 1, bank_op = 'capture' WHERE id = ? AND status = 'in_flight'`).run(now, r.id);
}

export async function tick(ctx: Ctx) {
  const now = ctx.now();
  const s = getSettings(ctx);
  await guarded(ctx.db.prepare(`SELECT * FROM rides WHERE status = 'awaiting_payment' AND confirmation_id IS NOT NULL`).all() as RideRow[], (r) => checkConfirmation(ctx, r));

  // Buses come by the timetable and stand at the stop for two minutes; boarding and getting off are the passenger's buttons.
  ctx.db.prepare(`UPDATE rides SET status = 'bus_arrived', arrived_at = arrive_at WHERE status = 'waiting_bus' AND arrive_at <= ?`).run(now);
  for (const r of ctx.db.prepare(`SELECT * FROM rides WHERE status = 'bus_arrived'`).all() as RideRow[]) {
    if (r.arrived_at! + realMs(BUS_DWELL_S, r.time_scale) <= now) nextBus(ctx, r);
  }

  // Helicopters and jets: the aircraft is ready after the preparation; then «Я на борту» and «Прилетели».
  ctx.db.prepare(`UPDATE rides SET status = 'boarding', arrived_at = assign_at WHERE status = 'preparing' AND mode IN ('heli','jet') AND assign_at <= ?`).run(now);

  const due = ctx.db.prepare(`SELECT * FROM rides WHERE status = 'searching' AND mode = 'taxi' AND assign_at <= ?`).all(now) as RideRow[];
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
  // The car arrives by itself; «Я сел» and «Мы приехали» are the passenger's buttons.
  ctx.db.prepare(`UPDATE rides SET status = 'arrived', arrived_at = arrive_at WHERE status = 'driver_coming' AND arrive_at <= ?`).run(now);

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

/** Everyone is on board: the flight takes the real flight time divided by the air time scale. */
export function takeOff(ctx: Ctx, r: RideRow, at = ctx.now()) {
  if (r.status !== 'boarding') throw new HttpError(409, 'Посадка ещё не началась', 'bad_status');
  const ms = realMs(r.duration_s, r.time_scale);
  ctx.db.prepare(`UPDATE rides SET status = 'in_flight', started_at = ?, finish_at = ? WHERE id = ? AND status = 'boarding'`).run(at, at + ms, r.id);
}

export async function rate(ctx: Ctx, r: RideRow, mandateId: string | null, stars: number, tip: number) {
  if (r.status !== 'completed') throw new HttpError(409, 'Оценить можно после поездки', 'bad_status');
  if (r.rating) throw new HttpError(409, 'Вы уже оценили эту поездку', 'already');
  if (tip > 0 && r.mode === 'bus') throw new HttpError(400, 'В автобусе чаевые не принимают');
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
  } else if (r.status === 'in_ride') {
    // No animation on the way: the passenger presses «Мы приехали».
    car = { pos: [from.lat, from.lon], heading: path.length > 1 ? along(path, 0).heading : 0 };
    etaS = r.finish_at ? Math.max(0, Math.round(((r.finish_at - now) / 1000) * r.time_scale)) : r.duration_s;
  } else if (r.status === 'completed') {
    left = r.progress !== null && r.progress < 1 ? slice(path, 0, r.progress) : path;
  }
  const extra = safeJson<RideExtra>(r.extra, {});
  if (r.mode === 'bus' && extra.bus) {
    const line = busRoute(extra.bus.route);
    const b = extra.bus;
    if (line && r.status === 'waiting_bus' && r.arrive_at) {
      // The bus drives from the first stop of the line; the client moves it between polls.
      const prefix = slice(line.path, 0, b.boardAt / line.length);
      motion = { path: prefix, startAt: b.dep, endAt: r.arrive_at };
      car = along(prefix, (now - b.dep) / (r.arrive_at - b.dep));
      etaS = Math.max(0, Math.round(((r.arrive_at - now) / 1000) * r.time_scale));
    } else if (r.status === 'bus_arrived' || r.status === 'on_bus') {
      car = { pos: [from.lat, from.lon], heading: path.length > 1 ? along(path, 0).heading : 0 };
      etaS = r.status === 'on_bus' && r.finish_at ? Math.max(0, Math.round(((r.finish_at - now) / 1000) * r.time_scale)) : null;
    }
  }
  if ((r.mode === 'heli' || r.mode === 'jet') && r.status !== 'completed') {
    car = { pos: [from.lat, from.lon], heading: path.length > 1 ? along(path, 0).heading : 0 };
    if (r.status === 'in_flight' && r.finish_at) etaS = Math.max(0, Math.round(((r.finish_at - now) / 1000) * r.time_scale));
  }
  const waitedGameS = r.status === 'arrived' && r.arrived_at ? Math.round(((now - r.arrived_at) / 1000) * r.time_scale) : 0;
  const busView = extra.bus && { ...extra.bus, line: busRoute(extra.bus.route) ? { path: busRoute(extra.bus.route)!.path, stops: busRoute(extra.bus.route)!.stops.slice(extra.bus.board.idx, extra.bus.alight.idx + 1) } : null };
  return {
    id: r.id,
    mode: r.mode,
    bus: busView ?? null,
    air: extra.air ?? null,
    line: extra.line ?? null,
    confirmation: r.status === 'awaiting_payment' ? { url: r.confirm_url, expiresAt: r.confirm_expires_at } : null,
    boardingUntil: r.status === 'preparing' ? r.assign_at : null,
    busLeavesAt: r.status === 'bus_arrived' && r.arrived_at ? r.arrived_at + realMs(BUS_DWELL_S, r.time_scale) : null,
    finishAt: r.finish_at,
    status: r.status,
    tariff: { id: r.tariff, title: t?.title ?? extra.air?.className ?? r.tariff, waitPerMin: (t?.waitPerMin ?? 0) * 100, vehicle: t?.vehicle ?? 'car' },
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
    waiting: r.status === 'arrived' ? { waitedS: waitedGameS, freeS: s.freeWaitMin * 60, autoBoardAt: null } : null,
    freeCancelUntil: r.status === 'searching' ? null : r.status === 'driver_coming' && r.assigned_at ? r.assigned_at + FREE_CANCEL_MS : r.status === 'arrived' || r.status === 'boarding' ? now : null,
    cancelFeeNow: r.mode === 'heli' || r.mode === 'jet' ? Math.round(r.price / 10 / 100) * 100 : s.cancelFee * 100,
    timeScale: r.time_scale,
    bank: { status: r.bank_status, pending: !!r.bank_op, error: r.bank_status === 'failed' || r.cancelled_by === 'bank' ? r.bank_error : null },
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
  const extra = safeJson<RideExtra>(r.extra, {});
  return {
    id: r.id,
    mode: r.mode,
    status: r.status,
    tariff: extra.bus
      ? `${extra.bus.kind === 'trolleybus' ? 'Троллейбус' : 'Автобус'} ${extra.bus.ref}`
      : extra.air
        ? extra.air.model
        : extra.line
          ? `Автобус ${extra.line.ref} · по вызову`
          : t?.vehicle === 'bus'
            ? `Автобус · ${t.title}`
            : (t?.title ?? r.tariff),
    colour: extra.bus?.colour ?? (extra.line ? extra.line.colour || '#d0021b' : null),
    tariffId: r.tariff,
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
