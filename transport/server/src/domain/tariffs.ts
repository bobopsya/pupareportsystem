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
  { id: 'econom', title: 'Эконом', base: 99, perKm: 12, perMin: 7, min: 199, waitPerMin: 9, seats: 4, cars: ['Kia Rio', 'Hyundai Solaris', 'Lada Vesta', 'Volkswagen Polo'], etaMin: [2, 6] },
  { id: 'comfort', title: 'Комфорт', base: 149, perKm: 16, perMin: 9, min: 299, waitPerMin: 12, seats: 4, cars: ['Skoda Octavia', 'Kia K5', 'Hyundai Elantra', 'Toyota Camry'], etaMin: [3, 7] },
  { id: 'comfort_plus', title: 'Комфорт+', base: 199, perKm: 20, perMin: 11, min: 399, waitPerMin: 15, seats: 4, cars: ['Toyota Camry', 'Kia K5 GT', 'Hyundai Sonata', 'Skoda Superb'], etaMin: [4, 8] },
  { id: 'business', title: 'Бизнес', base: 399, perKm: 32, perMin: 18, min: 899, waitPerMin: 25, seats: 4, cars: ['Mercedes-Benz E-класс', 'BMW 5 серии', 'Audi A6'], etaMin: [5, 10] },
  { id: 'kids', title: 'Детский', base: 249, perKm: 16, perMin: 9, min: 399, waitPerMin: 12, seats: 3, cars: ['Skoda Octavia', 'Kia K5', 'Volkswagen Tiguan'], etaMin: [4, 9] },
];

export interface Settings {
  /** How much faster than real time cars drive (a 25-minute ride takes ~4 minutes at ×6). */
  timeScale: number;
  /** 'auto' — rush hours and random demand; 'fixed' — always `surgeFixed`. */
  surgeMode: 'auto' | 'fixed';
  surgeFixed: number;
  /** Free waiting after the car arrives, game minutes. */
  freeWaitMin: number;
  /** The passenger gets in on their own after this many real seconds. */
  autoBoardS: number;
  cancelFee: number;
  childSeat: number;
  tariffs: Tariff[];
}

export const DEFAULT_SETTINGS: Settings = { timeScale: 6, surgeMode: 'auto', surgeFixed: 1, freeWaitMin: 3, autoBoardS: 45, cancelFee: 99, childSeat: 100, tariffs: DEFAULT_TARIFFS };

export function getSettings(ctx: Ctx): Settings {
  const s = getSetting<Partial<Settings>>(ctx.db, 'settings', {});
  return { ...DEFAULT_SETTINGS, ...s, tariffs: s.tariffs?.length ? s.tariffs : DEFAULT_TARIFFS };
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
