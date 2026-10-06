import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/** Base map. Tiles come from the portal's own /api/tiles proxy (OpenStreetMap behind it); colours follow the map style via CSS. */
export function createMap(el: HTMLElement, center: [number, number] = [55.75, 37.62], zoom = 10): L.Map {
  const m = L.map(el).setView(center, zoom);
  const tiles = L.tileLayer('/api/tiles/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap',
    className: 'zn-tiles',
  }).addTo(m);

  // Without tiles a dark-styled map is just a black box — say so instead.
  let loaded = 0;
  let failed = 0;
  const notice = L.DomUtil.create('div', 'zn-map-notice', el);
  notice.hidden = true;
  notice.textContent = 'Подложка карты не загрузилась: сервер не смог получить плитки OpenStreetMap. Точки и маршруты при этом работают.';
  tiles.on('tileload', () => {
    loaded++;
    notice.hidden = true;
  });
  tiles.on('tileerror', () => {
    failed++;
    if (!loaded && failed >= 3) notice.hidden = false;
  });
  return m;
}

export function escHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Round status dot used for Wi-Fi networks and clients. `color` may be a CSS variable. */
export function dotIcon(color: string, size = 18) {
  return L.divIcon({
    className: '',
    html: `<span style="display:flex;width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid var(--color-bg);box-shadow:0 0 0 2px color-mix(in srgb, ${color} 35%, transparent)"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/** Numbered marker for route points. */
export function numberIcon(n: number | string, color = 'var(--color-fg)') {
  return L.divIcon({
    className: '',
    html: `<span style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:${color};color:var(--color-bg);font:600 12px sans-serif;border:2px solid var(--color-bg);box-shadow:0 0 0 2px color-mix(in srgb, ${color} 35%, transparent)">${n}</span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

/** Square marker for client sites. */
export function siteIcon(color = 'var(--color-info)') {
  return L.divIcon({
    className: '',
    html: `<span style="display:flex;width:16px;height:16px;border-radius:4px;transform:rotate(45deg);background:${color};border:2px solid var(--color-bg);box-shadow:0 0 0 2px color-mix(in srgb, ${color} 35%, transparent)"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

export function tooltip(title: string, rows: (string | null | undefined | false)[]) {
  return `<div class="zn-tip"><b>${escHtml(title)}</b>${rows.filter(Boolean).map((r) => `<div>${r}</div>`).join('')}</div>`;
}

export const TIP_OPTS: L.TooltipOptions = { direction: 'top', offset: [0, -12], opacity: 1, className: 'zn-tip-wrap' };
