import type { LatLon } from './types';

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export function distance(a: LatLon, b: LatLon): number {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearing(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Precomputed segment lengths: positions along a route every animation frame without re-measuring. */
export class Track {
  private cum: number[] = [0];
  readonly length: number;
  constructor(readonly path: LatLon[]) {
    for (let i = 1; i < path.length; i++) this.cum.push(this.cum[i - 1] + distance(path[i - 1], path[i]));
    this.length = this.cum[this.cum.length - 1] ?? 0;
  }
  at(fraction: number): { pos: LatLon; heading: number; index: number } {
    const p = this.path;
    if (p.length < 2) return { pos: p[0] ?? [0, 0], heading: 0, index: 0 };
    const target = Math.min(1, Math.max(0, fraction)) * this.length;
    let lo = 1;
    let hi = p.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const seg = this.cum[lo] - this.cum[lo - 1];
    const t = seg ? (target - this.cum[lo - 1]) / seg : 0;
    const a = p[lo - 1];
    const b = p[lo];
    return { pos: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], heading: bearing(a, b), index: lo };
  }
  /** The rest of the route from the fraction onwards. */
  rest(fraction: number): LatLon[] {
    const { pos, index } = this.at(fraction);
    return [pos, ...this.path.slice(index)];
  }
}

export const MOSCOW_CENTER: LatLon = [55.7558, 37.6173];
export const inMoscow = (p: LatLon) => p[0] >= 55.14 && p[0] <= 56.02 && p[1] >= 36.8 && p[1] <= 38.2;
