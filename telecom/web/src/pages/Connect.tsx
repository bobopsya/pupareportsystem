import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, RefreshCw, Search, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { EsimModal, quotaText } from '../components/Line';
import { Logo } from '../components/Logo';
import { Button, cx, ErrorNote, Loading, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { rub } from '../lib/format';
import { useAccount, useLine, useMe, useTariffs } from '../lib/hooks';
import type { Line, NumberOffer } from '../lib/types';
import { login } from './Home';

type Step = 'tariff' | 'number' | 'pay';

export default function Connect() {
  const me = useMe();
  const user = me.data?.user;
  const line = useLine(!!user);
  const account = useAccount(!!user?.linked);
  const { data: plans } = useTariffs();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [step, setStep] = useState<Step>('tariff');
  const [tariff, setTariff] = useState('base');
  const [kind, setKind] = useState<'plain' | 'beautiful'>('plain');
  const [q, setQ] = useState('');
  const [seed, setSeed] = useState(0);
  const [pick, setPick] = useState<NumberOffer | null>(null);
  const [done, setDone] = useState<Line | null>(null);
  const numbers = useQuery({
    queryKey: ['numbers', kind, q, tariff, seed],
    queryFn: () => api<{ numbers: NumberOffer[] }>(`/numbers?kind=${kind}&q=${encodeURIComponent(q)}&tariff=${tariff}`),
    enabled: step === 'number',
    staleTime: Infinity,
  });
  const t = plans?.tariffs.find((x) => x.id === tariff);
  const connect = useMutation({
    mutationFn: () => api<Line>('/line', { body: { number: pick!.number, tariff } }),
    onSuccess: (l) => {
      setDone(l);
      void qc.invalidateQueries({ queryKey: ['account'] });
    },
    onError: (e) => {
      toast(errorText(e), 'bad');
      if ((e as { code?: string }).code === 'number_taken') {
        setPick(null);
        setStep('number');
        setSeed((s) => s + 1);
      }
    },
  });

  if (me.isLoading) return <Loading />;
  if (!user) return <Navigate to="/" replace />;
  if (line.data?.line && !done) return <Navigate to="/" replace />;

  if (done)
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center px-5 pb-8 pt-16 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-ok-soft text-ok">
          <Check className="size-8" />
        </span>
        <h1 className="mt-4 text-[26px] font-bold">Номер подключён!</h1>
        <p className="mt-1 text-[22px] font-bold text-brand-text num">{done.formatted}</p>
        <p className="mt-2 text-[15px] text-muted">Тариф «{done.tariff.title}». Звоните и пишите абонентам Бобтелекома — для этого дайте им свой номер.</p>
        <EsimInline line={done} />
        <Button className="mt-auto w-full" size="lg" variant="brand" onClick={() => void qc.invalidateQueries({ queryKey: ['line'] }).then(() => nav('/'))}>
          Начать пользоваться
        </Button>
      </div>
    );

  const total = (pick?.price ?? 0) + (t?.price ?? 0);
  const short = account.data?.available !== undefined && account.data.available < total * 100;
  const back = () => (step === 'pay' ? setStep('number') : step === 'number' ? setStep('tariff') : undefined);

  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]">
      <header className="mb-4 flex min-h-10 items-center gap-2">
        {step !== 'tariff' ? (
          <button type="button" aria-label="Назад" onClick={back} className="-ml-1 inline-flex size-10 items-center justify-center rounded-full hover:bg-sunken">
            <ArrowLeft className="size-5" />
          </button>
        ) : (
          <Logo />
        )}
        <span className="ml-auto text-sm text-muted">Шаг {step === 'tariff' ? 1 : step === 'number' ? 2 : 3} из 3</span>
      </header>

      {step === 'tariff' && (
        <>
          <h1 className="text-[26px] font-bold tracking-tight">Здравствуйте, {user.name.split(' ')[0]}!</h1>
          <p className="mt-1 text-[15px] text-muted">Выберите тариф — его можно сменить в любой момент.</p>
          <div className="mt-4 flex flex-col gap-2">
            {plans?.tariffs.map((x) => (
              <button key={x.id} type="button" onClick={() => setTariff(x.id)} className={cx('rounded-3xl border-2 p-4 text-left transition-colors', tariff === x.id ? 'border-brand bg-brand-soft/60' : 'border-transparent bg-sunken')}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[19px] font-bold">{x.title}</span>
                  <span className="text-[19px] font-bold num">
                    {rub(x.price * 100)}
                    <span className="text-sm font-medium text-muted">/мес</span>
                  </span>
                </div>
                <p className="mt-0.5 text-[15px] font-medium">{quotaText(x)}</p>
                <ul className="mt-1.5 text-sm text-muted">
                  {x.perks.map((p) => (
                    <li key={p}>· {p}</li>
                  ))}
                </ul>
              </button>
            ))}
          </div>
          <Button className="mt-4 w-full" size="lg" variant="brand" onClick={() => setStep('number')}>
            Выбрать номер
          </Button>
        </>
      )}

      {step === 'number' && (
        <>
          <h1 className="text-[26px] font-bold tracking-tight">Выберите номер</h1>
          <div className="mt-3 grid grid-cols-2 gap-1 rounded-2xl bg-sunken p-1">
            {(['plain', 'beautiful'] as const).map((k) => (
              <button key={k} type="button" onClick={() => (setKind(k), setPick(null))} className={cx('h-10 rounded-xl text-[15px] font-semibold', kind === k ? 'bg-surface shadow-sm' : 'text-muted')}>
                {k === 'plain' ? 'Обычные · бесплатно' : 'Красивые'}
              </button>
            ))}
          </div>
          <label className="mt-3 flex h-12 items-center gap-2 rounded-2xl bg-sunken px-4">
            <Search className="size-5 text-muted" />
            <input value={q} onChange={(e) => (setQ(e.target.value.replace(/\D/g, '').slice(0, 7)), setPick(null))} inputMode="numeric" placeholder="Любимые цифры в конце номера" className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none" />
          </label>
          <div className="mt-3 flex flex-col gap-2">
            {numbers.isLoading && <Loading />}
            {numbers.data?.numbers.map((n) => (
              <button key={n.number} type="button" onClick={() => setPick(n)} className={cx('flex items-center justify-between rounded-2xl border-2 px-4 py-3 text-left', pick?.number === n.number ? 'border-brand bg-brand-soft/60' : 'border-transparent bg-sunken')}>
                <span className="text-[19px] font-semibold tracking-tight num">{n.formatted}</span>
                <span className={cx('flex items-center gap-1 text-[15px] font-semibold', n.price ? 'text-brand-text' : 'text-ok')}>
                  {n.price > 0 && <Sparkles className="size-4" />}
                  {n.price ? rub(n.price * 100) : 'Бесплатно'}
                </span>
              </button>
            ))}
            {numbers.data && !numbers.data.numbers.length && <ErrorNote>Свободных номеров с такими цифрами нет — попробуйте другие.</ErrorNote>}
          </div>
          <button type="button" onClick={() => (setSeed((s) => s + 1), setPick(null))} className="mx-auto mt-3 flex h-10 items-center gap-2 px-3 text-[15px] font-semibold text-brand-text">
            <RefreshCw className="size-4" /> Другие номера
          </button>
          <Button className="mt-2 w-full" size="lg" variant="brand" disabled={!pick} onClick={() => setStep('pay')}>
            {pick ? `Дальше · ${pick.formatted}` : 'Выберите номер'}
          </Button>
        </>
      )}

      {step === 'pay' && pick && t && (
        <>
          <h1 className="text-[26px] font-bold tracking-tight">Проверьте и оплатите</h1>
          <div className="mt-4 rounded-3xl bg-sunken p-4">
            <div className="flex justify-between gap-3 py-1.5">
              <span className="text-muted">Номер</span>
              <span className="shrink-0 whitespace-nowrap font-semibold num">{pick.formatted}</span>
            </div>
            {pick.price > 0 && (
              <div className="flex justify-between gap-3 py-1.5">
                <span className="text-muted">Красивый номер, разово</span>
                <span className="shrink-0 whitespace-nowrap font-semibold num">{rub(pick.price * 100)}</span>
              </div>
            )}
            <div className="flex justify-between gap-3 py-1.5">
              <span className="text-muted">Тариф «{t.title}», первый месяц</span>
              <span className="shrink-0 whitespace-nowrap font-semibold num">{rub(t.price * 100)}</span>
            </div>
            <div className="mt-2 flex justify-between gap-3 border-t border-line-strong pt-3 text-[18px] font-bold">
              <span>Итого</span>
              <span className="whitespace-nowrap num">{rub(total * 100)}</span>
            </div>
          </div>
          <p className="mt-3 text-sm text-muted">Дальше каждые 30 дней со счёта Bobobank •• {user.accountLast4} спишется {rub(t.price * 100)}. Не хватит денег — номер заблокируется до оплаты.</p>
          {short && <div className="mt-3"><ErrorNote>На счёте доступно {rub(account.data!.available!)} — не хватит. Пополните счёт в Bobobank.</ErrorNote></div>}
          {user.linked ? (
            <Button className="mt-4 w-full" size="lg" variant="brand" loading={connect.isPending} onClick={() => connect.mutate()}>
              Подключить · {rub(total * 100)}
            </Button>
          ) : (
            <Button className="mt-4 w-full" size="lg" variant="ink" onClick={login}>
              Привязать счёт Bobobank
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function EsimInline({ line }: { line: Line }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="mt-4 text-[15px] font-semibold text-brand-text">
        Показать eSIM
      </button>
      <EsimModal line={line} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
