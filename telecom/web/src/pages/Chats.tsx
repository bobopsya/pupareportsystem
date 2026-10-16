import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Phone, Plus, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Avatar, Shell } from '../components/Shell';
import { Button, cx, Loading, Modal, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { clock, dayLabel, fullNumber, phoneDigits, typePhone } from '../lib/format';
import { useLine, useMe } from '../lib/hooks';
import type { Call, Chat, Conversation } from '../lib/types';

function NewChat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [v, setV] = useState('+123 ');
  const nav = useNavigate();
  const ok = fullNumber(v);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Новое сообщение"
      footer={
        <Button variant="brand" size="lg" disabled={!ok} onClick={() => nav(`/chats/${phoneDigits(v)}`)}>
          Написать
        </Button>
      }
    >
      <input autoFocus value={v} onChange={(e) => setV(typePhone(e.target.value))} inputMode="tel" placeholder="+123 XXX XXX-XX-XX" className="h-14 w-full rounded-2xl bg-sunken px-4 text-[20px] font-semibold outline-none focus:ring-2 focus:ring-brand num" />
      <p className="mt-2 text-sm text-muted">Писать можно абонентам Бобтелекома.</p>
    </Modal>
  );
}

export default function Chats() {
  const me = useMe();
  const line = useLine(!!me.data?.user);
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['chats'], queryFn: () => api<{ chats: Chat[] }>('/chats'), enabled: !!line.data?.line, refetchInterval: 3000 });
  if (me.data && !me.data.user) return <Navigate to="/" replace />;
  return (
    <Shell
      title="Чаты"
      actions={
        <button type="button" aria-label="Новое сообщение" onClick={() => setOpen(true)} className="inline-flex size-10 items-center justify-center rounded-full bg-brand text-on-brand">
          <Plus className="size-5" />
        </button>
      }
    >
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.chats.length ? (
        <p className="py-16 text-center text-muted">Сообщений пока нет. Напишите кому-нибудь из Бобтелекома!</p>
      ) : (
        <div className="-mx-2 flex flex-col">
          {q.data.chats.map((c) => (
            <Link key={c.number} to={`/chats/${c.number}`} className="flex items-center gap-3 rounded-2xl px-2 py-2.5 hover:bg-sunken">
              <Avatar name={c.name} system={c.system} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[16px] font-semibold">{c.name ?? c.formatted}</span>
                  <span className="shrink-0 text-xs text-muted">{dayLabel(c.last.at) === 'Сегодня' ? clock(c.last.at) : dayLabel(c.last.at)}</span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className={cx('truncate text-sm', c.unread ? 'font-medium text-fg' : 'text-muted')}>
                    {c.last.mine && 'Вы: '}
                    {c.last.text}
                  </span>
                  {c.unread > 0 && <span className="min-w-5 shrink-0 rounded-full bg-brand px-1.5 text-center text-xs font-bold leading-5 text-on-brand">{c.unread}</span>}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
      <NewChat open={open} onClose={() => setOpen(false)} />
    </Shell>
  );
}

export function ChatPage() {
  const { number = '' } = useParams();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ['chat', number], queryFn: () => api<Conversation>(`/chats/${number}`), enabled: !!me.data?.user, refetchInterval: 2000 });
  const count = q.data?.messages.length ?? 0;
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [count]);
  useEffect(() => void qc.invalidateQueries({ queryKey: ['line'] }), [count, qc]);
  const send = useMutation({
    mutationFn: () => api('/sms', { body: { to: number, text } }),
    onSuccess: () => {
      setText('');
      void qc.invalidateQueries({ queryKey: ['chat', number] });
      void qc.invalidateQueries({ queryKey: ['line'] });
    },
    onError: (e) => toast(errorText(e), 'bad'),
  });
  const call = useMutation({
    mutationFn: () => api<Call>('/calls', { body: { to: number } }),
    onSuccess: (c) => qc.setQueryData(['line'], (old: object | undefined) => (old ? { ...old, call: c } : old)),
    onError: (e) => toast(errorText(e), 'bad'),
  });
  if (me.data && !me.data.user) return <Navigate to="/" replace />;
  const c = q.data;
  let lastDay = '';
  return (
    <Shell
      back="/chats"
      title={
        <span className="flex items-center gap-2.5">
          <Avatar name={c?.name ?? null} system={c?.system} className="size-9 text-[15px]" />
          <span className="min-w-0">
            <span className="block truncate text-[17px] leading-tight">{c?.name ?? c?.formatted ?? '…'}</span>
            {c?.name && !c.system && <span className="block text-xs font-medium text-muted num">{c.formatted}</span>}
          </span>
        </span>
      }
      actions={
        c && !c.system ? (
          <button type="button" aria-label="Позвонить" onClick={() => call.mutate()} className="inline-flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand-text">
            <Phone className="size-5" />
          </button>
        ) : undefined
      }
    >
      <div className="flex min-h-[50dvh] flex-col gap-1 pb-20">
        {q.isLoading && <Loading />}
        {q.error && <p className="py-10 text-center text-muted">{errorText(q.error)}</p>}
        {c && !c.messages.length && <p className="py-16 text-center text-muted">Напишите первое сообщение</p>}
        {c?.messages.map((m) => {
          const d = dayLabel(m.createdAt);
          const sep = d !== lastDay;
          lastDay = d;
          return (
            <div key={m.id}>
              {sep && <p className="my-3 text-center text-xs font-medium text-muted">{d}</p>}
              <div className={cx('flex', m.mine ? 'justify-end' : 'justify-start')}>
                <div className={cx('max-w-[80%] whitespace-pre-wrap break-words rounded-[20px] px-3.5 py-2 text-[15px]', m.mine ? 'rounded-br-md bg-brand text-on-brand' : 'rounded-bl-md bg-sunken')}>
                  {m.text}
                  <span className={cx('ml-2 align-bottom text-[11px]', m.mine ? 'text-white/70' : 'text-muted')}>{clock(m.createdAt)}</span>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      {c && !c.system && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) send.mutate();
          }}
          className="fixed inset-x-0 bottom-[calc(58px+env(safe-area-inset-bottom))] z-[800] border-t border-line bg-surface/95 px-4 py-2 backdrop-blur"
        >
          <div className="mx-auto flex max-w-2xl items-center gap-2">
            <input value={text} onChange={(e) => setText(e.target.value.slice(0, 500))} placeholder="SMS" aria-label="Сообщение" className="h-11 min-w-0 flex-1 rounded-full bg-sunken px-4 text-[16px] outline-none focus:ring-2 focus:ring-brand" />
            <button type="submit" aria-label="Отправить" disabled={!text.trim() || send.isPending} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-brand text-on-brand disabled:opacity-40">
              <Send className="size-5" />
            </button>
          </div>
        </form>
      )}
    </Shell>
  );
}
