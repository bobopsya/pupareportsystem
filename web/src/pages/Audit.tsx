import { useInfiniteQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useState } from 'react';
import { EmployeeSelect } from '../components/common';
import { Badge, Button, Card, Empty, Loading, Mono, PageHeader, Select } from '../components/ui';
import { api } from '../lib/api';
import { ACTION_LABEL, ENTITY_LABEL, fmtDateTime, type Tone } from '../lib/format';
import type { AuditEntry } from '../lib/types';

const ACTION_TONE: Record<string, Tone> = {
  login_fail: 'bad',
  delete: 'warn',
  purge: 'bad',
  reveal: 'info',
  copy: 'info',
  export: 'warn',
  create: 'ok',
  restore: 'ok',
};

export function AuditRow({ e }: { e: AuditEntry }) {
  return (
    <li className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-3">
      <span className="w-36 shrink-0 text-xs tabular-nums text-faint">{fmtDateTime(e.ts)}</span>
      <span className="w-40 shrink-0 truncate text-sm">{e.user_login ?? <span className="text-faint">система</span>}</span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm">
        <Badge tone={ACTION_TONE[e.action] ?? 'neutral'}>{ACTION_LABEL[e.action] ?? e.action}</Badge>
        {e.entity && <span className="text-muted">{ENTITY_LABEL[e.entity] ?? e.entity}</span>}
        {e.summary && <span className="min-w-0 truncate">{e.summary}</span>}
      </span>
      {e.ip && <Mono className="shrink-0 text-xs text-faint">{e.ip}</Mono>}
    </li>
  );
}

export default function Audit() {
  const [userId, setUserId] = useState<string | null>(null);
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');

  const q = useInfiniteQuery({
    queryKey: ['audit', userId, action, entity],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: '100' });
      if (pageParam) p.set('before', String(pageParam));
      if (userId) p.set('userId', userId);
      if (action) p.set('action', action);
      if (entity) p.set('entity', entity);
      return api<AuditEntry[]>(`/audit?${p}`);
    },
    getNextPageParam: (last) => (last.length === 100 ? last[last.length - 1]!.id : undefined),
  });
  const rows = q.data?.pages.flat() ?? [];

  return (
    <>
      <PageHeader title="Журнал действий" description="Кто, что и когда делал: входы, изменения, просмотры паролей" />
      <div className="mb-4 grid gap-2 sm:grid-cols-3 lg:flex">
        <div className="lg:w-56">
          <EmployeeSelect value={userId} onChange={setUserId} emptyLabel="Все сотрудники" includeFired />
        </div>
        <Select value={action} onChange={(e) => setAction(e.target.value)} className="lg:w-52">
          <option value="">Все действия</option>
          {Object.entries(ACTION_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select value={entity} onChange={(e) => setEntity(e.target.value)} className="lg:w-52">
          <option value="">Все разделы</option>
          {['client', 'employee', 'vault_item', 'zt_network', 'zt_member', 'device', 'task', 'file', 'user', 'settings'].map((k) => (
            <option key={k} value={k}>
              {ENTITY_LABEL[k]}
            </option>
          ))}
        </Select>
      </div>
      <Card>
        {q.isLoading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty icon={<History />} title="Записей нет" />
        ) : (
          <>
            <ul className="divide-y divide-line/70">
              {rows.map((e) => (
                <AuditRow key={e.id} e={e} />
              ))}
            </ul>
            {q.hasNextPage && (
              <div className="flex justify-center border-t border-line p-3">
                <Button loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
                  Показать ещё
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}
