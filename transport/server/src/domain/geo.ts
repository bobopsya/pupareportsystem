/** Geometry on a sphere, good enough for a city: distances, points along a route, headings. */
export type LatLon = [number, number];

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function distance(a: LatLon, b: LatLon): number {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Compass heading from a to b, degrees clockwise from north. */
export function bearing(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Point at the given distance (m) and heading from a. */
export function offset(a: LatLon, meters: number, heading: number): LatLon {
  const d = meters / R;
  const h = rad(heading);
  const lat1 = rad(a[0]);
  const lon1 = rad(a[1]);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(h));
  const lon2 = lon1 + Math.atan2(Math.sin(h) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [deg(lat2), deg(lon2)];
}

/** Google encoded polyline (OSRM `polyline6` uses precision 6). */
export function decodePolyline(str: string, precision = 6): LatLon[] {
  const factor = 10 ** precision;
  const out: LatLon[] = [];
  let lat = 0;
  let lon = 0;
  let i = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let shift = 0;
      let result = 0;
      let b: number;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d;
      else lon += d;
    }
    out.push([lat / factor, lon / factor]);
  }
  return out;
}

export const round5 = (p: LatLon): LatLon => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];

/** Drops points closer than `minGap` meters to the previous one: shorter JSON, same shape. */
export function simplify(path: LatLon[], minGap = 4): LatLon[] {
  if (path.length < 3) return path.map(round5);
  const out: LatLon[] = [round5(path[0])];
  for (let i = 1; i < path.length - 1; i++) if (distance(out[out.length - 1], path[i]) >= minGap) out.push(round5(path[i]));
  out.push(round5(path[path.length - 1]));
  return out;
}

export function pathLength(path: LatLon[]): number {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += distance(path[i - 1], path[i]);
  return s;
}

/** Position and heading at a fraction (0..1) of the route length. */
export function along(path: LatLon[], fraction: number): { pos: LatLon; heading: number } {
  if (path.length === 0) return { pos: [0, 0], heading: 0 };
  if (path.length === 1) return { pos: path[0], heading: 0 };
  const f = Math.min(1, Math.max(0, fraction));
  const total = pathLength(path);
  let left = total * f;
  for (let i = 1; i < path.length; i++) {
    const seg = distance(path[i - 1], path[i]);
    if (left <= seg || i === path.length - 1) {
      const t = seg ? Math.min(1, left / seg) : 0;
      const a = path[i - 1];
      const b = path[i];
      return { pos: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], heading: bearing(a, b) };
    }
    left -= seg;
  }
  const n = path.length;
  return { pos: path[n - 1], heading: bearing(path[n - 2], path[n - 1]) };
}

/** The part of a route between two fractions (what is left to drive, a piece for a background car). */
export function slice(path: LatLon[], from: number, to = 1): LatLon[] {
  if (path.length < 2) return path;
  const total = pathLength(path);
  const a = total * Math.max(0, from);
  const b = total * Math.min(1, to);
  const out: LatLon[] = [along(path, from).pos];
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    walked += distance(path[i - 1], path[i]);
    if (walked > a && walked < b) out.push(path[i]);
  }
  out.push(along(path, to).pos);
  return out.map(round5);
}

/** Moscow, including the airports and the near part of New Moscow. */
export const MOSCOW = { south: 55.14, north: 56.02, west: 36.8, east: 38.2 };
export const inMoscow = (p: LatLon) => p[0] >= MOSCOW.south && p[0] <= MOSCOW.north && p[1] >= MOSCOW.west && p[1] <= MOSCOW.east;
