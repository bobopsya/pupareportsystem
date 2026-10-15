import { HttpError, type Ctx } from '../context.js';
import { newId } from '../util.js';
import { distance, type LatLon } from './geo.js';
import { getSettings, type AirClass } from './tariffs.js';

/** Helicopter pads around Moscow and the business-aviation terminals of the airports (coordinates from OSM). */
export interface AirPlace {
  code: string;
  title: string;
  subtitle: string;
  lat: number;
  lon: number;
}

export const HELIPADS: AirPlace[] = [
  { code: 'HPM', title: 'Хелипорт «Москва»', subtitle: 'Новорижское шоссе, Павшино', lat: 55.79549, lon: 37.35457 },
  { code: 'VKO3', title: 'Внуково-3', subtitle: 'Вертолётная площадка, Боровское шоссе', lat: 55.59182, lon: 37.23733 },
  { code: 'SVOA', title: 'Шереметьево, терминал A', subtitle: 'Бизнес-авиация, Химки', lat: 55.98275, lon: 37.44211 },
  { code: 'OSF', title: 'Остафьево', subtitle: 'Аэродром, Щербинка', lat: 55.5124, lon: 37.50671 },
  { code: 'POD', title: 'Подушкино', subtitle: 'Рублёво-Успенское направление', lat: 55.71207, lon: 37.27131 },
  { code: 'ZIA', title: 'Жуковский (Раменское)', subtitle: 'Аэродром, Раменский округ', lat: 55.54965, lon: 38.15478 },
  { code: 'GRZ', title: 'Большое Грызлово', subtitle: 'Аэродром, Серпухов', lat: 54.80312, lon: 37.63285 },
];

/** Private jets leave from the two business terminals. */
export const JET_ORIGINS: AirPlace[] = [
  { code: 'SVO', title: 'Шереметьево', subtitle: 'Терминал A, бизнес-авиация', lat: 55.98275, lon: 37.44211 },
  { code: 'VKO', title: 'Внуково-3', subtitle: 'Терминал бизнес-авиации', lat: 55.59952, lon: 37.27357 },
];

export const JET_DESTINATIONS: AirPlace[] = [
  { code: 'LED', title: 'Санкт-Петербург', subtitle: 'Пулково', lat: 59.8003, lon: 30.2625 },
  { code: 'AER', title: 'Сочи', subtitle: 'Адлер', lat: 43.4499, lon: 39.9566 },
  { code: 'KZN', title: 'Казань', subtitle: 'Международный аэропорт', lat: 55.6062, lon: 49.2787 },
  { code: 'KGD', title: 'Калининград', subtitle: 'Храброво', lat: 54.89, lon: 20.5926 },
  { code: 'MRV', title: 'Минеральные Воды', subtitle: 'Кавказские Минеральные Воды', lat: 44.2251, lon: 43.0819 },
  { code: 'UFA', title: 'Уфа', subtitle: 'Международный аэропорт', lat: 54.5575, lon: 55.8744 },
  { code: 'SVX', title: 'Екатеринбург', subtitle: 'Кольцово', lat: 56.7431, lon: 60.8027 },
  { code: 'OVB', title: 'Новосибирск', subtitle: 'Толмачёво', lat: 55.0126, lon: 82.6507 },
  { code: 'VVO', title: 'Владивосток', subtitle: 'Кневичи', lat: 43.399, lon: 132.148 },
  { code: 'MSQ', title: 'Минск', subtitle: 'Национальный аэропорт', lat: 53.8825, lon: 28.0307 },
  { code: 'EVN', title: 'Ереван', subtitle: 'Звартноц', lat: 40.1473, lon: 44.3959 },
  { code: 'TAS', title: 'Ташкент', subtitle: 'Международный аэропорт', lat: 41.2579, lon: 69.2812 },
  { code: 'ALA', title: 'Алматы', subtitle: 'Международный аэропорт', lat: 43.3521, lon: 77.0405 },
  { code: 'IST', title: 'Стамбул', subtitle: 'Новый аэропорт', lat: 41.2753, lon: 28.7519 },
  { code: 'AYT', title: 'Анталья', subtitle: 'Международный аэропорт', lat: 36.8987, lon: 30.8005 },
  { code: 'DXB', title: 'Дубай', subtitle: 'Международный аэропорт', lat: 25.2532, lon: 55.3657 },
  { code: 'AUH', title: 'Абу-Даби', subtitle: 'Международный аэропорт', lat: 24.433, lon: 54.6511 },
  { code: 'MLE', title: 'Мальдивы', subtitle: 'Мале, Велана', lat: 4.1918, lon: 73.529 },
];

