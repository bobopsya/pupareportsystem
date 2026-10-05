import { useQuery, useQueryClient } from '@tanstack/react-query';
import L from 'leaflet';
import {
  ArrowDown, ArrowUp, Download, ImagePlus, MapPin, Navigation, Plus, Route as RouteIcon, Save, Trash2, X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ClientSelect, EmployeeSelect, matches, SearchInput } from '../components/common';
import {
  Badge, Button, Card, Empty, ErrorText, Field, IconButton, Input, Loading, Modal, Mono, PageHeader, Select, Table, TagInput, Textarea, td, th, trHover,
  useConfirm, useToast,
} from '../components/ui';
import { api, fileUrl, saveBlob, uploadFile, type FileMeta } from '../lib/api';
import { fmtAgo, fmtBytes, fmtDate, type Tone } from '../lib/format';
import { pathLengthKm, routeToGpx } from '../lib/geo';
import { createMap, escHtml, numberIcon, TIP_OPTS, tooltip } from '../lib/map';
import { useMapStyle } from '../lib/theme';
import { MapStyleToggle } from '../components/MapStyle';
import { useClientNames, useDeleteRecord, useEmployeeNames, useRecords, useSaveRecord } from '../lib/queries';
import type { Route, RouteData, RoutePoint, RouteStatus } from '../lib/types';

export const ROUTE_STATUS: Record<RouteStatus, { label: string; tone: Tone; color: string }> = {
  planned: { label: 'Запланирован', tone: 'info', color: 'var(--color-info)' },
  in_progress: { label: 'В пути', tone: 'warn', color: 'var(--color-warn)' },
  done: { label: 'Выполнен', tone: 'ok', color: 'var(--color-ok)' },
  cancelled: { label: 'Отменён', tone: 'neutral', color: 'var(--color-faint)' },
};

const EMPTY: RouteData = { name: '', clientId: null, assigneeId: null, date: '', time: '', status: 'planned', description: '', tags: [], points: [] };

// ---------------- Map ----------------
function RouteMap({ points, road, onAdd, onMove }: { points: RoutePoint[]; road: Route['road']; onAdd: (lat: number, lng: number) => void; onMove: (i: number, lat: number, lng: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const cb = useRef({ onAdd, onMove });
  cb.current = { onAdd, onMove };
  const fitted = useRef(false);
  const { style: mapStyle } = useMapStyle();

  useEffect(() => {
    if (!box.current || map.current) return;
    const m = createMap(box.current);
    layer.current = L.layerGroup().addTo(m);
    m.on('click', (e) => cb.current.onAdd(e.latlng.lat, e.latlng.lng));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      fitted.current = false;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const lg = layer.current;
    if (!m || !lg) return;
    lg.clearLayers();
    drawRoute(lg, points, road, { draggable: true, onMove: (i, lat, lng) => cb.current.onMove(i, lat, lng) });
    if (points.length && !fitted.current) {
      m.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])), { padding: [50, 50], maxZoom: 15 });
      fitted.current = true;
    }
  }, [points, road]);

  return (
    <div className="relative">
      <div ref={box} className="zn-map h-[60dvh] min-h-80 w-full rounded-lg" data-map-style={mapStyle} />
      <div className="pointer-events-none absolute right-2 top-2 z-[500] hidden rounded-md border border-line bg-bg/85 px-2.5 py-1.5 text-xs text-muted backdrop-blur sm:block">
        Клик по карте — добавить точку · маркер можно перетащить
      </div>
    </div>
  );
}

/** Draws a route (road line, straight dashed line, numbered points) into a layer; shared with the overview map. */
export function drawRoute(
  lg: L.LayerGroup,
  points: RoutePoint[],
  road: Route['road'],
  opts: { draggable?: boolean; onMove?: (i: number, lat: number, lng: number) => void; color?: string; tooltip?: string; onClick?: () => void } = {},
) {
  const color = opts.color ?? 'var(--color-fg)';
  const lines: L.Polyline[] = [];
  if (road?.geometry.length) lines.push(L.polyline(road.geometry, { weight: 4, opacity: 0.9, className: 'zn-line-road' }).addTo(lg));
  if (points.length > 1) {
    lines.push(L.polyline(points.map((p) => [p.lat, p.lng] as [number, number]), { weight: 2, opacity: road ? 0.35 : 0.8, dashArray: '6 6', className: 'zn-line-straight' }).addTo(lg));
  }
  points.forEach((p, i) => {
    const marker = L.marker([p.lat, p.lng], { icon: numberIcon(i + 1, color), draggable: !!opts.draggable }).addTo(lg);
    if (opts.onMove) {
      marker.on('dragend', () => {
        const ll = marker.getLatLng();
        opts.onMove!(i, ll.lat, ll.lng);
      });
    }
    const tip = opts.tooltip ?? (p.label || p.note ? tooltip(p.label || `Точка ${i + 1}`, [p.note && escHtml(p.note)]) : null);
    if (tip) marker.bindTooltip(tip, TIP_OPTS);
    if (opts.onClick) marker.on('click', opts.onClick);
  });
  if (opts.tooltip) lines.forEach((l) => l.bindTooltip(opts.tooltip!, { ...TIP_OPTS, sticky: true }));
  if (opts.onClick) lines.forEach((l) => l.on('click', opts.onClick!));
}

