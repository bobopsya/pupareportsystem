import { useQuery } from '@tanstack/react-query';
import { Card, Loading, PageHeader, cx } from '../components/ui';
import { api } from '../lib/api';
import { dateTime, money } from '../lib/format';

interface Tx {
  id: string;
  kind: string;
  description: string;
  createdAt: number;
  legs: { amount: number; currency: string; name: string; number: string; user_id: string | null; user_name: string | null }[];
}

export function TransactionsPage() {
  const { data } = useQuery({ queryKey: ['admin', 'tx'], queryFn: () => api<{ items: Tx[] }>('/admin/transactions'), refetchInterval: 10_000 });
  return (
    <>
      <PageHeader title="Проводки" sub="Каждая операция — набор проводок, сумма которых равна нулю" />
      {!data ? <Loading /> : (
        <div className="flex flex-col gap-2">
          {data.items.map((t) => (
            <Card key={t.id} className="!p-4">
              <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-semibold">{t.description || t.kind}</span><span className="text-muted">{t.kind} · {dateTime(t.createdAt)}</span></div>
              <div className="mt-2 flex flex-col gap-1">
                {t.legs.map((l, i) => (
                  <div key={i} className="flex justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-muted">{l.user_name ? `${l.user_name} · ` : ''}{l.name} <span className="num">•• {l.number.slice(-4)}</span></span>
                    <span className={cx('shrink-0 font-semibold num', l.amount > 0 && 'text-ok')}>{money(l.amount, l.currency, { sign: true, exact: true })}</span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export function AuditPage() {
  const { data } = useQuery({ queryKey: ['admin', 'audit'], queryFn: () => api<{ items: { id: number; ts: number; user_name: string | null; action: string; entity: string | null; summary: string | null; ip: string | null }[] }>('/admin/audit') });
  return (
    <>
      <PageHeader title="Журнал действий" />
      {!data ? <Loading /> : (
        <Card pad={false} className="overflow-hidden">
          {data.items.map((a) => (
            <div key={a.id} className="flex flex-col gap-0.5 border-b border-line px-4 py-2.5 text-sm last:border-0 sm:flex-row sm:gap-4">
              <span className="shrink-0 text-muted num sm:w-36">{dateTime(a.ts)}</span>
              <span className="shrink-0 font-semibold sm:w-40 truncate">{a.user_name ?? 'система'}</span>
              <span className="min-w-0 flex-1 break-words"><b>{a.action}</b>{a.summary ? ` · ${a.summary}` : ''}</span>
              <span className="shrink-0 text-xs text-faint">{a.ip}</span>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