export type AirKind = 'heli' | 'jet';

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Points along the great circle: the way a plane actually flies (an arc on the map). */
export function greatCircle(a: LatLon, b: LatLon, n = 64): LatLon[] {
  const [φ1, λ1, φ2, λ2] = [rad(a[0]), rad(a[1]), rad(b[0]), rad(b[1])];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2));
  if (d < 1e-9) return [a, b];
  const out: LatLon[] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    out.push([Math.round(deg(Math.atan2(z, Math.sqrt(x * x + y * y))) * 1e5) / 1e5, Math.round(deg(Math.atan2(y, x)) * 1e5) / 1e5]);
  }
  return out;
}

export function placesFor(kind: AirKind) {
  return kind === 'heli' ? { from: HELIPADS, to: HELIPADS } : { from: JET_ORIGINS, to: JET_DESTINATIONS };
}

const find = (list: AirPlace[], code: string) => list.find((p) => p.code === code);

/** Flight time in hours: cruise plus taxi, climb and landing. */
export function flightHours(kind: AirKind, c: AirClass, km: number) {
  return km / c.speed + (kind === 'heli' ? 10 : 20) / 60;
}

/** Price in kopecks, rounded to 100 ₽: a helicopter bills at least 30 minutes, a jet adds half an hour of repositioning. */
export function airPrice(kind: AirKind, c: AirClass, km: number) {
  const h = flightHours(kind, c, km);
  const billed = kind === 'heli' ? Math.max(0.5, h) : h + 0.5;
  return Math.round((c.rate * billed) / 100) * 100 * 100;
}

export function airQuote(ctx: Ctx, userId: string | null, kind: AirKind, fromCode: string, toCode: string) {
  const places = placesFor(kind);
  const from = find(places.from, fromCode);
  const to = find(places.to, toCode);
  if (!from || !to) throw new HttpError(400, kind === 'heli' ? 'Выберите вертодромы из списка' : 'Выберите аэропорт вылета и город');
  if (from.code === to.code) throw new HttpError(400, 'Откуда и куда — одно и то же место', 'too_close');
  const s = getSettings(ctx);
  const km = distance([from.lat, from.lon], [to.lat, to.lon]) / 1000;
  const classes = kind === 'heli' ? s.helicopters : s.jets;
  const options = classes.map((c) => {
    const ok = km <= c.range;
    return {
      id: c.id,
      title: c.title,
      model: c.model,
      seats: c.seats,
      price: ok ? airPrice(kind, c, km) : 0,
      durationS: Math.round(flightHours(kind, c, km) * 3600),
      available: ok,
      reason: ok ? null : `Не долетит без посадки: дальность ${c.range.toLocaleString('ru-RU')} км`,
    };
  });
  const path = greatCircle([from.lat, from.lon], [to.lat, to.lon], kind === 'heli' ? 24 : 64);
  const id = newId('est', 16);
  const point = (p: AirPlace) => JSON.stringify({ lat: p.lat, lon: p.lon, title: p.title, subtitle: p.subtitle, code: p.code });
  ctx.db
    .prepare('INSERT INTO estimates(id, user_id, from_json, to_json, distance_m, duration_s, route, approx, surge, prices, created_at, mode) VALUES(?,?,?,?,?,?,?,0,1,?,?,?)')
    .run(id, userId, point(from), point(to), Math.round(km * 1000), 0, JSON.stringify(path), JSON.stringify(options), ctx.now(), kind);
  return { id, kind, from, to, distance: Math.round(km * 1000), route: path, options, timeScale: s.airTimeScale };
}

/** Registration marks are made up, in the Russian format. */
export function registration(ctx: Ctx, kind: AirKind) {
  const n = String(10000 + Math.floor(ctx.random() * 89999));
  return kind === 'heli' ? `RA-${n.slice(0, 5)}` : `RA-${n}`;
}
