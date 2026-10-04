import { useQuery } from '@tanstack/react-query';
import { Cpu, KeyRound, ListTodo, Network, UserRound, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card, Dot, Empty, Loading, Mono, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtAgo } from '../lib/format';
import type { AuditEntry } from '../lib/types';
import { AuditRow } from './Audit';
import { TaskList } from './Tasks';

interface DashboardData {
  counts: Record<'employees' | 'clients' | 'activeClients' | 'networks' | 'members' | 'membersOnline' | 'devices' | 'vaultItems' | 'openTasks', number>;
  members: { id: string; name: string; nodeId: string; online: boolean; lastSeen: number | null; ips: string[]; network: string }[];
  lastSync: number | null;
  recent: AuditEntry[];
}

function Stat({ to, icon, label, value, sub }: { to: string; icon: ReactNode; label: string; value: number; sub?: ReactNode }) {
  return (
    <Link to={to} className="group rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong">
      <div className="flex items-center justify-between text-muted [&>svg]:size-4">
        <span className="text-xs font-medium">{label}</span>
        {icon}
      </div>
      <div className="mt-3 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      <div className="mt-0.5 h-4 text-xs text-faint">{sub}</div>
    </Link>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

export default function Dashboard() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardData>('/dashboard'), refetchInterval: 60_000 });

  if (isLoading || !data) return <Loading />;
  const c = data.counts;

  return (
    <>
      <PageHeader title={`${greeting()}, ${user?.fullName.split(' ')[0] ?? ''}`} description="Сводка по ZhukoNet" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat to="/employees" icon={<Users />} label="Сотрудники" value={c.employees} />
        <Stat to="/clients" icon={<UserRound />} label="Клиенты" value={c.clients} sub={`${c.activeClients} активных`} />
        <Stat to="/zerotier" icon={<Network />} label="Сети ZeroTier" value={c.networks} sub={`${c.members} узлов`} />
        <Stat
          to="/zerotier"
          icon={<Dot on={c.membersOnline > 0} />}
          label="Узлов онлайн"
          value={c.membersOnline}
          sub={data.lastSync ? `синхр. ${fmtAgo(data.lastSync)}` : 'нет синхронизации'}
        />
        <Stat to="/devices" icon={<Cpu />} label="Устройства" value={c.devices} />
        <Stat to="/vault" icon={<KeyRound />} label="Пароли" value={c.vaultItems} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Card
          title={
            <span className="flex items-center gap-2">
              <ListTodo className="size-4 text-muted" /> Задачи <span className="text-faint font-normal">{c.openTasks} открыто</span>
            </span>
          }
          actions={
            <Link to="/tasks" className="text-xs text-muted hover:text-fg">
              Все задачи →
            </Link>
          }
        >
          <TaskList compact />
        </Card>

        <Card
          title="Онлайн-статусы узлов"
          actions={
            <Link to="/zerotier" className="text-xs text-muted hover:text-fg">
              ZeroTier →
            </Link>
          }
        >
          {data.members.length === 0 ? (
            <Empty title="Узлов пока нет">Добавьте сеть ZeroTier и синхронизируйте её, чтобы видеть, кто в сети.</Empty>
          ) : (
            <ul className="max-h-96 divide-y divide-line/70 overflow-y-auto">
              {data.members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Dot on={m.online} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{m.name || <Mono>{m.nodeId}</Mono>}</div>
                    <div className="truncate text-xs text-faint">{m.network}</div>
                  </div>
                  <div className="text-right">
                    <Mono className="block text-xs text-muted">{m.ips[0] ?? ''}</Mono>
                    <span className="text-[11px] text-faint">{m.online ? 'онлайн' : fmtAgo(m.lastSeen)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        className="mt-5"
        title="Последние действия"
        actions={
          <Link to="/audit" className="text-xs text-muted hover:text-fg">
            Весь журнал →
          </Link>
        }
      >
        {data.recent.length === 0 ? (
          <Empty title="Пока пусто" />
        ) : (
          <ul className="divide-y divide-line/70">
            {data.recent.map((e) => (
              <AuditRow key={e.id} e={e} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
