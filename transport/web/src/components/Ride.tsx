import { useQueryClient } from '@tanstack/react-query';
import { Baby, Bus, Check, ExternalLink, FileText, MessageCircle, Phone, Plane, ShieldCheck, Star, X, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { clock, km, minutes, rub } from '../lib/format';
import type { Car, Driver, Ride, TariffId } from '../lib/types';
import { AircraftIcon } from './Air';
import { BusBadge } from './Bus';
import { Button, cx, Modal, useToast } from './ui';

/** Side view of a car for the tariff cards (own drawing). */
export function TariffCar({ tariff, className }: { tariff: TariffId; className?: string }) {
  const body = { econom: '#f1f1ee', comfort: '#c9ccd1', comfort_plus: '#3b4a63', business: '#1d1d1f', kids: '#ffe680' }[tariff];
  const glass = tariff === 'business' || tariff === 'comfort_plus' ? '#8fa3bf' : '#5d6f86';
  return (
    <svg viewBox="0 0 96 40" className={className ?? 'h-9 w-[86px]'} aria-hidden="true">
      <ellipse cx="48" cy="36" rx="40" ry="2.6" fill="#000" opacity=".12" />
      <path d={tariff === 'business' ? 'M6 27 Q6 20 14 19 L30 17 L40 9 Q46 6 60 6 L70 7 Q76 8 80 15 L88 18 Q92 19 92 24 L92 29 L6 29 Z' : 'M6 27 Q6 20 14 19 L28 17 L38 9 Q43 6 56 6 L66 7 Q72 8 76 15 L86 18 Q91 19 91 24 L91 29 L6 29 Z'} fill={body} stroke="#141414" strokeOpacity=".5" strokeWidth="1" />
      <path d="M33 17 L41 10.5 Q45 8.5 52 8.5 L54 8.5 L54 17 Z" fill={glass} />
      <path d="M57 8.5 L65 9 Q70 9.5 73 16.5 L57 17 Z" fill={glass} />
      <circle cx="24" cy="29" r="6.5" fill="#141414" />
      <circle cx="24" cy="29" r="2.6" fill="#bbb" />
      <circle cx="74" cy="29" r="6.5" fill="#141414" />
      <circle cx="74" cy="29" r="2.6" fill="#bbb" />
      <rect x="86" y="20" width="4" height="2.5" rx="1" fill="#fff6b0" />
      {tariff === 'kids' && <circle cx="62" cy="13" r="3" fill="#ff7a59" />}
    </svg>
  );
}

/** «А 123 ВС 777» on a white plate with the region in its own box, like a real number plate. */
export function Plate({ plate }: { plate: string }) {
  const parts = plate.split(' ');
  const region = parts.pop();
  return (
    <span className="inline-flex h-8 items-stretch overflow-hidden rounded-md border-2 border-ink bg-white font-semibold text-[#141414]">
      <span className="flex items-center px-1.5 text-[15px] tracking-wide">{parts.join(' ')}</span>
      <span className="flex flex-col items-center justify-center border-l-2 border-ink px-1 text-[11px] leading-none">
        {region}
        <span className="mt-0.5 text-[6px] font-bold">RUS</span>
      </span>
    </span>
  );
}

function DriverCard({ car, driver }: { car: Car; driver: Driver }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-lg font-bold">{driver.name[0]}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold">
          {car.color} {car.model}
        </div>
        <div className="flex items-center gap-1 truncate text-sm text-muted">
          {driver.name}
          <Star className="ml-1 size-3.5 shrink-0 fill-current text-[#f5b400]" />
          {driver.rating.toFixed(2).replace('.', ',')}
        </div>
      </div>
      <Plate plate={car.plate} />
    </div>
  );
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** «через 25 мин» for long waits, «через 0:45» for the last minute. */
const inTime = (s: number) => (s >= 90 ? minutes(s) : mmss(s));
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

/** Bottom sheet of an active ride: searching → car is coming → waiting → on the way → rating. */
export function RideSheet({ ride, offset, onDone }: { ride: Ride; offset: number; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const now = useNow() + offset;
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'cancel'>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['ride'] });
    void qc.invalidateQueries({ queryKey: ['account'] });
  };
  const act = async (name: string, path: string, body?: unknown) => {
    setBusy(name);
    try {
      const r = await api<Ride>(path, { body: body ?? {} });
      qc.setQueryData(['ride'], { ride: r.status === 'cancelled' ? null : r, offset });
      refresh();
      return r;
    } catch (e) {
      toast(errorText(e), 'bad');
      return null;
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };
  const cancel = async () => {
    const r = await act('cancel', `/rides/${ride.id}/cancel`);
    if (r) {
      toast(r.cancelFee ? `Заказ отменён. Списано ${rub(r.cancelFee)} за отмену` : 'Заказ отменён, деньги разморожены');
      onDone();
    }
  };
  const paidCancel = ride.status === 'arrived' || (ride.status === 'driver_coming' && ride.freeCancelUntil !== null && now >= ride.freeCancelUntil);
  const callBot = () => toast(`${ride.driver?.name ?? 'Водитель'} — бот и звонки не принимает, но уже знает, куда ехать`);

  const air = ride.air;
  const bus = ride.bus;
  const craftCard = air && ride.car && ride.driver && (
    <div className="mt-4 flex items-center gap-3 rounded-2xl bg-sunken p-3">
      <AircraftIcon kind={air.kind} className="size-12 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold">{air.model}</div>
        <div className="truncate text-sm text-muted">Командир {ride.driver.name} · {air.className}, до {air.seats} пасс.</div>
      </div>
      <span className="shrink-0 rounded-lg border-2 border-ink bg-white px-1.5 py-0.5 text-sm font-bold text-[#141414]">{ride.car.plate}</span>
    </div>
  );
  const what = air ? (air.kind === 'heli' ? 'вертолёт' : 'джет') : 'поездку';

  let body;
  if (ride.status === 'awaiting_payment') {
    const left = ride.confirmation?.expiresAt ? Math.max(0, (ride.confirmation.expiresAt - now) / 1000) : 0;
    body = (
      <>
        <h2 className="text-[22px] font-bold">Подтвердите оплату в Bobobank</h2>
        <p className="mt-1 text-[15px] text-muted">
          {rub(ride.holdAmount)} — больше лимита привязки, поэтому банк спрашивает вас. Деньги заморозятся, после {air ? 'полёта' : 'поездки'} спишется точная цена. Осталось {mmss(left)}.
        </p>
        {craftCard}
        {ride.confirmation?.url && (
          <a href={ride.confirmation.url} target="_blank" rel="noopener" className="mt-4 block">
            <Button className="w-full" size="lg" variant="brand" icon={<ExternalLink className="size-5" />}>
              Открыть Bobobank
            </Button>
          </a>
        )}
        <Button className="mt-2 w-full" variant="soft" loading={busy === 'cancel'} onClick={() => void cancel()}>
          Отменить {what}
        </Button>
      </>
    );
  } else if (ride.status === 'preparing' || ride.status === 'boarding') {
    const until = ride.boardingUntil ?? now;
    const place = ride.from.title;
    body = (
      <>
        <h2 className="text-[22px] font-bold">{ride.status === 'preparing' ? (air?.kind === 'heli' ? 'Готовим вертолёт' : 'Готовим борт к вылету') : 'Посадка'}</h2>
        <p className="mt-1 text-[15px] text-muted">
          {ride.status === 'preparing'
            ? `Экипаж проверяет борт и заправку · посадка в ${clock(until)}, через ${inTime((until - now) / 1000)}`
            : `${place}${air?.kind === 'jet' ? ', терминал бизнес-авиации' : ''} · вылет в ${clock(until)}, через ${inTime((until - now) / 1000)}`}
        </p>
        {ride.status === 'preparing' && (
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-sunken">
            <div className="bt-bar h-full w-1/3 rounded-full bg-brand" />
          </div>
        )}
        {craftCard}
        {ride.status === 'boarding' && (
          <Button className="mt-3 w-full" size="lg" variant="brand" icon={<Plane className="size-5" />} loading={busy === 'board'} onClick={() => void act('board', `/rides/${ride.id}/board`)}>
            Я на борту
          </Button>
        )}
        <Button className="mt-2 w-full" variant="soft" loading={busy === 'cancel'} onClick={() => (ride.status === 'boarding' ? setConfirm('cancel') : void cancel())}>
          Отменить {what}
        </Button>
      </>
    );
  } else if (ride.status === 'in_flight' && air) {
    const gameS = ride.etaS ?? ride.duration;
    body = (
      <>
        <h2 className="text-[22px] font-bold">В полёте</h2>
        <p className="mt-0.5 text-[15px] text-muted">
          {ride.from.title} → {ride.to.title} · {Math.round(ride.distance / 1000).toLocaleString('ru-RU')} км · прилёт ≈ {clock(Date.now() + gameS * 1000)}
        </p>
        {craftCard}
        <Button className="mt-3 w-full" size="lg" variant="brand" loading={busy === 'arrive'} onClick={() => void act('arrive', `/rides/${ride.id}/arrive`)}>
          Прилетели
        </Button>
      </>
    );
  } else if ((ride.status === 'waiting_bus' || ride.status === 'bus_arrived' || ride.status === 'on_bus') && bus) {
    const waitS = ride.etaS ?? 0;
    const leaves = ride.busLeavesAt ? Math.max(0, (ride.busLeavesAt - now) / 1000) : 0;
    body = (
      <>
        <div className="flex items-center gap-2">
          <BusBadge num={bus.ref} colour={bus.colour} />
          <span className="min-w-0 truncate text-sm text-muted">→ {bus.to}</span>
        </div>
        {ride.status === 'waiting_bus' && (
          <>
            <h2 className="mt-2 text-[22px] font-bold">{waitS < 60 ? 'Автобус подходит' : `Автобус через ${minutes(waitS)}`}</h2>
            <p className="mt-0.5 text-[15px] text-muted">
              Идите на остановку «{bus.board.name}» ({Math.round(bus.board.walkM / 10) * 10} м). Когда автобус подойдёт, нажмите «Я сел».
            </p>
          </>
        )}
        {ride.status === 'bus_arrived' && (
          <>
            <h2 className="mt-2 text-[22px] font-bold">Автобус на остановке — садитесь!</h2>
            <p className="mt-0.5 text-[15px] text-warn">Уедет через {mmss(leaves)}. Проезд {rub(ride.price)} спишется, когда нажмёте «Я сел».</p>
          </>
        )}
        {ride.status === 'on_bus' && (
          <>
            <h2 className="mt-2 text-[22px] font-bold">Едете в автобусе</h2>
            <p className="mt-0.5 text-[15px] text-muted">
              Выходите на «{bus.alight.name}» — {bus.stops} ост.{ride.etaS ? `, примерно ${minutes(ride.etaS)}` : ''}. Проезд оплачен.
            </p>
          </>
        )}
        {bus.line && (
          <ol className="mt-3 max-h-36 overflow-y-auto rounded-2xl bg-sunken px-4 py-2 text-sm">
            {bus.line.stops.map((st, i) => (
              <li key={i} className="flex items-center gap-2 py-1">
                <span className="size-2.5 shrink-0 rounded-full border-2 border-white" style={{ background: bus.colour || '#d0021b' }} />
                <span className={cx('truncate', (i === 0 || i === bus.line!.stops.length - 1) && 'font-semibold')}>{st.name}</span>
              </li>
            ))}
          </ol>
        )}
        {ride.status === 'bus_arrived' && (
          <Button className="mt-3 w-full" size="lg" variant="brand" icon={<Bus className="size-5" />} loading={busy === 'board'} onClick={() => void act('board', `/rides/${ride.id}/board`)}>
            Я сел · {rub(ride.price)}
          </Button>
        )}
        {ride.status === 'on_bus' ? (
          <Button className="mt-3 w-full" size="lg" variant="brand" loading={busy === 'arrive'} onClick={() => void act('arrive', `/rides/${ride.id}/arrive`)}>
            Я вышел
          </Button>
        ) : (
          <Button className="mt-2 w-full" variant="soft" loading={busy === 'cancel'} onClick={() => void cancel()}>
            Не поеду
          </Button>
        )}
      </>
    );
  } else if (ride.status === 'searching') {
    body = (
      <>
        <h2 className="text-[22px] font-bold">Ищем машину</h2>
        <p className="mt-1 text-[15px] text-muted">
          {ride.tariff.title} · {rub(ride.price)} · заморозили {rub(ride.holdAmount)} на счёте
        </p>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-sunken">
          <div className="bt-bar h-full w-1/3 rounded-full bg-brand" />
        </div>
        <Button className="mt-5 w-full" size="lg" variant="soft" loading={busy === 'cancel'} onClick={() => void cancel()}>
          Отменить поиск
        </Button>
      </>
    );
  } else if (ride.status === 'driver_coming' && ride.car && ride.driver) {
    const left = ride.motion ? Math.max(0, ride.motion.endAt - now) : 0;
    const gameMin = Math.max(1, Math.ceil(((left / 1000) * ride.timeScale) / 60));
    body = (
      <>
        <h2 className="text-[22px] font-bold">
          {gameMin <= 1 ? 'Машина подъезжает' : `Приедет через ${gameMin} мин`}
        </h2>
        <p className="mt-0.5 text-[15px] text-muted">Подача к «{ride.from.title}»</p>
        <div className="mt-4 rounded-2xl bg-sunken p-3">
          <DriverCard car={ride.car} driver={ride.driver} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button icon={<Phone className="size-[18px]" />} onClick={callBot}>
            Связаться
          </Button>
          <Button loading={busy === 'cancel'} onClick={() => (paidCancel ? setConfirm('cancel') : void cancel())}>
            Отменить
          </Button>
        </div>
        {!paidCancel && ride.freeCancelUntil && <p className="mt-2 text-center text-xs text-muted">Бесплатная отмена ещё {mmss((ride.freeCancelUntil - now) / 1000)}</p>}
      </>
    );
  } else if (ride.status === 'arrived' && ride.car && ride.driver && ride.waiting) {
    const waited = ride.waiting.waitedS + ((now - ride.now) / 1000) * ride.timeScale;
    const free = ride.waiting.freeS - waited;
    body = (
      <>
        <h2 className="text-[22px] font-bold">Машина на месте</h2>
        <p className={cx('mt-0.5 text-[15px]', free > 0 ? 'text-muted' : 'text-warn')}>
          {free > 0 ? `Бесплатное ожидание ещё ${mmss(free)}` : `Платное ожидание ${mmss(-free)} · ${rub(ride.tariff.waitPerMin)}/мин`}
        </p>
        <div className="mt-4 rounded-2xl bg-sunken p-3">
          <DriverCard car={ride.car} driver={ride.driver} />
        </div>
        <Button className="mt-3 w-full" size="lg" variant="brand" loading={busy === 'board'} onClick={() => void act('board', `/rides/${ride.id}/board`)}>
          Я сел
        </Button>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button icon={<MessageCircle className="size-[18px]" />} onClick={callBot}>
            Выхожу
          </Button>
          <Button onClick={() => setConfirm('cancel')}>Отменить</Button>
        </div>
      </>
    );
  } else if (ride.status === 'in_ride' && ride.car && ride.driver) {
    const gameS = ride.etaS ?? ride.duration;
    body = (
      <>
        <h2 className="text-[22px] font-bold">Едем</h2>
        <p className="mt-0.5 text-[15px] text-muted">
          До «{ride.to.title}» · {km(ride.distance)} · примерно {minutes(gameS)}, прибытие ≈ {clock(Date.now() + gameS * 1000)}
        </p>
        <div className="mt-4 rounded-2xl bg-sunken p-3">
          <DriverCard car={ride.car} driver={ride.driver} />
        </div>
        <Button className="mt-3 w-full" size="lg" variant="brand" loading={busy === 'arrive'} onClick={() => void act('arrive', `/rides/${ride.id}/arrive`)}>
          Мы приехали
        </Button>
        <Button className="mt-2 w-full" variant="soft" icon={<ShieldCheck className="size-[18px]" />} onClick={() => toast('Поездка застрахована и записывается. Хорошей дороги!')}>
          Безопасность
        </Button>
      </>
    );
  } else if (ride.status === 'completed') {
    body = <Finished ride={ride} onDone={onDone} />;
  } else body = <h2 className="text-xl font-bold">Обновляем поездку…</h2>;

  return (
    <>
      {body}
      <Modal
        open={confirm === 'cancel'}
        onClose={() => setConfirm(null)}
        title="Отменить поездку?"
        footer={
          <>
            <Button variant="danger" size="lg" loading={busy === 'cancel'} onClick={() => void cancel()}>
              Отменить за {rub(ride.cancelFeeNow)}
            </Button>
            <Button size="lg" onClick={() => setConfirm(null)}>
              Подожду
            </Button>
          </>
        }
      >
        <p className="text-[15px] text-muted">Машина уже {ride.status === 'arrived' ? 'ждёт вас' : 'в пути больше двух минут'}. За отмену спишем {rub(ride.cancelFeeNow)}{ride.status === 'arrived' ? ' и платное ожидание, если оно было' : ''}, остальное разморозим.</p>
      </Modal>
    </>
  );
}

