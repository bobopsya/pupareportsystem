import { useInfiniteQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { EntryRow, PendingRow } from '../components/EntryRow';
import { Screen } from '../components/Screen';
import { Button, Card, ErrorNote, Input, Loading, Segmented } from '../components/ui';
import { api, errorText } from '../lib/api';
import { dayTitle } from '../lib/format';
import { useMeta } from '../lib/hooks';
import type { Entry } from '../lib/types';

interface Page {
  items: Entry[];
  next: number | null;
  pending: { id: string; amount: number; currency: string; title: string; subtitle: string; category: string; createdAt: number }[];
}

export default function History() {
  const [q, setQ] = useState('');
  const [dir, setDir] = useState<'all' | 'out' | 'in'>('all');
  const [category, setCategory] = useState('');
  const { data: meta } = useMeta();
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (dir !== 'all') params.set('dir', dir);
  if (category) params.set('category', category);
  const { data, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['history', params.toString()],
    queryFn: ({ pageParam }) => api<Page>(`/history?${params.toString()}${pageParam ? `&before=${pageParam}` : ''}`),
    initialPageParam: 0,
    getNextPageParam: (p) => p.next ?? undefined,
  });
  const items = data?.pages.flatMap((p) => p.items) ?? [];
  const pending = data?.pages[0]?.pending ?? [];
  const groups: { day: string; items: Entry[] }[] = [];
  for (const e of items) {
    const d = dayTitle(e.createdAt);
    if (groups.at(-1)?.day !== d) groups.push({ day: d, items: [] });
    groups.at(-1)!.items.push(e);
  }

  return (
    <Screen title="История" back={null}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-faint" />
        <Input autoFocus={new URLSearchParams(location.search).has('focus')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по операциям" className="pl-11" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Segmented value={dir} onChange={setDir} options={[{ value: 'all', label: 'Все' }, { value: 'out', label: 'Списания' }, { value: 'in', label: 'Пополнения' }]} />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Категория" className="h-11 max-w-full rounded-2xl bg-sunken px-3 text-base sm:text-sm font-semibold">
          <option value="">Все категории</option>
          {meta?.categories.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </div>
      {error && <div className="mt-4"><ErrorNote>{errorText(error)}</ErrorNote></div>}
      {!data ? (
        <Loading />
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {pending.length > 0 && (
            <Card pad={false} className="overflow-hidden">
              <div className="px-4 pt-3 text-sm font-semibold text-warn">В обработке</div>
              {pending.map((p) => <PendingRow key={p.id} p={p} />)}
            </Card>
          )}
          {groups.map((g) => (
            <div key={g.day}>
              <div className="mb-2 px-1 text-sm font-semibold text-muted first-letter:uppercase">{g.day}</div>
              <Card pad={false} className="overflow-hidden">{g.items.map((e) => <EntryRow key={e.id} e={e} />)}</Card>
            </div>
          ))}
          {!items.length && !pending.length && <div className="py-16 text-center text-muted">Операций не найдено</div>}
          {hasNextPage && <Button loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>Показать ещё</Button>}
        </div>
      )}
    </Screen>
  );
}
