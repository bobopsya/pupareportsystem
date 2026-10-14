import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, ErrorNote, Loading, PageHeader } from '../components/ui';
import { api, errorText } from '../lib/api';
import { money } from '../lib/format';

interface Stats {
  clients: number;
  newClients: number;
  deposits: number;
  loansOut: number;
  overdue: number;
  cards: number;
  turnover24h: number;
  gpayBalance: number;
  fees: number;
  reviewApps: number;
  openThreads: number;
  restrictions: number;
  system: { name: string; currency: string; balance: number }[];
}

export function Dashboard() {
  const nav = useNavigate();
  const { data, error } = useQuery({ queryKey: ['admin', 'stats'], queryFn: () => api<Stats>('/admin/stats'), refetchInterval: 15_000 });
  if (error) return <ErrorNote>{errorText(error)}</ErrorNote>;
  if (!data) return <Loading />;
  const kpi: [string, string, string?, (() => void)?][] = [
    ['Клиенты', String(data.clients), `+${data.newClients} за сутки`, () => nav('/admin/clients')],
    ['Средства клиентов', money(data.deposits)],
    ['Выдано кредитов', money(data.loansOut), `${data.overdue} с просрочкой`],
    ['Оборот за сутки', money(data.turnover24h)],
    ['Активных карт', String(data.cards)],
    ['Доход банка', money(data.fees), 'комиссии и проценты'],
    ['Заявки на проверке', String(data.reviewApps), undefined, () => nav('/admin/applications')],
    ['Открытые обращения', String(data.openThreads), undefined, () => nav('/admin/support')],
  ];
  return (
    <>
      <PageHeader title="Сводка" sub="Состояние банка в реальном времени" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpi.map(([k, v, sub, on]) => (
          <button key={k} type="button" disabled={!on} onClick={on} className="rounded-[24px] bg-surface p-5 text-left shadow-card enabled:hover:bg-sunken">
            <div className="text-sm text-muted">{k}</div>
            <div className="mt-1 text-[24px] font-extrabold num">{v}</div>
            {sub && <div className="text-xs text-faint">{sub}</div>}
          </button>
        ))}
      </div>
      <h2 className="mb-3 mt-8 text-lg font-extrabold">Счета банка</h2>
      <Card pad={false} className="overflow-hidden">
        <div className="divide-y divide-line">
          {data.system.filter((s) => s.balance !== 0).map((s) => (
            <div key={`${s.name}${s.currency}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <span className="min-w-0 truncate">{s.name}</span>
              <span className="shrink-0 font-semibold num">{money(s.balance, s.currency, { exact: true })}</span>
            </div>
          ))}
        </div>
        <p className="px-5 py-3 text-xs text-muted">Отрицательный остаток системного счёта — деньги, которые банк выдал клиентам (двойная запись: сумма всех счетов в каждой валюте равна нулю).</p>
      </Card>
    </>
  );
}
