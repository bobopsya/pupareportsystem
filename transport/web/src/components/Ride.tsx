import { useQueryClient } from '@tanstack/react-query';
import { Baby, Check, FileText, MessageCircle, Phone, ShieldCheck, Star, X, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { clock, km, minutes, rub } from '../lib/format';
import type { Car, Driver, Ride, TariffId } from '../lib/types';
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

const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

/** Bottom sheet of an active ride: searching → car is coming → waiting → on the way → rating. */
export function RideSheet({ ride, offset, onDone }: { ride: Ride; offset: number; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const now = useNow() + offset;
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'cancel' | 'stop'>(null);
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

  let body;
  if (ride.status === 'searching') {
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
          Я в машине, поехали
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
    const left = ride.motion ? Math.max(0, ride.motion.endAt - now) : 0;
    const gameS = (left / 1000) * ride.timeScale;
    const frac = ride.motion ? Math.min(1, Math.max(0, (now - ride.motion.startAt) / (ride.motion.endAt - ride.motion.startAt))) : 0;
    body = (
      <>
        <h2 className="text-[22px] font-bold">В пути</h2>
        <p className="mt-0.5 text-[15px] text-muted">
          До «{ride.to.title}» ещё {minutes(gameS)} · {km(ride.distance * (1 - frac))} · прибытие ≈ {clock(Date.now() + gameS * 1000)}
        </p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken">
          <div className="h-full rounded-full bg-ink transition-[width] duration-1000 ease-linear" style={{ width: `${frac * 100}%` }} />
        </div>
        <div className="mt-4 rounded-2xl bg-sunken p-3">
          <DriverCard car={ride.car} driver={ride.driver} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button icon={<ShieldCheck className="size-[18px]" />} onClick={() => toast('Поездка застрахована и записывается. Хорошей дороги!')}>
            Безопасность
          </Button>
          <Button onClick={() => setConfirm('stop')}>Остановите здесь</Button>
        </div>
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
      <Modal
        open={confirm === 'stop'}
        onClose={() => setConfirm(null)}
        title="Остановить здесь?"
        footer={
          <>
            <Button variant="ink" size="lg" loading={busy === 'stop'} onClick={() => void act('stop', `/rides/${ride.id}/stop`)}>
              Да, выйду здесь
            </Button>
            <Button size="lg" onClick={() => setConfirm(null)}>
              Едем дальше
            </Button>
          </>
        }
      >
        <p className="text-[15px] text-muted">Поездка закончится там, где сейчас машина. Заплатите только за проеханную часть пути (но не меньше минимальной цены тарифа).</p>
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
          <h2 className="text-[22px] font-bold">Приехали!</h2>
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
      <div className="mt-5 text-center text-[15px] font-semibold">Как вам поездка{ride.driver ? ` с ${ride.driver.name}` : ''}?</div>
      <div className="mt-2 flex justify-center gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" aria-label={`${n} из 5`} onClick={() => setStars(n)} className="p-1">
            <Star className={cx('size-9 transition-colors', n <= stars ? 'fill-[#f5b400] text-[#f5b400]' : 'text-line-strong')} />
          </button>
        ))}
      </div>
      <div className="mt-4 text-sm text-muted">Чаевые водителю</div>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {TIPS.map((t) => (
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
