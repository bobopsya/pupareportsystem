import type { RoutePoint } from './types';

const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function pathLengthKm(points: { lat: number; lng: number }[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversine(points[i - 1]!, points[i]!);
  return Math.round(total * 100) / 100;
}

/**
 * Reads coordinates from what people usually paste: "55.7558, 37.6173",
 * a Google Maps link (…/@55.7558,37.6173,15z) or a Yandex Maps link (…?ll=37.6173%2C55.7558 — longitude first).
 */
export function parseLatLng(text: string): { lat: number; lng: number } | null {
  const num = '(-?\\d{1,3}(?:\\.\\d+)?)';
  let lat: number;
  let lng: number;
  const google = new RegExp(`@${num},${num}`).exec(text);
  const yandex = new RegExp(`[?&]ll=${num}(?:,|%2C)${num}`, 'i').exec(text);
  const plain = new RegExp(`${num}\\s*[,; ]\\s*${num}`).exec(text);
  if (google) [lat, lng] = [Number(google[1]), Number(google[2])];
  else if (yandex) [lng, lat] = [Number(yandex[1]), Number(yandex[2])];
  else if (plain) [lat, lng] = [Number(plain[1]), Number(plain[2])];
  else return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** A GPX track the user can import into a navigator (OsmAnd, Garmin, …). */
export function routeToGpx(name: string, points: RoutePoint[]): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const wpts = points
    .map((p, i) => `  <wpt lat="${p.lat}" lon="${p.lng}"><name>${esc(p.label || `Точка ${i + 1}`)}</name>${p.note ? `<desc>${esc(p.note)}</desc>` : ''}</wpt>`)
    .join('\n');
  const trkpts = points.map((p) => `      <trkpt lat="${p.lat}" lon="${p.lng}"></trkpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="ZhukoNet" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name></metadata>
${wpts}
  <trk><name>${esc(name)}</name><trkseg>
${trkpts}
  </trkseg></trk>
</gpx>
`;
}
