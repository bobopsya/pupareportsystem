import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Briefcase, Bus as BusIcon, ChevronRight, Clock, CreditCard, History as HistoryIcon, Home as HomeIcon, LocateFixed, LogOut, Menu, MessageSquare, Settings, Shield, User } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAirPlanner } from '../components/Air';
import { BusOptions, StopBoard } from '../components/Bus';
import { LogoMark, Logo } from '../components/Logo';
import { ChildIcon, RideSheet, SurgeBadge, TariffCar } from '../components/Ride';
import { RouteSearch, savedToPlace } from '../components/Search';
import { Button, cx, FloatButton, Modal, Spinner, useToast } from '../components/ui';
import { api, ApiError, errorText } from '../lib/api';
import { minutes, rub, km } from '../lib/format';
import { inMoscow, MOSCOW_CENTER } from '../lib/geo';
import { useAccount, useCurrentRide, useMe, usePlaces } from '../lib/hooks';
import type { BusPlan, Estimate, LatLon, Mode as Transport, Place, Ride, TariffId } from '../lib/types';
import { BackgroundCars, BusStops, FitBounds, LiveBuses, MapView, PointMarker, RideCar, RouteLine, SearchPulse, StopDots, useLeaflet } from '../map/Map';

type Mode = 'main' | 'pick' | 'estimate';

const TRANSPORTS: { id: Transport; label: string }[] = [
  { id: 'taxi', label: 'Такси' },
  { id: 'bus', label: 'Автобус' },
  { id: 'heli', label: 'Вертолёт' },
  { id: 'jet', label: 'Джет' },
];

