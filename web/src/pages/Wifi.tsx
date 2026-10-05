import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Eye, EyeOff, List, Map as MapIcon, Pencil, Plus, Trash2, Wifi as WifiIcon, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClientSelect, matches, SearchInput } from '../components/common';
import {
  Badge, Button, Card, Checkbox, CopyButton, cx, Empty, ErrorText, Field, IconButton, Input, Loading, Modal, Mono, PageHeader, Segmented, Select, Table,
  TagInput, Textarea, td, th, trHover, useConfirm,
} from '../components/ui';
import { fmtAgo, type Tone } from '../lib/format';
import { useClientNames, useDeleteRecord, useRecords, useSaveRecord } from '../lib/queries';
import type { Wifi, WifiData, WifiStatus } from '../lib/types';

const EMPTY: WifiData = {
  name: '', password: '', security: 'wpa2', band: '', hidden: false, status: 'active', clientId: null, location: '', lat: null, lng: null, tags: [], notes: '',
};

const SECURITY: Record<string, string> = {
  open: 'Открытая', wep: 'WEP', wpa: 'WPA', wpa2: 'WPA2', wpa3: 'WPA3', 'wpa2-ent': 'WPA2-Enterprise', other: 'Другое',
};
export const WIFI_STATUS: Record<WifiStatus, { label: string; tone: Tone; color: string }> = {
  active: { label: 'Активна', tone: 'ok', color: '#4ade80' },
  inactive: { label: 'Не работает', tone: 'bad', color: '#f87171' },
  unknown: { label: 'Неизвестно', tone: 'neutral', color: '#a3a3a3' },
};

// ---------------- Password cell ----------------
function PasswordCell({ value }: { value: string }) {
  const [shown, setShown] = useState(false);
  if (!value) return <span className="text-faint">—</span>;
  return (
    <div className="flex items-center gap-1">
      <Mono className={cx('min-w-0 flex-1 truncate', !shown && 'tracking-widest text-muted')}>{shown ? value : '••••••••'}</Mono>
      <IconButton label={shown ? 'Скрыть' : 'Показать'} onClick={() => setShown(!shown)}>
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </IconButton>
      <CopyButton value={value} label="Копировать пароль" clearAfterMs={30_000} />
    </div>
  );
}

