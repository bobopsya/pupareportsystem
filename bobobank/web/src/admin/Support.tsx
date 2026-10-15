import { useQuery } from '@tanstack/react-query';
import { Bot, ChevronLeft, Info, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, Loading, PageHeader, Segmented, cx, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ago, money, timeOnly } from '../lib/format';
import type { Account, Restriction } from '../lib/types';

interface ThreadItem {
  id: string;
  subject: string;
  status: string;
  unread: number;
  updatedAt: number;
  user: { id: string; name: string; phone: string };
  last: string;
}

const TEMPLATES = [
  'Здравствуйте! Меня зовут {name}, я помогу разобраться.',
  'Проверил операцию — деньги списаны корректно, чек доступен в истории операций.',
  'Ограничение наложено по документу государственного органа. Снять его может только орган, который его наложил; после получения постановления об отмене мы снимем его в течение дня.',
  'Чтобы подключить выплаты из GPAY: откройте счёт → «Подключить магазин GPAY», введите код в кабинете GPAY в настройках магазина.',
  'Спасибо за обращение! Если появятся вопросы — пишите.',
];

export function SupportDesk() {
  const { id } = useParams();
  const nav = useNavigate();
  const [status, setStatus] = useState<'open' | 'answered' | 'closed' | 'all'>('open');
  const { data } = useQuery({ queryKey: ['support', status], queryFn: () => api<{ items: ThreadItem[]; counts: Record<string, number> }>(`/support/threads?status=${status}`), refetchInterval: 4000 });
  return (
    <>
      <PageHeader title="Поддержка" sub="Обращения клиентов из чата приложения" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className={cx(id && 'hidden lg:block')}>
          <Segmented className="mb-3" value={status} onChange={setStatus} options={[{ value: 'open', label: `Новые ${data?.counts.open ?? ''}` }, { value: 'answered', label: 'Отвечены' }, { value: 'closed', label: 'Закрыты' }, { value: 'all', label: 'Все' }]} />
          <Card pad={false} className="overflow-hidden">
            {!data ? <Loading /> : data.items.map((t) => (
              <button key={t.id} type="button" onClick={() => nav(`/admin/support/${t.id}`)} className={cx('flex w-full flex-col gap-0.5 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-sunken/70', t.id === id && 'bg-brand-soft')}>
                <span className="flex items-center justify-between gap-2"><span className="truncate font-semibold">{t.user.name}</span><span className="shrink-0 text-xs text-faint">{ago(t.updatedAt)}</span></span>
                <span className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-sm text-muted">{t.last}</span>{t.unread > 0 && <span className="min-w-5 rounded-full bg-bad px-1.5 text-center text-xs font-semibold text-white">{t.unread}</span>}</span>
              </button>
            ))}
            {data && !data.items.length && <div className="px-5 py-10 text-center text-sm text-muted">Обращений нет</div>}
          </Card>
        </div>
        {id ? <ThreadView id={id} /> : <div className="hidden items-center justify-center rounded-2xl border-2 border-dashed border-line text-muted lg:flex">Выберите обращение</div>}
      </div>
    </>
  );
}

interface ThreadData {
  thread: { id: string; subject: string; status: string };
  messages: { id: number; author: string; authorName: string; body: string; createdAt: number }[];
  client: { id: string; name: string; phone: string; tariff: string; blocked: boolean; accounts: Account[]; restrictions: Restriction[] };
}

function ThreadView({ id }: { id: string }) {
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const { data, refetch } = useQuery({ queryKey: ['support', 'thread', id], queryFn: () => api<ThreadData>(`/support/threads/${id}`), refetchInterval: 3000 });
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const n = data?.messages.length ?? 0;
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [n]);
  if (!data) return <Loading />;
  const send = async () => {
    if (!text.trim()) return;
    try {
      await api(`/support/threads/${id}/reply`, { body: { body: text } });
      setText('');
      await refetch();
    } catch (e) {
      toast(errorText(e), 'bad');
    }
  };
  const c = data.client;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Card className="!p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" aria-label="Назад" onClick={() => nav('/admin/support')} className="-ml-1 inline-flex size-9 items-center justify-center rounded-full hover:bg-sunken lg:hidden"><ChevronLeft className="size-5" /></button>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{c.name}</div>
            <div className="text-sm text-muted num">{c.phone} · {c.tariff === 'prime' ? 'Prime' : 'Стандарт'}</div>
          </div>
          {user?.role === 'admin' && <Button size="sm" onClick={() => nav(`/admin/clients/${c.id}`)}>Карточка клиента</Button>}
          <Button size="sm" variant={data.thread.status === 'closed' ? 'secondary' : 'primary'} onClick={() => void api(`/support/threads/${id}/status`, { body: { status: data.thread.status === 'closed' ? 'open' : 'closed' } }).then(() => refetch())}>{data.thread.status === 'closed' ? 'Открыть снова' : 'Закрыть обращение'}</Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {c.accounts.map((a) => <Badge key={a.id}>{a.name} {money(a.balance, a.currency)}</Badge>)}
          {c.restrictions.map((r) => <Badge key={r.id} tone="bad">{r.typeTitle}: {r.reasonTitle}</Badge>)}
          {c.blocked && <Badge tone="bad">Вход заблокирован</Badge>}
        </div>
      </Card>
      <Card className="flex max-h-[60dvh] min-h-[320px] flex-col gap-2 overflow-y-auto">
        {data.messages.map((m) => {
          if (m.author === 'system') return <div key={m.id} className="mx-auto flex max-w-[90%] gap-2 rounded-2xl bg-warn-soft px-3 py-2 text-sm"><Info className="mt-0.5 size-4 shrink-0 text-warn" /><span className="whitespace-pre-line">{m.body}</span></div>;
          const staff = m.author === 'support' || m.author === 'bot';
          return (
            <div key={m.id} className={cx('flex max-w-[85%] flex-col', staff ? 'self-end items-end' : 'self-start items-start')}>
              <span className="mb-0.5 flex items-center gap-1 px-2 text-xs text-muted">{m.author === 'bot' && <Bot className="size-3" />}{m.authorName || c.name}</span>
              <div className={cx('whitespace-pre-line break-words rounded-[18px] px-3.5 py-2 text-[15px]', staff ? 'bg-brand text-on-brand' : 'bg-sunken')}>{m.body}</div>
              <span className="px-2 text-[11px] text-faint num">{timeOnly(m.createdAt)}</span>
            </div>
          );
        })}
        <div ref={end} />
      </Card>
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {TEMPLATES.map((t) => <button key={t} type="button" onClick={() => setText(t.replace('{name}', user?.name.split(' ')[0] ?? ''))} className="max-w-[260px] shrink-0 truncate rounded-full bg-surface px-3 py-1.5 text-sm shadow-card hover:bg-sunken">{t}</button>)}
      </div>
      <form onSubmit={(e) => (e.preventDefault(), void send())} className="flex gap-2">
        <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} rows={2} placeholder="Ответ клиенту (Enter — отправить)" className="min-w-0 flex-1 resize-none rounded-2xl bg-surface px-4 py-3 text-base shadow-card outline-none focus:ring-2 focus:ring-brand" />
        <button type="submit" aria-label="Отправить" disabled={!text.trim()} className="inline-flex size-12 shrink-0 items-center justify-center self-end rounded-full bg-brand text-on-brand disabled:opacity-40"><Send className="size-5" /></button>
      </form>
    </div>
  );
}
