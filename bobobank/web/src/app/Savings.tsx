import { useQuery } from '@tanstack/react-query';
import { PiggyBank, TrendingUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AccountPicker } from '../components/AccountPicker';
import { CategoryIcon } from '../components/CategoryIcon';
import { Row, Screen } from '../components/Screen';
import { Button, Card, ErrorNote, Field, Input, Loading, cx, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { longDate, money, toAmount } from '../lib/format';
import { useHome, useRefresh } from '../lib/hooks';
import type { Account } from '../lib/types';
import { SectionTitle } from './Shell';

interface Products {
  products: { savingsRate: number; deposits: { months: number; rate: number }[] };
}

export default function Savings() {
  const nav = useNavigate();
  const toast = useToast();
  const refresh = useRefresh();
  const { data: home } = useHome();
  const { data: p } = useQuery({ queryKey: ['products'], queryFn: () => api<Products>('/products') });
  const [months, setMonths] = useState(3);
  const [amount, setAmount] = useState('100000');
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rub = home?.accounts.filter((a) => a.currency === 'RUB' && (a.kind === 'current' || a.kind === 'savings')) ?? [];
  useEffect(() => {
    if (!from && rub.length) setFrom(rub[0].id);
  }, [rub, from]);
  if (!home || !p) return <Loading />;
  const plan = p.products.deposits.find((d) => d.months === months) ?? p.products.deposits[0];
  const amt = Number(toAmount(amount) ?? 0);
  // Daily capitalisation: amount × (1 + r/365)^days.
  const days = Math.round(plan.months * 30.4);
  const income = Math.max(0, Math.round(amt * 100 * ((1 + plan.rate / 100 / 365) ** days - 1)));
  const mine = home.accounts.filter((a) => a.kind === 'deposit' || a.kind === 'savings');
  const hasSavings = mine.some((a) => a.kind === 'savings');

  const openDeposit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ account: Account }>('/deposits', { body: { fromAccountId: from, amount: toAmount(amount), months } });
      toast('Вклад открыт');
      refresh();
      nav(`/app/accounts/${r.account.id}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Вклады и накопления" back={null}>
      {mine.length > 0 && (
        <Card pad={false} className="mb-2 divide-y divide-line overflow-hidden">
          {mine.map((a) => (
            <Row key={a.id} onClick={() => nav(`/app/accounts/${a.id}`)} icon={<CategoryIcon category="savings" />} title={a.name} sub={`${String(a.params.rate)}%${typeof a.params.endsAt === 'number' ? ` · до ${longDate(a.params.endsAt)}` : ' · снимайте когда угодно'}`} right={<span className="font-bold num">{money(a.balance, a.currency)}</span>} />
          ))}
        </Card>
      )}

      <SectionTitle>Вклад «Бобо»</SectionTitle>
      <Card className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {p.products.deposits.map((d) => (
            <button key={d.months} type="button" onClick={() => setMonths(d.months)} className={cx('rounded-2xl border-2 px-3 py-3 text-left', months === d.months ? 'border-brand bg-brand-soft' : 'border-transparent bg-sunken')}>
              <div className="text-xl font-extrabold">{d.rate}%</div>
              <div className="text-xs text-muted">{d.months} мес.</div>
            </button>
          ))}
        </div>
        <Field label="Сумма вклада" hint="От 10 000 ₽">
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-[20px] font-extrabold num" />
        </Field>
        <div className="flex items-center gap-3 rounded-2xl bg-brand-soft p-4">
          <TrendingUp className="size-6 shrink-0 text-brand" />
          <div>
            <div className="text-sm text-muted">Доход за {plan.months} мес. с ежедневной капитализацией</div>
            <div className="text-xl font-extrabold text-brand-strong dark:text-brand num">+{money(income)}</div>
          </div>
        </div>
        <AccountPicker label="Списать со счёта" accounts={rub} value={from} onChange={setFrom} />
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button size="lg" variant="primary" loading={busy} disabled={amt < 10000} onClick={() => void openDeposit()}>Открыть вклад</Button>
        <p className="text-xs text-muted">Проценты начисляются каждый день и сразу прибавляются ко вкладу. При досрочном закрытии начисленные проценты не выплачиваются.</p>
      </Card>

      {!hasSavings && (
        <>
          <SectionTitle>Накопительный счёт</SectionTitle>
          <Card className="flex items-center gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#fff4dc] text-[#b8650a]"><PiggyBank className="size-6" /></span>
            <div className="min-w-0 flex-1">
              <div className="font-bold">{p.products.savingsRate}% на остаток</div>
              <div className="text-sm text-muted">Пополняйте и снимайте без ограничений</div>
            </div>
            <Button variant="primary" onClick={() => void api<{ account: Account }>('/accounts', { body: { kind: 'savings', currency: 'RUB' } }).then((r) => (refresh(), nav(`/app/accounts/${r.account.id}`)), (e) => toast(errorText(e), 'bad'))}>Открыть</Button>
          </Card>
        </>
      )}
    </Screen>
  );
}
