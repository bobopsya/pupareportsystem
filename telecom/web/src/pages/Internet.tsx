import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Gauge, Home as HomeIcon, MapPin, Router, Wifi } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Card, Shell } from '../components/Shell';
import { Button, cx, ErrorNote, Loading, Modal, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { day, rub } from '../lib/format';
import { useLine, useMe } from '../lib/hooks';
import type { Home, HomeTariff } from '../lib/types';
import { login } from './Home';

interface Offer {
  tariffs: HomeTariff[];
  router: { rent: number; buy: number };
  bundle: boolean;
  discount: number;
}
type RouterKind = 'own' | 'rent' | 'buy';
const TZ = 'Europe/Moscow';
const hm = (ts: number) => new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(ts);
const weekday = (ts: number) => new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(ts);
const speedText = (mbit: number) => (mbit >= 1000 ? `${mbit / 1000} Гбит/с` : `${mbit} Мбит/с`);

/** Order: tariff → address and coverage → router → master's visit → pay. */
function OrderWizard({ offer }: { offer: Offer }) {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [tariff, setTariff] = useState(offer.tariffs[1]?.id ?? offer.tariffs[0].id);
  const [addr, setAddr] = useState({ street: '', house: '', flat: '' });
  const [cov, setCov] = useState<{ ok: boolean; tech: string | null; address: string } | null>(null);
  const [router, setRouter] = useState<RouterKind>('rent');
  const [slot, setSlot] = useState<number | null>(null);
  const slots = useQuery({ queryKey: ['home-slots'], queryFn: () => api<{ slots: { at: number; until: number; free: boolean }[] }>('/home/slots'), enabled: step >= 3 });
  const t = offer.tariffs.find((x) => x.id === tariff)!;
  const monthly = offer.bundle ? t.bundlePrice : t.price;
  const routerNow = router === 'buy' ? offer.router.buy : router === 'rent' ? offer.router.rent : 0;
  const check = useMutation({
    mutationFn: () => api<{ ok: boolean; tech: string | null; address: string }>('/home/coverage', { body: addr }),
    onSuccess: (r) => setCov(r),
    onError: (e) => toast(errorText(e), 'bad'),
  });
  const order = useMutation({
    mutationFn: () => api<Home>('/home', { body: { tariff, address: addr, router, installAt: slot } }),
    onSuccess: () => {
      toast('Заявка принята — ждите мастера');
      void qc.invalidateQueries({ queryKey: ['home'] });
      void qc.invalidateQueries({ queryKey: ['line'] });
    },
    onError: (e) => {
      toast(errorText(e), 'bad');
      if ((e as { code?: string }).code === 'slot_taken') void slots.refetch();
    },
  });
  const days = new Map<string, { at: number; until: number; free: boolean }[]>();
  for (const s of slots.data?.slots ?? []) days.set(weekday(s.at), [...(days.get(weekday(s.at)) ?? []), s]);
  const steps = ['Тариф', 'Адрес', 'Роутер', 'Мастер', 'Оплата'];

  return (
    <>
      <div className="mb-4 flex gap-1">
        {steps.map((s, i) => (
          <button key={s} type="button" disabled={i > step} onClick={() => setStep(i)} className="flex-1 text-left">
            <span className={cx('block h-1 rounded-full', i <= step ? 'bg-[#14b8a6]' : 'bg-sunken')} />
            <span className={cx('mt-1 block text-[11px] font-medium', i === step ? 'text-fg' : 'text-muted')}>{s}</span>
          </button>
        ))}
      </div>

      {step === 0 && (
        <>
          {offer.bundle ? (
            <p className="mb-3 rounded-2xl bg-[#14b8a6]/15 px-3 py-2.5 text-sm text-[#0d9488]">У вас есть номер Бобтелекома — домашний интернет на {offer.discount}% дешевле.</p>
          ) : (
            <p className="mb-3 rounded-2xl bg-sunken px-3 py-2.5 text-sm text-muted">С мобильным номером Бобтелекома — скидка {offer.discount}% на домашний интернет.</p>
          )}
          <div className="flex flex-col gap-2">
            {offer.tariffs.map((x) => (
              <button key={x.id} type="button" onClick={() => setTariff(x.id)} className={cx('rounded-3xl border-2 p-4 text-left', tariff === x.id ? 'border-[#14b8a6] bg-[#14b8a6]/10' : 'border-transparent bg-sunken')}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[19px] font-bold">{x.title}</span>
                  <span className="text-right">
                    <span className="text-[19px] font-bold num">{rub((offer.bundle ? x.bundlePrice : x.price) * 100)}</span>
                    <span className="text-sm text-muted">/мес</span>
                    {offer.bundle && <span className="block text-xs text-muted line-through num">{rub(x.price * 100)}</span>}
                  </span>
                </div>
                <p className="text-[15px] font-semibold text-[#0d9488]">до {speedText(x.speed)}</p>
                <p className="mt-0.5 text-sm text-muted">{x.perks.join(' · ')}</p>
              </button>
            ))}
          </div>
          <Button className="mt-4 w-full" size="lg" variant="brand" onClick={() => setStep(1)}>
            Указать адрес
          </Button>
        </>
      )}

      {step === 1 && (
        <>
          <h2 className="text-[22px] font-bold">Куда провести интернет?</h2>
          <div className="mt-3 flex flex-col gap-2">
            <input value={addr.street} onChange={(e) => (setAddr({ ...addr, street: e.target.value }), setCov(null))} placeholder="Улица, например «Тверская улица»" className="h-13 rounded-2xl bg-sunken px-4 text-[16px] outline-none focus:ring-2 focus:ring-brand" />
            <div className="grid grid-cols-2 gap-2">
              <input value={addr.house} onChange={(e) => (setAddr({ ...addr, house: e.target.value }), setCov(null))} placeholder="Дом" className="h-13 rounded-2xl bg-sunken px-4 text-[16px] outline-none focus:ring-2 focus:ring-brand" />
              <input value={addr.flat} onChange={(e) => setAddr({ ...addr, flat: e.target.value })} placeholder="Квартира" inputMode="numeric" className="h-13 rounded-2xl bg-sunken px-4 text-[16px] outline-none focus:ring-2 focus:ring-brand" />
            </div>
          </div>
          {cov && (
            <p className={cx('mt-3 flex items-start gap-2 rounded-2xl px-3 py-2.5 text-sm', cov.ok ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad')}>
              <MapPin className="mt-0.5 size-4 shrink-0" />
              {cov.ok ? `Дом подключён (${cov.tech}). Мастер проведёт кабель в квартиру бесплатно.` : 'В этот дом мы пока не провели кабель. Попробуйте другой адрес.'}
            </p>
          )}
          {cov?.ok ? (
            <Button className="mt-4 w-full" size="lg" variant="brand" onClick={() => setStep(2)}>
              Дальше
            </Button>
          ) : (
            <Button className="mt-4 w-full" size="lg" variant="brand" loading={check.isPending} disabled={addr.street.trim().length < 3 || !addr.house.trim()} onClick={() => check.mutate()}>
              Проверить адрес
            </Button>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <h2 className="text-[22px] font-bold">Wi‑Fi роутер</h2>
          <div className="mt-3 flex flex-col gap-2">
            {(
              [
                ['rent', 'Аренда', `${rub(offer.router.rent * 100)}/мес · заменим бесплатно, если сломается`],
                ['buy', 'Купить', `${rub(offer.router.buy * 100)} разово · Wi‑Fi 6, ваш навсегда`],
                ['own', 'Свой роутер', 'Бесплатно · мастер настроит ваш'],
              ] as const
            ).map(([k, title, sub]) => (
              <button key={k} type="button" onClick={() => setRouter(k)} className={cx('flex items-center gap-3 rounded-3xl border-2 p-4 text-left', router === k ? 'border-[#14b8a6] bg-[#14b8a6]/10' : 'border-transparent bg-sunken')}>
                <Router className="size-6 shrink-0 text-[#0d9488]" />
                <span>
                  <span className="block text-[17px] font-bold">{title}</span>
                  <span className="block text-sm text-muted">{sub}</span>
                </span>
              </button>
            ))}
          </div>
          <Button className="mt-4 w-full" size="lg" variant="brand" onClick={() => setStep(3)}>
            Выбрать время мастера
          </Button>
        </>
      )}

      {step === 3 && (
        <>
          <h2 className="text-[22px] font-bold">Когда удобно принять мастера?</h2>
          <p className="mt-1 text-sm text-muted">Подключение занимает около часа, интернет заработает сразу после визита.</p>
          {slots.isLoading && <Loading />}
          <div className="mt-3 flex flex-col gap-3">
            {[...days].map(([d, list]) => (
              <div key={d}>
                <p className="mb-1.5 text-sm font-semibold capitalize">{d}</p>
                <div className="grid grid-cols-3 gap-2">
                  {list.map((s) => (
                    <button key={s.at} type="button" disabled={!s.free} onClick={() => setSlot(s.at)} className={cx('h-11 rounded-xl text-sm font-semibold num disabled:opacity-35', slot === s.at ? 'bg-[#14b8a6] text-white' : 'bg-sunken')}>
                      {hm(s.at)}–{hm(s.until)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <Button className="mt-4 w-full" size="lg" variant="brand" disabled={!slot} onClick={() => setStep(4)}>
            Дальше
          </Button>
        </>
      )}

      {step === 4 && slot && (
        <>
          <h2 className="text-[22px] font-bold">Проверьте заявку</h2>
          <div className="mt-3 rounded-3xl bg-sunken p-4 text-[15px]">
            {[
              ['Тариф', `${t.title}, до ${speedText(t.speed)}`],
              ['Адрес', cov?.address ?? ''],
              ['Мастер', `${weekday(slot)}, ${hm(slot)}–${hm(slot + 2 * 3600_000)}`],
              ['Роутер', router === 'rent' ? 'аренда' : router === 'buy' ? 'покупка' : 'свой'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 py-1">
                <span className="shrink-0 text-muted">{k}</span>
                <span className="text-right font-medium">{v}</span>
              </div>
            ))}
            <div className="mt-2 border-t border-line-strong pt-2">
              <div className="flex justify-between gap-3 py-1">
                <span className="text-muted">Первый месяц{offer.bundle ? ' (−20%)' : ''}</span>
                <span className="whitespace-nowrap font-semibold num">{rub(monthly * 100)}</span>
              </div>
              {routerNow > 0 && (
                <div className="flex justify-between gap-3 py-1">
                  <span className="text-muted">{router === 'buy' ? 'Роутер, покупка' : 'Аренда роутера'}</span>
                  <span className="whitespace-nowrap font-semibold num">{rub(routerNow * 100)}</span>
                </div>
              )}
              <div className="flex justify-between gap-3 pt-2 text-[18px] font-bold">
                <span>Итого сейчас</span>
                <span className="whitespace-nowrap num">{rub((monthly + routerNow) * 100)}</span>
              </div>
            </div>
          </div>
          <p className="mt-3 text-sm text-muted">Дальше каждые 30 дней спишется {rub((monthly + (router === 'rent' ? offer.router.rent : 0)) * 100)}. До визита мастера заявку можно отменить — деньги вернутся.</p>
          {me.data?.user?.linked ? (
            <Button className="mt-4 w-full" size="lg" variant="brand" loading={order.isPending} onClick={() => order.mutate()}>
              Оплатить и вызвать мастера · {rub((monthly + routerNow) * 100)}
            </Button>
          ) : (
            <Button className="mt-4 w-full" size="lg" variant="ink" onClick={login}>
              Привязать счёт Bobobank
            </Button>
          )}
        </>
      )}
    </>
  );
}

/** A speed test: the needle runs up to the measured speed. */
function SpeedTest({ max }: { max: number }) {
  const toast = useToast();
  const [shown, setShown] = useState(0);
  const [result, setResult] = useState<{ down: number; up: number; ping: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const raf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await api<{ down: number; up: number; ping: number }>('/home/speedtest');
      const t0 = performance.now();
      const frame = (t: number) => {
        const k = Math.min(1, (t - t0) / 2200);
        const wobble = k < 1 ? Math.sin(t / 90) * 0.04 : 0;
        setShown(r.down * (1 - Math.pow(1 - k, 3)) * (1 + wobble));
        if (k < 1) raf.current = requestAnimationFrame(frame);
        else {
          setResult(r);
          setBusy(false);
        }
      };
      raf.current = requestAnimationFrame(frame);
    } catch (e) {
      toast(errorText(e), 'bad');
      setBusy(false);
    }
  };
  const angle = -120 + Math.min(1, shown / max) * 240;
  return (
    <Card className="flex flex-col items-center">
      <h2 className="self-start text-[17px] font-bold">Тест скорости</h2>
      <svg viewBox="0 0 200 130" className="mt-2 w-60">
        <path d="M 22 118 A 82 82 0 1 1 178 118" fill="none" strokeWidth="12" strokeLinecap="round" className="stroke-sunken" />
        <path d="M 22 118 A 82 82 0 1 1 178 118" fill="none" strokeWidth="12" strokeLinecap="round" stroke="#14b8a6" pathLength={100} strokeDasharray="100" strokeDashoffset={100 - Math.min(1, shown / max) * 100} />
        <g transform={`rotate(${angle} 100 100)`}>
          <line x1="100" y1="100" x2="100" y2="34" strokeWidth="4" strokeLinecap="round" className="stroke-fg" />
        </g>
        <circle cx="100" cy="100" r="7" className="fill-fg" />
      </svg>
      <p className="-mt-2 text-[34px] font-bold num">{shown.toFixed(shown >= 100 ? 0 : 1).replace('.', ',')}</p>
      <p className="text-sm text-muted">Мбит/с</p>
      {result && (
        <div className="mt-3 grid w-full grid-cols-3 gap-2 text-center">
          {[
            ['Загрузка', `${result.down.toLocaleString('ru-RU')}`],
            ['Отдача', `${result.up.toLocaleString('ru-RU')}`],
            ['Пинг', `${result.ping} мс`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-2xl bg-sunken py-2">
              <p className="text-xs text-muted">{k}</p>
              <p className="text-[16px] font-bold num">{v}</p>
            </div>
          ))}
        </div>
      )}
      <Button className="mt-4 w-full" variant="brand" loading={busy} icon={<Gauge className="size-5" />} onClick={() => void run()}>
        {result ? 'Ещё раз' : 'Проверить скорость'}
      </Button>
    </Card>
  );
}

function HomeDetails({ home, offer }: { home: Home; offer: Offer }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [closing, setClosing] = useState(false);
  const [change, setChange] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['home'] });
    void qc.invalidateQueries({ queryKey: ['line'] });
  };
  const cancel = useMutation({ mutationFn: () => api('/home/cancel', { method: 'POST' }), onSuccess: () => (setClosing(false), toast(home.status === 'scheduled' ? 'Заявка отменена, деньги вернутся на счёт' : 'Договор расторгнут'), refresh()), onError: (e) => toast(errorText(e), 'bad') });
  const pay = useMutation({ mutationFn: () => api('/home/pay', { method: 'POST' }), onSuccess: () => (toast('Оплачено — интернет снова работает'), refresh()), onError: (e) => toast(errorText(e), 'bad') });
  const tariff = useMutation({ mutationFn: (id: string) => api<Home>('/home/tariff', { body: { tariff: id } }), onSuccess: () => (setChange(false), toast('Тариф изменится со следующего периода'), refresh()), onError: (e) => toast(errorText(e), 'bad') });
  const stages = [
    { key: 'booked', title: 'Заявка принята', sub: `договор ${home.contract}` },
    { key: 'master', title: home.status === 'scheduled' ? `Мастер ${home.master}` : `Мастер ${home.master} подключил`, sub: `${weekday(home.installAt)}, ${hm(home.installAt)}–${hm(home.installUntil)}` },
    { key: 'active', title: 'Интернет работает', sub: home.installedAt ? `с ${day(home.installedAt)}` : 'сразу после визита' },
  ];
  const reached = home.stage === 'booked' ? 0 : home.stage === 'master' ? 1 : 2;
  return (
    <>
      <section className={cx('rounded-[28px] p-5 text-white', home.status === 'blocked' ? 'bg-gradient-to-br from-[#4b4b55] to-[#2b2b33]' : 'bg-gradient-to-br from-[#0f766e] to-[#14b8a6]')}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-white/80">Домашний интернет</p>
            <p className="text-[26px] font-bold leading-tight">{home.tariff.title}</p>
            <p className="text-[15px] text-white/90">до {speedText(home.tariff.speed)}</p>
          </div>
          <Wifi className="size-9 text-white/80" />
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-sm text-white/90">
          <HomeIcon className="size-4" /> {home.addressText}
        </p>
        {home.status === 'active' && (
          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
            <span className="rounded-full bg-white/20 px-2.5 py-1">Wi‑Fi: {home.wifi}</span>
            <span className="rounded-full bg-white/20 px-2.5 py-1">{home.gbUsed.toLocaleString('ru-RU')} ГБ за период</span>
            {home.nextCharge && <span className="rounded-full bg-white/20 px-2.5 py-1">{rub(home.nextCharge.amount * 100)} — {day(home.nextCharge.at)}</span>}
          </div>
        )}
      </section>

      {home.status === 'blocked' && (
        <div className="mt-3 rounded-3xl bg-bad-soft p-4 text-bad">
          <p className="text-[15px] font-semibold">Интернет отключён: не хватило денег на абонплату</p>
          <Button className="mt-3 w-full" variant="danger" loading={pay.isPending} onClick={() => pay.mutate()}>
            Оплатить
          </Button>
        </div>
      )}

      {home.status !== 'active' && home.status !== 'blocked' ? (
        <Card className="mt-3">
          <h2 className="text-[17px] font-bold">Подключение</h2>
          <ol className="mt-3 flex flex-col gap-3">
            {stages.map((s, i) => (
              <li key={s.key} className="flex items-start gap-3">
                <span className={cx('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold', i < reached ? 'bg-[#14b8a6] text-white' : i === reached ? 'bg-[#14b8a6]/20 text-[#0d9488] ring-2 ring-[#14b8a6]' : 'bg-sunken text-muted')}>{i < reached ? <Check className="size-4" /> : i + 1}</span>
                <span>
                  <span className={cx('block text-[15px] font-semibold', i > reached && 'text-muted')}>{s.title}</span>
                  <span className="block text-sm text-muted">{s.sub}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-muted">Мастер позвонит за час. О каждом шаге придёт SMS в «Чаты».</p>
        </Card>
      ) : (
        home.status === 'active' && (
          <div className="mt-3">
            <SpeedTest max={home.tariff.speed} />
          </div>
        )
      )}

      <div className="mt-3 flex flex-col overflow-hidden rounded-3xl bg-surface ring-1 ring-line">
        <div className="flex justify-between gap-3 px-4 py-3 text-[15px]">
          <span className="text-muted">Роутер</span>
          <span className="font-medium">{home.router === 'rent' ? 'в аренде' : home.router === 'buy' ? 'куплен' : 'свой'}</span>
        </div>
        <div className="flex justify-between gap-3 border-t border-line px-4 py-3 text-[15px]">
          <span className="text-muted">Договор</span>
          <span className="font-medium num">{home.contract}</span>
        </div>
        {home.nextTariff && (
          <div className="border-t border-line px-4 py-3 text-sm text-[#0d9488]">
            Со следующего периода — «{home.nextTariff.title}»
          </div>
        )}
        <button type="button" onClick={() => setChange(true)} className="border-t border-line px-4 py-3 text-left text-[15px] font-semibold text-brand-text hover:bg-sunken">
          Сменить скорость
        </button>
        <button type="button" onClick={() => setClosing(true)} className="border-t border-line px-4 py-3 text-left text-[15px] font-semibold text-bad hover:bg-sunken">
          {home.status === 'scheduled' ? 'Отменить заявку' : 'Расторгнуть договор'}
        </button>
      </div>

      <Modal open={change} onClose={() => setChange(false)} title="Скорость">
        <div className="flex flex-col gap-2">
          {offer.tariffs.map((x) => (
            <button key={x.id} type="button" disabled={tariff.isPending} onClick={() => tariff.mutate(x.id)} className={cx('flex items-center justify-between rounded-2xl p-3 text-left', x.id === home.tariff.id ? 'bg-[#14b8a6]/15' : 'bg-sunken')}>
              <span>
                <span className="block font-bold">{x.title}</span>
                <span className="block text-sm text-muted">до {speedText(x.speed)}</span>
              </span>
              <span className="font-semibold num">{rub((offer.bundle ? x.bundlePrice : x.price) * 100)}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">{home.status === 'scheduled' ? 'До подключения тариф меняется сразу.' : 'Новая скорость — со следующего списания, без доплаты сейчас.'}</p>
      </Modal>
      <Modal
        open={closing}
        onClose={() => setClosing(false)}
        title={home.status === 'scheduled' ? 'Отменить заявку?' : 'Расторгнуть договор?'}
        footer={
          <Button variant="danger" size="lg" loading={cancel.isPending} onClick={() => cancel.mutate()}>
            {home.status === 'scheduled' ? 'Отменить и вернуть деньги' : 'Расторгнуть'}
          </Button>
        }
      >
        <p className="text-[15px]">{home.status === 'scheduled' ? 'Мастер не приедет, все списания вернутся на счёт Bobobank.' : 'Интернет дома отключится сразу. Оплаченный месяц не возвращается.'}</p>
      </Modal>
    </>
  );
}

export default function Internet() {
  const me = useMe();
  const line = useLine(!!me.data?.user);
  const offer = useQuery({ queryKey: ['home-offer'], queryFn: () => api<Offer>('/home/offer'), staleTime: 60_000 });
  const home = useQuery({ queryKey: ['home'], queryFn: () => api<{ home: Home | null }>('/home'), enabled: !!me.data?.user, refetchInterval: 15_000 });
  if (me.data && !me.data.user) return <Navigate to="/" replace />;
  const h = home.data?.home ?? line.data?.home ?? null;
  return (
    <Shell title="Домашний интернет" back="/">
      {!offer.data || home.isLoading ? <Loading /> : h ? <HomeDetails home={h} offer={offer.data} /> : offer.data.tariffs.length ? <OrderWizard offer={offer.data} /> : <ErrorNote>Тарифов пока нет</ErrorNote>}
    </Shell>
  );
}
