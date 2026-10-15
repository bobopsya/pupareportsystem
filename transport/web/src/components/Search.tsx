import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Briefcase, Clock, Home as HomeIcon, MapPin, Search as SearchIcon, Star, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, errorText } from '../lib/api';
import type { Place, SavedPlace } from '../lib/types';
import { cx, Spinner } from './ui';

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const placeIcon = (kind?: string) => (kind === 'home' ? HomeIcon : kind === 'work' ? Briefcase : kind === 'fav' ? Star : kind === 'recent' ? Clock : MapPin);

export const savedToPlace = (p: SavedPlace): Place => ({ lat: p.lat, lon: p.lon, title: p.kind === 'fav' ? p.title : p.address, subtitle: p.kind === 'fav' ? p.address : p.title });

function Results({ query, saved, recent, onPick }: { query: string; saved: SavedPlace[]; recent: Place[]; onPick: (p: Place) => void }) {
  const q = useDebounced(query.trim(), 450);
  const { data, isFetching, error } = useQuery({ queryKey: ['search', q.toLowerCase()], queryFn: () => api<{ items: Place[] }>(`/geo/search?q=${encodeURIComponent(q)}`), enabled: q.length >= 3, staleTime: 600_000, retry: false });
  const rows: { key: string; icon: ReturnType<typeof placeIcon>; place: Place }[] = [];
  if (q.length < 3) {
    for (const s of saved) rows.push({ key: s.id, icon: placeIcon(s.kind), place: savedToPlace(s) });
    for (const r of recent) rows.push({ key: `r${r.lat}${r.lon}`, icon: placeIcon('recent'), place: r });
  } else for (const p of data?.items ?? []) rows.push({ key: `${p.lat},${p.lon}`, icon: MapPin, place: p });
  return (
    <div className="flex flex-col">
      {q.length >= 3 && isFetching && !data && (
        <div className="flex items-center gap-3 px-5 py-4 text-muted">
          <Spinner /> Ищем адрес…
        </div>
      )}
      {error && <div className="px-5 py-4 text-[15px] text-bad">{errorText(error)}</div>}
      {q.length >= 3 && data && !data.items.length && <div className="px-5 py-4 text-[15px] text-muted">Ничего не нашли в Москве. Попробуйте «улица, дом» или выберите точку на карте.</div>}
      {rows.map(({ key, icon: Icon, place }) => (
        <button key={key} type="button" onClick={() => onPick(place)} className="flex items-center gap-4 px-5 py-3 text-left hover:bg-sunken">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sunken">
            <Icon className="size-[18px]" />
          </span>
          <span className="min-w-0 flex-1 border-b border-line pb-3 pt-1">
            <span className="block truncate text-[16px] font-medium">{place.title}</span>
            {place.subtitle && <span className="block truncate text-sm text-muted">{place.subtitle}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

function Field({ value, onChange, placeholder, focused, onFocus, dot, autoFocus }: { value: string; onChange: (v: string) => void; placeholder: string; focused: boolean; onFocus: () => void; dot: 'from' | 'to'; autoFocus?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  return (
    <label className={cx('flex h-12 items-center gap-3 rounded-2xl px-4 transition-colors', focused ? 'bg-sunken ring-2 ring-ink' : 'bg-sunken')}>
      <span className={cx('size-3 shrink-0 border-[3px] border-ink', dot === 'from' ? 'rounded-full bg-brand' : 'rounded-[3px] bg-surface')} />
      <input ref={ref} value={value} onChange={(e) => onChange(e.target.value)} onFocus={onFocus} placeholder={placeholder} enterKeyHint="search" autoComplete="off" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint" />
      {value && focused && (
        <button type="button" aria-label="Очистить" onMouseDown={(e) => e.preventDefault()} onClick={() => onChange('')} className="text-muted">
          <X className="size-4" />
        </button>
      )}
    </label>
  );
}

/** Full-screen address search: «Откуда» and «Куда», saved places, a point on the map. */
export function RouteSearch({ from, to, focus, saved, recent, onClose, onPickOnMap, onDone }: {
  from: Place | null;
  to: Place | null;
  focus: 'from' | 'to';
  saved: SavedPlace[];
  recent: Place[];
  onClose: () => void;
  onPickOnMap: (field: 'from' | 'to') => void;
  onDone: (from: Place | null, to: Place | null) => void;
}) {
  const [field, setField] = useState(focus);
  const [qFrom, setQFrom] = useState(from?.title ?? '');
  const [qTo, setQTo] = useState(to?.title ?? '');
  const [f, setF] = useState(from);
  const pick = (p: Place) => {
    if (field === 'from') {
      setF(p);
      setQFrom(p.title);
      if (to) onDone(p, to);
      else setField('to');
    } else onDone(f, p);
  };
  const query = field === 'from' ? (qFrom === f?.title ? '' : qFrom) : qTo === to?.title ? '' : qTo;
  return (
    <div className="bt-fade fixed inset-0 z-[1000] flex flex-col bg-surface">
      <div className="flex flex-col gap-2 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Назад" onClick={onClose} className="-ml-1 inline-flex size-10 items-center justify-center rounded-full hover:bg-sunken">
            <ArrowLeft className="size-5" />
          </button>
          <h1 className="text-lg font-bold">Маршрут</h1>
        </div>
        <Field dot="from" value={qFrom} onChange={setQFrom} placeholder="Откуда" focused={field === 'from'} onFocus={() => setField('from')} autoFocus={focus === 'from'} />
        <Field dot="to" value={qTo} onChange={setQTo} placeholder="Куда едем?" focused={field === 'to'} onFocus={() => setField('to')} autoFocus={focus === 'to'} />
      </div>
      <button type="button" onClick={() => onPickOnMap(field)} className="mx-4 mb-1 flex items-center gap-3 rounded-2xl px-1 py-2 text-left text-[15px] font-semibold hover:bg-sunken">
        <span className="flex size-9 items-center justify-center rounded-full bg-brand text-on-brand">
          <MapPin className="size-[18px]" />
        </span>
        Указать {field === 'from' ? 'место подачи' : 'адрес'} на карте
      </button>
      <div className="flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
        <Results query={query} saved={saved} recent={recent} onPick={pick} />
      </div>
    </div>
  );
}

/** One address (for «Дом», «Работа»). */
export function PlaceSearch({ title, onClose, onPick }: { title: string; onClose: () => void; onPick: (p: Place) => void }) {
  const [q, setQ] = useState('');
  return (
    <div className="bt-fade fixed inset-0 z-[1000] flex flex-col bg-surface">
      <div className="flex flex-col gap-2 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Назад" onClick={onClose} className="-ml-1 inline-flex size-10 items-center justify-center rounded-full hover:bg-sunken">
            <ArrowLeft className="size-5" />
          </button>
          <h1 className="text-lg font-bold">{title}</h1>
        </div>
        <label className="flex h-12 items-center gap-3 rounded-2xl bg-sunken px-4 ring-2 ring-ink">
          <SearchIcon className="size-5 text-muted" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Улица и дом" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint" />
        </label>
      </div>
      <div className="flex-1 overflow-y-auto">
        <Results query={q} saved={[]} recent={[]} onPick={onPick} />
      </div>
    </div>
  );
}