function TransportSwitch({ value, onChange }: { value: Transport; onChange: (t: Transport) => void }) {
  return (
    <div className="mb-3 grid grid-cols-4 gap-1 rounded-2xl bg-sunken p-1" role="tablist">
      {TRANSPORTS.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)} className={cx('h-9 truncate rounded-xl px-0.5 text-[12px] font-semibold transition-colors min-[360px]:text-[13px]', value === t.id ? 'bg-surface shadow-sm' : 'text-muted')}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

const login = () => window.location.assign('/api/auth/bank/start');

type BusMode = 'charter' | 'route';
const LINE_RE = /^[а-яё]{0,2}\d{1,4}[а-яё]?$/i;
const savedLine = () => {
  try {
    return localStorage.getItem('bt-line') || '561';
  } catch {
    return '561';
  }
};

/** Which city line to call: any number, the imported lines as hints. */
function LinePicker({ open, value, onClose, onPick }: { open: boolean; value: string; onClose: () => void; onPick: (ref: string) => void }) {
  const [q, setQ] = useState(value);
  useEffect(() => setQ(value), [open, value]);
  const { data } = useQuery({ queryKey: ['bus-lines'], queryFn: () => api<{ lines: { ref: string; kind: string; colour: string | null; title: string }[] }>('/bus/lines'), enabled: open, staleTime: Infinity });
  const ref = q.trim().toLowerCase();
  const ok = LINE_RE.test(ref);
  const hints = (data?.lines ?? []).filter((l) => l.kind === 'bus' && (!ref || l.ref.toLowerCase().startsWith(ref))).slice(0, 40);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Какой автобус вызвать?"
      footer={
        <Button variant="ink" size="lg" disabled={!ok} onClick={() => onPick(ref)}>
          {ok ? `Вызвать автобус ${ref}` : 'Например 561, м3 или т25'}
        </Button>
      }
    >
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value.slice(0, 6))} placeholder="Номер маршрута" inputMode="text" className="h-14 w-full rounded-2xl bg-sunken px-4 text-[20px] font-bold outline-none focus:ring-2 focus:ring-ink" />
      <p className="mt-2 text-sm text-muted">Любой номер — приедет городской автобус с ним на табличке. Ниже — маршруты, что ходят по карте.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {hints.map((l) => (
          <button key={l.ref} type="button" title={l.title} onClick={() => onPick(l.ref.toLowerCase())} className="inline-flex h-9 min-w-12 items-center justify-center rounded-xl px-2.5 text-[15px] font-bold text-white" style={{ background: l.colour || '#d0021b' }}>
            {l.ref}
          </button>
        ))}
      </div>
    </Modal>
  );
}
/** Bus tab: a chartered bus like a taxi, or a city bus on its line. */
function BusModeSwitch({ value, onChange }: { value: BusMode; onChange: (m: BusMode) => void }) {
  return (
    <div className="-mt-1 mb-3 flex gap-2">
      {([['charter', 'Заказать автобус'], ['route', 'Городской по маршруту']] as const).map(([id, label]) => (
        <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)} className={cx('h-8 rounded-full px-3 text-[13px] font-semibold transition-colors', value === id ? 'bg-ink text-on-ink' : 'bg-sunken text-muted')}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Centre pin: lifts while the map moves, the address bubble sits above it. */
function CenterPin({ moving, label, kind }: { moving: boolean; label: string | null; kind: 'from' | 'to' }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-[500] -translate-x-1/2 -translate-y-full">
      <div className={cx('flex flex-col items-center transition-transform duration-200', moving ? '-translate-y-3' : '')}>
        {label !== null && (
          <span className={cx('mb-2 max-w-[240px] truncate rounded-2xl bg-ink px-3 py-1.5 text-[13px] font-semibold text-on-ink shadow-[var(--shadow-float)] transition-opacity', moving ? 'opacity-0' : 'opacity-100')}>
            {label || <Spinner className="size-4 text-on-ink" />}
          </span>
        )}
        <span className={cx('flex size-11 items-center justify-center border-[3px] border-white bg-ink shadow-[var(--shadow-float)]', kind === 'from' ? 'rounded-full' : 'rounded-xl')}>
          <span className={cx('size-3.5 bg-brand', kind === 'from' ? 'rounded-full' : 'rounded-[3px] bg-white')} />
        </span>
        <span className="h-4 w-[3px] rounded-b bg-ink" />
      </div>
      <span className={cx('absolute -bottom-1 left-1/2 h-1.5 w-3 -translate-x-1/2 rounded-full bg-black/30 transition-transform', moving ? 'scale-75' : '')} />
    </div>
  );
}

/** Imperative bits of the map the page needs (fly to the user's location). */
function MapHandle({ onReady }: { onReady: (fly: (p: LatLon, z?: number) => void) => void }) {
  const map = useLeaflet();
  useEffect(() => {
    if (map) onReady((p, z) => map.flyTo(p, z ?? Math.max(map.getZoom(), 16), { duration: 0.7 }));
  }, [map, onReady]);
  return null;
}

function Drawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const u = me?.user;
  if (!open) return null;
  const item = (to: string, icon: React.ReactNode, label: string) => (
    <Link to={to} onClick={onClose} className="flex items-center gap-4 rounded-2xl px-3 py-3 text-[16px] font-medium hover:bg-sunken">
      {icon}
      {label}
    </Link>
  );
  return (
    <div className="fixed inset-0 z-[1050] bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="bt-fade flex h-full w-[min(320px,86vw)] flex-col bg-surface px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="px-3 pb-4">
          <Logo />
        </div>
        {u ? (
          <Link to="/profile" onClick={onClose} className="mb-2 flex items-center gap-3 rounded-2xl bg-sunken px-3 py-3">
            <span className="flex size-11 items-center justify-center rounded-full bg-brand text-lg font-bold text-on-brand">{u.name[0]}</span>
            <span className="min-w-0">
              <span className="block truncate font-semibold">{u.name}</span>
              <span className="block text-sm text-muted">{u.phone}</span>
            </span>
          </Link>
        ) : (
          <Button variant="ink" className="mx-1 mb-3" onClick={login}>
            Войти через Bobobank
          </Button>
        )}
        {u && item('/rides', <HistoryIcon className="size-5" />, 'Мои поездки')}
        {u && item('/profile', <User className="size-5" />, 'Профиль и оплата')}
        {u?.role === 'admin' && item('/admin', <Shield className="size-5" />, 'Админка')}
        <a href={me?.bankUrl ?? '#'} className="flex items-center gap-4 rounded-2xl px-3 py-3 text-[16px] font-medium hover:bg-sunken">
          <CreditCard className="size-5" />
          Bobobank
        </a>
        <div className="flex-1" />
        {u && (
          <button
            type="button"
            onClick={() => void api('/auth/logout', { body: {} }).then(() => {
              qc.clear();
              onClose();
              nav('/');
              window.location.reload();
            })}
            className="flex items-center gap-4 rounded-2xl px-3 py-3 text-[16px] font-medium text-bad hover:bg-sunken"
          >
            <LogOut className="size-5" />
            Выйти
          </button>
        )}
        <p className="px-3 pt-2 text-xs text-faint">Игровое такси: машины и водители — боты. Карта © участники OpenStreetMap.</p>
      </aside>
    </div>
  );
}

export default function Home() {
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: me } = useMe();
  const user = me?.user ?? null;
  const { data: account } = useAccount(!!user?.linked);
  const { data: places } = usePlaces(!!user);
  const { data: rideData } = useCurrentRide(!!user);
  const ride: Ride | null = rideData?.ride ?? null;

  const [center, setCenter] = useState<LatLon>(MOSCOW_CENTER);
  const [moving, setMoving] = useState(false);
  const [mode, setMode] = useState<Mode>('main');
  const [pickField, setPickField] = useState<'from' | 'to'>('to');
  const [from, setFrom] = useState<Place | null>(null);
  const [fromLocked, setFromLocked] = useState(false);
  const [to, setTo] = useState<Place | null>(null);
  const [pinPlace, setPinPlace] = useState<Place | null>(null);
  const [search, setSearch] = useState<null | 'from' | 'to'>(null);
  const [drawer, setDrawer] = useState(false);
  const [tariff, setTariff] = useState<TariffId>('econom');
  const [busMode, setBusMode] = useState<BusMode>('charter');
  const [line, setLine] = useState(savedLine);
  const [linePicker, setLinePicker] = useState(false);
  const pickLine = (ref: string) => {
    setLine(ref);
    setLinePicker(false);
    try {
      localStorage.setItem('bt-line', ref);
    } catch {
      /* private mode */
    }
  };
  const [childSeat, setChildSeat] = useState(false);
  const [comment, setComment] = useState('');
  const [commentOpen, setCommentOpen] = useState(false);
  const [transport, setTransport] = useState<Transport>('taxi');
  const [busOpt, setBusOpt] = useState(0);
  const [stop, setStop] = useState<string | null>(null);
  const fly = useRef<(p: LatLon, z?: number) => void>(() => {});
  const onMapReady = useCallback((f: (p: LatLon, z?: number) => void) => (fly.current = f), []);

  // Messages after «Войти через Bobobank».
  useEffect(() => {
    const err = params.get('auth_error');
    if (params.get('connected')) toast('Счёт Bobobank привязан — можно ехать');
    if (err) toast(err, 'bad');
    if (err || params.get('connected')) setParams({}, { replace: true });
  }, [params, setParams, toast]);

  // Start where the user is, if they let us and they are in Moscow.
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const ll: LatLon = [p.coords.latitude, p.coords.longitude];
        if (inMoscow(ll)) fly.current(ll, 16);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 60_000 },
    );
  }, []);

  // Address under the pin.
  const pinActive = !ride && (mode === 'main' || mode === 'pick') && transport !== 'heli' && transport !== 'jet';
  useEffect(() => {
    if (!pinActive || moving) return;
    let stop = false;
    setPinPlace(null);
    const t = setTimeout(() => {
      api<Place>(`/geo/reverse?lat=${center[0].toFixed(6)}&lon=${center[1].toFixed(6)}`)
        .then((p) => !stop && setPinPlace(p))
        .catch(() => !stop && setPinPlace({ lat: center[0], lon: center[1], title: 'Точка на карте', subtitle: '' }));
    }, 350);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [center, moving, pinActive]);
  useEffect(() => {
    if (mode === 'main' && pinPlace && !fromLocked) setFrom(pinPlace);
  }, [mode, pinPlace, fromLocked]);

  const est = useMutation({
    mutationFn: (b: { from: Place; to: Place }) => api<Estimate>('/rides/estimate', { body: b }),
    onError: (e) => {
      toast(errorText(e), 'bad');
      setMode('main');
    },
  });
  const routeBus = transport === 'bus' && busMode === 'route';
  const taxiLike = transport === 'taxi' || (transport === 'bus' && busMode === 'charter');
  const estimate = est.data && mode === 'estimate' && taxiLike ? est.data : null;
  const busPlan = useMutation({
    mutationFn: (b: { from: Place; to: Place }) => api<BusPlan>('/bus/plan', { body: b }),
    onSuccess: () => setBusOpt(0),
    onError: (e) => {
      toast(errorText(e), 'bad');
      setMode('main');
    },
  });
  const plan = busPlan.data && mode === 'estimate' && routeBus ? busPlan.data : null;
  const runEstimate = (f: Place, t: Place, kind: Transport = transport, bm: BusMode = busMode) => {
    setFrom(f);
    setTo(t);
    setMode('estimate');
    if (kind === 'bus' && bm === 'route') busPlan.mutate({ from: f, to: t });
    else est.mutate({ from: f, to: t });
  };
  const busOrder = useMutation({
    mutationFn: () => api<Ride>('/rides/bus', { body: { estimateId: plan!.id, option: busOpt } }),
    onSuccess: (r) => qc.setQueryData(['ride'], { ride: r, offset: r.now - Date.now() }),
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'estimate_expired' && from && to) busPlan.mutate({ from, to });
      toast(errorText(e), 'bad');
    },
  });
  // Prices are valid for 15 minutes; refresh quietly before that.
  useEffect(() => {
    if (mode !== 'estimate' || !from || !to || !taxiLike) return;
    const t = setInterval(() => est.mutate({ from, to }), 10 * 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, from, to, taxiLike]);

  const order = useMutation({
    mutationFn: () => api<Ride>('/rides', { body: { estimateId: estimate!.id, tariff: selected!.id, childSeat: seatOk && childSeat, comment: comment || undefined, line: selected!.id === 'bus_city' ? line : undefined } }),
    onSuccess: (r) => {
      qc.setQueryData(['ride'], { ride: r, offset: r.now - Date.now() });
      void qc.invalidateQueries({ queryKey: ['account'] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'estimate_expired' && from && to) est.mutate({ from, to });
      if (e instanceof ApiError && (e.code === 'no_mandate' || e.code === 'mandate_revoked')) void qc.invalidateQueries({ queryKey: ['me'] });
      toast(errorText(e), 'bad');
    },
  });

  const resetTrip = () => {
    setMode('main');
    setTo(null);
    setFromLocked(false);
    est.reset();
    busPlan.reset();
  };
  const isAir = transport === 'heli' || transport === 'jet';
  const air = useAirPlanner({
    kind: transport === 'jet' ? 'jet' : 'heli',
    center,
    linked: !!user?.linked,
    account,
    login,
    onTaxiTo: (p) => {
      setTransport('taxi');
      runEstimate(from ?? pinPlace ?? { lat: center[0], lon: center[1], title: 'Точка на карте', subtitle: '' }, { lat: p.lat, lon: p.lon, title: p.title, subtitle: p.subtitle }, 'taxi');
    },
  });
  const switchTransport = (t: Transport) => {
    setTransport(t);
    if (t === 'bus') setTariff('bus_city');
    else if (t === 'taxi') setTariff('econom');
    if (mode === 'estimate' && from && to && (t === 'taxi' || t === 'bus')) runEstimate(from, to, t);
    else if (t === 'heli' || t === 'jet') setMode('main');
  };
  const switchBusMode = (m: BusMode) => {
    setBusMode(m);
    if (mode === 'estimate' && from && to) runEstimate(from, to, 'bus', m);
  };

  const saved = places?.places ?? [];
  const recent = places?.recent ?? [];
  const home = saved.find((p) => p.kind === 'home');
  const work = saved.find((p) => p.kind === 'work');
  const tariffs = estimate?.tariffs.filter((t) => (t.vehicle ?? 'car') === (transport === 'bus' ? 'bus' : 'car'));
  const selected = tariffs?.find((t) => t.id === tariff) ?? tariffs?.[0];
  const seatOk = selected?.vehicle !== 'bus' && selected?.id !== 'kids';
  const price = selected ? selected.price + (childSeat && seatOk ? estimate!.childSeat : 0) : 0;
  const short = account?.linked && account.available !== undefined && price > 0 && account.available < Math.ceil((price * 1.2) / 100) * 100;

  const locate = () => {
    if (!('geolocation' in navigator)) return toast('Браузер не даёт определить место', 'bad');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const ll: LatLon = [p.coords.latitude, p.coords.longitude];
        if (!inMoscow(ll)) return toast('Вы не в Москве — Бобо.Транспорт работает только здесь', 'bad');
        setFromLocked(false);
        fly.current(ll, 17);
      },
      () => toast('Не удалось определить место. Разрешите доступ к геопозиции.', 'bad'),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  // ---- Map layers per state ----
  const fitPoints = useMemo<LatLon[]>(() => {
    if (ride) {
      if (ride.mode === 'bus' && ride.status === 'waiting_bus') return [[ride.from.lat, ride.from.lon], ...(ride.position ? [ride.position.pos] : [])];
      if (ride.mode === 'bus') return ride.fullRoute;
      if (ride.air) return ride.status === 'in_flight' || ride.status === 'completed' || ride.status === 'awaiting_payment' ? ride.fullRoute : [[ride.from.lat, ride.from.lon]];
      if (ride.status === 'driver_coming' && ride.motion) return [...ride.motion.path, [ride.from.lat, ride.from.lon]];
      if (ride.status === 'arrived') return [[ride.from.lat, ride.from.lon]];
      if (ride.status === 'in_ride' || ride.status === 'completed') return ride.fullRoute;
      return [[ride.from.lat, ride.from.lon], [ride.to.lat, ride.to.lon]];
    }
    if (estimate) return estimate.route;
    if (plan && from && to) {
      const o = plan.options.find((x) => x.n === busOpt);
      return [[from.lat, from.lon], [to.lat, to.lon], ...(o ? o.path : [])];
    }
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ride?.id, ride?.status, ride?.motion?.startAt, estimate?.id, plan?.id, busOpt]);

  const vehicleKind = ride?.mode === 'bus' ? 'bus' : ride?.mode === 'heli' ? 'heli' : ride?.mode === 'jet' ? 'jet' : 'car';
  const rideLayers = ride && ride.mode !== 'taxi' && (
    <>
      {ride.bus && ride.bus.line && <RouteLine path={ride.bus.line.path} color={ride.bus.colour || '#d0021b'} faded />}
      <RouteLine path={ride.status === 'on_bus' || ride.status === 'in_flight' ? ride.route : ride.fullRoute} color={ride.bus ? ride.bus.colour || '#d0021b' : undefined} />
      {ride.bus?.line && <StopDots stops={ride.bus.line.stops} color={ride.bus.colour || '#d0021b'} />}
      {ride.status !== 'in_flight' && ride.status !== 'on_bus' && ride.status !== 'completed' && <PointMarker pos={[ride.from.lat, ride.from.lon]} kind="from" label={ride.bus ? ride.from.title : ride.status === 'boarding' ? 'Посадка' : ride.from.title} />}
      <PointMarker pos={[ride.to.lat, ride.to.lon]} kind="to" label={ride.to.title} />
      {ride.position && ride.status !== 'completed' && (
        <RideCar
          kind={vehicleKind}
          color={ride.bus ? ride.bus.colour || '#d0021b' : ride.car?.colorHex ?? '#ffffff'}
          label={ride.bus?.ref}
          motion={ride.motion}
          position={ride.position}
          clockOffset={rideData?.offset ?? 0}
          follow={ride.status === 'on_bus' || (ride.status === 'in_flight' && ride.mode === 'heli')}
        />
      )}
      <FitBounds points={fitPoints} padding={[56, 56]} maxZoom={ride.air ? 13 : 17} />
    </>
  );
  const selectedBus = plan?.options.find((o) => o.n === busOpt);

  const layers = rideLayers ? (
    rideLayers
  ) : ride ? (
    <>
      {ride.status === 'driver_coming' && ride.motion && <RouteLine path={ride.motion.path} />}
      {(ride.status === 'searching' || ride.status === 'driver_coming' || ride.status === 'arrived') && <RouteLine path={ride.fullRoute} faded />}
      {(ride.status === 'in_ride' || ride.status === 'completed') && <RouteLine path={ride.route} />}
      {ride.status === 'searching' && <SearchPulse pos={[ride.from.lat, ride.from.lon]} />}
      {ride.status !== 'in_ride' && ride.status !== 'completed' && <PointMarker pos={[ride.from.lat, ride.from.lon]} kind="from" label={ride.status === 'arrived' ? (ride.tariff.vehicle === 'bus' ? 'Автобус ждёт' : 'Машина ждёт') : undefined} />}
      <PointMarker pos={[ride.to.lat, ride.to.lon]} kind="to" label={ride.status === 'in_ride' ? ride.to.title : undefined} />
      {ride.car && ride.status !== 'completed' && <RideCar kind={ride.tariff.vehicle === 'bus' ? 'bus' : 'car'} label={ride.line?.ref} color={ride.car.colorHex} motion={ride.motion} position={ride.position} clockOffset={rideData?.offset ?? 0} follow={ride.status === 'in_ride'} />}
      <FitBounds points={fitPoints} padding={[56, 56]} />
    </>
  ) : mode === 'estimate' && taxiLike && from && to ? (
    <>
      {estimate && <RouteLine path={estimate.route} />}
      <PointMarker pos={[from.lat, from.lon]} kind="from" label={from.title} />
      <PointMarker pos={[to.lat, to.lon]} kind="to" label={estimate ? minutes(estimate.duration) : to.title} />
      {estimate && <FitBounds points={fitPoints} padding={[60, 60]} />}
    </>
  ) : isAir ? (
    air.layers
  ) : mode === 'estimate' && transport === 'bus' && from && to ? (
    <>
      {selectedBus && (
        <>
          <RouteLine path={[[from.lat, from.lon], [selectedBus.board.lat, selectedBus.board.lon]]} dashed color="#6b6b6b" />
          <RouteLine path={selectedBus.path} color={selectedBus.colour || '#d0021b'} />
          <RouteLine path={[[selectedBus.alight.lat, selectedBus.alight.lon], [to.lat, to.lon]]} dashed color="#6b6b6b" />
          <StopDots stops={[selectedBus.board, selectedBus.alight]} color={selectedBus.colour} />
          <LiveBuses route={selectedBus.route} />
        </>
      )}
      <PointMarker pos={[from.lat, from.lon]} kind="from" label={from.title} />
      <PointMarker pos={[to.lat, to.lon]} kind="to" label={to.title} />
      {plan && <FitBounds points={fitPoints} padding={[60, 60]} />}
    </>
  ) : routeBus ? (
    <>
      <LiveBuses />
      <BusStops onPick={setStop} />
    </>
  ) : (
    <BackgroundCars center={center} />
  );

  // ---- Sheet content ----
  let sheet;
  if (ride) {
    sheet = <RideSheet key={ride.id} ride={ride} offset={rideData?.offset ?? 0} onDone={resetTrip} />;
  } else if (mode === 'pick') {
    sheet = (
      <>
        <h2 className="text-xl font-bold">{pickField === 'from' ? 'Откуда поедем?' : 'Куда поедем?'}</h2>
        <p className="mt-1 truncate text-[15px] text-muted">{pinPlace ? `${pinPlace.title}${pinPlace.subtitle ? ` · ${pinPlace.subtitle}` : ''}` : 'Двигайте карту, чтобы поставить точку'}</p>
        <Button
          className="mt-4 w-full"
          size="lg"
          variant="brand"
          disabled={!pinPlace || moving || !!pinPlace.outside}
          onClick={() => {
            if (!pinPlace) return;
            if (pickField === 'from') {
              setFrom(pinPlace);
              setFromLocked(true);
              if (to) runEstimate(pinPlace, to);
              else setMode('main');
            } else if (from) runEstimate(from, pinPlace);
          }}
        >
          Готово
        </Button>
      </>
    );
  } else if (isAir) {
    sheet = (
      <>
        <TransportSwitch value={transport} onChange={switchTransport} />
        {air.sheet}
      </>
    );
  } else if (mode === 'estimate' && routeBus) {
    sheet = (
      <>
        <TransportSwitch value={transport} onChange={switchTransport} />
        <BusModeSwitch value={busMode} onChange={switchBusMode} />
        <div className="-mt-1 flex items-center gap-2">
          <button type="button" aria-label="Назад" onClick={resetTrip} className="-ml-2 inline-flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-sunken">
            <ArrowLeft className="size-5" />
          </button>
          <button type="button" onClick={() => setSearch('to')} className="min-w-0 flex-1 text-left">
            <span className="block truncate text-[15px] font-semibold">{from?.title} → {to?.title}</span>
            <span className="block text-sm text-muted">{plan ? (plan.options.length ? 'Прямые автобусы, без пересадок' : 'Прямого автобуса нет') : 'Ищем автобусы…'}</span>
          </button>
        </div>
        <div className="mt-3 max-h-[38dvh] overflow-y-auto overscroll-contain">
          {!plan ? (
            <div className="h-32 animate-pulse rounded-2xl bg-sunken" />
          ) : plan.options.length ? (
            <BusOptions options={plan.options} selected={busOpt} onSelect={setBusOpt} />
          ) : (
            <div className="rounded-2xl bg-sunken p-4 text-[15px] text-muted">Поблизости нет остановок одного маршрута, который довезёт без пересадок.</div>
          )}
        </div>
        {plan && !plan.options.length ? (
          <Button className="mt-3 w-full" size="lg" variant="brand" onClick={() => switchTransport('taxi')}>
            Поехать на такси
          </Button>
        ) : user?.linked ? (
          <Button className="mt-3 w-full" size="lg" variant="brand" loading={busOrder.isPending} disabled={!selectedBus} onClick={() => busOrder.mutate()}>
            {selectedBus ? `Поехали · ${rub(selectedBus.fare)}` : 'Ищем…'}
          </Button>
        ) : (
          <Button className="mt-3 w-full" size="lg" variant="ink" onClick={login}>
            Войти через Bobobank
          </Button>
        )}
      </>
    );
  } else if (mode === 'estimate') {
    sheet = (
      <>
        <TransportSwitch value={transport} onChange={switchTransport} />
        {transport === 'bus' && <BusModeSwitch value={busMode} onChange={switchBusMode} />}
        <div className="-mt-1 flex items-center gap-2">
          <button type="button" aria-label="Назад" onClick={resetTrip} className="-ml-2 inline-flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-sunken">
            <ArrowLeft className="size-5" />
          </button>
          <button type="button" onClick={() => setSearch('to')} className="min-w-0 flex-1 text-left">
            <span className="block truncate text-[15px] font-semibold">{from?.title} → {to?.title}</span>
            <span className="block text-sm text-muted">{estimate ? `${km(estimate.distance)} · ${minutes(estimate.duration)} в пути${estimate.approx ? ' · примерно' : ''}` : 'Строим маршрут…'}</span>
          </button>
          {estimate && <SurgeBadge surge={estimate.surge} />}
        </div>
        <div className="no-scrollbar -mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1">
          {(tariffs ?? [null, null, null, null]).map((t, i) =>
            t ? (
              <button key={t.id} type="button" onClick={() => setTariff(t.id)} className={cx('flex w-[108px] shrink-0 flex-col items-start rounded-2xl border-2 px-2.5 pb-2.5 pt-1 text-left transition-colors', selected?.id === t.id ? 'border-ink bg-surface' : 'border-transparent bg-sunken')}>
                <TariffCar tariff={t.id} label={line} className="-ml-1 h-9 w-[86px]" />
                <span className="mt-0.5 truncate text-[13px] font-medium text-muted">{t.id === 'bus_city' ? `Городской ${line}` : t.title}</span>
                <span className="text-[17px] font-bold num">{rub(t.price)}</span>
                <span className="text-xs text-muted">{t.eta} мин</span>
              </button>
            ) : (
              <div key={i} className="h-[124px] w-[108px] shrink-0 animate-pulse rounded-2xl bg-sunken" />
            ),
          )}
        </div>
        {selected && <p className="mt-2 truncate text-xs text-muted">{selected.cars.join(', ')} или похожие · до {selected.seats} пассажиров</p>}
        <div className="no-scrollbar -mx-5 mt-2 flex items-center gap-2 overflow-x-auto px-5">
          {selected?.id === 'bus_city' && (
            <button type="button" onClick={() => setLinePicker(true)} className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-ink px-3 text-sm font-medium text-on-ink">
              <BusIcon className="size-4" />
              Маршрут {line} · сменить
            </button>
          )}
          {seatOk && (
            <button type="button" onClick={() => setChildSeat(!childSeat)} className={cx('inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-medium', childSeat ? 'bg-ink text-on-ink' : 'bg-sunken')}>
              <ChildIcon className="size-4" />
              Кресло{estimate ? ` +${rub(estimate.childSeat)}` : ''}
            </button>
          )}
          <button type="button" onClick={() => setCommentOpen(true)} className={cx('inline-flex h-9 min-w-0 max-w-[220px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-medium', comment ? 'bg-ink text-on-ink' : 'bg-sunken')}>
            <MessageSquare className="size-4 shrink-0" />
            <span className="truncate">{comment || 'Пожелания'}</span>
          </button>
        </div>
        {user?.linked && account?.linked && (
          <Link to="/profile" className="mt-3 flex items-center gap-3 rounded-2xl bg-sunken px-3 py-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-[#21a038] text-xs font-bold text-white">B</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">Bobobank •• {account.accountLast4}</span>
              <span className={cx('block text-xs', short ? 'text-bad' : 'text-muted')}>{account.unavailable ? 'Банк не отвечает' : short ? `Доступно ${rub(account.available ?? 0)} — не хватит на поездку` : `Доступно ${rub(account.available ?? 0)}`}</span>
            </span>
            <ChevronRight className="size-4 text-muted" />
          </Link>
        )}
        {user && !user.linked && <p className="mt-3 rounded-2xl bg-warn-soft px-3 py-2.5 text-sm text-warn">Привязка к Bobobank отключена. Привяжите счёт снова, чтобы ездить.</p>}
        {user?.linked ? (
          <Button className="mt-3 w-full" size="lg" variant="brand" loading={order.isPending} disabled={!estimate || est.isPending} onClick={() => order.mutate()}>
            {estimate ? `${selected?.id === 'bus_city' ? `Вызвать ${line}` : transport === 'bus' ? 'Заказать' : 'Вызвать'} · ${rub(price)}` : 'Считаем цену…'}
          </Button>
        ) : (
          <Button className="mt-3 w-full" size="lg" variant="ink" onClick={login}>
            {user ? 'Привязать Bobobank' : 'Войти через Bobobank'}
          </Button>
        )}
      </>
    );
  } else {
    const chip = (key: string, icon: React.ReactNode, title: string, onClick: () => void) => (
      <button key={key} type="button" onClick={onClick} className="flex h-[52px] max-w-[200px] shrink-0 items-center gap-2 rounded-2xl bg-sunken px-3 text-left hover:bg-hover">
        {icon}
        <span className="truncate text-[15px] font-semibold">{title}</span>
      </button>
    );
    const go = (p: Place) => runEstimate(from ?? pinPlace ?? { lat: center[0], lon: center[1], title: 'Точка на карте', subtitle: '' }, p);
    sheet = (
      <>
        <TransportSwitch value={transport} onChange={switchTransport} />
        {transport === 'bus' && <BusModeSwitch value={busMode} onChange={switchBusMode} />}
        <button type="button" onClick={() => setSearch('from')} className="flex w-full items-center gap-3 py-1 text-left">
          <span className="size-3 shrink-0 rounded-full border-[3px] border-ink bg-brand" />
          <span className="min-w-0 flex-1 truncate text-[15px] text-muted">{from ? from.title : 'Определяем адрес…'}</span>
        </button>
        <button type="button" onClick={() => setSearch('to')} className="mt-2 flex h-14 w-full items-center gap-3 rounded-2xl bg-sunken px-4 text-left hover:bg-hover">
          <span className="size-3 shrink-0 rounded-[3px] border-[3px] border-ink bg-surface" />
          <span className="text-[18px] font-bold">{routeBus ? 'Куда едем на автобусе?' : 'Куда едем?'}</span>
        </button>
        {user && (home || work || recent.length > 0) ? (
          <div className="no-scrollbar -mx-5 mt-3 flex gap-2 overflow-x-auto px-5">
            {home && chip('home', <HomeIcon className="size-5 shrink-0" />, 'Домой', () => go(savedToPlace(home)))}
            {work && chip('work', <Briefcase className="size-5 shrink-0" />, 'На работу', () => go(savedToPlace(work)))}
            {recent.map((r) => chip(`${r.lat},${r.lon}`, <Clock className="size-5 shrink-0 text-muted" />, r.title, () => go(r)))}
          </div>
        ) : user ? (
          <Link to="/profile" className="mt-3 flex items-center gap-3 rounded-2xl px-1 py-2 text-[15px] text-muted hover:text-fg">
            <HomeIcon className="size-5" />
            Добавьте «Дом» и «Работу» — вызывать будет быстрее
          </Link>
        ) : (
          <div className="mt-4 flex items-center gap-3 rounded-2xl bg-sunken p-3">
            <LogoMark className="size-11" />
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-semibold">Платите счётом Bobobank</div>
              <div className="text-muted">Привязка один раз — дальше деньги спишутся сами после поездки</div>
            </div>
          </div>
        )}
        {!user && (
          <Button className="mt-3 w-full" size="lg" variant="ink" onClick={login}>
            Войти через Bobobank
          </Button>
        )}
      </>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-bg">
      <div className="relative min-h-0 flex-1">
        <MapView
          center={center}
          onMoveStart={() => setMoving(true)}
          onMoveEnd={(c, byUser) => {
            setMoving(false);
            setCenter(c);
            if (byUser && mode === 'main') setFromLocked(false);
          }}
        >
          <MapHandle onReady={onMapReady} />
          {layers}
        </MapView>
        {pinActive && <CenterPin moving={moving} kind={mode === 'pick' ? pickField : 'from'} label={pinPlace ? (pinPlace.outside ? 'Только по Москве' : pinPlace.title) : moving ? '' : ''} />}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[600] flex items-start justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))]">
          {mode === 'pick' ? (
            <FloatButton label="Назад" onClick={() => setMode(to && from ? 'estimate' : 'main')}>
              <ArrowLeft className="size-5" />
            </FloatButton>
          ) : (
            <FloatButton label="Меню" onClick={() => setDrawer(true)}>
              <Menu className="size-5" />
            </FloatButton>
          )}
          {!ride && mode === 'main' && (
            <span className="pointer-events-auto rounded-full bg-surface px-3 py-2 shadow-[var(--shadow-float)]">
              <Logo className="[&_svg]:size-6 [&>span]:text-[15px]" />
            </span>
          )}
          {user?.role === 'admin' && !ride && mode === 'main' ? (
            <FloatButton label="Админка" onClick={() => nav('/admin')}>
              <Settings className="size-5" />
            </FloatButton>
          ) : (
            <span className="size-12" />
          )}
        </div>
        {(pinActive || ride?.status === 'in_ride' || ride?.status === 'on_bus') && (
          <div className="pointer-events-none absolute bottom-6 right-4 z-[600]">
            <FloatButton label="Где я" onClick={locate}>
              <LocateFixed className="size-5" />
            </FloatButton>
          </div>
        )}
      </div>
      <section className="relative z-[700] -mt-5 rounded-t-[26px] bg-surface px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 shadow-[var(--shadow-sheet)]">
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-line-strong" aria-hidden="true" />
        <div key={ride ? `ride-${ride.status}` : `${transport}-${mode}`} className="bt-sheet">
          {sheet}
        </div>
      </section>
      {search && (
        <RouteSearch
          from={from}
          to={to}
          focus={search}
          saved={saved}
          recent={recent}
          onClose={() => setSearch(null)}
          onPickOnMap={(f) => {
            setSearch(null);
            setPickField(f);
            setMode('pick');
            if (f === 'to' && to) fly.current([to.lat, to.lon]);
            if (f === 'from' && from) fly.current([from.lat, from.lon]);
          }}
          onDone={(picked, t) => {
            setSearch(null);
            // The pickup address may still be loading: the pin's point works as «Откуда» anyway.
            const f = picked ?? from ?? pinPlace ?? { lat: center[0], lon: center[1], title: 'Точка на карте', subtitle: '' };
            if (picked) {
              setFrom(f);
              setFromLocked(true);
            }
            if (f && t) runEstimate(f, t);
            else if (f) fly.current([f.lat, f.lon]);
          }}
        />
      )}
      <Drawer open={drawer} onClose={() => setDrawer(false)} />
      <StopBoard id={stop} onClose={() => setStop(null)} />
      <LinePicker open={linePicker} value={line} onClose={() => setLinePicker(false)} onPick={pickLine} />
      <Modal open={commentOpen} onClose={() => setCommentOpen(false)} title="Пожелания водителю" footer={<Button variant="ink" size="lg" onClick={() => setCommentOpen(false)}>Готово</Button>}>
        <textarea value={comment} onChange={(e) => setComment(e.target.value.slice(0, 200))} placeholder="Например: подъезд 2, не звонить" className="min-h-24 w-full rounded-2xl bg-sunken p-4 text-[16px] outline-none focus:ring-2 focus:ring-ink" />
        <div className="mt-2 flex flex-wrap gap-2">
          {['Подъезд со двора', 'Не звонить, напишите', 'Тихая поездка', 'Помогите с багажом'].map((s) => (
            <button key={s} type="button" onClick={() => setComment(s)} className="rounded-full bg-sunken px-3 py-1.5 text-sm">
              {s}
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
