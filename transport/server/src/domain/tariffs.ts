import type { Ctx } from '../context.js';
import { getSetting, setSetting } from '../db.js';

export type TariffId = 'econom' | 'comfort' | 'comfort_plus' | 'business' | 'kids';

export interface Tariff {
  id: TariffId;
  title: string;
  /** Rubles. */
  base: number;
  perKm: number;
  perMin: number;
  min: number;
  /** Per minute of paid waiting after the free minutes. */
  waitPerMin: number;
  seats: number;
  cars: string[];
  /** Base ETA for a car: cheaper classes come faster. */
  etaMin: [number, number];
}

const DEFAULT_TARIFFS: Tariff[] = [
  { id: 'econom', title: 'Эконом', base: 199, perKm: 24, perMin: 14, min: 399, waitPerMin: 18, seats: 4, cars: ['Kia Rio', 'Hyundai Solaris', 'Lada Vesta', 'Volkswagen Polo'], etaMin: [2, 6] },
  { id: 'comfort', title: 'Комфорт', base: 299, perKm: 32, perMin: 18, min: 599, waitPerMin: 24, seats: 4, cars: ['Skoda Octavia', 'Kia K5', 'Hyundai Elantra', 'Toyota Camry'], etaMin: [3, 7] },
  { id: 'comfort_plus', title: 'Комфорт+', base: 399, perKm: 40, perMin: 22, min: 799, waitPerMin: 30, seats: 4, cars: ['Toyota Camry', 'Kia K5 GT', 'Hyundai Sonata', 'Skoda Superb'], etaMin: [4, 8] },
  { id: 'business', title: 'Бизнес', base: 799, perKm: 64, perMin: 36, min: 1799, waitPerMin: 50, seats: 4, cars: ['Mercedes-Benz E-класс', 'BMW 5 серии', 'Audi A6'], etaMin: [5, 10] },
  { id: 'kids', title: 'Детский', base: 499, perKm: 32, perMin: 18, min: 799, waitPerMin: 24, seats: 3, cars: ['Skoda Octavia', 'Kia K5', 'Volkswagen Tiguan'], etaMin: [4, 9] },
];

/** A helicopter or a business jet class: rate per flight hour, cruise speed and range. */
export interface AirClass {
  id: string;
  title: string;
  model: string;
  seats: number;
  /** Rubles per flight hour. */
  rate: number;
  speed: number;
  range: number;
}

export const DEFAULT_HELICOPTERS: AirClass[] = [
  { id: 'r44', title: 'Лёгкий', model: 'Robinson R44', seats: 3, rate: 75_000, speed: 190, range: 550 },
  { id: 'bell407', title: 'Комфорт', model: 'Bell 407', seats: 6, rate: 180_000, speed: 230, range: 600 },
  { id: 'h145', title: 'Бизнес', model: 'Airbus H145', seats: 8, rate: 290_000, speed: 240, range: 650 },
];

export const DEFAULT_JETS: AirClass[] = [
  { id: 'light', title: 'Light', model: 'Cessna Citation CJ3', seats: 6, rate: 350_000, speed: 700, range: 3000 },
  { id: 'midsize', title: 'Midsize', model: 'Cessna Citation XLS', seats: 8, rate: 480_000, speed: 780, range: 3500 },
  { id: 'supermid', title: 'Super-mid', model: 'Bombardier Challenger 350', seats: 9, rate: 650_000, speed: 830, range: 5900 },
  { id: 'heavy', title: 'Heavy', model: 'Gulfstream G650', seats: 13, rate: 1_100_000, speed: 900, range: 12_900 },
];

