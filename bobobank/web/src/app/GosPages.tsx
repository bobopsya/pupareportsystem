import { useQuery } from '@tanstack/react-query';
import { ArrowDownUp, Briefcase, Landmark, RefreshCw, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AccountPicker } from '../components/AccountPicker';
import { EntryRow } from '../components/EntryRow';
import { GosButton, GosMark, GosNote } from '../components/Gos';
import { Logo } from '../components/Logo';
import { Screen } from '../components/Screen';
import { Success } from '../components/Success';
import { Button, Card, ErrorNote, Field, Input, Loading, Segmented, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { money } from '../lib/format';
import { useHome, useRefresh } from '../lib/hooks';
import type { Account, Entry, GosStatus } from '../lib/types';
import { SectionTitle } from './Shell';

const coins = (n: number) => `${n.toLocaleString('ru-RU')} ПСЯ`;

/** Home: with Бобуслуги connected, customers without a confirmed passport are asked to confirm it. */
export function KycBanner({ gos }: { gos: GosStatus | undefined }) {
  if (!gos?.required || gos.ok) return null;
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 size-6 shrink-0 text-[#E8A200]" />
        <div className="min-w-0">
          <div className="font-semibold">{gos.linked ? 'Нужен действующий Бобопаспорт' : 'Подтвердите личность через Бобуслуги'}</div>
          <div className="text-sm text-muted">{gos.linked ? 'Паспорт на Бобуслугах не найден или отозван. Новые счета, карты и кредиты откроются после его оформления.' : 'Без этого нельзя открывать новые счета, карты и кредиты. Всё, что уже есть, работает как прежде.'}</div>
        </div>
      </div>
      <GosButton link next="/app" label={gos.linked ? 'Обновить данные с Бобуслуг' : 'Подключить Бобуслуги'} />
    </div>
  );
}

/** Profile: what the bank knows from Бобуслуги. */
export function GosProfileCard({ gos }: { gos: GosStatus | undefined }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (params.get('gos') === 'linked') toast('Бобуслуги подключены');
    const err = params.get('gosError');
    if (err) toast(err, 'bad');
  }, [params, toast]);
  if (!gos?.required) return null;
  const update = async () => {
    setBusy(true);
    try {
      await api('/profile/gos/refresh', { body: {} });
      refresh();
      toast('Данные обновлены');
    } catch (e) {
      toast(errorText(e), 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SectionTitle>Бобуслуги</SectionTitle>
      <Card className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <GosMark className="size-10" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">{gos.linked ? `Аккаунт ${gos.login}` : 'Не подключены'}</div>
            <div className="text-sm text-muted">
              {gos.passport ? `Бобопаспорт ${gos.passport.number}` : gos.linked ? 'Бобопаспорта нет' : 'Подтвердите личность, чтобы открывать продукты'}
            </div>
          </div>
          {gos.linked && (
            <Button size="sm" variant="secondary" loading={busy} icon={<RefreshCw className="size-4" />} onClick={() => void update()}>
              Обновить
            </Button>
          )}
        </div>
        {!gos.linked && <GosButton link next="/app/profile" label="Подключить Бобуслуги" />}
      </Card>
    </>
  );
}

interface Business {
  id: number;
  number: string;
  name: string;
  org_type: 'ИП' | 'Компания';
  inn: string;
  hasAccount: boolean;
}

/** Business account from the registry on Бобуслуги: pick the business, the name and INN come from there. */
export function BusinessPicker({ gosUrl, busy, onOpen }: { gosUrl: string; busy: boolean; onOpen: (businessId: number) => void }) {
  const { data, error } = useQuery({ queryKey: ['gos-businesses'], queryFn: () => api<{ linked: boolean; businesses: Business[] }>('/gos/businesses') });
  if (error) return <ErrorNote>{errorText(error)}</ErrorNote>;
  if (!data) return <Loading />;
  if (!data.businesses.length) {
    return (
      <Card className="flex flex-col gap-3 text-center">
        <Briefcase className="mx-auto size-10 text-muted" />
        <div className="font-semibold">В реестре нет вашего бизнеса</div>
        <p className="text-sm text-muted">Зарегистрируйте ИП или компанию на Бобуслугах — после одобрения счёт откроется здесь в один клик.</p>
        <a href={`${gosUrl}/#/services`} className="font-medium text-brand">Открыть Бобуслуги</a>
      </Card>
    );
  }
  return (
    <Card pad={false} className="divide-y divide-line overflow-hidden">
      {data.businesses.map((b) => (
        <div key={b.id} className="flex items-center gap-3 p-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand"><Briefcase className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="font-medium">{b.org_type === 'ИП' ? `ИП ${b.name}` : `«${b.name}»`}</div>
            <div className="text-sm text-muted num">ИНН {b.inn}</div>
          </div>
          {b.hasAccount ? <span className="text-sm text-muted">Счёт есть</span> : <Button size="sm" variant="primary" loading={busy} onClick={() => onOpen(b.id)}>Открыть</Button>}
        </div>
      ))}
    </Card>
  );
}

// ---------- Псякоины ----------

interface ExchangeInfo {
  linked: boolean;
  rate: number;
  spread: number;
  coins: number;
  buy: number;
  sell: number;
}

export function PsyExchange() {
  const nav = useNavigate();
  const refresh = useRefresh();
  const { data: home } = useHome();
  const { data: info, error, refetch } = useQuery({ queryKey: ['psy'], queryFn: () => api<ExchangeInfo>('/gos/exchange') });
  const accounts = useMemo(() => home?.accounts.filter((a) => a.currency === 'RUB' && ['current', 'business'].includes(a.kind)) ?? [], [home]);
  const [dir, setDir] = useState<'to_rub' | 'to_psy'>('to_rub');
  const [from, setFrom] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ rub: number; coins: number } | null>(null);
  useEffect(() => {
    if (!from && accounts.length) setFrom(accounts[0].id);
  }, [accounts, from]);
  if (error) return <Screen title="Псякоины"><ErrorNote>{errorText(error)}</ErrorNote></Screen>;
  if (!info || !home) return <Loading />;
  if (!info.linked) {
    return (
      <Screen title="Псякоины">
        <Card className="flex flex-col gap-3">
          <p className="text-muted">Чтобы менять псякоины с Бобуслуг на рубли и обратно, подключите Бобуслуги.</p>
          <GosButton link next="/app/exchange/psy" label="Подключить Бобуслуги" />
        </Card>
      </Screen>
    );
  }
  const n = Math.max(0, Math.floor(Number(amount.replace(/\s/g, '')) || 0));
  const rub = n * (dir === 'to_rub' ? info.sell : info.buy);
  const acc = accounts.find((a) => a.id === from);
  if (done) {
    return (
      <Success
        title={dir === 'to_rub' ? 'Псякоины обменяны' : 'Псякоины куплены'}
        amount={dir === 'to_rub' ? `+${money(done.rub, 'RUB', { exact: true })}` : coins(done.coins)}
        lines={[['Псякоинов', coins(done.coins)], ['Рублей', money(done.rub, 'RUB', { exact: true })], ['Курс', `1 ПСЯ = ${money(info.rate, 'RUB', { exact: true })}`]]}
        onDone={() => nav('/app', { replace: true })}
      />
    );
  }
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ rub: number; coins: number }>('/gos/exchange', { body: { accountId: from, coins: n, direction: dir } });
      refresh();
      void refetch();
      setDone(r);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const over = dir === 'to_rub' ? n > info.coins : !!acc && rub > acc.available;
  return (
    <Screen title="Псякоины">
      <div className="grid grid-cols-2 gap-3">
        <Card><div className="text-sm text-muted">На Бобуслугах</div><div className="mt-1 text-xl font-semibold num">{coins(info.coins)}</div></Card>
        <Card><div className="text-sm text-muted">Курс</div><div className="mt-1 text-xl font-semibold num">{money(info.rate, 'RUB', { exact: true })}</div><div className="text-xs text-muted">Покупка {money(info.buy, 'RUB', { exact: true })} · продажа {money(info.sell, 'RUB', { exact: true })}</div></Card>
      </div>
      <Card className="mt-3 flex flex-col gap-4">
        <Segmented value={dir} onChange={setDir} options={[{ value: 'to_rub', label: 'Продать ПСЯ' }, { value: 'to_psy', label: 'Купить ПСЯ' }]} />
        <AccountPicker label={dir === 'to_rub' ? 'Зачислить на счёт' : 'Списать со счёта'} accounts={accounts} value={from} onChange={setFrom} />
        <Field label="Сколько псякоинов" error={over ? (dir === 'to_rub' ? 'Столько псякоинов нет' : 'Недостаточно средств') : null}>
          <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 7))} placeholder="0" className="text-[22px] font-semibold num" invalid={over} />
        </Field>
        <div className="flex items-center gap-2 text-sm text-muted">
          <ArrowDownUp className="size-4" />
          {dir === 'to_rub' ? 'Получите' : 'Спишем'} <b className="text-fg num">{money(rub, 'RUB', { exact: true })}</b>
          <span className="text-faint">· спред {info.spread}%</span>
        </div>
        {err && <ErrorNote>{err}</ErrorNote>}
        <Button size="lg" variant="primary" loading={busy} disabled={!n || !from || over} onClick={() => void submit()}>{dir === 'to_rub' ? 'Продать' : 'Купить'}</Button>
      </Card>
    </Screen>
  );
}

