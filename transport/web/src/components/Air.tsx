import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Car, ChevronRight, Plane, ShieldCheck, Users } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, errorText } from '../lib/api';
import { rub } from '../lib/format';
import { distance } from '../lib/geo';
import type { Account, AirPlace, AirQuote, LatLon, Ride } from '../lib/types';
import { FitBounds, heliSvg, jetSvg, PlaceMarkers, RouteLine } from '../map/Map';
import { Button, cx, Modal, useToast } from './ui';

interface Places {
  helipads: AirPlace[];
  origins: AirPlace[];
  destinations: AirPlace[];
}

const hours = (s: number) => {
  const m = Math.round(s / 60);
  return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч${m % 60 ? ` ${m % 60} мин` : ''}`;
};

export function AircraftIcon({ kind, className }: { kind: 'heli' | 'jet'; className?: string }) {
  return <span className={cx('inline-flex items-center justify-center [&_svg]:!filter-none', className)} dangerouslySetInnerHTML={{ __html: kind === 'heli' ? heliSvg('#3b4a63', 0.8) : jetSvg('#f4f4f2', 0.8) }} />;
}

function PlacePicker({ open, title, places, near, onPick, onClose }: { open: boolean; title: string; places: AirPlace[]; near: LatLon; onPick: (p: AirPlace) => void; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="-mx-2 flex flex-col">
        {places.map((p) => (
          <button key={p.code} type="button" onClick={() => onPick(p)} className="flex items-center gap-3 rounded-2xl px-2 py-2.5 text-left hover:bg-sunken">
            <span className="flex h-9 min-w-11 items-center justify-center rounded-xl bg-ink px-1.5 text-xs font-bold text-on-ink">{p.code}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold">{p.title}</span>
              <span className="block truncate text-sm text-muted">{p.subtitle}</span>
            </span>
            <span className="shrink-0 text-sm text-muted num">{Math.round(distance(near, [p.lat, p.lon]) / 1000).toLocaleString('ru-RU')} км</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

/**
 * Helicopter or private jet booking: places from the list, aircraft classes with the price,
 * and the order. Returns the sheet and the map layers for the page.
 */
export function useAirPlanner({ kind, center, linked, account, login, onTaxiTo }: { kind: 'heli' | 'jet'; center: LatLon; linked: boolean; account?: Account; login: () => void; onTaxiTo: (p: AirPlace) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: places } = useQuery({ queryKey: ['air-places'], queryFn: () => api<Places>('/air/places'), staleTime: Infinity });
  const fromList = kind === 'heli' ? places?.helipads : places?.origins;
  const toList = kind === 'heli' ? places?.helipads : places?.destinations;
  const [from, setFrom] = useState<AirPlace | null>(null);
  const [to, setTo] = useState<AirPlace | null>(null);
  const [picker, setPicker] = useState<null | 'from' | 'to'>(null);
  const [cls, setCls] = useState<string | null>(null);

  // Reset when switching between helicopter and jet; start from the nearest place.
  useEffect(() => {
    setTo(null);
    setCls(null);
    if (fromList?.length) setFrom([...fromList].sort((a, b) => distance(center, [a.lat, a.lon]) - distance(center, [b.lat, b.lon]))[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, fromList]);

  const quote = useMutation({ mutationFn: () => api<AirQuote>('/air/estimate', { body: { kind, from: from!.code, to: to!.code } }), onError: (e) => toast(errorText(e), 'bad') });
  useEffect(() => {
    if (from && to && from.code !== to.code) quote.mutate();
    else quote.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from?.code, to?.code, kind]);
  const q = quote.data && quote.data.kind === kind && quote.data.from.code === from?.code && quote.data.to.code === to?.code ? quote.data : null;
  useEffect(() => {
    if (q && !q.options.find((o) => o.id === cls && o.available)) setCls(q.options.find((o) => o.available)?.id ?? null);
  }, [q, cls]);
  const opt = q?.options.find((o) => o.id === cls);

  const order = useMutation({
    mutationFn: () => api<Ride>('/rides/air', { body: { estimateId: q!.id, classId: cls } }),
    onSuccess: (r) => {
      qc.setQueryData(['ride'], { ride: r, offset: r.now - Date.now() });
      void qc.invalidateQueries({ queryKey: ['account'] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'estimate_expired') quote.mutate();
      toast(errorText(e), 'bad');
    },
  });

  const overLimit = !!opt && account?.limit !== undefined && opt.price > account.limit;
  const short = !!opt && account?.available !== undefined && opt.price > account.available;

  const row = (label: string, p: AirPlace | null, placeholder: string, onClick: () => void, dot: 'from' | 'to') => (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl bg-sunken px-4 py-2.5 text-left hover:bg-hover">
      <span className={cx('size-3 shrink-0 border-[3px] border-ink', dot === 'from' ? 'rounded-full bg-brand' : 'rounded-[3px] bg-surface')} />
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted">{label}</span>
        <span className={cx('block truncate text-[16px] font-semibold', !p && 'text-muted')}>{p ? p.title : placeholder}</span>
      </span>
      {p && <span className="rounded-lg bg-surface px-1.5 py-0.5 text-xs font-bold">{p.code}</span>}
      <ChevronRight className="size-4 text-muted" />
    </button>
  );

  const sheet: ReactNode = (
    <>
      <div className="flex flex-col gap-2">
        {row(kind === 'heli' ? 'Вертодром вылета' : 'Аэропорт вылета', from, 'Выберите', () => setPicker('from'), 'from')}
        {row(kind === 'heli' ? 'Куда летим' : 'Город назначения', to, kind === 'heli' ? 'Выберите вертодром' : 'Выберите город', () => setPicker('to'), 'to')}
      </div>
      {q && (
        <>
          <div className="no-scrollbar -mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1">
            {q.options.map((o) => (
              <button key={o.id} type="button" disabled={!o.available} onClick={() => setCls(o.id)} className={cx('flex w-[148px] shrink-0 flex-col items-start rounded-2xl border-2 p-2.5 text-left transition-colors disabled:opacity-45', cls === o.id ? 'border-ink bg-surface' : 'border-transparent bg-sunken')}>
                <AircraftIcon kind={kind} className="-ml-1 -mt-1 size-10" />
                <span className="text-[13px] font-medium text-muted">{o.title}</span>
                <span className="w-full truncate text-[13px] font-semibold">{o.model}</span>
                <span className="mt-1 text-[16px] font-bold num">{o.available ? rub(o.price) : 'Не долетит'}</span>
                <span className="inline-flex items-center gap-1 text-xs text-muted">
                  {hours(o.durationS)} · <Users className="size-3" /> {o.seats}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            {(q.distance / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} км по прямой{opt ? ` · в полёте ${hours(opt.durationS)}` : ''} · экипаж — боты · игровое время ×{q.timeScale}
          </p>
        </>
      )}
      {quote.isPending && <div className="mt-3 h-[150px] animate-pulse rounded-2xl bg-sunken" />}
      {linked && opt && (overLimit || short) && (
        <p className={cx('mt-3 flex items-start gap-2 rounded-2xl px-3 py-2.5 text-sm', short ? 'bg-bad-soft text-bad' : 'bg-brand-soft')}>
          <ShieldCheck className="mt-0.5 size-4 shrink-0" />
          {short ? `На счёте Bobobank доступно ${rub(account?.available ?? 0)} — не хватит на этот борт.` : 'Сумма больше лимита привязки: банк попросит подтвердить её в приложении Bobobank.'}
        </p>
      )}
      {linked ? (
        <Button className="mt-3 w-full" size="lg" variant="brand" loading={order.isPending} disabled={!opt || !opt.available || quote.isPending} onClick={() => order.mutate()}>
          {opt ? `Забронировать · ${rub(opt.price)}` : to ? 'Выберите борт' : kind === 'heli' ? 'Выберите, куда летим' : 'Выберите город'}
        </Button>
      ) : (
        <Button className="mt-3 w-full" size="lg" variant="ink" onClick={login}>
          Войти через Bobobank
        </Button>
      )}
      {from && (
        <button type="button" onClick={() => onTaxiTo(from)} className="mt-2 flex h-10 w-full items-center justify-center gap-2 text-[15px] font-semibold text-muted hover:text-fg">
          <Car className="size-[18px]" />
          Такси до «{from.title}»
        </button>
      )}
      <PlacePicker open={picker === 'from'} title={kind === 'heli' ? 'Откуда летим' : 'Аэропорт вылета'} places={fromList ?? []} near={center} onClose={() => setPicker(null)} onPick={(p) => (setFrom(p), setPicker(null))} />
      <PlacePicker open={picker === 'to'} title={kind === 'heli' ? 'Куда летим' : 'Куда летим'} places={(toList ?? []).filter((p) => p.code !== from?.code)} near={from ? [from.lat, from.lon] : center} onClose={() => setPicker(null)} onPick={(p) => (setTo(p), setPicker(null))} />
    </>
  );

  const fit = useMemo<LatLon[]>(() => (q ? q.route : from ? [[from.lat, from.lon]] : []), [q, from]);
  const markers = useMemo(() => (kind === 'heli' ? (places?.helipads ?? []) : [from, to].filter((x): x is AirPlace => !!x)), [kind, places, from, to]);
  const layers: ReactNode = (
    <>
      {q && <RouteLine path={q.route} dashed={false} weight={4} />}
      <PlaceMarkers kind={kind} places={markers} selected={[from?.code, to?.code].filter((x): x is string => !!x)} onPick={kind === 'heli' ? (code) => { const p = places?.helipads.find((x) => x.code === code); if (p && p.code !== from?.code) setTo(p); } : undefined} />
      <FitBounds points={fit.length ? fit : [center]} padding={[60, 60]} maxZoom={kind === 'heli' && !q ? 11 : 13} />
    </>
  );

  return { sheet, layers };
}

export const PlaneIcon = Plane;
