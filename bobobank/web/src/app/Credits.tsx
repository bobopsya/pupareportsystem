import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, CreditCard, Landmark, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CategoryIcon } from '../components/CategoryIcon';
import { Row, Screen } from '../components/Screen';
import { Badge, Button, Card, Loading, Spinner, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { longDate, money } from '../lib/format';
import { useRefresh } from '../lib/hooks';
import type { Account, Application, Loan } from '../lib/types';
import { SectionTitle } from './Shell';

interface C {
  loans: Loan[];
  applications: Application[];
  creditCards: Account[];
  products: { loanRate: number; creditCardRate: number; creditCardGraceDays: number };
}

export default function Credits() {
  const nav = useNavigate();
  const toast = useToast();
  const refresh = useRefresh();
  const { data, refetch } = useQuery({
    queryKey: ['credits'],
    queryFn: () => api<C>('/credits'),
    refetchInterval: (q) => (q.state.data?.applications.some((a) => a.status === 'processing') ? 1500 : false),
  });
  const [busy, setBusy] = useState<string | null>(null);
  if (!data) return <Loading />;
  const live = data.applications.filter((a) => ['processing', 'review', 'approved'].includes(a.status));
  const past = data.applications.filter((a) => !['processing', 'review', 'approved'].includes(a.status)).slice(0, 5);
  const accept = async (a: Application) => {
    setBusy(a.id);
    try {
      const r = await api<{ resultId: string; product: string }>(`/applications/${a.id}/accept`, { body: {} });
      refresh();
      toast(a.product === 'loan' ? 'Деньги зачислены на счёт' : 'Кредитная карта выпущена');
      nav(a.product === 'loan' ? `/app/loans/${r.resultId}` : `/app/cards/${r.resultId}`);
    } catch (e) {
      toast(errorText(e), 'bad');
    } finally {
      setBusy(null);
    }
  };
  return (
    <Screen title="Кредиты" back={null}>
      {live.map((a) => (
        <Card key={a.id} className="mb-3">
          <div className="flex items-start gap-3">
            {a.status === 'processing' ? <Spinner className="size-7 text-brand" /> : a.status === 'approved' ? <CheckCircle2 className="size-7 text-brand" /> : <Clock className="size-7 text-warn" />}
            <div className="min-w-0 flex-1">
              <div className="font-bold">{a.product === 'loan' ? 'Кредит наличными' : 'Кредитная карта'} · {money(a.amount)}</div>
              <div className="text-sm text-muted">
                {a.status === 'processing' && 'Банк проверяет заявку, это займёт несколько секунд…'}
                {a.status === 'review' && 'Заявка на дополнительной проверке у специалиста. Мы пришлём уведомление.'}
                {a.status === 'approved' && `Одобрено ${money(a.offerAmount ?? 0)} под ${a.offerRate}%${a.product === 'loan' ? ` на ${a.term} мес.` : ''}`}
              </div>
            </div>
          </div>
          {a.status === 'approved' && (
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button variant="primary" size="lg" loading={busy === a.id} onClick={() => void accept(a)}>{a.product === 'loan' ? 'Получить деньги' : 'Выпустить карту'}</Button>
              <Button size="lg" onClick={() => void api(`/applications/${a.id}/cancel`, { body: {} }).then(() => refetch())}>Отказаться</Button>
            </div>
          )}
        </Card>
      ))}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button type="button" onClick={() => nav('/app/credits/apply/loan')} className="flex min-h-[148px] flex-col justify-between rounded-[24px] bg-[#e7efff] p-5 text-left text-[#1d3f8f] dark:bg-[#151d33] dark:text-[#82a8ff]">
          <Landmark className="size-7" />
          <span><span className="block text-lg font-extrabold">Кредит наличными</span><span className="block text-sm opacity-80">от {data.products.loanRate}%, до 5 млн ₽, решение за минуту</span></span>
        </button>
        <button type="button" onClick={() => nav('/app/credits/apply/credit_card')} className="flex min-h-[148px] flex-col justify-between rounded-[24px] bg-brand p-5 text-left text-on-brand">
          <CreditCard className="size-7" />
          <span><span className="block text-lg font-extrabold">Кредитная карта</span><span className="block text-sm opacity-90">{data.products.creditCardGraceDays} дней без процентов на покупки</span></span>
        </button>
      </div>

      {(data.loans.length > 0 || data.creditCards.length > 0) && <SectionTitle>Мои кредиты</SectionTitle>}
      {(data.loans.length > 0 || data.creditCards.length > 0) && (
        <Card pad={false} className="divide-y divide-line overflow-hidden">
          {data.creditCards.map((a) => (
            <Row key={a.id} onClick={() => nav(`/app/accounts/${a.id}`)} icon={<CategoryIcon category="credit" />} title="Кредитная карта" sub={`Доступно ${money(a.available)} из ${money(a.creditLimit)}`} right={a.balance < 0 ? <span className="font-bold num text-bad">{money(a.balance)}</span> : <Badge tone="brand">Без долга</Badge>} />
          ))}
          {data.loans.map((l) => (
            <Row key={l.id} onClick={() => nav(`/app/loans/${l.id}`)} icon={<CategoryIcon category="credit" />} title={`Кредит ${money(l.principal)}`} sub={l.status === 'closed' ? 'Погашен' : l.next ? `Платёж ${money(l.next.amount)} · ${longDate(l.next.dueAt)}` : ''} right={l.status === 'overdue' ? <Badge tone="bad">Просрочка</Badge> : l.status === 'closed' ? <Badge>Закрыт</Badge> : <span className="font-bold num">{money(l.debt)}</span>} />
          ))}
        </Card>
      )}

      {past.length > 0 && (
        <>
          <SectionTitle>История заявок</SectionTitle>
          <Card pad={false} className="divide-y divide-line overflow-hidden">
            {past.map((a) => (
              <Row key={a.id} icon={a.status === 'rejected' ? <XCircle className="size-6 text-bad" /> : <CheckCircle2 className="size-6 text-muted" />} title={`${a.product === 'loan' ? 'Кредит' : 'Кредитная карта'} · ${money(a.amount)}`} sub={a.status === 'rejected' ? a.reason ?? 'Отказ' : a.status === 'issued' ? 'Оформлен' : 'Отменена'} />
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