// ---------------- Photos ----------------
function RoutePhotos({ routeId }: { routeId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<FileMeta | null>(null);
  const { data = [], isLoading } = useQuery({ queryKey: ['files', 'route', routeId], queryFn: () => api<FileMeta[]>(`/files?ownerType=route&ownerId=${routeId}&kind=photo`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['files', 'route', routeId] });

  const upload = async (files: FileList) => {
    for (const f of Array.from(files)) {
      try {
        if (f.size > 20 * 1024 * 1024) throw new Error(`${f.name}: больше 20 МБ`);
        await uploadFile(f, { ownerType: 'route', ownerId: routeId, kind: 'photo' });
      } catch (e) {
        toast((e as Error).message, 'bad');
      }
    }
    refresh();
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-faint">Фото</h3>
        <Button size="sm" icon={<ImagePlus className="size-3.5" />} onClick={() => fileRef.current?.click()}>
          Добавить
        </Button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && void upload(e.target.files)} />
      </div>
      {isLoading ? (
        <Loading />
      ) : data.length === 0 ? (
        <p className="text-sm text-faint">Фото с выезда: объект, оборудование, что сделано. До 20 МБ, метаданные удаляются.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {data.map((f) => (
            <button key={f.id} type="button" onClick={() => setView(f)} className="aspect-square overflow-hidden rounded-md border border-line bg-hover">
              <img src={fileUrl(f.id, { thumb: true })} alt={f.caption} loading="lazy" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {view && (
        <Modal
          open
          wide="xl"
          onClose={() => setView(null)}
          title={view.name}
          footer={
            <>
              <Button
                variant="danger"
                className="mr-auto"
                icon={<Trash2 className="size-4" />}
                onClick={async () => {
                  if (!(await confirm({ title: 'Удалить фото?', danger: true, confirmText: 'Удалить' }))) return;
                  await api(`/files/${view.id}`, { method: 'DELETE' });
                  setView(null);
                  refresh();
                }}
              >
                Удалить
              </Button>
              <a href={fileUrl(view.id, { download: true })} className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-elevated px-3.5 text-sm hover:bg-hover">
                <Download className="size-4" /> Скачать
              </a>
            </>
          }
        >
          <img src={fileUrl(view.id)} alt={view.caption} className="mx-auto max-h-[70dvh] rounded-md" />
          <p className="mt-2 text-xs text-faint">{fmtBytes(view.size)}</p>
        </Modal>
      )}
    </div>
  );
}

// ---------------- Editor ----------------
function RouteEditor({ route }: { route: Route }) {
  const save = useSaveRecord('routes');
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<RouteData>({ ...EMPTY, ...route });
  useEffect(() => setF({ ...EMPTY, ...route }), [route]);
  const dirty = JSON.stringify({ ...EMPTY, ...route, distanceKm: undefined, road: undefined }) !== JSON.stringify({ ...f, distanceKm: undefined, road: undefined });
  const set = <K extends keyof RouteData>(k: K, v: RouteData[K]) => setF((x) => ({ ...x, [k]: v }));
  const liveKm = pathLengthKm(f.points);

  const addPoint = (lat: number, lng: number) => set('points', [...f.points, { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, label: '', note: '' }]);
  const movePoint = (i: number, lat: number, lng: number) => set('points', f.points.map((p, j) => (j === i ? { ...p, lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 } : p)));
  const updPoint = (i: number, patch: Partial<RoutePoint>) => set('points', f.points.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const swap = (i: number, j: number) => {
    if (j < 0 || j >= f.points.length) return;
    const next = [...f.points];
    [next[i], next[j]] = [next[j]!, next[i]!];
    set('points', next);
  };

  const persist = (extra?: Partial<RouteData>) => save.mutateAsync({ ...route, ...f, ...extra });
  const buildRoad = async () => {
    if (f.points.length < 2) return toast('Нужно минимум 2 точки', 'bad');
    try {
      if (dirty) await persist();
      await api(`/routes/${route.id}/road`, { method: 'POST' });
      qc.invalidateQueries({ queryKey: ['routes'] });
      toast('Маршрут проложен по дорогам', 'ok');
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <RouteMap points={f.points} road={dirty ? null : route.road} onAdd={addPoint} onMove={movePoint} />

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm">
        <span className="flex items-center gap-1.5">
          <MapPin className="size-4 text-muted" /> {f.points.length} точек
        </span>
        <span className="text-muted">
          По прямой: <b className="text-fg">{liveKm} км</b>
        </span>
        {route.road && !dirty && (
          <span className="text-muted">
            По дорогам: <b className="text-fg">{route.road.distanceKm} км</b> · ≈{Math.floor(route.road.durationMin / 60)} ч {route.road.durationMin % 60} мин
          </span>
        )}
        <Button size="sm" variant="secondary" className="ml-auto" icon={<Navigation className="size-3.5" />} loading={save.isPending} onClick={() => void buildRoad()} disabled={f.points.length < 2}>
          Проложить по дорогам
        </Button>
        <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} disabled={!f.points.length} onClick={() => saveBlob(new Blob([routeToGpx(f.name || 'route', f.points)], { type: 'application/gpx+xml' }), `${(f.name || 'route').replace(/[^\p{L}\p{N}]+/gu, '_')}.gpx`)}>
          GPX
        </Button>
        <MapStyleToggle />
      </div>

      {f.points.length > 0 && (
        <Card title="Точки маршрута">
          <div className="divide-y divide-line/70">
            {f.points.map((p, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-2">
                <span className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-hover text-xs font-medium">{i + 1}</span>
                <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <Input placeholder="Название точки" value={p.label} onChange={(e) => updPoint(i, { label: e.target.value })} />
                  <Input placeholder="Заметка" value={p.note} onChange={(e) => updPoint(i, { note: e.target.value })} />
                  <Mono className="self-center text-xs text-faint">{p.lat.toFixed(4)}, {p.lng.toFixed(4)}</Mono>
                </div>
                <div className="flex">
                  <IconButton label="Вверх" disabled={i === 0} onClick={() => swap(i, i - 1)}>
                    <ArrowUp className="size-4" />
                  </IconButton>
                  <IconButton label="Вниз" disabled={i === f.points.length - 1} onClick={() => swap(i, i + 1)}>
                    <ArrowDown className="size-4" />
                  </IconButton>
                  <IconButton label="Удалить точку" onClick={() => set('points', f.points.filter((_, j) => j !== i))}>
                    <X className="size-4" />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Детали">
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Название *">
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Статус">
            <Select value={f.status} onChange={(e) => set('status', e.target.value as RouteStatus)}>
              {Object.entries(ROUTE_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Клиент">
            <ClientSelect value={f.clientId} onChange={(v) => set('clientId', v)} />
          </Field>
          <Field label="Ответственный">
            <EmployeeSelect value={f.assigneeId} onChange={(v) => set('assigneeId', v)} />
          </Field>
          <Field label="Дата">
            <Input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label="Время">
            <Input type="time" value={f.time} onChange={(e) => set('time', e.target.value)} />
          </Field>
          <Field label="Теги" className="sm:col-span-2">
            <TagInput value={f.tags} onChange={(v) => set('tags', v)} />
          </Field>
          <Field label="Описание" className="sm:col-span-2">
            <Textarea className="min-h-24" value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Что нужно сделать на выезде, детали, контакты…" />
          </Field>
        </div>
      </Card>

      <Card>
        <div className="p-4">
          <RoutePhotos routeId={route.id} />
        </div>
      </Card>

      <ErrorText error={save.error} />
      <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-line bg-bg/95 py-3 backdrop-blur">
        {dirty && <span className="mr-auto text-xs text-warn">Есть несохранённые изменения</span>}
        <Button disabled={!dirty} onClick={() => setF({ ...EMPTY, ...route })}>
          Отменить
        </Button>
        <Button variant="primary" icon={<Save className="size-4" />} loading={save.isPending} disabled={!dirty} onClick={() => void persist().then(() => toast('Маршрут сохранён', 'ok')).catch((e) => toast(e.message, 'bad'))}>
          Сохранить
        </Button>
      </div>
    </div>
  );
}

// ---------------- New route ----------------
function NewRouteModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const save = useSaveRecord('routes');
  const [f, setF] = useState({ name: '', clientId: null as string | null });
  return (
    <Modal
      open
      onClose={onClose}
      title="Новый маршрут"
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate({ ...EMPTY, ...f }, { onSuccess: (r) => onCreated(r.id) })}>
            Создать и открыть
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Название *">
          <Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Выезд к Иванову, 12 мая" />
        </Field>
        <Field label="Клиент">
          <ClientSelect value={f.clientId} onChange={(clientId) => setF({ ...f, clientId })} />
        </Field>
        <ErrorText error={save.error} />
      </div>
    </Modal>
  );
}

// ---------------- Page ----------------
export default function Routes() {
  const { data = [], isLoading } = useRecords('routes');
  const params = useParams();
  const navigate = useNavigate();
  const del = useDeleteRecord('routes');
  const confirm = useConfirm();
  const cli = useClientNames();
  const emp = useEmployeeNames();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const list = useMemo(
    () =>
      data
        .filter((r) => (!status || r.status === status) && (!clientId || r.clientId === clientId))
        .filter((r) => matches(q, r.name, r.description, r.tags, cli(r.clientId), emp(r.assigneeId)))
        .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.updatedAt - a.updatedAt),
    [data, status, clientId, q, cli, emp],
  );
  const selected = params.id ? data.find((r) => r.id === params.id) : undefined;

  return (
    <>
      <PageHeader
        title="Маршруты"
        description="Планирование выездов: точки на карте, расстояние, клиент, фото"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Новый маршрут
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
        <div className="flex flex-col gap-3">
          <SearchInput value={q} onChange={setQ} placeholder="Название, клиент, тег…" />
          <div className="grid grid-cols-2 gap-2">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Любой статус</option>
              {Object.entries(ROUTE_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
            <ClientSelect value={clientId} onChange={setClientId} emptyLabel="Все клиенты" />
          </div>

          {isLoading ? (
            <Loading />
          ) : list.length === 0 ? (
            <Card>
              <Empty icon={<RouteIcon />} title={data.length ? 'Ничего не найдено' : 'Маршрутов пока нет'}>
                {!data.length && 'Нажмите «Новый маршрут».'}
              </Empty>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {list.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => navigate(`/routes/${r.id}`)}
                  className={`rounded-lg border px-3.5 py-3 text-left transition-colors ${r.id === params.id ? 'border-fg/60 bg-elevated' : 'border-line bg-surface hover:border-line-strong'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{r.name}</span>
                    <Badge tone={ROUTE_STATUS[r.status].tone}>{ROUTE_STATUS[r.status].label}</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-faint">
                    {r.clientId && <span>{cli(r.clientId)}</span>}
                    {r.date && <span>{fmtDate(r.date)}{r.time ? ` ${r.time}` : ''}</span>}
                    <span>{r.points.length} точек</span>
                    <span>{r.road ? `${r.road.distanceKm} км дорог` : `${r.distanceKm} км`}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          {selected ? (
            <>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="truncate text-lg font-semibold">{selected.name}</h2>
                <Button
                  variant="danger"
                  size="sm"
                  icon={<Trash2 className="size-4" />}
                  onClick={async () => {
                    if (await confirm({ title: `Удалить маршрут «${selected.name}»?`, body: 'Маршрут и его фото попадут в корзину на 30 дней.', danger: true, confirmText: 'Удалить' })) {
                      await del.mutateAsync(selected.id);
                      navigate('/routes');
                    }
                  }}
                >
                  Удалить
                </Button>
              </div>
              <RouteEditor key={selected.id} route={selected} />
            </>
          ) : (
            <Card>
              <Empty icon={<RouteIcon />} title="Выберите маршрут" >
                Или создайте новый — затем кликайте по карте, чтобы расставить точки.
              </Empty>
            </Card>
          )}
        </div>
      </div>

      {creating && (
        <NewRouteModal
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            navigate(`/routes/${id}`);
          }}
        />
      )}
    </>
  );
}

/** Compact list of a client's routes, for the client card. */
export function ClientRoutes({ clientId }: { clientId: string }) {
  const { data = [] } = useRecords('routes', { clientId });
  const navigate = useNavigate();
  if (data.length === 0) return <p className="text-sm text-faint">Маршруты выездов к этому клиенту появятся здесь.</p>;
  return (
    <Table>
      <thead>
        <tr>
          <th className={th}>Маршрут</th>
          <th className={th}>Дата</th>
          <th className={th}>Статус</th>
          <th className={th}>Расстояние</th>
        </tr>
      </thead>
      <tbody>
        {data.map((r) => (
          <tr key={r.id} className={`${trHover} cursor-pointer`} onClick={() => navigate(`/routes/${r.id}`)}>
            <td className={td}>{r.name}</td>
            <td className={`${td} text-muted whitespace-nowrap`}>{r.date ? fmtDate(r.date) : fmtAgo(r.updatedAt)}</td>
            <td className={td}>
              <Badge tone={ROUTE_STATUS[r.status].tone}>{ROUTE_STATUS[r.status].label}</Badge>
            </td>
            <td className={`${td} text-muted`}>{r.road ? `${r.road.distanceKm} км` : `${r.distanceKm} км`}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