const TIPS = [0, 30_00, 50_00, 100_00];

function Finished({ ride, onDone }: { ride: Ride; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [stars, setStars] = useState(0);
  const [tip, setTip] = useState(0);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await api(`/rides/${ride.id}/rate`, { body: { stars: stars || 5, tip } });
      toast(tip ? `Спасибо! ${rub(tip)} чаевых отправлены водителю` : 'Спасибо за оценку!');
      qc.setQueryData(['ride'], { ride: null, offset: 0 });
      void qc.invalidateQueries({ queryKey: ['account'] });
      void qc.invalidateQueries({ queryKey: ['places'] });
      onDone();
    } catch (e) {
      toast(errorText(e), 'bad');
    } finally {
      setBusy(false);
    }
  };
  const bank = ride.bank;
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-bold">{ride.mode === 'heli' || ride.mode === 'jet' ? 'Прилетели!' : 'Приехали!'}</h2>
          <p className="mt-0.5 text-[15px] text-muted">{ride.progress !== null && ride.progress < 0.99 ? 'Остановились по вашей просьбе' : ride.to.title}</p>
        </div>
        <div className="text-right">
          <div className="text-[26px] font-bold leading-none num">{rub(ride.finalPrice ?? 0)}</div>
          <div className={cx('mt-1 inline-flex items-center gap-1 text-xs', bank.status === 'captured' ? 'text-ok' : bank.error ? 'text-bad' : 'text-muted')}>
            {bank.status === 'captured' ? <Check className="size-3.5" /> : bank.error ? <X className="size-3.5" /> : null}
            {bank.status === 'captured' ? 'Оплачено Bobobank' : bank.error ? 'Не списалось' : 'Списываем…'}
          </div>
        </div>
      </div>
      {bank.error && <p className="mt-2 text-sm text-bad">{bank.error}</p>}
      <div className="mt-5 text-center text-[15px] font-semibold">{ride.mode === 'bus' ? 'Как вам поездка?' : ride.air ? `Как вам полёт с командиром ${ride.driver?.name ?? ''}?` : `Как вам поездка${ride.driver ? ` с ${ride.driver.name}` : ''}?`}</div>
      <div className="mt-2 flex justify-center gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" aria-label={`${n} из 5`} onClick={() => setStars(n)} className="p-1">
            <Star className={cx('size-9 transition-colors', n <= stars ? 'fill-[#f5b400] text-[#f5b400]' : 'text-line-strong')} />
          </button>
        ))}
      </div>
      {ride.mode !== 'bus' && <div className="mt-4 text-sm text-muted">{ride.air ? 'Чаевые экипажу' : 'Чаевые водителю'}</div>}
      <div className={cx('mt-2 grid grid-cols-4 gap-2', ride.mode === 'bus' && 'hidden')}>
        {(ride.air ? [0, 1000_00, 3000_00, 5000_00] : TIPS).map((t) => (
          <button key={t} type="button" onClick={() => setTip(t)} className={cx('h-11 rounded-2xl text-[15px] font-semibold transition-colors', tip === t ? 'bg-ink text-on-ink' : 'bg-sunken hover:bg-hover')}>
            {t ? rub(t) : 'Нет'}
          </button>
        ))}
      </div>
      <Button className="mt-4 w-full" size="lg" variant="brand" loading={busy} onClick={() => void send()}>
        {tip ? `Готово · чаевые ${rub(tip)}` : 'Готово'}
      </Button>
      {bank.status === 'captured' && (
        <a href={`/api/rides/${ride.id}/receipt.pdf`} target="_blank" rel="noopener" className="mt-2 flex h-11 items-center justify-center gap-2 text-[15px] font-semibold text-muted hover:text-fg">
          <FileText className="size-[18px]" />
          Чек в PDF
        </a>
      )}
    </>
  );
}

export function SurgeBadge({ surge }: { surge: number }) {
  if (surge <= 1) return null;
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-on-brand">
      <Zap className="size-3 fill-current" />×{surge.toFixed(1).replace('.', ',')}
    </span>
  );
}

export const ChildIcon = Baby;
