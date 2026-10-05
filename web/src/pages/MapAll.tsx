import L from 'leaflet';
import { Map as MapIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClientSelect } from '../components/common';
import { MapStyleToggle } from '../components/MapStyle';
import { Card, Checkbox, Loading, PageHeader } from '../components/ui';
import { CLIENT_STATUS } from '../lib/format';
import { createMap, dotIcon, escHtml, siteIcon, TIP_OPTS, tooltip } from '../lib/map';
import { useClientNames, useEmployeeNames, useRecords } from '../lib/queries';
import { useMapStyle } from '../lib/theme';
import type { Client, Route } from '../lib/types';
import { drawRoute, ROUTE_STATUS } from './Routes';
import { WIFI_STATUS, wifiTooltip } from './Wifi';

type LayerId = 'clients' | 'wifi' | 'routes';

const LAYERS_KEY = 'zn.map.layers';
function readLayers(): Record<LayerId, boolean> {
  try {
    return { clients: true, wifi: true, routes: true, ...JSON.parse(localStorage.getItem(LAYERS_KEY) ?? '{}') };
  } catch {
    return { clients: true, wifi: true, routes: true };
  }
}

const CLIENT_COLOR: Record<string, string> = {
  new: 'var(--color-info)',
  active: 'var(--color-ok)',
  paused: 'var(--color-warn)',
  former: 'var(--color-faint)',
};

function LayerChip({ checked, onChange, swatch, label, count, missing }: { checked: boolean; onChange: (v: boolean) => void; swatch: ReactNode; label: string; count: number; missing?: number }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
      <Checkbox
        checked={checked}
        onChange={onChange}
        ariaLabel={label}
        label={
          <span className="flex items-center gap-2">
            {swatch}
            {label}
            <span className="text-xs text-faint">{count}</span>
          </span>
        }
      />
      {!!missing && <span className="text-[11px] text-faint" title="Без координат — на карте не показаны">+{missing} без коорд.</span>}
    </div>
  );
}

