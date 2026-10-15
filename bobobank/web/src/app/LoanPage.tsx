import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AccountPicker } from '../components/AccountPicker';
import { Screen } from '../components/Screen';
import { Badge, Button, Card, ErrorNote, Loading, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { longDate, money } from '../lib/format';
import { useHome, useRefresh } from '../lib/hooks';
import type { Loan } from '../lib/types';
import { SectionTitle } from './Shell';

export default function LoanPage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const refresh = useRefresh();
  const { data: home } = useHome();
  const { data, refetch } = useQuery({ queryKey: ['credits', 'loan', id], queryFn: () => api<{ loans: Loan[] }>('/credits').then((r) => r.loans.find((l) => l.id === id) ?? null) });
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rub = home?.accounts.filter((a) => a.currency === 'RUB' && ['current', 'savings', 'business'].includes(a.kind)) ?? [];
  useEffect(() => {
    if (!from && data) setFrom(data.payoutAccountId);
  }, [data, from]);
  if (data === undefined || !home) return <Loading />;
  if (!data) return <ErrorNote>Кредит не найден</ErrorNote>;
  const pay = async (full: boolean) => {
    setBusy(full ? 'full' : 'next');
    setError(null);
    try {
      await api(`/loans/${id}/pay`, { body: { fromAccountId: from, full } });
      toast(full ? 'Кредит погашен' : 'Платёж внесён');
      await refetch();
      refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Screen title="Кредит наличными" sub={`${data.rate}% · ${data.term} мес.`}>
      <Card className={data.status === 'overdue' ? 'bg-bad-soft' : ''}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted">Остаток долга</span>
          {data.status === 'overdue' ? <Badge tone="bad">Просрочка</Badge> : data.status === 'closed' ? <Badge>Погашен</Badge> : <Badge tone="brand">Платёж {data.paidCount + 1} из {data.term}</Badge>}
        </div>
        <div className="text-[34px] font-semibold num">{money(data.debt)}</div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full bg-brand" style={{ width: `${((data.principal - data.debt) / data.principal) * 100}%` }} /></div>
        <div className="mt-1 text-xs text-muted">Выплачено {money(data.principal - data.debt)} из {money(data.principal)}</div>
        {data.next && (
          <div className="mt-4 rounded-2xl bg-sunken p-3 text-sm">
            Следующий платёж <b className="num">{money(data.next.amount)}</b> — {longDate(data.next.dueAt)}{data.penalty > 0 && <span className="text-bad"> (с пенями {money(data.penalty)})</span>}. Спишем автоматически со счёта зачисления.
          </div>
        )}
      </Card>
      {data.status !== 'closed' && (
        <Card className="mt-3 flex flex-col gap-3">
          <AccountPicker label="Списать со счёта" accounts={rub} value={from} onChange={setFrom} />
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button variant="primary" size="lg" loading={busy === 'next'} onClick={() => void pay(false)}>Внести платёж</Button>
            <Button size="lg" loading={busy === 'full'} onClick={() => void pay(true)}>Погасить полностью</Button>
          </div>
        </Card>
      )}
      <SectionTitle>График платежей</SectionTitle>
      <Card pad={false} className="overflow-hidden">
        {data.schedule.map((s) => (
          <div key={s.n} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
            {s.paid ? <CheckCircle2 className="size-5 shrink-0 text-brand" /> : <Circle className="size-5 shrink-0 text-faint" />}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{longDate(s.dueAt)}</div>
              <div className="text-xs text-muted num">долг {money(s.principal)} · проценты {money(s.interest)}</div>
            </div>
            <div className="font-semibold num">{money(s.payment)}</div>
          </div>
        ))}
      </Card>
    </Screen>
  );
}
