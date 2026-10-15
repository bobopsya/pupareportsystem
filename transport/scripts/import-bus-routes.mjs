#!/usr/bin/env node
// Imports real Moscow bus and trolleybus routes (stops and geometry) from OpenStreetMap through the OSM API.
//
//   node transport/scripts/import-bus-routes.mjs [out.json] [maxRoutes]
//
// The OSM API is not a bulk service: the script makes ~1 request per second with its own User-Agent.
// Data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] ?? path.join(here, '..', 'server', 'data', 'bus-routes.json');
const MAX = Number(process.argv[3] ?? 260);
const API = process.env.OSM_API ?? 'https://api.openstreetmap.org/api/0.6';
const UA = process.env.OSM_USER_AGENT ?? 'BoboTransport-import/1.0 (game taxi; routes import)';
const MOSCOW = { south: 55.14, north: 56.02, west: 36.8, east: 38.2 };

// Hubs across the city: a small box around each finds the routes passing through it.
const HUBS = [
  [55.7566, 37.6315], [55.765, 37.605], [55.752, 37.593], [55.735, 37.593], [55.729, 37.611], [55.73, 37.638], [55.742, 37.653],
  [55.758, 37.659], [55.776, 37.655], [55.793, 37.636], [55.777, 37.582], [55.744, 37.566], [55.805, 37.515], [55.82, 37.641],
  [55.789, 37.68], [55.783, 37.719], [55.758, 37.752], [55.716, 37.817], [55.705, 37.765], [55.731, 37.667], [55.709, 37.622],
  [55.707, 37.585], [55.678, 37.563], [55.663, 37.483], [55.731, 37.446], [55.804, 37.403], [55.827, 37.437], [55.855, 37.476],
  [55.837, 37.576], [55.888, 37.661], [55.87, 37.664], [55.81, 37.799], [55.752, 37.817], [55.65, 37.744], [55.655, 37.649],
  [55.621, 37.67], [55.619, 37.506], [55.643, 37.526], [55.64, 37.606], [55.606, 37.533], [55.716, 37.554], [55.749, 37.539],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function get(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = last + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(60_000) });
      if (res.status === 509 || res.status === 429) {
        await sleep(10_000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(3000 * (attempt + 1));
    }
  }
}

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
function dist(a, b) {
  const h = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const r5 = (p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];

function simplify(pts, gap = 12) {
  if (pts.length < 3) return pts.map(r5);
  const out = [r5(pts[0])];
  for (let i = 1; i < pts.length - 1; i++) if (dist(out[out.length - 1], pts[i]) >= gap) out.push(r5(pts[i]));
  out.push(r5(pts[pts.length - 1]));
  return out;
}

/** Ways of the route joined end to end; each way is flipped when its far end touches the previous one. */
function stitch(ways) {
  const out = [];
  let gap = 0;
  for (let i = 0; i < ways.length; i++) {
    let w = ways[i];
    if (w.length < 2) continue;
    if (!out.length) {
      const next = ways[i + 1];
      // Orient the first way by the second one.
      if (next && next.length && (dist(w[0], next[0]) < 1 || dist(w[0], next[next.length - 1]) < 1)) w = [...w].reverse();
      out.push(...w);
      continue;
    }
    const end = out[out.length - 1];
    if (dist(end, w[w.length - 1]) < dist(end, w[0])) w = [...w].reverse();
    gap = Math.max(gap, dist(end, w[0]));
    out.push(...(dist(end, w[0]) < 1 ? w.slice(1) : w));
  }
  return { pts: out, gap };
}

/** Distance along the path of the nearest point to p (projection on segments). */
function locate(pathPts, cum, p, fromIndex) {
  let best = { d: Infinity, at: 0, i: fromIndex };
  const kx = Math.cos(rad(p[0]));
  for (let i = Math.max(1, fromIndex); i < pathPts.length; i++) {
    const a = pathPts[i - 1];
    const b = pathPts[i];
    const ax = (a[1] - p[1]) * kx;
    const ay = a[0] - p[0];
    const bx = (b[1] - p[1]) * kx;
    const by = b[0] - p[0];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
    const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const d = dist(q, p);
    if (d < best.d) best = { d, at: cum[i - 1] + dist(a, q), i };
  }
  return best;
}

function fare(tags) {
  const m = String(tags['charge:cards'] ?? tags['charge:troika'] ?? tags.charge ?? '').match(/(\d+)/);
  return m ? Number(m[1]) * 100 : 8300;
}

let reason = '';
const skip = (why) => ((reason = why), null);

function buildRoute(rel, els) {
  const node = (id) => els.get(`node/${id}`);
  const way = (id) => els.get(`way/${id}`);
  const tags = rel.tags ?? {};
  const members = rel.members ?? [];
  // Stops: stop positions; the name may sit on the paired platform.
  const stops = [];
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    if (m.type !== 'node' || !m.role.startsWith('stop')) continue;
    const n = node(m.ref);
    if (!n) continue;
    let name = n.tags?.name;
    if (!name) {
      const pf = members.slice(i + 1, i + 3).find((x) => x.role.startsWith('platform'));
      const pn = pf && (pf.type === 'node' ? node(pf.ref) : way(pf.ref));
      name = pn?.tags?.name;
    }
    if (!name) continue;
    const p = [n.lat, n.lon];
    if (stops.length && (stops[stops.length - 1].name === name || dist(stops[stops.length - 1].p, p) < 40)) continue;
    stops.push({ name, p });
  }
  const ways = members
    .filter((m) => m.type === 'way' && (m.role === '' || m.role === 'forward' || m.role === 'backward'))
    .map((m) => way(m.ref))
    .filter(Boolean)
    .map((w) => w.nodes.map((id) => node(id)).filter(Boolean).map((n) => [n.lat, n.lon]));
  const { pts: raw, gap } = stitch(ways);
  if (gap > 50) return skip(`разрыв линии ${Math.round(gap)} м`);
  if (stops.length < 5 || raw.length < 10) return skip(`мало данных: ${stops.length} остановок, ${raw.length} точек`);
  const pts = simplify(raw);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  let from = 0;
  const placed = [];
  for (const s of stops) {
    const loc = locate(pts, cum, s.p, from);
    if (loc.d > 60) return skip(`остановка «${s.name}» в ${Math.round(loc.d)} м от линии`);
    if (placed.length && loc.at <= placed[placed.length - 1].at) return skip(`остановка «${s.name}» не по порядку`);
    from = loc.i;
    placed.push({ name: s.name, lat: r5(s.p)[0], lon: r5(s.p)[1], at: Math.round(loc.at) });
  }
  const inside = placed.filter((s) => s.lat >= MOSCOW.south && s.lat <= MOSCOW.north && s.lon >= MOSCOW.west && s.lon <= MOSCOW.east).length;
  if (inside < placed.length * 0.8) return skip('за пределами Москвы');
  const ref = String(tags.ref ?? '').trim();
  if (!ref) return skip('без номера');
  return {
    id: rel.id,
    kind: tags.route === 'trolleybus' ? 'trolleybus' : 'bus',
    ref,
    name: tags.name ?? `${ref}: ${tags.from ?? ''} → ${tags.to ?? ''}`,
    from: tags.from ?? placed[0].name,
    to: tags.to ?? placed[placed.length - 1].name,
    colour: /^#[0-9a-f]{6}$/i.test(tags.colour ?? '') ? tags.colour : null,
    fare: fare(tags),
    night: /^н\d/i.test(ref),
    electric: tags.electric_bus === 'yes' || tags.route === 'trolleybus',
    length: Math.round(cum[cum.length - 1]),
    path: pts,
    stops: placed,
  };
}