// ---------------- Editor ----------------
function WifiModal({ net, onClose }: { net: Wifi | 'new'; onClose: () => void }) {
  const isNew = net === 'new';
  const save = useSaveRecord('wifi-networks');
  const [f, setF] = useState<WifiData>(isNew ? EMPTY : { ...EMPTY, ...net });
  const [show, setShow] = useState(isNew);
  const set = <K extends keyof WifiData>(k: K, v: WifiData[K]) => setF((x) => ({ ...x, [k]: v }));
  const coords = `${f.lat ?? ''}${f.lat !== null || f.lng !== null ? ', ' : ''}${f.lng ?? ''}`;

  const parseCoords = (text: string) => {
    const m = text.match(/(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)/);
    if (!m) return setF((x) => ({ ...x, lat: null, lng: null }));
    setF((x) => ({ ...x, lat: Number(m[1]), lng: Number(m[2]) }));
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={isNew ? 'Новая Wi-Fi сеть' : f.name}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ ...(isNew ? {} : { id: net.id }), ...f }, { onSuccess: onClose })}>
            Сохранить
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Название сети (SSID) *">
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="ZhukoNet-Office" autoFocus={isNew} />
        </Field>
        <Field label="Статус">
          <Select value={f.status} onChange={(e) => set('status', e.target.value as WifiStatus)}>
            {Object.entries(WIFI_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-xs font-medium text-muted">Пароль</span>
          <div className="flex gap-2">
            <Input mono aria-label="Пароль" type={show ? 'text' : 'password'} value={f.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" placeholder={f.security === 'open' ? 'без пароля' : ''} />
            <IconButton label={show ? 'Скрыть' : 'Показать'} className="size-9 border border-line" onClick={() => setShow(!show)}>
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </IconButton>
          </div>
        </div>
        <Field label="Защита">
          <Select value={f.security} onChange={(e) => set('security', e.target.value as WifiData['security'])}>
            {Object.entries(SECURITY).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Диапазон">
          <Select value={f.band} onChange={(e) => set('band', e.target.value as WifiData['band'])}>
            <option value="">—</option>
            <option value="2.4">2.4 ГГц</option>
            <option value="5">5 ГГц</option>
            <option value="6">6 ГГц</option>
            <option value="dual">Два диапазона</option>
          </Select>
        </Field>
        <Field label="Клиент">
          <ClientSelect value={f.clientId} onChange={(clientId) => set('clientId', clientId)} />
        </Field>
        <div className="flex items-end pb-2">
          <Checkbox checked={f.hidden} onChange={(v) => set('hidden', v)} label="Скрытая сеть (не вещает SSID)" />
        </div>
        <Field label="Адрес / место" className="sm:col-span-2">
          <Input value={f.location} onChange={(e) => set('location', e.target.value)} placeholder="Офис, 3 этаж / Berlin, Musterstraße 1" />
        </Field>
        <Field label="Координаты (для карты)" className="sm:col-span-2" hint="Широта, долгота — например 52.5200, 13.4050. Можно скопировать из Google/Яндекс Карт.">
          <Input mono defaultValue={f.lat !== null || f.lng !== null ? coords : ''} onChange={(e) => parseCoords(e.target.value)} placeholder="52.5200, 13.4050" />
        </Field>
        <Field label="Теги" className="sm:col-span-2">
          <TagInput value={f.tags} onChange={(v) => set('tags', v)} />
        </Field>
        <Field label="Заметки" className="sm:col-span-2">
          <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
      <ErrorText error={save.error} />
    </Modal>
  );
}

// ---------------- Map ----------------
function WifiMap({ nets, onSelect }: { nets: Wifi[]; onSelect: (n: Wifi) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const pts = useMemo(() => nets.filter((n) => n.lat !== null && n.lng !== null), [nets]);

  useEffect(() => {
    if (!box.current || map.current) return;
    const m = L.map(box.current, { attributionControl: true }).setView([52.52, 13.405], 3);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
      // The page sends no Referer at all; OSM's tile policy rejects such requests (403).
      // Tiles alone send just the portal origin, as the policy requires.
      referrerPolicy: 'strict-origin-when-cross-origin',
      className: 'zn-dark-tiles',
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const lg = layer.current;
    if (!m || !lg) return;
    lg.clearLayers();
    for (const n of pts) {
      const color = WIFI_STATUS[n.status].color;
      const icon = L.divIcon({
        className: '',
        html: `<span style="display:flex;width:18px;height:18px;border-radius:50%;background:${color};border:2px solid #0a0a0a;box-shadow:0 0 0 2px ${color}55"></span>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      const marker = L.marker([n.lat!, n.lng!], { icon, title: n.name }).addTo(lg);
      const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
      marker.bindPopup(
        `<div style="font-family:sans-serif;min-width:140px">
          <b>${esc(n.name)}</b><br>
          <span style="color:#555">${WIFI_STATUS[n.status].label}${n.location ? ' · ' + esc(n.location) : ''}</span>
        </div>`,
      );
      marker.on('click', () => onSelectRef.current(n));
    }
    if (pts.length) {
      const bounds = L.latLngBounds(pts.map((n) => [n.lat!, n.lng!] as [number, number]));
      m.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    }
  }, [pts]);

  return (
    <Card>
      {pts.length === 0 && (
        <div className="border-b border-line px-4 py-2 text-xs text-faint">
          Ни у одной сети нет координат. Добавьте «Координаты» в карточке сети, чтобы она появилась на карте. Остальные {nets.length} сетей видны в списке.
        </div>
      )}
      <div ref={box} className="h-[65dvh] min-h-80 w-full rounded-b-lg" style={{ background: '#111' }} />
    </Card>
  );
}

// ---------------- Page ----------------
export default function WifiPage() {
  const { data = [], isLoading } = useRecords('wifi-networks');
  const del = useDeleteRecord('wifi-networks');
  const cli = useClientNames();
  const confirm = useConfirm();
  const [view, setView] = useState<'list' | 'map'>('list');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Wifi | 'new' | null>(null);

  const list = data
    .filter((n) => (!status || n.status === status) && (!clientId || n.clientId === clientId))
    .filter((n) => matches(q, n.name, n.location, n.notes, n.tags, cli(n.clientId)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  return (
    <>
      <PageHeader
        title="Wi-Fi сети"
        description="База Wi-Fi сетей: название, пароль, статус и расположение на карте"
        actions={
          <>
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { id: 'list', label: <List className="size-3.5" />, title: 'Список' },
                { id: 'map', label: <MapIcon className="size-3.5" />, title: 'Карта' },
              ]}
            />
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>
              Добавить сеть
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Название, место, тег…" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-44">
          <option value="">Любой статус</option>
          {Object.entries(WIFI_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
        <div className="sm:w-56">
          <ClientSelect value={clientId} onChange={setClientId} emptyLabel="Все клиенты" />
        </div>
        <span className="text-xs text-faint sm:ml-auto">{list.length} из {data.length}</span>
      </div>

      {isLoading ? (
        <Loading />
      ) : view === 'map' ? (
        <WifiMap nets={list} onSelect={setEdit} />
      ) : list.length === 0 ? (
        <Card>
          <Empty icon={<WifiIcon />} title={data.length ? 'Ничего не найдено' : 'Сетей пока нет'}>
            {!data.length && 'Нажмите «Добавить сеть», чтобы завести первую запись.'}
          </Empty>
        </Card>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th className={th}>Сеть</th>
                <th className={th}>Статус</th>
                <th className={`${th} min-w-48`}>Пароль</th>
                <th className={`${th} hidden md:table-cell`}>Защита</th>
                <th className={`${th} hidden lg:table-cell`}>Место / клиент</th>
                <th className={`${th} hidden xl:table-cell`}>Изменена</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {list.map((n) => (
                <tr key={n.id} className={trHover}>
                  <td className={td}>
                    <div className="flex items-center gap-2">
                      {n.status === 'inactive' ? <WifiOff className="size-4 text-bad" /> : <WifiIcon className="size-4 text-muted" />}
                      <div>
                        <div className="font-medium">{n.name}</div>
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {n.hidden && <Badge>скрытая</Badge>}
                          {n.band && <Badge>{n.band === 'dual' ? '2.4+5' : n.band} ГГц</Badge>}
                          {n.tags.map((t) => (
                            <Badge key={t}>{t}</Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className={td}>
                    <Badge tone={WIFI_STATUS[n.status].tone}>{WIFI_STATUS[n.status].label}</Badge>
                  </td>
                  <td className={td}>
                    <PasswordCell value={n.password} />
                  </td>
                  <td className={`${td} hidden md:table-cell text-muted`}>{SECURITY[n.security]}</td>
                  <td className={`${td} hidden lg:table-cell text-muted`}>
                    <div className="truncate max-w-56">{n.location || '—'}</div>
                    {n.clientId && (
                      <Link to={`/clients/${n.clientId}`} className="text-xs text-faint underline decoration-line-strong underline-offset-2 hover:text-fg" onClick={(e) => e.stopPropagation()}>
                        {cli(n.clientId)}
                      </Link>
                    )}
                  </td>
                  <td className={`${td} hidden xl:table-cell text-xs text-faint whitespace-nowrap`}>{fmtAgo(n.updatedAt)}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    <IconButton label="Изменить" onClick={() => setEdit(n)}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton
                      label="Удалить"
                      onClick={async () => {
                        if (await confirm({ title: `Удалить сеть «${n.name}»?`, body: 'Запись попадёт в корзину на 30 дней.', danger: true, confirmText: 'Удалить' })) del.mutate(n.id);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {edit && <WifiModal net={edit} onClose={() => setEdit(null)} />}
    </>
  );
}
