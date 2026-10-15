import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError, type Ctx } from '../context.js';
import { newId } from '../util.js';
import { along, distance, slice, type LatLon } from './geo.js';
import { getSettings } from './tariffs.js';

/**
 * Real Moscow bus and trolleybus routes from OpenStreetMap (transport/scripts/import-bus-routes.mjs).
 * The timetable is computed, not stored: buses leave the first stop every few minutes and drive at a city
 * speed, so every bus is somewhere on its line at any moment.
 */
export interface BusStop {
  name: string;
  lat: number;
  lon: number;
  /** Meters from the start of the route. */
  at: number;
}

export interface BusRoute {
  id: number;
  kind: 'bus' | 'trolleybus';
  ref: string;
  name: string;
  from: string;
  to: string;
  colour: string | null;
  fare: number;
  night: boolean;
  /** Runs every 8 minutes around the clock (test fixtures). */
  allDay?: boolean;
  electric: boolean;
  length: number;
  path: LatLon[];
  stops: BusStop[];
}

export interface StopPlace {
  id: string;
  name: string;
  lat: number;
  lon: number;
  lines: { route: number; stop: number }[];
}

/** Game speeds: a city bus ~18 km/h with stops, a pedestrian ~4.7 km/h. */
const BUS_MS = 5;
const WALK_MS = 1.3;
export const MAX_WALK_M = 800;

const here = path.dirname(fileURLToPath(import.meta.url));
let routes: BusRoute[] = [];
let places: StopPlace[] = [];
let loaded = false;

function index() {
  places = [];
  const byName = new Map<string, StopPlace[]>();
  routes.forEach((r, ri) =>
    r.stops.forEach((s, si) => {
      const same = byName.get(s.name) ?? [];
      let p = same.find((x) => distance([x.lat, x.lon], [s.lat, s.lon]) < 200);
      if (!p) {
        p = { id: `st${places.length + 1}`, name: s.name, lat: s.lat, lon: s.lon, lines: [] };
        places.push(p);
        same.push(p);
        byName.set(s.name, same);
      }
      p.lines.push({ route: ri, stop: si });
    }),
  );
}

/** Routes from BUS_ROUTES_FILE, or the file shipped with the server. */
export function busRoutes(): BusRoute[] {
  if (!loaded) {
    loaded = true;
    const file = process.env.BUS_ROUTES_FILE || path.join(here, '..', '..', 'data', 'bus-routes.json');
    try {
      routes = (JSON.parse(fs.readFileSync(file, 'utf8')) as { routes: BusRoute[] }).routes ?? [];
    } catch {
      routes = [];
    }
    index();
  }
  return routes;
}

/** Tests and the importer swap the network. */
export function setBusRoutes(list: BusRoute[]) {
  routes = list;
  loaded = true;
  index();
}

export const busRoute = (id: number) => busRoutes().find((r) => r.id === id);

const moscow = (ts: number) => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(ts);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return { h: Number(get('hour')) % 24 + Number(get('minute')) / 60, wd: get('weekday') };
};

/** Game minutes between buses now, or null when the line does not run (night lines run only at night). */
export function headwayMin(r: BusRoute, ts: number): number | null {
  if (r.allDay) return 8;
  const { h, wd } = moscow(ts);
  const night = h < 5.5 || h >= 24;
  if (r.night) return h < 6 ? 20 : null;
  if (night && h >= 1) return null;
  const weekend = wd === 'Sat' || wd === 'Sun';
  if (!weekend && ((h >= 7 && h < 10) || (h >= 17 && h < 20))) return 6;
  if (h >= 10 && h < 17) return 8;
  if (h >= 20 && h < 23) return 12;
  return 15;
}

/** Real milliseconds: the timetable runs at the game time scale like the taxis. */
function clock(ctx: Ctx, r: BusRoute, ts: number) {
  const scale = getSettings(ctx).timeScale;
  const hw = headwayMin(r, ts);
  if (hw === null) return null;
  const H = (hw * 60_000) / scale;
  return { H, offset: ((r.id % 97) / 97) * H, speed: (BUS_MS * scale) / 1000 /* m per real ms */ };
}

/** Next buses reaching the stop not earlier than `after`: when each left the first stop and when it arrives here. */
export function arrivals(ctx: Ctx, r: BusRoute, stopIdx: number, after: number, count = 2) {
  const c = clock(ctx, r, after);
  if (!c) return [];
  const travel = r.stops[stopIdx].at / c.speed;
  const k0 = Math.ceil((after - travel - c.offset) / c.H);
  return Array.from({ length: count }, (_, i) => {
    const dep = (k0 + i) * c.H + c.offset;
    return { dep, at: Math.round(dep + travel) };
  });
}

/** Buses on the line right now. */
export function vehicles(ctx: Ctx, r: BusRoute, now: number) {
  const c = clock(ctx, r, now);
  if (!c) return [];
  const trip = r.length / c.speed;
  const out: { dep: number; pos: LatLon; heading: number; fraction: number }[] = [];
  for (let k = Math.ceil((now - trip - c.offset) / c.H); k * c.H + c.offset <= now; k++) {
    const dep = k * c.H + c.offset;
    const f = (now - dep) / trip;
    if (f < 0 || f > 1) continue;
    const p = along(r.path, f);
    out.push({ dep, pos: p.pos, heading: p.heading, fraction: f });
  }
  return out;
}

export interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}
const inBox = (b: Bbox, lat: number, lon: number) => lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;

export function stopsIn(b: Bbox, limit = 400) {
  busRoutes();
  return places.filter((p) => inBox(b, p.lat, p.lon)).slice(0, limit).map((p) => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon, refs: [...new Set(p.lines.map((l) => routes[l.route].ref))] }));
}

