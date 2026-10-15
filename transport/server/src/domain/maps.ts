import { HttpError, type Ctx } from '../context.js';
import { distance, inMoscow, MOSCOW, offset, bearing, decodePolyline, simplify, type LatLon } from './geo.js';

/**
 * OSRM (routes along real roads) and Nominatim (addresses), called only from the server: with a cache,
 * an identifying User-Agent and at most one Nominatim request per second, as the OSM servers ask.
 */
class Throttle {
  private last = 0;
  private queue = 0;
  constructor(private gapMs: number, private maxQueue: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.queue >= this.maxQueue) throw new HttpError(429, 'Сервис адресов перегружен, попробуйте через пару секунд', 'busy');
    this.queue++;
    try {
      const at = Math.max(Date.now(), this.last + this.gapMs);
      this.last = at;
      if (at > Date.now()) await new Promise((r) => setTimeout(r, at - Date.now()));
      return await fn();
    } finally {
      this.queue--;
    }
  }
}

const nominatim = new Throttle(1100, 8);
const osrm = new Throttle(200, 30);

const DAY = 24 * 3600_000;

function cached<T>(ctx: Ctx, key: string, ttl: number): T | undefined {
  const row = ctx.db.prepare('SELECT value, created_at FROM geo_cache WHERE key = ?').get(key) as { value: string; created_at: number } | undefined;
  return row && ctx.now() - row.created_at < ttl ? (JSON.parse(row.value) as T) : undefined;
}
const store = (ctx: Ctx, key: string, value: unknown) =>
  ctx.db.prepare('INSERT INTO geo_cache(key, value, created_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, created_at = excluded.created_at').run(key, JSON.stringify(value), ctx.now());

export function pruneGeoCache(ctx: Ctx) {
  ctx.db.prepare('DELETE FROM geo_cache WHERE created_at < ?').run(ctx.now() - 30 * DAY);
}

async function getJson<T>(ctx: Ctx, url: string): Promise<T> {
  const res = await ctx.geoHttp(url, { headers: { 'user-agent': ctx.cfg.userAgent, accept: 'application/json', 'accept-language': 'ru' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export interface Route {
  distance: number;
  duration: number;
  path: LatLon[];
  /** OSRM did not answer: a straight-line estimate, so the service keeps working. */
  approx?: boolean;
}

const k5 = (p: LatLon) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;

function straight(a: LatLon, b: LatLon): Route {
  const d = distance(a, b) * 1.35;
  const h = bearing(a, b);
  const steps = Math.max(2, Math.ceil(d / 200));
  const path: LatLon[] = Array.from({ length: steps + 1 }, (_, i) => offset(a, (distance(a, b) * i) / steps, h));
  return { distance: Math.round(d), duration: Math.round(d / (22 / 3.6)), path, approx: true };
}

/** Driving route along Moscow roads. */
export async function route(ctx: Ctx, a: LatLon, b: LatLon): Promise<Route> {
  const key = `route:${k5(a)};${k5(b)}`;
  const hit = cached<Route>(ctx, key, 7 * DAY);
  if (hit) return hit;
  try {
    const url = `${ctx.cfg.osrmUrl}/route/v1/driving/${a[1].toFixed(6)},${a[0].toFixed(6)};${b[1].toFixed(6)},${b[0].toFixed(6)}?overview=full&geometries=polyline6&steps=false&alternatives=false`;
    const data = await osrm.run(() => getJson<{ code: string; routes?: { distance: number; duration: number; geometry: string }[] }>(ctx, url));
    const r = data.routes?.[0];
    if (data.code !== 'Ok' || !r) throw new Error(`OSRM: ${data.code}`);
    const out: Route = { distance: Math.round(r.distance), duration: Math.round(r.duration), path: simplify(decodePolyline(r.geometry, 6)) };
    store(ctx, key, out);
    return out;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return straight(a, b);
  }
}

export interface Place {
  title: string;
  subtitle: string;
  lat: number;
  lon: number;
}

interface NominatimItem {
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  category?: string;
  type?: string;
  address?: Record<string, string>;
}

/** «Тверская улица, 10» + «Тверской район, Москва» instead of the full OSM display name. */
export function formatPlace(it: NominatimItem): Place {
  const a = it.address ?? {};
  const road = a.road ?? a.pedestrian ?? a.footway ?? a.square ?? a.highway;
  const street = road ? (a.house_number ? `${road}, ${a.house_number}` : road) : '';
  const name = it.name && it.name !== a.house_number ? it.name : '';
  const title = name && it.category !== 'building' && it.category !== 'place' ? name : street || name || it.display_name.split(',')[0];
  const district = a.suburb ?? a.city_district ?? a.neighbourhood ?? a.quarter ?? '';
  const city = a.city ?? a.town ?? a.village ?? a.state ?? '';
  const sub = [title === name && street ? street : '', district, city].filter((x) => x && x !== title);
  return { title, subtitle: [...new Set(sub)].join(', '), lat: Number(Number(it.lat).toFixed(6)), lon: Number(Number(it.lon).toFixed(6)) };
}

export async function search(ctx: Ctx, q: string): Promise<Place[]> {
  const query = q.trim().replace(/\s+/g, ' ').slice(0, 120);
  if (query.length < 3) return [];
  const key = `search:${query.toLowerCase()}`;
  const hit = cached<Place[]>(ctx, key, 7 * DAY);
  if (hit) return hit;
  const params = new URLSearchParams({
    q: /москв/i.test(query) ? query : `${query}, Москва`,
    format: 'jsonv2',
    limit: '8',
    addressdetails: '1',
    'accept-language': 'ru',
    countrycodes: 'ru',
    viewbox: `${MOSCOW.west},${MOSCOW.north},${MOSCOW.east},${MOSCOW.south}`,
    bounded: '1',
  });
  let items: NominatimItem[];
  try {
    items = await nominatim.run(() => getJson<NominatimItem[]>(ctx, `${ctx.cfg.nominatimUrl}/search?${params}`));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, 'Поиск адресов сейчас не отвечает. Выберите точку на карте.', 'geo_down');
  }
  const seen = new Set<string>();
  const out = items
    .map(formatPlace)
    .filter((p) => inMoscow([p.lat, p.lon]))
    .filter((p) => {
      const k = `${p.title}|${p.subtitle}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  store(ctx, key, out);
  return out;
}

export async function reverse(ctx: Ctx, p: LatLon): Promise<Place> {
  const key = `rev:${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  const hit = cached<Place>(ctx, key, 30 * DAY);
  if (hit) return { ...hit, lat: p[0], lon: p[1] };
  const params = new URLSearchParams({ lat: p[0].toFixed(6), lon: p[1].toFixed(6), format: 'jsonv2', zoom: '18', addressdetails: '1', 'accept-language': 'ru' });
  try {
    const it = await nominatim.run(() => getJson<NominatimItem & { error?: string }>(ctx, `${ctx.cfg.nominatimUrl}/reverse?${params}`));
    if (it.error) throw new Error(it.error);
    const place = formatPlace(it);
    store(ctx, key, place);
    return { ...place, lat: p[0], lon: p[1] };
  } catch {
    // No address: the point still works for a ride.
    return { title: 'Точка на карте', subtitle: `${p[0].toFixed(5)}, ${p[1].toFixed(5)}`, lat: p[0], lon: p[1] };
  }
}
