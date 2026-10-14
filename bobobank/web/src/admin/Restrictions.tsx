import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Badge, Card, ErrorNote, Loading, PageHeader } from '../components/ui';
import { api, errorText } from '../lib/api';
import { dateTime, money } from '../lib/format';

interface R {
  id: string;
  user_id: string;
  user_name: string;
  account_number: string | null;
  type: string;
  typeTitle: string;
  reasonTitle: string;
  comment: string;
  amount: number;
  created_at: number;
}

export function Restrictions() {
  const nav = useNavigate();
  const { data, error } = useQuery({ queryKey: ['admin', 'restrictions'], queryFn: () => api<{ items: R[] }>('/admin/restrictions') });
  return (
    <>
      <PageHeader title="Аресты и блокировки" sub="Наложить новое ограничение можно в карточке клиента" />
      {error && <ErrorNote>{errorText(error)}</ErrorNote>}
      {!data ? <Loading /> : (
        <Card pad={false} className="overflow-hidden">
          {data.items.map((r) => (
            <button key={r.id} type="button" onClick={() => nav(`/admin/clients/${r.user_id}`)} className="flex w-full flex-col gap-1 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-sunken/70 sm:flex-row sm:items-center sm:gap-4">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{r.user_name}</span>
                <span className="block text-sm text-muted">{r.reasonTitle}{r.comment ? ` · ${r.comment}` : ''}</span>
              </span>
              <span className="text-sm text-muted num">{r.account_number ? `•• ${r.account_number.slice(-4)}` : 'все счета'} · {dateTime(r.created_at)}</span>
              <Badge tone="bad">{r.typeTitle}{r.amount ? ` ${money(r.amount)}` : ''}</Badge>
            </button>
          ))}
          {!data.items.length && <div className="px-5 py-10 text-center text-muted">Действующих ограничений нет</div>}
        </Card>
      )}
    </>
  );
}
