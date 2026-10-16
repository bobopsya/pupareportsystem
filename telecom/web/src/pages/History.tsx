import { useQuery } from '@tanstack/react-query';
import { FileText, MessageCircle, PhoneIncoming, PhoneOutgoing, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { cx, Loading } from '../components/ui';
import { api } from '../lib/api';
import { clock, dayLabel, formatNumber, rub, talk } from '../lib/format';
import { useMe } from '../lib/hooks';
import type { Call, Charge } from '../lib/types';

type Filter = 'all' | 'money' | 'calls' | 'sms';
interface Item {
  key: string;
  at: number;
  kind: Filter;
  icon: React.ReactNode;
  title: string;
  sub: string;
  right?: string;
  pdf?: string;
}

export default function History() {
  const me = useMe();
  const [f, setF] = useState<Filter>('all');
  const q = useQuery({ queryKey: ['history'], queryFn: () => api<{ charges: Charge[]; calls: Call[]; sms: { id: string; to: string; createdAt: number }[]; spent: number }>('/history'), enabled: !!me.data?.user });
  if (me.data && !me.data.user) return <Navigate to="/" replace />;
  const d = q.data;
  const items: Item[] = d
    ? [
        ...d.charges.map((c) => ({ key: c.id, at: c.paidAt ?? c.createdAt, kind: 'money' as const, icon: <Wallet className="size-5" />, title: c.title[0].toUpperCase() + c.title.slice(1), sub: c.status === 'refunded' ? 'Возвращено на счёт' : 'Списано с Bobobank', right: `${c.status === 'refunded' ? '' : '−'}${rub(c.amount)}`, pdf: `/api/charges/${c.id}/receipt.pdf` })),
        ...d.calls.map((c) => ({
          key: c.id,
          at: c.createdAt,
          kind: 'calls' as const,
          icon: c.direction === 'in' ? <PhoneIncoming className="size-5" /> : <PhoneOutgoing className="size-5" />,
          title: c.name ?? c.formatted,
          sub: `${c.direction === 'in' ? 'Входящий' : 'Исходящий'}${c.seconds ? ` · ${talk(c.seconds)}` : ''}`,
          right: c.billedMin ? `−${c.billedMin} мин` : c.direction === 'in' ? 'бесплатно' : '0 мин',
        })),
        ...d.sms.map((s) => ({ key: s.id, at: s.createdAt, kind: 'sms' as const, icon: <MessageCircle className="size-5" />, title: formatNumber(s.to), sub: 'Исходящее SMS', right: '−1 SMS' })),
      ].sort((a, b) => b.at - a.at)
    : [];
  const shown = items.filter((i) => f === 'all' || i.kind === f);
  let lastDay = '';
  return (
    <Shell title="Расходы">
      {d && (
        <div className="rounded-3xl bg-brand-soft p-4">
          <p className="text-sm text-brand-text">Всего оплачено связи</p>
          <p className="text-[28px] font-bold num">{rub(d.spent)}</p>
        </div>
      )}
      <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
        {([['all', 'Всё'], ['money', 'Списания'], ['calls', 'Звонки'], ['sms', 'SMS']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setF(k)} className={cx('h-9 shrink-0 rounded-full px-4 text-sm font-semibold', f === k ? 'bg-ink text-on-ink' : 'bg-sunken')}>
            {l}
          </button>
        ))}
      </div>
      {q.isLoading && <Loading />}
      {d && !shown.length && <p className="py-12 text-center text-muted">Здесь пока пусто</p>}
      <div className="mt-2 flex flex-col">
        {shown.map((i) => {
          const dl = dayLabel(i.at);
          const sep = dl !== lastDay;
          lastDay = dl;
          return (
            <div key={i.key}>
              {sep && <p className="mb-1 mt-4 px-1 text-[13px] font-semibold text-muted">{dl}</p>}
              <div className="flex items-center gap-3 py-2">
                <span className={cx('flex size-10 shrink-0 items-center justify-center rounded-full', i.kind === 'money' ? 'bg-brand-soft text-brand-text' : 'bg-sunken text-muted')}>{i.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{i.title}</span>
                  <span className="block truncate text-sm text-muted">
                    {clock(i.at)} · {i.sub}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span className={cx('text-[15px] font-semibold num', i.kind !== 'money' && 'text-muted')}>{i.right}</span>
                  {i.pdf && (
                    <a href={i.pdf} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-brand-text">
                      <FileText className="size-3" /> Чек
                    </a>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
