import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, MessageCircle, Package, Phone, Plane, QrCode, Repeat } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AddonsModal, EsimModal, quotaText, Ring } from '../components/Line';
import { Logo, LogoMark } from '../components/Logo';
import { Card, Shell } from '../components/Shell';
import { Button, cx, Loading, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { day, rub } from '../lib/format';
import { useLine, useMe, useTariffs } from '../lib/hooks';
import type { Line } from '../lib/types';

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

function Dashboard({ line }: { line: Line }) {
  const [esim, setEsim] = useState(false);
  const [packs, setPacks] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const pay = useMutation({
    mutationFn: () => api<Line>('/line/pay', { method: 'POST' }),
    onSuccess: () => {
      toast('Оплачено — связь работает');
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
  return (
    <Shell>
      <div className="mb-4 flex items-center justify-between">
        <Logo />
      </div>
      <section className={cx('rounded-[28px] p-5 text-white', blocked ? 'bg-gradient-to-br from-[#4b4b55] to-[#2b2b33]' : 'bg-gradient-to-br from-[#2a1f7a] via-[#4334d6] to-[#7a6bff]')}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-white/75">Ваш номер</p>
            <p className="mt-0.5 whitespace-nowrap text-[clamp(20px,6.6vw,28px)] font-bold tracking-tight num" data-testid="my-number">{line.formatted}</p>
          </div>
          <span className={cx('shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold', blocked ? 'bg-[#ef4444]' : 'bg-white/20')}>{blocked ? 'Заблокирован' : 'Активен'}</span>
        </div>
        <Link to="/tariffs" className="mt-4 flex items-center justify-between rounded-2xl bg-white/12 px-3 py-2.5 hover:bg-white/18">
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
        {line.roamingUntil && (
          <p className="mt-3 flex items-center gap-2 rounded-2xl bg-sunken px-3 py-2 text-sm">
            <Plane className="size-4 text-brand-text" /> Роуминг включён до {day(line.roamingUntil)}
          </p>
        )}
      </Card>

      <div className="mt-3 grid grid-cols-4 gap-2">
        {action(<Phone className="size-5" />, 'Позвонить', () => nav('/calls'))}
        {action(<MessageCircle className="size-5" />, 'SMS', () => nav('/chats'))}
        {action(<Package className="size-5" />, 'Пакеты', () => setPacks(true))}
        {action(<QrCode className="size-5" />, 'eSIM', () => setEsim(true))}
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
  return line.data ? <Dashboard line={line.data.line} /> : <Loading />;
}