// ---------- Казна ----------

export function Treasury() {
  const { data, error } = useQuery({ queryKey: ['treasury'], queryFn: () => api<{ country: { code: string; name?: string }; account: Account; entries: Entry[] }>('/treasury') });
  if (error) return <Screen title="Казна"><ErrorNote>{errorText(error)}</ErrorNote></Screen>;
  if (!data) return <Loading />;
  return (
    <Screen title={`Казна ${data.country.name ?? data.country.code}`}>
      <Card>
        <div className="flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand"><Landmark className="size-6" /></span>
          <div>
            <div className="text-[28px] font-semibold leading-none num">{money(data.account.balance, 'RUB')}</div>
            <div className="mt-1 text-sm text-muted num">Счёт {data.account.number}</div>
          </div>
        </div>
        <p className="mt-3 text-sm text-muted">Сюда приходят штрафы, налоги и пошлины, оплаченные из Bobobank. Зарплаты госслужащим выплачиваются отсюда на Бобуслугах: «Казна → Выплатить из банка».</p>
      </Card>
      <SectionTitle>Операции</SectionTitle>
      <Card pad={false} className="overflow-hidden">
        {data.entries.length ? data.entries.map((e) => <EntryRow key={e.id} e={e} />) : <p className="p-6 text-center text-muted">Операций пока нет</p>}
      </Card>
    </Screen>
  );
}

