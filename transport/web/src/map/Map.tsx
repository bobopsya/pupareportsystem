import { useQuery } from '@tanstack/react-query';
import L from 'leaflet';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { Track } from '../lib/geo';
import type { LatLon } from '../lib/types';

const MapCtx = createContext<L.Map | null>(null);
export const useLeaflet = () => useContext(MapCtx);

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

/** Full-size OpenStreetMap. Children add layers through the map context. */
export function MapView({ center, zoom = 16, onMoveStart, onMoveEnd, children, className }: { center: LatLon; zoom?: number; onMoveStart?: () => void; onMoveEnd?: (c: LatLon, byUser: boolean) => void; children?: ReactNode; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const handlers = useRef({ onMoveStart, onMoveEnd });
  handlers.current = { onMoveStart, onMoveEnd };

  useEffect(() => {
    const m = L.map(el.current!, { zoomControl: false, attributionControl: true, center, zoom, minZoom: 3, maxZoom: 19, zoomSnap: 0.25, inertia: true, worldCopyJump: false });
    m.attributionControl.setPrefix(false);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION, crossOrigin: false }).addTo(m);
    let byUser = false;
    m.on('movestart', () => handlers.current.onMoveStart?.());
    m.on('dragstart', () => (byUser = true));
    m.on('moveend', () => {
      const c = m.getCenter();
      handlers.current.onMoveEnd?.([c.lat, c.lng], byUser);
      byUser = false;
    });
    // Keep the map sized to its box (the bottom sheet changes height).
    const ro = new ResizeObserver(() => m.invalidateSize({ pan: false }));
    ro.observe(el.current!);
    setMap(m);
    return () => {
      ro.disconnect();
      m.remove();
    };
    // The map is created once; later centre changes go through flyTo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={className ?? 'absolute inset-0'}>
      <div ref={el} className="absolute inset-0 z-0" />
      {map && <MapCtx.Provider value={map}>{children}</MapCtx.Provider>}
    </div>
  );
}

