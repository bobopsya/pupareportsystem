import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Briefcase, ChevronRight, Clock, CreditCard, History as HistoryIcon, Home as HomeIcon, LocateFixed, LogOut, Menu, MessageSquare, Settings, Shield, User } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LogoMark, Logo } from '../components/Logo';
import { ChildIcon, RideSheet, SurgeBadge, TariffCar } from '../components/Ride';
import { RouteSearch, savedToPlace } from '../components/Search';
import { Button, cx, FloatButton, Modal, Spinner, useToast } from '../components/ui';
import { api, ApiError, errorText } from '../lib/api';
import { minutes, rub, km } from '../lib/format';
import { inMoscow, MOSCOW_CENTER } from '../lib/geo';
import { useAccount, useCurrentRide, useMe, usePlaces } from '../lib/hooks';
import type { Estimate, LatLon, Place, Ride, TariffId } from '../lib/types';
import { BackgroundCars, FitBounds, MapView, PointMarker, RideCar, RouteLine, SearchPulse, useLeaflet } from '../map/Map';

type Mode = 'main' | 'pick' | 'estimate';

const login = () => window.location.assign('/api/auth/bank/start');

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
  const [childSeat, setChildSeat] = useState(false);
  const [comment, setComment] = useState('');
  const [commentOpen, setCommentOpen] = useState(false);
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
  const pinActive = !ride && (mode === 'main' || mode === 'pick');
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
  const estimate = est.data && mode === 'estimate' ? est.data : null;
  const runEstimate = (f: Place, t: Place) => {
    setFrom(f);
    setTo(t);
    setMode('estimate');
    est.mutate({ from: f, to: t });
  };
  // Prices are valid for 15 minutes; refresh quietly before that.
  useEffect(() => {
    if (mode !== 'estimate' || !from || !to) return;
    const t = setInterval(() => est.mutate({ from, to }), 10 * 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, from, to]);

  const order = useMutation({
    mutationFn: () => api<Ride>('/rides', { body: { estimateId: estimate!.id, tariff, childSeat: childSeat && tariff !== 'kids', comment: comment || undefined } }),
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
  };

  const saved = places?.places ?? [];
  const recent = places?.recent ?? [];
  const home = saved.find((p) => p.kind === 'home');
  const work = saved.find((p) => p.kind === 'work');
  const selected = estimate?.tariffs.find((t) => t.id === tariff) ?? estimate?.tariffs[0];
  const price = selected ? selected.price + (childSeat && tariff !== 'kids' ? estimate!.childSeat : 0) : 0;
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
      if (ride.status === 'driver_coming' && ride.motion) return [...ride.motion.path, [ride.from.lat, ride.from.lon]];
      if (ride.status === 'arrived') return [[ride.from.lat, ride.from.lon]];
      if (ride.status === 'in_ride' || ride.status === 'completed') return ride.fullRoute;
      return [[ride.from.lat, ride.from.lon], [ride.to.lat, ride.to.lon]];
    }
    if (estimate) return estimate.route;
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ride?.id, ride?.status, ride?.motion?.startAt, estimate?.id]);

  const layers = ride ? (
    <>
      {ride.status === 'driver_coming' && ride.motion && <RouteLine path={ride.motion.path} />}
      {(ride.status === 'searching' || ride.status === 'driver_coming' || ride.status === 'arrived') && <RouteLine path={ride.fullRoute} faded />}
      {(ride.status === 'in_ride' || ride.status === 'completed') && <RouteLine path={ride.route} />}
      {ride.status === 'searching' && <SearchPulse pos={[ride.from.lat, ride.from.lon]} />}
      {ride.status !== 'in_ride' && ride.status !== 'completed' && <PointMarker pos={[ride.from.lat, ride.from.lon]} kind="from" label={ride.status === 'arrived' ? 'Машина ждёт' : undefined} />}
      <PointMarker pos={[ride.to.lat, ride.to.lon]} kind="to" label={ride.status === 'in_ride' ? ride.to.title : undefined} />
      {ride.car && ride.status !== 'completed' && <RideCar color={ride.car.colorHex} motion={ride.motion} position={ride.position} clockOffset={rideData?.offset ?? 0} follow={ride.status === 'in_ride'} />}
      <FitBounds points={fitPoints} padding={[56, 56]} />
    </>
  ) : mode === 'estimate' && from && to ? (
    <>
      {estimate && <RouteLine path={estimate.route} />}
      <PointMarker pos={[from.lat, from.lon]} kind="from" label={from.title} />
      <PointMarker pos={[to.lat, to.lon]} kind="to" label={estimate ? minutes(estimate.duration) : to.title} />
      {estimate && <FitBounds points={fitPoints} padding={[60, 60]} />}
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
  } else if (mode === 'estimate') {
    sheet = (
      <>
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
          {(estimate?.tariffs ?? [null, null, null, null]).map((t, i) =>
            t ? (
              <button key={t.id} type="button" onClick={() => setTariff(t.id)} className={cx('flex w-[108px] shrink-0 flex-col items-start rounded-2xl border-2 px-2.5 pb-2.5 pt-1 text-left transition-colors', tariff === t.id ? 'border-ink bg-surface' : 'border-transparent bg-sunken')}>
                <TariffCar tariff={t.id} className="-ml-1 h-9 w-[86px]" />
                <span className="mt-0.5 text-[13px] font-medium text-muted">{t.title}</span>
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
          {tariff !== 'kids' && (
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
            {estimate ? `Вызвать · ${rub(price)}` : 'Считаем цену…'}
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
        <button type="button" onClick={() => setSearch('from')} className="flex w-full items-center gap-3 py-1 text-left">
          <span className="size-3 shrink-0 rounded-full border-[3px] border-ink bg-brand" />
          <span className="min-w-0 flex-1 truncate text-[15px] text-muted">{from ? from.title : 'Определяем адрес…'}</span>
        </button>
        <button type="button" onClick={() => setSearch('to')} className="mt-2 flex h-14 w-full items-center gap-3 rounded-2xl bg-sunken px-4 text-left hover:bg-hover">
          <span className="size-3 shrink-0 rounded-[3px] border-[3px] border-ink bg-surface" />
          <span className="text-[18px] font-bold">Куда едем?</span>
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
        {(pinActive || ride?.status === 'in_ride') && (
          <div className="pointer-events-none absolute bottom-6 right-4 z-[600]">
            <FloatButton label="Где я" onClick={locate}>
              <LocateFixed className="size-5" />
            </FloatButton>
          </div>
        )}
      </div>
      <section className="relative z-[700] -mt-5 rounded-t-[26px] bg-surface px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 shadow-[var(--shadow-sheet)]">
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-line-strong" aria-hidden="true" />
        <div key={ride ? `ride-${ride.status}` : mode} className="bt-sheet">
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
