import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bell, ChevronRight, Gauge, MessageCircle, Package, Phone, PhoneIncoming, PhoneOutgoing, Plane, QrCode, Repeat, Router, Wifi } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AddonsModal, EsimModal, quotaText, Ring } from '../components/Line';
import { Logo, LogoMark } from '../components/Logo';
import { Avatar, Card, Shell } from '../components/Shell';
import { Button, cx, Loading, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { clock, data, day, dayLabel, dayTime, rub, talk } from '../lib/format';
import { useLine, useMe, useTariffs } from '../lib/hooks';
import type { Home, HomeTariff, Line, LineState, RecentEvent } from '../lib/types';

export const login = () => window.location.assign('/api/auth/bank/start');

function Landing() {
  const { data } = useTariffs();
  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))]">
      <Logo />
      <section className="mt-6 overflow-hidden rounded-[28px] bg-gradient-to-br from-[#2a1f7a] via-[#4334d6] to-[#7a6bff] p-6 text-white">
        <h1 className="text-[30px] font-bold leading-[1.1] tracking-tight">Свой номер за минуту</h1>
        <p className="mt-2 text-[16px] text-white/85">Тарифы с минутами и гигабайтами, звонки и SMS абонентам Бобтелекома. Абонплата списывается со счёта Bobobank сама.</p>
        <Button className="mt-5 w-full !bg-white !text-[#2a1f7a] hover:!bg-white/90" size="lg" onClick={login}>
          Войти через Bobobank
        </Button>
      </section>
      <h2 className="mb-2 mt-7 px-1 text-[13px] font-semibold uppercase tracking-wide text-muted">Тарифы</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {data?.tariffs.map((t) => (
          <Card key={t.id}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[18px] font-bold">{t.title}</span>
              <span className="text-[18px] font-bold num">{rub(t.price * 100)}<span className="text-sm font-medium text-muted">/мес</span></span>
            </div>
            <p className="mt-1 text-sm text-muted">{quotaText(t)}</p>
          </Card>
        ))}
      </div>
      <p className="mt-6 text-center text-xs text-faint">Игровой оператор: номера, звонки и SMS работают только между абонентами Бобтелекома.</p>
    </div>
  );
}

const greeting = () => {
  const h = Number(new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: 'numeric', hour12: false }).format(Date.now()));
  return h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
};
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