/** Live buses in the map frame (optionally of one route). */
export function liveIn(ctx: Ctx, b: Bbox, now: number, routeId?: number, limit = 150) {
  const out: { id: string; route: number; ref: string; colour: string | null; kind: string; lat: number; lon: number; heading: number; to: string }[] = [];
  for (const r of busRoutes()) {
    if (routeId && r.id !== routeId) continue;
    for (const v of vehicles(ctx, r, now)) {
      if (!inBox(b, v.pos[0], v.pos[1])) continue;
      out.push({ id: `${r.id}:${Math.round(v.dep)}`, route: r.id, ref: r.ref, colour: r.colour, kind: r.kind, lat: v.pos[0], lon: v.pos[1], heading: Math.round(v.heading), to: r.to });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Departure board of a stop: each line with the next two buses. */
export function board(ctx: Ctx, placeId: string, now: number) {
  busRoutes();
  const p = places.find((x) => x.id === placeId);
  if (!p) throw new HttpError(404, 'Остановка не найдена');
  const scale = getSettings(ctx).timeScale;
  const lines = p.lines
    .filter((l) => l.stop < routes[l.route].stops.length - 1)
    .map((l) => {
      const r = routes[l.route];
      const next = arrivals(ctx, r, l.stop, now);
      return { route: r.id, ref: r.ref, kind: r.kind, colour: r.colour, to: r.to, night: r.night, minutes: next.map((a) => Math.max(0, Math.round(((a.at - now) / 60_000) * scale))) };
    })
    .sort((a, b) => (a.minutes[0] ?? 999) - (b.minutes[0] ?? 999));
  return { id: p.id, name: p.name, lat: p.lat, lon: p.lon, lines };
}

export interface BusOption {
  n: number;
  route: number;
  ref: string;
  kind: string;
  colour: string | null;
  to: string;
  fare: number;
  board: { idx: number; name: string; lat: number; lon: number; walkM: number };
  alight: { idx: number; name: string; lat: number; lon: number; walkM: number };
  stops: number;
  /** Game seconds. */
  walkS: number;
  waitS: number;
  rideS: number;
  totalS: number;
  distance: number;
  path: LatLon[];
}

/** Direct buses between two points: the nearest stops within walking distance, the soonest bus. */
export function plan(ctx: Ctx, userId: string | null, from: LatLon, to: LatLon, now: number) {
  if (distance(from, to) < 400) throw new HttpError(400, 'Тут ближе дойти пешком', 'too_close');
  const scale = getSettings(ctx).timeScale;
  const options: BusOption[] = [];
  for (const r of busRoutes()) {
    let bi = -1;
    let bw = Infinity;
    r.stops.forEach((s, i) => {
      const d = distance(from, [s.lat, s.lon]);
      if (d < bw && i < r.stops.length - 1) [bi, bw] = [i, d];
    });
    if (bi < 0 || bw > MAX_WALK_M) continue;
    let ai = -1;
    let aw = Infinity;
    for (let i = bi + 1; i < r.stops.length; i++) {
      const d = distance(to, [r.stops[i].lat, r.stops[i].lon]);
      if (d < aw) [ai, aw] = [i, d];
    }
    if (ai < 0 || aw > MAX_WALK_M) continue;
    const walkS = bw / WALK_MS;
    const next = arrivals(ctx, r, bi, now + (walkS * 1000) / scale, 1)[0];
    if (!next) continue;
    const waitS = ((next.at - now) / 1000) * scale;
    const dist = r.stops[ai].at - r.stops[bi].at;
    const rideS = dist / BUS_MS;
    const s = (i: number, walkM: number) => ({ idx: i, name: r.stops[i].name, lat: r.stops[i].lat, lon: r.stops[i].lon, walkM: Math.round(walkM) });
    options.push({
      n: 0,
      route: r.id,
      ref: r.ref,
      kind: r.kind,
      colour: r.colour,
      to: r.to,
      fare: r.fare,
      board: s(bi, bw),
      alight: s(ai, aw),
      stops: ai - bi,
      walkS: Math.round(walkS),
      waitS: Math.round(waitS),
      rideS: Math.round(rideS),
      totalS: Math.round(waitS + rideS + aw / WALK_MS),
      distance: Math.round(dist),
      path: slice(r.path, r.stops[bi].at / r.length, r.stops[ai].at / r.length),
    });
  }
  // The best variant of each line number, fastest first.
  const best = new Map<string, BusOption>();
  for (const o of options.sort((a, b) => a.totalS - b.totalS)) if (!best.has(o.ref)) best.set(o.ref, o);
  const top = [...best.values()].slice(0, 4).map((o, n) => ({ ...o, n }));
  const id = newId('est', 16);
  ctx.db
    .prepare(`INSERT INTO estimates(id, user_id, from_json, to_json, distance_m, duration_s, route, approx, surge, prices, created_at, mode) VALUES(?,?,?,?,0,0,'[]',0,1,?,?,'bus')`)
    .run(id, userId, JSON.stringify({ lat: from[0], lon: from[1] }), JSON.stringify({ lat: to[0], lon: to[1] }), JSON.stringify(top), now);
  return { id, options: top, timeScale: scale };
}

/** Geometry and stops of a line, for drawing it. */
export function routeView(id: number) {
  const r = busRoute(id);
  if (!r) throw new HttpError(404, 'Маршрут не найден');
  return { id: r.id, ref: r.ref, kind: r.kind, name: r.name, from: r.from, to: r.to, colour: r.colour, fare: r.fare, electric: r.electric, path: r.path, stops: r.stops };
}

/** Real ms the bus needs between two points of the line. */
export const busTravelMs = (ctx: Ctx, meters: number) => (meters / BUS_MS / getSettings(ctx).timeScale) * 1000;
