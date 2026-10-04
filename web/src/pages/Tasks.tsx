import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ClientSelect, EmployeeSelect } from '../components/common';
import { Badge, Card, Checkbox, cx, Empty, IconButton, Input, Loading, PageHeader, Segmented, Button, useToast } from '../components/ui';
import { useAuth } from '../lib/auth';
import { fmtDate, today } from '../lib/format';
import { useClientNames, useDeleteRecord, useEmployeeNames, useRecords, useSaveRecord } from '../lib/queries';
import type { Task } from '../lib/types';

function NewTask() {
  const save = useSaveRecord('tasks');
  const { user } = useAuth();
  const toast = useToast();
  const [t, setT] = useState({ text: '', assigneeId: user?.id ?? null, due: '', clientId: null as string | null });
  const submit = async () => {
    if (!t.text.trim()) return;
    try {
      await save.mutateAsync({ ...t, done: false });
      setT({ ...t, text: '', due: '' });
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };
  return (
    <form
      className="grid gap-2 border-b border-line p-3 sm:grid-cols-[1fr_11rem_10rem_11rem_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Input placeholder="Новая задача…" value={t.text} onChange={(e) => setT({ ...t, text: e.target.value })} />
      <EmployeeSelect value={t.assigneeId} onChange={(v) => setT({ ...t, assigneeId: v })} emptyLabel="Без исполнителя" />
      <Input type="date" value={t.due} onChange={(e) => setT({ ...t, due: e.target.value })} aria-label="Срок" />
      <ClientSelect value={t.clientId} onChange={(v) => setT({ ...t, clientId: v })} emptyLabel="Без клиента" />
      <Button type="submit" variant="primary" icon={<Plus className="size-4" />} loading={save.isPending}>
        Добавить
      </Button>
    </form>
  );
}

function TaskRow({ t, compact }: { t: Task; compact?: boolean }) {
  const save = useSaveRecord('tasks');
  const del = useDeleteRecord('tasks');
  const emp = useEmployeeNames();
  const cli = useClientNames();
  const overdue = !t.done && t.due && t.due < today();
  return (
    <li className="group flex items-start gap-3 px-4 py-2.5">
      <div className="pt-0.5">
        <Checkbox checked={t.done} onChange={(done) => save.mutate({ ...t, done })} />
      </div>
      <div className="min-w-0 flex-1">
        <div className={cx('text-sm break-words', t.done && 'text-faint line-through')}>{t.text}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
          {t.assigneeId && <span>{emp(t.assigneeId)}</span>}
          {t.clientId && <span>Клиент: {cli(t.clientId)}</span>}
          {t.due && (overdue ? <Badge tone="bad">до {fmtDate(t.due)}</Badge> : <span>до {fmtDate(t.due)}</span>)}
        </div>
      </div>
      {!compact && (
        <IconButton label="Удалить" className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => del.mutate(t.id)}>
          <Trash2 className="size-4" />
        </IconButton>
      )}
    </li>
  );
}

export function TaskList({ compact, filter = 'open', mine }: { compact?: boolean; filter?: 'open' | 'done' | 'all'; mine?: boolean }) {
  const { data, isLoading } = useRecords('tasks');
  const { user } = useAuth();
  if (isLoading) return <Loading />;
  let list = (data ?? []).filter((t) => (filter === 'all' ? true : filter === 'done' ? t.done : !t.done));
  if (mine) list = list.filter((t) => t.assigneeId === user?.id);
  list.sort((a, b) => Number(a.done) - Number(b.done) || (a.due || '9999').localeCompare(b.due || '9999') || b.createdAt - a.createdAt);
  if (compact) list = list.slice(0, 8);
  return (
    <>
      {compact && <NewTaskCompact />}
      {list.length === 0 ? (
        <Empty title={filter === 'done' ? 'Нет выполненных задач' : 'Открытых задач нет'} />
      ) : (
        <ul className="divide-y divide-line/70">
          {list.map((t) => (
            <TaskRow key={t.id} t={t} compact={compact} />
          ))}
        </ul>
      )}
    </>
  );
}

function NewTaskCompact() {
  const save = useSaveRecord('tasks');
  const { user } = useAuth();
  const [text, setText] = useState('');
  return (
    <form
      className="flex gap-2 border-b border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        save.mutate({ text, assigneeId: user?.id ?? null, due: '', clientId: null, done: false }, { onSuccess: () => setText('') });
      }}
    >
      <Input placeholder="Быстро добавить задачу…" value={text} onChange={(e) => setText(e.target.value)} />
      <Button type="submit" icon={<Plus className="size-4" />} loading={save.isPending} aria-label="Добавить" />
    </form>
  );
}

export default function Tasks() {
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open');
  const [who, setWho] = useState<'all' | 'mine'>('all');
  return (
    <>
      <PageHeader
        title="Задачи"
        description="Общий список задач команды"
        actions={
          <>
            <Segmented value={who} onChange={setWho} options={[{ id: 'all', label: 'Все' }, { id: 'mine', label: 'Мои' }]} />
            <Segmented value={filter} onChange={setFilter} options={[{ id: 'open', label: 'Открытые' }, { id: 'done', label: 'Готовые' }, { id: 'all', label: 'Все' }]} />
          </>
        }
      />
      <Card>
        <NewTask />
        <TaskList filter={filter} mine={who === 'mine'} />
      </Card>
    </>
  );
}