// ---------- Оплата штрафа с Бобуслуг ----------

interface Fine {
  id: number;
  amount: number;
  amountRub: number;
  reason: string;
  kind: string;
  status: string;
  country: string | null;
  payer: string;
  login: string;
}

export function GosPay() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const refresh = useRefresh();
  const id = params.get('fine') ?? '';
  const back = params.get('return');
  const { data: home } = useHome();
  const { data, error } = useQuery({ queryKey: ['gos-fine', id], queryFn: () => api<{ fine: Fine }>(`/gos/fines/${encodeURIComponent(id)}`).then((r) => r.fine), enabled: !!id, retry: false });
  const accounts = useMemo(() => home?.accounts.filter((a) => a.currency === 'RUB' && ['current', 'savings', 'business', 'credit_card', 'kids'].includes(a.kind)) ?? [], [home]);
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ entryId: number; returnUrl: string | null } | null>(null);
  useEffect(() => {
    if (!from && accounts.length) setFrom(accounts[0].id);
  }, [accounts, from]);
  const backTo = done?.returnUrl ?? null;
  const [left, setLeft] = useState(3);
  useEffect(() => {
    if (!backTo) return;
    if (left <= 0) {
      window.location.replace(backTo);
      return;
    }
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [backTo, left]);

  const what = data?.kind === 'tax' ? 'Налог' : data?.kind === 'court' ? 'Взыскание по суду' : 'Штраф';
  const wrap = (children: React.ReactNode) => (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <div className="mb-6 flex items-center justify-between"><Logo compact /><GosMark className="size-9" /></div>
      {children}
    </div>
  );
  if (!id) return wrap(<ErrorNote>Ссылка без номера штрафа.</ErrorNote>);
  if (error) return wrap(<><ErrorNote>{errorText(error)}</ErrorNote><Button className="mt-4 w-full" onClick={() => nav('/app')}>В приложение</Button></>);
  if (!data || !home) return wrap(<Loading />);
  if (done) {
    return wrap(
      <Success
        title={`${what} оплачен`}
        amount={money(data.amountRub, 'RUB', { exact: true })}
        lines={[['Получатель', data.kind === 'court' ? 'Истец по решению суда' : `Казна ${data.country ?? ''}`], ['Назначение', data.reason], ['На Бобуслугах', `${data.amount} ПСЯ — закрыт`]]}
        entryId={done.entryId}
        doneLabel={backTo ? 'Вернуться на Бобуслуги' : 'Готово'}
        extra={backTo ? <p className="mt-4 text-sm text-muted">Возвращаем на Бобуслуги через {Math.max(left, 0)} с…</p> : undefined}
        onDone={() => (backTo ? window.location.replace(backTo) : nav('/app', { replace: true }))}
      />,
    );
  }
  const pay = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ entryId: number; returnUrl: string | null }>(`/gos/fines/${data.id}/pay`, { body: { accountId: from, return: back ?? undefined } });
      refresh();
      setDone(r);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return wrap(
    <>
      <Card className="text-center">
        <div className="text-sm text-muted">{what} №{data.id} · {data.country ?? 'Бобуслуги'}</div>
        <div className="mt-3 text-[38px] font-semibold leading-none num">{money(data.amountRub, 'RUB', { exact: data.amountRub % 100 !== 0 })}</div>
        <div className="mt-1 text-sm text-muted num">{data.amount} ПСЯ по курсу Бобуслуг</div>
        <div className="mt-3 text-[15px]">{data.reason}</div>
        <div className="mt-1 text-sm text-muted">Плательщик: {data.payer} ({data.login})</div>
      </Card>
      {data.status === 'unpaid' ? (
        <Card className="mt-3 flex flex-col gap-3">
          <AccountPicker label="Списать со счёта" accounts={accounts} value={from} onChange={setFrom} />
          {err && <ErrorNote>{err}</ErrorNote>}
          <Button size="lg" variant="primary" loading={busy} disabled={!from} onClick={() => void pay()}>Оплатить {money(data.amountRub, 'RUB', { exact: data.amountRub % 100 !== 0 })}</Button>
          <GosNote>Штраф закроется на Бобуслугах сразу после оплаты. Без комиссии.</GosNote>
        </Card>
      ) : (
        <div className="mt-3"><ErrorNote>{data.status === 'paid' ? 'Этот штраф уже оплачен.' : 'Штраф отменён.'}</ErrorNote></div>
      )}
      <Button className="mt-3 w-full" variant="ghost" onClick={() => (back ? window.location.assign(back) : nav('/app'))}>{back ? 'Вернуться на Бобуслуги' : 'Отмена'}</Button>
    </>,
  );
}