const ids = new Map();
for (const [i, [lat, lon]] of HUBS.entries()) {
  const bbox = [lon - 0.004, lat - 0.0025, lon + 0.004, lat + 0.0025].map((x) => x.toFixed(5)).join(',');
  try {
    const d = await get(`${API}/map.json?bbox=${bbox}`);
    let n = 0;
    for (const e of d.elements) {
      if (e.type === 'relation' && (e.tags?.route === 'bus' || e.tags?.route === 'trolleybus') && e.tags?.['public_transport:version'] === '2') {
        ids.set(e.id, (ids.get(e.id) ?? 0) + 1);
        n++;
      }
    }
    console.log(`hub ${i + 1}/${HUBS.length}: ${n} routes, ${ids.size} total`);
  } catch (e) {
    console.warn(`hub ${i + 1}: ${e.message}`);
  }
}

// Routes seen at more hubs first: they cross the city and are the most useful.
const order = [...ids].sort((a, b) => b[1] - a[1]).map(([id]) => id);
const routes = [];
for (const id of order) {
  if (routes.length >= MAX) break;
  try {
    const d = await get(`${API}/relation/${id}/full.json`);
    const els = new Map(d.elements.map((e) => [`${e.type}/${e.id}`, e]));
    const r = buildRoute(els.get(`relation/${id}`), els);
    if (r) routes.push(r);
    console.log(`${routes.length}/${MAX}  ${id} ${r ? `${r.ref}: ${r.stops.length} остановок, ${(r.length / 1000).toFixed(1)} км` : `пропущен: ${reason}`}`);
  } catch (e) {
    console.warn(`${id}: ${e.message}`);
  }
}

routes.sort((a, b) => a.ref.localeCompare(b.ref, 'ru', { numeric: true }) || a.id - b.id);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ source: 'OpenStreetMap contributors, ODbL 1.0', generatedAt: new Date().toISOString(), routes }));
console.log(`Сохранено ${routes.length} направлений в ${OUT}`);