/** Mobile data by day for the last week: seven bars, today highlighted. */
function WeekChart({ usage }: { usage: { day: string; mb: number }[] }) {
  const max = Math.max(1, ...usage.map((u) => u.mb));
  const total = usage.reduce((s, u) => s + u.mb, 0);
  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <h2 className="text-[17px] font-bold">Интернет за неделю</h2>
        <span className="text-sm font-semibold num">{data(total)}</span>
      </div>
      <div className="mt-3 flex h-28 items-end gap-2" role="img" aria-label={`Мобильный интернет за 7 дней: ${data(total)}`}>
        {usage.map((u, i) => (
          <div key={u.day} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[10px] text-muted num">{u.mb ? (u.mb >= 1024 ? `${(u.mb / 1024).toFixed(1).replace('.', ',')}Г` : u.mb) : ''}</span>
            <div className={cx('w-full max-w-7 rounded-t-md rounded-b-sm', i === usage.length - 1 ? 'bg-brand' : 'bg-brand-soft')} style={{ height: `${Math.max(4, (u.mb / max) * 80)}px` }} />
            <span className={cx('text-[11px]', i === usage.length - 1 ? 'font-semibold' : 'text-muted')}>{i === usage.length - 1 ? 'сег' : WD[new Date(`${u.day}T12:00:00Z`).getUTCDay()]}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function HomeInternetCard({ home }: { home: Home | null }) {
  const offer = useQuery({ queryKey: ['home-offer'], queryFn: () => api<{ tariffs: HomeTariff[]; bundle: boolean }>('/home/offer'), enabled: !home, staleTime: 300_000 });
  if (!home) {
    const min = offer.data ? Math.min(...offer.data.tariffs.map((t) => (offer.data!.bundle ? t.bundlePrice : t.price))) : null;
    return (
      <Link to="/internet" className="flex items-center gap-4 overflow-hidden rounded-3xl bg-gradient-to-r from-[#0f766e] to-[#14b8a6] p-4 text-white">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/20">
          <Router className="size-6" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-bold">Домашний интернет</span>
          <span className="block text-sm text-white/85">До 1 Гбит/с{min ? ` от ${rub(min * 100)}/мес` : ''}{offer.data?.bundle ? ' · −20% вместе с мобильной' : ''}</span>
        </span>
        <ChevronRight className="size-5 text-white/80" />
      </Link>
    );
  }
  const label = home.stage === 'booked' ? `Мастер приедет ${dayTime(home.installAt)}` : home.stage === 'master' ? `Мастер ${home.master} уже едет` : home.stage === 'blocked' ? 'Отключён за неуплату' : `До ${home.tariff.speed} Мбит/с · ${home.gbUsed.toLocaleString('ru-RU')} ГБ за период`;
  return (
    <Link to="/internet" className="block rounded-3xl bg-surface p-4 ring-1 ring-line hover:bg-sunken">
      <div className="flex items-center gap-3">
        <span className={cx('flex size-11 shrink-0 items-center justify-center rounded-2xl', home.status === 'blocked' ? 'bg-bad-soft text-bad' : 'bg-[#14b8a6]/15 text-[#0d9488]')}>
          <Wifi className="size-6" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-bold">Домашний интернет · {home.tariff.title}</span>
          <span className={cx('block truncate text-sm', home.status === 'blocked' ? 'text-bad' : 'text-muted')}>{label}</span>
        </span>
        <ChevronRight className="size-5 text-muted" />
      </div>
      {home.status === 'active' && (
        <div className="mt-3 flex gap-2 text-xs">
          <span className="rounded-full bg-sunken px-2.5 py-1">{home.wifi}</span>
          {home.nextCharge && <span className="rounded-full bg-sunken px-2.5 py-1">{rub(home.nextCharge.amount * 100)} — {day(home.nextCharge.at)}</span>}
        </div>
      )}
    </Link>
  );
}

function Recent({ items }: { items: RecentEvent[] }) {
  if (!items.length) return null;
  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] font-bold">Недавние</h2>
        <Link to="/history" className="text-sm font-semibold text-brand-text">Все</Link>
      </div>
      <div className="-mx-2 mt-1 flex flex-col">
        {items.map((e) => (
          <Link key={e.id} to={e.kind === 'sms' || e.number === 'BOBTEL' ? `/chats/${e.number}` : '/calls'} className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-sunken">
            <Avatar name={e.name} system={e.number === 'BOBTEL'} className="size-10 text-[15px]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold">{e.name ?? e.formatted}</span>
              <span className="flex items-center gap-1 truncate text-sm text-muted">
                {e.kind === 'call' ? (
                  <>
                    {e.direction === 'in' ? <PhoneIncoming className="size-3.5 shrink-0" /> : <PhoneOutgoing className="size-3.5 shrink-0" />}
                    {e.seconds ? talk(e.seconds) : e.status === 'missed' ? 'Пропущенный' : e.status === 'busy' ? 'Занято' : 'Без ответа'}
                  </>
                ) : (
                  <span className="truncate">{e.mine ? 'Вы: ' : ''}{e.text}</span>
                )}
              </span>
            </span>
            <span className="shrink-0 text-xs text-muted">{dayLabel(e.createdAt) === 'Сегодня' ? clock(e.createdAt) : dayLabel(e.createdAt)}</span>
          </Link>
        ))}
      </div>
    </Card>
  );
}

function Dashboard({ state }: { state: LineState }) {
  const line = state.line!;
  const me = useMe();
  const user = me.data?.user;
  const [esim, setEsim] = useState(false);
  const [packs, setPacks] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const { data: plans } = useTariffs();
  const pay = useMutation({
    mutationFn: () => api<Line>('/line/pay', { method: 'POST' }),
    onSuccess: () => {
      toast('Оплачено — связь работает');
      void qc.invalidateQueries({ queryKey: ['line'] });
    },
    onError: (e) => toast(errorText(e), 'bad'),
  });
  const buy = useMutation({
    mutationFn: (id: string) => api<Line>('/line/addons', { body: { id } }),
    onSuccess: (_l, id) => {
      toast(`Пакет «${plans?.addons.find((a) => a.id === id)?.title}» подключён`);
      void qc.invalidateQueries({ queryKey: ['line'] });
    },
    onError: (e) => toast(errorText(e), 'bad'),
  });
  const blocked = line.status === 'blocked';
  const action = (icon: React.ReactNode, label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1.5 rounded-2xl bg-sunken px-1 py-3 text-[13px] font-medium hover:bg-hover">
      <span className="flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand-text">{icon}</span>
      {label}
    </button>
  );
  const bankOk = !!user && user.bankPhone === line.number;
  return (
    <Shell>
      <header className="mb-4 flex items-center gap-3">
        <LogoMark className="size-10" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted">{greeting()},</p>
          <p className="truncate text-[20px] font-bold leading-tight">{user?.name.split(' ')[0]}</p>
        </div>
        <Link to="/chats" aria-label="Сообщения" className="relative inline-flex size-11 items-center justify-center rounded-full bg-sunken">
          <Bell className="size-5" />
          {state.unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-bad px-1 text-center text-[11px] font-bold leading-[18px] text-white">{state.unread}</span>}
        </Link>
      </header>

      <section className={cx('rounded-[28px] p-5 text-white', blocked ? 'bg-gradient-to-br from-[#4b4b55] to-[#2b2b33]' : 'bg-gradient-to-br from-[#2a1f7a] via-[#4334d6] to-[#7a6bff]')}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-white/75">Ваш номер</p>
            <p className="mt-0.5 whitespace-nowrap text-[clamp(20px,6.6vw,28px)] font-bold tracking-tight num" data-testid="my-number">{line.formatted}</p>
          </div>
          <span className={cx('shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold', blocked ? 'bg-[#ef4444]' : 'bg-white/20')}>{blocked ? 'Заблокирован' : 'Активен'}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-medium">
          <Link to="/profile" className={cx('rounded-full px-2 py-0.5', bankOk ? 'bg-white/20' : 'bg-white/10 text-white/70')}>{bankOk ? '✓ Bobobank' : 'Bobobank'}</Link>
          <Link to="/profile" className={cx('rounded-full px-2 py-0.5', user?.gos ? 'bg-white/20' : 'bg-white/10 text-white/70')}>{user?.gos ? '✓ Бобуслуги' : '+ Бобуслуги'}</Link>
          {line.roamingUntil && <span className="rounded-full bg-white/20 px-2 py-0.5">✈ Роуминг до {day(line.roamingUntil)}</span>}
        </div>
        <Link to="/tariffs" className="mt-3 flex items-center justify-between rounded-2xl bg-white/12 px-3 py-2.5 hover:bg-white/18">
          <span>
            <span className="block text-[15px] font-semibold">Тариф «{line.tariff.title}»</span>
            <span className="block text-xs text-white/75">{blocked ? 'Связь приостановлена' : line.nextCharge.at ? `${rub(line.nextCharge.amount * 100)} — ${day(line.nextCharge.at)}` : ''}</span>
          </span>
          <ChevronRight className="size-5 text-white/70" />
        </Link>
      </section>

      {blocked && (
        <div className="mt-3 rounded-3xl bg-bad-soft p-4 text-bad">
          <p className="flex items-center gap-2 text-[15px] font-semibold">
            <AlertTriangle className="size-5" />
            {line.blockReason === 'admin' ? 'Номер заблокирован администратором' : 'Не хватило денег на абонплату'}
          </p>
          {line.blockReason !== 'admin' && (
            <>
              <p className="mt-1 text-sm">Пополните счёт в Bobobank и оплатите — номер заработает сразу.</p>
              <Button className="mt-3 w-full" variant="danger" loading={pay.isPending} onClick={() => pay.mutate()}>
                Оплатить {rub((line.nextTariff ?? line.tariff).price * 100)}
              </Button>
            </>
          )}
        </div>
      )}

      <div className="mt-3 grid grid-cols-4 gap-2">
        {action(<Phone className="size-5" />, 'Позвонить', () => nav('/calls'))}
        {action(<MessageCircle className="size-5" />, 'SMS', () => nav('/chats'))}
        {action(<Package className="size-5" />, 'Пакеты', () => setPacks(true))}
        {action(<QrCode className="size-5" />, 'eSIM', () => setEsim(true))}
      </div>

      <Card className="mt-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-bold">Осталось</h2>
          <span className="text-xs text-muted">до {day(line.periodEnd)}</span>
        </div>
        <div className="mt-3 grid grid-cols-3">
          <Ring label="Минуты" left={line.left.minutes} total={line.total.minutes} unit="min" />
          <Ring label="Интернет" left={line.left.mb} total={line.total.mb} unit="mb" />
          <Ring label="SMS" left={line.left.sms} total={line.total.sms} unit="sms" />
        </div>
        {line.nextTariff && <p className="mt-3 rounded-2xl bg-brand-soft px-3 py-2 text-sm text-brand-text">Со следующего периода — тариф «{line.nextTariff.title}», {rub(line.nextTariff.price * 100)}</p>}
      </Card>

      <div className="mt-3">
        <HomeInternetCard home={state.home} />
      </div>

      {state.usage7.length > 0 && (
        <div className="mt-3">
          <WeekChart usage={state.usage7} />
        </div>
      )}

      {!blocked && plans && (
        <>
          <h2 className="mb-2 mt-5 px-1 text-[13px] font-semibold uppercase tracking-wide text-muted">Пакеты в одно касание</h2>
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {plans.addons.map((a) => (
              <button key={a.id} type="button" disabled={buy.isPending} onClick={() => buy.mutate(a.id)} className="flex w-[132px] shrink-0 flex-col items-start rounded-3xl bg-surface p-3.5 text-left ring-1 ring-line hover:bg-sunken disabled:opacity-60">
                <span className="flex size-9 items-center justify-center rounded-xl bg-brand-soft text-brand-text">{a.roamingDays ? <Plane className="size-5" /> : a.gb ? <Gauge className="size-5" /> : a.minutes ? <Phone className="size-5" /> : <MessageCircle className="size-5" />}</span>
                <span className="mt-2 text-[15px] font-bold leading-tight">{a.title}</span>
                <span className="mt-0.5 text-sm text-muted num">{rub(a.price * 100)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="mt-3">
        <Recent items={state.recent} />
      </div>

      <Link to="/tariffs" className="mt-3 flex items-center gap-3 rounded-3xl bg-surface p-4 ring-1 ring-line hover:bg-sunken">
        <span className="flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand-text">
          <Repeat className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">Сменить тариф</span>
          <span className="block truncate text-sm text-muted">{quotaText(line.tariff)}</span>
        </span>
        <ChevronRight className="size-5 text-muted" />
      </Link>
      <EsimModal line={line} open={esim} onClose={() => setEsim(false)} />
      <AddonsModal open={packs} onClose={() => setPacks(false)} />
    </Shell>
  );
}

export default function Home() {
  const me = useMe();
  const line = useLine(!!me.data?.user);
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  useEffect(() => {
    const err = params.get('auth_error');
    if (err) toast(err, 'bad');
    if (err || params.get('connected')) setParams({}, { replace: true });
  }, [params, setParams, toast]);
  if (me.isLoading || (me.data?.user && line.isLoading)) return <div className="flex min-h-dvh items-center justify-center"><LogoMark className="size-14 animate-pulse" /></div>;
  if (!me.data?.user) return <Landing />;
  if (!line.data?.line) return <Navigate to="/connect" replace />;
  return line.data ? <Dashboard state={line.data} /> : <Loading />;
}