export interface Settings {
  /** How much faster than real time taxis and buses go: 1 = real time (TIME_SCALE). */
  timeScale: number;
  /** 'auto' — rush hours and random demand; 'fixed' — always `surgeFixed`. */
  surgeMode: 'auto' | 'fixed';
  surgeFixed: number;
  /** Free waiting after the car arrives, game minutes. */
  freeWaitMin: number;
  /** The passenger gets in on their own after this many minutes of waiting. */
  autoBoardMin: number;
  cancelFee: number;
  childSeat: number;
  tariffs: Tariff[];
  /** Time scale of flights: 1 = real time (AIR_TIME_SCALE). */
  airTimeScale: number;
  /** Pre-flight preparation of the aircraft, minutes. */
  heliPrepMin: number;
  jetPrepMin: number;
  /** How long the crew waits at boarding before take-off, minutes. */
  airBoardMin: number;
  helicopters: AirClass[];
  jets: AirClass[];
}

export const DEFAULT_SETTINGS: Settings = {
  timeScale: 1,
  surgeMode: 'auto',
  surgeFixed: 1,
  freeWaitMin: 3,
  autoBoardMin: 5,
  cancelFee: 199,
  childSeat: 200,
  tariffs: DEFAULT_TARIFFS,
  airTimeScale: 1,
  heliPrepMin: 15,
  jetPrepMin: 30,
  airBoardMin: 10,
  helicopters: DEFAULT_HELICOPTERS,
  jets: DEFAULT_JETS,
};

export function getSettings(ctx: Ctx): Settings {
  const s = getSetting<Partial<Settings>>(ctx.db, 'settings', {});
  return {
    ...DEFAULT_SETTINGS,
    timeScale: ctx.cfg.timeScale,
    airTimeScale: ctx.cfg.airTimeScale,
    ...s,
    tariffs: s.tariffs?.length ? s.tariffs : DEFAULT_TARIFFS,
    helicopters: s.helicopters?.length ? s.helicopters : DEFAULT_HELICOPTERS,
    jets: s.jets?.length ? s.jets : DEFAULT_JETS,
  };
}

export function saveSettings(ctx: Ctx, patch: Partial<Settings>) {
  setSetting(ctx.db, 'settings', { ...getSettings(ctx), ...patch });
}

export const tariffOf = (ctx: Ctx, id: string) => getSettings(ctx).tariffs.find((t) => t.id === id);

const moscowHour = (ts: number) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false }).format(ts)) % 24;
const moscowWeekday = (ts: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', weekday: 'short' }).format(ts);

/** Surge ×1.0–×1.8: weekday rush hours, Friday and Saturday nights, plus a little random demand that changes every 5 minutes. */
export function surgeAt(ctx: Ctx, ts = ctx.now()): number {
  const s = getSettings(ctx);
  if (s.surgeMode === 'fixed') return Math.min(3, Math.max(1, s.surgeFixed));
  const h = moscowHour(ts);
  const wd = moscowWeekday(ts);
  const weekend = wd === 'Sat' || wd === 'Sun';
  let k = 1;
  if (!weekend && ((h >= 7 && h < 10) || (h >= 17 && h < 20))) k = 1.35;
  if ((wd === 'Fri' || wd === 'Sat') && (h >= 22 || h < 2)) k = 1.3;
  if (h >= 2 && h < 6) k = 1.1;
  // Pseudo-random demand, the same for everyone within a 5-minute window.
  const slot = Math.floor(ts / 300_000);
  const noise = ((Math.sin(slot * 12.9898) * 43758.5453) % 1 + 1) % 1;
  k += noise * 0.3 - 0.05;
  return Math.round(Math.min(1.8, Math.max(1, k)) * 10) / 10;
}

/** Price in kopecks, rounded to whole rubles. */
export function priceOf(t: Tariff, distanceM: number, durationS: number, surge: number, childSeat = 0): number {
  const rub = (t.base + (t.perKm * distanceM) / 1000 + (t.perMin * durationS) / 60) * surge;
  return (Math.max(t.min, Math.round(rub)) + childSeat) * 100;
}

/** Paid waiting in kopecks: whole game minutes after the free ones. */
export function waitingPrice(t: Tariff, paidS: number): number {
  return Math.ceil(Math.max(0, paidS) / 60) * t.waitPerMin * 100;
}
