import { useQuery } from '@tanstack/react-query';
import { Bot, Info, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { LogoMark } from '../components/Logo';
import { Screen } from '../components/Screen';
import { Loading, cx, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { timeOnly } from '../lib/format';

interface Msg {
  id: number;
  author: 'client' | 'support' | 'system' | 'bot';
  authorName: string;
  body: string;
  createdAt: number;
}

const QUICK = ['Почему не прошла оплата?', 'Как снять ограничение со счёта?', 'Хочу оспорить операцию', 'Как подключить GPAY?'];

export default function Chat() {
  const toast = useToast();
  const { data, refetch } = useQuery({ queryKey: ['chat'], queryFn: () => api<{ thread: { status: string } | null; messages: Msg[] }>('/chat'), refetchInterval: 3000 });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const count = data?.messages.length ?? 0;
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [count]);
  const send = async (body = text) => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api('/chat', { body: { body } });
      setText('');
      await refetch();
    } catch (e) {
      toast(errorText(e), 'bad');
    } finally {
      setBusy(false);
    }
  };
  if (!data) return <Loading />;
  return (
    <Screen title="Чат с банком" sub="Отвечаем круглосуточно" back={null}>
      <div className="flex min-h-[55dvh] flex-col gap-2 pb-28 lg:pb-24">
        {!data.messages.length && (
          <div className="flex flex-col items-center py-10 text-center">
            <LogoMark className="size-14" />
            <div className="mt-3 text-lg font-bold">Чем можем помочь?</div>
            <p className="text-sm text-muted">Напишите вопрос — специалист ответит здесь же.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {QUICK.map((q) => <button key={q} type="button" onClick={() => void send(q)} className="rounded-full bg-surface px-3.5 py-2 text-sm font-semibold shadow-card hover:bg-sunken">{q}</button>)}
            </div>
          </div>
        )}
        {data.messages.map((m) => {
          if (m.author === 'system') {
            return (
              <div key={m.id} className="mx-auto my-2 flex max-w-[92%] gap-2 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-fg">
                <Info className="mt-0.5 size-4 shrink-0 text-warn" />
                <span className="whitespace-pre-line">{m.body}</span>
              </div>
            );
          }
          const mine = m.author === 'client';
          return (
            <div key={m.id} className={cx('flex max-w-[85%] flex-col', mine ? 'self-end items-end' : 'self-start items-start')}>
              {!mine && <span className="mb-1 flex items-center gap-1 px-2 text-xs font-semibold text-muted">{m.author === 'bot' && <Bot className="size-3.5" />}{m.authorName || 'Специалист Bobobank'}</span>}
              <div className={cx('whitespace-pre-line break-words rounded-[20px] px-4 py-2.5 text-[15px]', mine ? 'rounded-br-md bg-brand text-on-brand' : 'rounded-bl-md bg-surface shadow-card')}>{m.body}</div>
              <span className="mt-0.5 px-2 text-[11px] text-faint num">{timeOnly(m.createdAt)}</span>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <form
        onSubmit={(e) => (e.preventDefault(), void send())}
        className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur-xl lg:bottom-0 lg:left-[264px]"
      >
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Сообщение" maxLength={2000} className="h-12 min-w-0 flex-1 rounded-full bg-sunken px-5 text-base outline-none focus:ring-2 focus:ring-brand" />
          <button type="submit" aria-label="Отправить" disabled={busy || !text.trim()} className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-brand text-on-brand disabled:opacity-40"><Send className="size-5" /></button>
        </div>
      </form>
    </Screen>
  );
}