export default function MapAll() {
  const navigate = useNavigate();
  const { data: clients = [], isLoading: l1 } = useRecords('clients');
  const { data: wifi = [], isLoading: l2 } = useRecords('wifi-networks');
  const { data: routes = [], isLoading: l3 } = useRecords('routes');
  const cli = useClientNames();
  const emp = useEmployeeNames();
  const { style: mapStyle } = useMapStyle();
  const [layers, setLayers] = useState(readLayers);
  const [clientId, setClientId] = useState<string | null>(null);

  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const group = useRef<L.FeatureGroup | null>(null);
  const navRef = useRef(navigate);
  navRef.current = navigate;
  const lastFitKey = useRef('');

  const toggle = (id: LayerId, v: boolean) =>
    setLayers((prev) => {
      const next = { ...prev, [id]: v };
      try {
        localStorage.setItem(LAYERS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

  // Everything that can appear on the map, already narrowed by the client filter.
  const view = useMemo(() => {
    const match = (cid: string | null) => !clientId || cid === clientId;
    const c = clients.filter((x) => match(x.id));
    const w = wifi.filter((x) => match(x.clientId));
    const r = routes.filter((x) => match(x.clientId));
    return {
      clients: c.filter((x) => x.lat !== null && x.lng !== null),
      clientsMissing: c.filter((x) => x.lat === null || x.lng === null).length,
      wifi: w.filter((x) => x.lat !== null && x.lng !== null),
      wifiMissing: w.filter((x) => x.lat === null || x.lng === null).length,
      routes: r.filter((x) => x.points.length > 0),
      routesMissing: r.filter((x) => x.points.length === 0).length,
    };
  }, [clients, wifi, routes, clientId]);

  useEffect(() => {
    if (!box.current || map.current) return;
    const m = createMap(box.current, [55.75, 37.62], 5);
    group.current = L.featureGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = group.current;
    if (!m || !g) return;
    g.clearLayers();

    if (layers.routes) {
      for (const r of view.routes) {
        const st = ROUTE_STATUS[r.status];
        // Draw straight into the feature group: getBounds() cannot measure nested plain layer groups.
        drawRoute(g, r.points, r.road, {
          color: st.color,
          tooltip: routeTooltip(r, cli, emp),
          onClick: () => navRef.current(`/routes/${r.id}`),
        });
      }
    }
    if (layers.wifi) {
      for (const n of view.wifi) {
        L.marker([n.lat!, n.lng!], { icon: dotIcon(WIFI_STATUS[n.status].color) })
          .bindTooltip(wifiTooltip(n, cli), TIP_OPTS)
          .on('click', () => navRef.current(`/wifi?open=${n.id}`))
          .addTo(g);
      }
    }
    if (layers.clients) {
      for (const c of view.clients) {
        L.marker([c.lat!, c.lng!], { icon: siteIcon(CLIENT_COLOR[c.status]) })
          .bindTooltip(clientTooltip(c, emp), TIP_OPTS)
          .on('click', () => navRef.current(`/clients/${c.id}`))
          .addTo(g);
      }
    }

    // Re-frame only when the set of visible things changes, not on every data refresh.
    const fitKey = `${clientId}|${JSON.stringify(layers)}|${view.clients.length}|${view.wifi.length}|${view.routes.length}`;
    const bounds = g.getBounds();
    if (fitKey !== lastFitKey.current && bounds.isValid()) {
      m.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
      lastFitKey.current = fitKey;
    }
  }, [view, layers, cli, emp, clientId]);

  const loading = l1 || l2 || l3;

  return (
    <>
      <PageHeader title="Карта" description="Клиенты, Wi-Fi сети и маршруты выездов на одной карте" actions={<MapStyleToggle />} />

      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="flex flex-wrap gap-2">
          <LayerChip
            checked={layers.clients}
            onChange={(v) => toggle('clients', v)}
            swatch={<span className="inline-block size-2.5 rotate-45 rounded-[2px] bg-info" />}
            label="Клиенты"
            count={view.clients.length}
            missing={view.clientsMissing}
          />
          <LayerChip
            checked={layers.wifi}
            onChange={(v) => toggle('wifi', v)}
            swatch={<span className="inline-block size-2.5 rounded-full bg-ok" />}
            label="Wi-Fi"
            count={view.wifi.length}
            missing={view.wifiMissing}
          />
          <LayerChip
            checked={layers.routes}
            onChange={(v) => toggle('routes', v)}
            swatch={<span className="inline-block h-0.5 w-4 bg-fg" />}
            label="Маршруты"
            count={view.routes.length}
            missing={view.routesMissing}
          />
        </div>
        <div className="lg:ml-auto lg:w-64">
          <ClientSelect value={clientId} onChange={setClientId} emptyLabel="Все клиенты" />
        </div>
      </div>

      <Card>
        {loading && (
          <div className="border-b border-line">
            <Loading />
          </div>
        )}
        <div ref={box} className="zn-map h-[70dvh] min-h-96 w-full rounded-lg" data-map-style={mapStyle} />
      </Card>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-faint">
        <span className="flex items-center gap-1.5">
          <MapIcon className="size-3.5" /> Наведите на объект — краткая информация, клик — открыть карточку.
        </span>
        <span>Координаты: у клиента — в карточке («Координаты объекта»), у сети — в карточке сети, у маршрута — точки на карте.</span>
      </div>
    </>
  );
}

function clientTooltip(c: Client, emp: (id: string | null) => string) {
  const st = CLIENT_STATUS[c.status]!;
  return tooltip(c.fullName, [
    `<span class="zn-tip-status"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${CLIENT_COLOR[c.status]}"></span>${st.label}</span>`,
    c.phones[0] && escHtml(c.phones[0]),
    c.address && escHtml(c.address.split('\n')[0]!),
    c.responsibleId && `Ответственный: ${escHtml(emp(c.responsibleId))}`,
  ]);
}

function routeTooltip(r: Route, cli: (id: string | null) => string, emp: (id: string | null) => string) {
  const st = ROUTE_STATUS[r.status];
  return tooltip(r.name, [
    `<span class="zn-tip-status"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${st.color}"></span>${st.label}</span>`,
    r.date && `${r.date.split('-').reverse().join('.')}${r.time ? ` ${r.time}` : ''}`,
    `${r.points.length} точек · ${r.road ? `${r.road.distanceKm} км по дорогам` : `${r.distanceKm} км по прямой`}`,
    r.clientId && `Клиент: ${escHtml(cli(r.clientId))}`,
    r.assigneeId && `Ответственный: ${escHtml(emp(r.assigneeId))}`,
  ]);
}