const cssVar = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** Route line with a white casing, like on navigation maps. */
export function RouteLine({ path, faded, color, dashed, weight = 5 }: { path: LatLon[]; faded?: boolean; color?: string | null; dashed?: boolean; weight?: number }) {
  const map = useLeaflet();
  useEffect(() => {
    if (!map || path.length < 2) return;
    const casing = dashed ? null : L.polyline(path, { color: '#ffffff', weight: weight + 4, opacity: faded ? 0.5 : 0.95, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(map);
    const line = L.polyline(path, {
      color: color || cssVar('--color-route', '#141414'),
      weight: dashed ? 3 : weight,
      opacity: faded ? 0.4 : 1,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false,
      dashArray: dashed ? '2 8' : faded ? '1 9' : undefined,
    }).addTo(map);
    return () => {
      casing?.remove();
      line.remove();
    };
  }, [map, path, faded, color, dashed, weight]);
  return null;
}

/** «Откуда» — a black ring, «Куда» — a black square with a white centre. */
export function PointMarker({ pos, kind, label }: { pos: LatLon; kind: 'from' | 'to'; label?: string }) {
  const map = useLeaflet();
  useEffect(() => {
    if (!map) return;
    const dot =
      kind === 'from'
        ? '<span style="display:block;width:22px;height:22px;border-radius:50%;background:#141414;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);position:relative"><span style="position:absolute;inset:5px;border-radius:50%;background:#FFD600"></span></span>'
        : '<span style="display:block;width:22px;height:22px;border-radius:6px;background:#141414;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);position:relative"><span style="position:absolute;inset:5px;border-radius:2px;background:#fff"></span></span>';
    const tag = label
      ? `<span style="position:absolute;left:50%;bottom:28px;transform:translateX(-50%);white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis;background:#141414;color:#fff;font:600 13px/1.2 var(--font-sans);padding:6px 10px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.3)">${escapeHtml(label)}</span>`
      : '';
    const icon = L.divIcon({ className: 'bt-marker', html: `<span style="position:relative;display:block">${tag}${dot}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] });
    const m = L.marker(pos, { icon, interactive: false, keyboard: false, zIndexOffset: 500 }).addTo(map);
    return () => void m.remove();
  }, [map, pos, kind, label]);
  return null;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Top-down car, nose up; rotated by the heading. The ride's own car carries a checkered roof sign. */
export function carSvg(color: string, sign: boolean, size = 1) {
  const w = Math.round(22 * size);
  const h = Math.round(40 * size);
  const signSvg = sign ? '<rect x="7" y="21" width="10" height="5" rx="1" fill="#FFD600" stroke="#141414" stroke-width=".8"/><rect x="7.5" y="21.5" width="2.5" height="2" fill="#141414"/><rect x="12.5" y="21.5" width="2.5" height="2" fill="#141414"/><rect x="10" y="23.5" width="2.5" height="2" fill="#141414"/><rect x="15" y="23.5" width="1.5" height="2" fill="#141414"/>' : '';
  return `<svg width="${w}" height="${h}" viewBox="0 0 24 44" style="display:block;filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))">
    <rect x="2" y="2" width="20" height="40" rx="7" fill="${color}" stroke="rgba(0,0,0,.35)" stroke-width="1"/>
    <path d="M5 14 Q12 9.5 19 14 L18 19.5 L6 19.5 Z" fill="#1d2633" opacity=".88"/>
    <path d="M6 32 L18 32 L19 37 Q12 39.5 5 37 Z" fill="#1d2633" opacity=".78"/>
    <rect x="6" y="20" width="12" height="11" rx="2" fill="#000" opacity=".07"/>
    <circle cx="6.5" cy="4.5" r="1.4" fill="#fff8c9"/><circle cx="17.5" cy="4.5" r="1.4" fill="#fff8c9"/>
    <rect x="4.5" y="39.6" width="3.5" height="1.3" rx=".6" fill="#d02020"/><rect x="16" y="39.6" width="3.5" height="1.3" rx=".6" fill="#d02020"/>
    ${signSvg}
  </svg>`;
}

/** City bus seen from above: a long body with a row of windows. */
export function busSvg(color: string, size = 1) {
  const w = Math.round(16 * size);
  const h = Math.round(46 * size);
  return `<svg width="${w}" height="${h}" viewBox="0 0 16 46" style="display:block;filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))">
    <rect x="1" y="1" width="14" height="44" rx="3.5" fill="${color}" stroke="rgba(0,0,0,.4)" stroke-width="1"/>
    <rect x="3" y="2.5" width="10" height="4" rx="1.5" fill="#1d2633" opacity=".85"/>
    <rect x="4" y="9" width="8" height="30" rx="1.5" fill="#fff" opacity=".22"/>
    <rect x="5" y="40" width="6" height="3" rx="1" fill="#1d2633" opacity=".6"/>
  </svg>`;
}

/** Helicopter from above: body, tail boom and a spinning rotor. */
export function heliSvg(color: string, size = 1) {
  const s = Math.round(44 * size);
  return `<svg width="${s}" height="${s}" viewBox="0 0 44 44" style="display:block;filter:drop-shadow(0 3px 3px rgba(0,0,0,.4))">
    <rect x="20.6" y="22" width="2.8" height="18" rx="1.2" fill="${color}" stroke="rgba(0,0,0,.4)" stroke-width=".6"/>
    <rect x="15" y="37" width="14" height="2.2" rx="1" fill="${color}"/>
    <ellipse cx="22" cy="17" rx="7" ry="10" fill="${color}" stroke="rgba(255,255,255,.5)" stroke-width="1"/>
    <ellipse cx="22" cy="11" rx="4.5" ry="4" fill="#8fb4d9" opacity=".9"/>
    <g class="bt-rotor" style="transform-origin:22px 17px"><rect x="1" y="16" width="42" height="2" rx="1" fill="#2b2b2b" opacity=".75"/><rect x="21" y="-4" width="2" height="42" rx="1" fill="#2b2b2b" opacity=".75"/></g>
  </svg>`;
}

/** Business jet from above: swept wings and tail. */
export function jetSvg(color: string, size = 1) {
  const s = Math.round(48 * size);
  return `<svg width="${s}" height="${s}" viewBox="0 0 48 48" style="display:block;filter:drop-shadow(0 4px 4px rgba(0,0,0,.4))">
    <path d="M24 2 C26 2 27 6 27 10 L27 18 L45 28 L45 31 L27 26 L26.5 38 L32 42 L32 44 L24 42.5 L16 44 L16 42 L21.5 38 L21 26 L3 31 L3 28 L21 18 L21 10 C21 6 22 2 24 2 Z" fill="${color}" stroke="#141414" stroke-opacity=".5" stroke-width="1"/>
    <path d="M22.3 6 Q24 4 25.7 6 L25.4 8 L22.6 8 Z" fill="#1d2633"/>
    <rect x="17" y="21.5" width="2.5" height="5" rx="1" fill="#555"/><rect x="28.5" y="21.5" width="2.5" height="5" rx="1" fill="#555"/>
  </svg>`;
}

export type VehicleKind = 'car' | 'bus' | 'heli' | 'jet';

function vehicleIcon(kind: VehicleKind, color: string, label?: string) {
  const svg = kind === 'bus' ? busSvg(color) : kind === 'heli' ? heliSvg(color) : kind === 'jet' ? jetSvg(color) : carSvg(color, true, 1.05);
  const box = kind === 'bus' ? 48 : kind === 'jet' ? 50 : kind === 'heli' ? 46 : 42;
  // The number badge stays upright: only .bt-car rotates.
  const badge = label ? `<span style="position:absolute;left:50%;top:-12px;transform:translateX(-50%);background:${color};color:#fff;font:700 12px/1 var(--font-sans);padding:3px 6px;border-radius:8px;border:2px solid #fff;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.35)">${escapeHtml(label)}</span>` : '';
  return L.divIcon({
    className: 'bt-marker',
    html: `<div style="position:relative;width:${box}px;height:${box}px">${badge}<div class="bt-car" style="width:${box}px;height:${box}px;display:flex;align-items:center;justify-content:center">${svg}</div></div>`,
    iconSize: [box, box],
    iconAnchor: [box / 2, box / 2],
  });
}

function carIcon(color: string, sign: boolean, size = 1) {
  const w = Math.round(22 * size);
  const h = Math.round(40 * size);
  const box = Math.max(w, h);
  return L.divIcon({
    className: 'bt-marker',
    html: `<div class="bt-car" style="width:${box}px;height:${box}px;display:flex;align-items:center;justify-content:center">${carSvg(color, sign, size)}</div>`,
    iconSize: [box, box],
    iconAnchor: [box / 2, box / 2],
  });
}

const rotate = (m: L.Marker, heading: number) => {
  const el = m.getElement()?.querySelector<HTMLElement>('.bt-car');
  if (el) el.style.transform = `rotate(${heading}deg)`;
};

/**
 * The ride's car. With `motion` it drives along the path by the server clock (smoothly, every frame);
 * otherwise it stands at `position`.
 */
export function RideCar({ color, motion, position, clockOffset, follow, kind = 'car', label }: { color: string; motion: { path: LatLon[]; startAt: number; endAt: number } | null; position: { pos: LatLon; heading: number } | null; clockOffset: number; follow?: boolean; kind?: VehicleKind; label?: string }) {
  const map = useLeaflet();
  const marker = useRef<L.Marker | null>(null);
  useEffect(() => {
    if (!map) return;
    const m = L.marker([0, 0], { icon: vehicleIcon(kind, color, label), interactive: false, keyboard: false, zIndexOffset: 1000 });
    marker.current = m;
    return () => {
      m.remove();
      marker.current = null;
    };
  }, [map, color, kind, label]);

  useEffect(() => {
    const m = marker.current;
    if (!map || !m) return;
    if (!motion) {
      if (!position) return void m.remove();
      m.setLatLng(position.pos);
      if (!map.hasLayer(m)) m.addTo(map);
      rotate(m, position.heading);
      return;
    }
    const track = new Track(motion.path);
    let raf = 0;
    let last = 0;
    let heading = position?.heading ?? 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (t - last < 33) return; // ~30 fps is plenty for a car on a map
      last = t;
      const f = (Date.now() + clockOffset - motion.startAt) / (motion.endAt - motion.startAt);
      const p = track.at(f);
      m.setLatLng(p.pos);
      if (!map.hasLayer(m)) m.addTo(map);
      // Turn smoothly instead of snapping at every road bend.
      const d = ((p.heading - heading + 540) % 360) - 180;
      heading = (heading + d * 0.25 + 360) % 360;
      rotate(m, heading);
      if (follow && !map.getBounds().pad(-0.2).contains(p.pos)) map.panTo(p.pos, { animate: true, duration: kind === 'jet' ? 1 : 0.5 });
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [map, motion, position, clockOffset, follow, kind]);
  return null;
}

const BG_COLORS: Record<string, string[]> = {
  econom: ['#f4f4f2', '#c4c7cc', '#8a8d91', '#f4f4f2'],
  comfort: ['#f4f4f2', '#1d1d1f', '#2a4b8d'],
  comfort_plus: ['#1d1d1f', '#f4f4f2'],
  business: ['#1d1d1f'],
};

interface BgCar {
  id: string;
  path: LatLon[];
  speed: number;
  phase: number;
  tariff: string;
}

/** Other cars around: a picture of a living city, they go back and forth along real streets. */
export function BackgroundCars({ center, hidden }: { center: LatLon; hidden?: boolean }) {
  const map = useLeaflet();
  const cell = `${center[0].toFixed(2)},${center[1].toFixed(2)}`;
  const { data } = useQuery({ queryKey: ['near', cell], queryFn: () => api<{ cars: BgCar[] }>(`/cars/near?lat=${center[0].toFixed(4)}&lon=${center[1].toFixed(4)}`), staleTime: 300_000, enabled: !hidden });
  useEffect(() => {
    if (!map || !data || hidden) return;
    const items = data.cars.map((c, i) => {
      const colors = BG_COLORS[c.tariff] ?? BG_COLORS.econom;
      const m = L.marker(c.path[0], { icon: carIcon(colors[i % colors.length], false, 0.8), interactive: false, keyboard: false }).addTo(map);
      return { c, m, track: new Track(c.path), heading: 0 };
    });
    let raf = 0;
    let last = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (t - last < 50) return;
      last = t;
      for (const it of items) {
        if (it.track.length < 1) continue;
        const period = (2 * it.track.length) / it.c.speed;
        const u = ((Date.now() / 1000 / period + it.c.phase) % 1) * 2;
        const forward = u <= 1;
        const p = it.track.at(forward ? u : 2 - u);
        it.m.setLatLng(p.pos);
        const h = forward ? p.heading : (p.heading + 180) % 360;
        const d = ((h - it.heading + 540) % 360) - 180;
        it.heading = (it.heading + d * 0.2 + 360) % 360;
        rotate(it.m, it.heading);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      items.forEach((it) => it.m.remove());
    };
  }, [map, data, hidden]);
  return null;
}

/** Fits the map to the points once they change (route shown, car assigned). */
export function FitBounds({ points, padding = [48, 48], maxZoom = 17 }: { points: LatLon[]; padding?: [number, number]; maxZoom?: number }) {
  const map = useLeaflet();
  const key = points.map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join(';');
  useEffect(() => {
    if (!map || points.length === 0) return;
    if (points.length === 1) map.flyTo(points[0], Math.min(maxZoom, 16), { duration: 0.6 });
    else map.flyToBounds(L.latLngBounds(points), { padding, maxZoom, duration: 0.6 });
    // Fit only when the set of points changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

/** Pulsing circles under «Откуда» while a car is being found. */
export function SearchPulse({ pos }: { pos: LatLon }) {
  const map = useLeaflet();
  useEffect(() => {
    if (!map) return;
    const html = '<span style="position:relative;display:block;width:120px;height:120px">' + [0, 0.6, 1.2].map((d) => `<span class="bt-pulse" style="position:absolute;inset:0;border-radius:50%;background:rgba(255,214,0,.45);animation-delay:${d}s"></span>`).join('') + '</span>';
    const m = L.marker(pos, { icon: L.divIcon({ className: 'bt-marker', html, iconSize: [120, 120], iconAnchor: [60, 60] }), interactive: false, keyboard: false, zIndexOffset: -100 }).addTo(map);
    return () => void m.remove();
  }, [map, pos]);
  return null;
}

/** Small round stop markers along a bus ride (or all stops in the frame). */
export function StopDots({ stops, color, onClick }: { stops: { lat: number; lon: number; name: string; id?: string }[]; color?: string | null; onClick?: (id: string) => void }) {
  const map = useLeaflet();
  useEffect(() => {
    if (!map) return;
    const layer = L.layerGroup(
      stops.map((st) => {
        const c = L.circleMarker([st.lat, st.lon], { radius: onClick ? 6 : 4, color: '#fff', weight: 2, fillColor: color || '#141414', fillOpacity: 1, interactive: !!onClick, bubblingMouseEvents: false });
        if (onClick && st.id) {
          c.on('click', () => onClick(st.id!));
          c.bindTooltip(escapeHtml(st.name), { direction: 'top', offset: [0, -6] });
        }
        return c;
      }),
    ).addTo(map);
    return () => void layer.remove();
  }, [map, stops, color, onClick]);
  return null;
}

/** Calls back with the frame after every move (to load stops and buses in view). */
export function useMapFrame() {
  const map = useLeaflet();
  const [frame, setFrame] = useState<{ s: number; w: number; n: number; e: number; zoom: number } | null>(null);
  useEffect(() => {
    if (!map) return;
    const update = () => {
      const b = map.getBounds();
      setFrame({ s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast(), zoom: map.getZoom() });
    };
    update();
    map.on('moveend', update);
    return () => void map.off('moveend', update);
  }, [map]);
  return frame;
}

interface LiveBus {
  id: string;
  route: number;
  ref: string;
  colour: string | null;
  lat: number;
  lon: number;
  heading: number;
}

/** Buses of the real lines in the frame; positions refresh every 3 s and glide in between. */
export function LiveBuses({ route, onPick }: { route?: number; onPick?: (b: LiveBus) => void }) {
  const map = useLeaflet();
  const frame = useMapFrame();
  const q = frame ? `s=${frame.s.toFixed(4)}&w=${frame.w.toFixed(4)}&n=${frame.n.toFixed(4)}&e=${frame.e.toFixed(4)}${route ? `&route=${route}` : ''}` : '';
  const { data } = useQuery({ queryKey: ['bus-live', q], queryFn: () => api<{ buses: LiveBus[] }>(`/bus/live?${q}`), enabled: !!frame && (frame.zoom >= 13 || !!route), refetchInterval: 3000, placeholderData: (p) => p });
  const markers = useRef(new Map<string, { m: L.Marker; from: LatLon; to: LatLon; at: number }>());
  useEffect(() => {
    if (!map || !data) return;
    const seen = new Set<string>();
    const now = performance.now();
    for (const b of data.buses) {
      seen.add(b.id);
      const cur = markers.current.get(b.id);
      if (cur) {
        const p = cur.m.getLatLng();
        Object.assign(cur, { from: [p.lat, p.lng] as LatLon, to: [b.lat, b.lon] as LatLon, at: now });
        rotate(cur.m, b.heading);
      } else {
        const m = L.marker([b.lat, b.lon], { icon: vehicleIcon('bus', b.colour || '#d0021b', b.ref), keyboard: false, zIndexOffset: 200 }).addTo(map);
        if (onPick) m.on('click', () => onPick(b));
        rotate(m, b.heading);
        markers.current.set(b.id, { m, from: [b.lat, b.lon], to: [b.lat, b.lon], at: now });
      }
    }
    for (const [id, v] of markers.current) {
      if (!seen.has(id)) {
        v.m.remove();
        markers.current.delete(id);
      }
    }
  }, [map, data, onPick]);
  useEffect(() => {
    let raf = 0;
    const frameFn = (t: number) => {
      raf = requestAnimationFrame(frameFn);
      for (const v of markers.current.values()) {
        const f = Math.min(1, (t - v.at) / 3000);
        v.m.setLatLng([v.from[0] + (v.to[0] - v.from[0]) * f, v.from[1] + (v.to[1] - v.from[1]) * f]);
      }
    };
    raf = requestAnimationFrame(frameFn);
    const all = markers.current;
    return () => {
      cancelAnimationFrame(raf);
      for (const v of all.values()) v.m.remove();
      all.clear();
    };
  }, []);
  return null;
}

/** Bus stops in the frame when zoomed in; a tap opens the departure board. */
export function BusStops({ onPick }: { onPick: (id: string) => void }) {
  const frame = useMapFrame();
  const q = frame ? `s=${frame.s.toFixed(4)}&w=${frame.w.toFixed(4)}&n=${frame.n.toFixed(4)}&e=${frame.e.toFixed(4)}` : '';
  const { data } = useQuery({ queryKey: ['bus-stops', q], queryFn: () => api<{ stops: { id: string; name: string; lat: number; lon: number }[] }>(`/bus/stops?${q}`), enabled: !!frame && frame.zoom >= 15, placeholderData: (p) => p, staleTime: 600_000 });
  return <StopDots stops={frame && frame.zoom >= 15 ? (data?.stops ?? []) : []} onClick={onPick} />;
}

/** Helipads and airports to choose from. */
export function PlaceMarkers({ places, selected, onPick, kind }: { places: { code: string; title: string; lat: number; lon: number }[]; selected?: string[]; onPick?: (code: string) => void; kind: 'heli' | 'jet' }) {
  const map = useLeaflet();
  useEffect(() => {
    if (!map) return;
    const layer = L.layerGroup(
      places.map((p) => {
        const on = selected?.includes(p.code);
        const html = `<span style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:${kind === 'heli' ? '50%' : '9px'};background:${on ? '#FFD600' : '#141414'};color:${on ? '#141414' : '#fff'};font:800 ${kind === 'heli' ? 15 : 10}px/1 var(--font-sans);border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)">${kind === 'heli' ? 'H' : escapeHtml(p.code)}</span>`;
        const m = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: 'bt-marker', html, iconSize: [30, 30], iconAnchor: [15, 15] }), keyboard: false, zIndexOffset: on ? 800 : 300 });
        m.bindTooltip(escapeHtml(p.title), { direction: 'top', offset: [0, -14] });
        if (onPick) m.on('click', () => onPick(p.code));
        return m;
      }),
    ).addTo(map);
    return () => void layer.remove();
  }, [map, places, selected, onPick, kind]);
  return null;
}
