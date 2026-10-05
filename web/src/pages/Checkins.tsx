import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Check, ExternalLink, Link2, Link2Off, MessageSquareWarning, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, cx, Empty, Loading, Mono, PageHeader, Table, td, Textarea, th, trHover, useConfirm, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtDateTime, fmtMskTime } from '../lib/format';
import type { CheckinEmployee, CheckinsData, TelegramInfo } from '../lib/types';

const DAYS = 14;

export function useCheckins() {
  return useQuery({ queryKey: ['checkins', DAYS], queryFn: () => api<CheckinsData>(`/checkins?days=${DAYS}`), refetchInterval: 60_000 });
}

function useTelegram() {
  return useQuery({ queryKey: ['telegram'], queryFn: () => api<TelegramInfo>('/telegram') });
}

/** Today's check-in for the current user: a status line plus the button. */
export function CheckinButton({ compact }: { compact?: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useCheckins();
  const mark = useMutation({
    mutationFn: () => api<{ ts: number }>('/checkins', { method: 'POST' }),
    onSuccess: (r) => (toast(`Отмечено в ${fmtMskTime(r.ts)} МСК`, 'ok'), qc.invalidateQueries({ queryKey: ['checkins'] })),
    onError: (e) => toast(e.message, 'bad'),
  });
  if (!data || !user) return null;
  const mine = data.employees.find((e) => e.id === user.id)?.checkins[data.today];

  if (mine) {
    return (
      <div className={cx('flex items-center gap-3', compact ? '' : 'py-1')}>
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ok/15 text-ok">
          <Check className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium">Вы отметились сегодня</div>
          <div className="text-xs text-muted">
            {fmtDate(data.today)}, {fmtMskTime(mine.ts)} МСК · {mine.source === 'telegram' ? 'через Telegram' : 'на сайте'}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-warn/15 text-warn">
        <CalendarCheck className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">Вы ещё не отметились сегодня</div>
        <div className="text-xs text-muted">Отметка до {data.deadline}. Иначе бот опубликует сообщение в канал.</div>
      </div>
      <Button variant="primary" loading={mark.isPending} icon={<Check className="size-4" />} onClick={() => mark.mutate()}>
        Отметиться
      </Button>
    </div>
  );
}

function TelegramLinkCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { data } = useTelegram();
  const [link, setLink] = useState<{ url: string; expiresAt: number } | null>(null);
  const create = useMutation({
    mutationFn: () => api<{ url: string; expiresAt: number }>('/telegram/link', { method: 'POST' }),
    onSuccess: setLink,
    onError: (e) => toast(e.message, 'bad'),
  });
  const unlink = useMutation({
    mutationFn: () => api('/telegram/link', { method: 'DELETE' }),
    onSuccess: () => (toast('Telegram отвязан', 'ok'), qc.invalidateQueries({ queryKey: ['telegram'] }), qc.invalidateQueries({ queryKey: ['checkins'] })),
  });

  // While a link is pending, poll until the bot reports the account as linked.
  const linked = data?.me.linked;
  useEffect(() => {
    if (!link || linked) return;
    const t = setInterval(() => qc.invalidateQueries({ queryKey: ['telegram'] }), 3000);
    return () => clearInterval(t);
  }, [link, linked, qc]);
  useEffect(() => {
    if (linked) setLink(null);
  }, [linked]);

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Send className="size-4 text-muted" /> Мой Telegram
        </span>
      }
      actions={data && <Badge tone={data.me.linked ? 'ok' : 'neutral'}>{data.me.linked ? 'привязан' : 'не привязан'}</Badge>}
    >
      <div className="flex flex-col gap-3 p-4 text-sm">
        {!data ? null : !data.tokenSet ? (
          <p className="text-muted">
            Бот ещё не настроен. Укажите токен в <Link to="/settings" className="text-fg underline underline-offset-2">Настройках</Link>.
          </p>
        ) : data.me.linked ? (
          <>
            <p className="text-muted">
              Аккаунт привязан{data.me.username ? <> к <Mono className="text-fg">@{data.me.username}</Mono></> : ''} {fmtDateTime(data.me.linkedAt)}. В боте{' '}
              <a href={`https://t.me/${data.botUsername}`} target="_blank" rel="noreferrer" className="text-fg underline underline-offset-2">
                @{data.botUsername}
              </a>{' '}
              можно отмечаться, искать и редактировать клиентов, вести историю, смотреть задачи и выезды.
            </p>
            <div>
              <Button
                variant="danger"
                icon={<Link2Off className="size-4" />}
                onClick={async () => {
                  if (await confirm({ title: 'Отвязать Telegram?', body: 'Бот перестанет отвечать вам, пока вы не привяжете аккаунт снова.', danger: true, confirmText: 'Отвязать' }))
                    unlink.mutate();
                }}
              >
                Отвязать
              </Button>
            </div>
          </>
        ) : link ? (
          <>
            <p className="text-muted">Откройте ссылку на устройстве с Telegram и нажмите «Запустить» / Start. Ссылка одноразовая, действует 15 минут.</p>
            <a href={link.url} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-2 rounded-md border border-fg bg-fg px-3 h-9 text-sm font-medium text-bg hover:bg-fg/85">
              <ExternalLink className="size-4" /> Открыть @{data.botUsername}
            </a>
            <Mono className="break-all text-xs text-faint">{link.url}</Mono>
          </>
        ) : (
          <>
            <p className="text-muted">Привяжите свой Telegram, чтобы отмечаться и работать с клиентами прямо из бота @{data.botUsername}.</p>
            <div>
              <Button variant="primary" icon={<Link2 className="size-4" />} loading={create.isPending} onClick={() => create.mutate()}>
                Привязать Telegram
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function TemplateCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const { data } = useTelegram();
  const [text, setText] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const value = text ?? data?.template ?? '';
  const save = useMutation({
    mutationFn: () => api('/telegram/template', { method: 'PUT', body: { template: value } }),
    onSuccess: () => (setText(null), toast('Текст сохранён', 'ok'), qc.invalidateQueries({ queryKey: ['telegram'] })),
    onError: (e) => toast(e.message, 'bad'),
  });
  const test = useMutation({
    mutationFn: () => api('/telegram/test', { method: 'POST' }),
    onSuccess: () => toast('Тестовое сообщение отправлено в канал', 'ok'),
    onError: (e) => toast(e.message, 'bad'),
  });
  if (!data) return null;

  const insert = (ph: string) => {
    const el = ref.current;
    const at = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? at;
    setText(value.slice(0, at) + ph + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + ph.length, at + ph.length);
    });
  };
  const today = new Date().toLocaleDateString('ru-RU');
  const preview = value
    .replaceAll('{имя}', user?.fullName ?? 'Иван Иванов')
    .replaceAll('{логин}', user?.login ?? 'ivan')
    .replaceAll('{должность}', 'Инженер')
    .replaceAll('{дата}', today);
  const dirty = text !== null && text !== data.template;

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <MessageSquareWarning className="size-4 text-muted" /> Сообщение в канал
        </span>
      }
      actions={data.channel ? <Mono className="text-xs text-faint">{data.channel}</Mono> : <Badge tone="warn">канал не задан</Badge>}
    >
      <form
        className="flex flex-col gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p className="text-sm text-muted">
          Один общий текст. После 00:00 МСК бот публикует его в канал отдельно за каждого сотрудника, который не отметился за прошедший день. Редактировать может любой сотрудник.
        </p>
        <Textarea ref={ref} rows={4} value={value} onChange={(e) => setText(e.target.value)} aria-label="Текст сообщения" maxLength={3000} />
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          Подставить:
          {data.placeholders.map((p) => (
            <button key={p} type="button" onClick={() => insert(p)} className="rounded border border-line px-1.5 py-0.5 font-mono text-fg hover:border-line-strong">
              {p}
            </button>
          ))}
        </div>
        <div className="rounded-md border border-line bg-bg/40 p-3 text-sm whitespace-pre-wrap break-words">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-faint">Предпросмотр</div>
          {preview}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={!dirty || !value.trim()} loading={save.isPending}>
            Сохранить
          </Button>
          {value !== data.defaultTemplate && (
            <Button variant="ghost" onClick={() => setText(data.defaultTemplate)}>
              Текст по умолчанию
            </Button>
          )}
          <Button variant="ghost" icon={<Send className="size-4" />} disabled={!data.tokenSet || !data.channel || dirty} loading={test.isPending} onClick={() => test.mutate()}>
            Тест в канал
          </Button>
          {data.templateMeta && (
            <span className="ml-auto text-xs text-faint">
              Изменено: {data.templateMeta.by}, {fmtDateTime(data.templateMeta.at)}
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}

function DayCell({ e, day, today }: { e: CheckinEmployee; day: string; today: string }) {
  const mark = e.checkins[day];
  const required = e.required.includes(day);
  const label = `${fmtDate(day)}: `;
  if (mark) {
    return <span title={`${label}${fmtMskTime(mark.ts)} МСК (${mark.source === 'telegram' ? 'Telegram' : 'сайт'})`} className="block size-3.5 rounded-sm bg-ok" />;
  }
  if (!required) return <span title={`${label}не требуется`} className="block size-3.5 rounded-sm border border-dashed border-line" />;
  if (day === today) return <span title={`${label}ещё не отметился`} className="block size-3.5 rounded-sm border border-line-strong" />;
  return (
    <span
      title={`${label}не отметился${e.reported.includes(day) ? ' — сообщение отправлено в канал' : ''}`}
      className={cx('block size-3.5 rounded-sm bg-bad/80', e.reported.includes(day) && 'ring-2 ring-bad/30')}
    />
  );
}

export default function Checkins() {
  const { data, isLoading } = useCheckins();
  if (isLoading || !data) return <Loading />;
  const days = [...data.days].reverse();
  const done = data.employees.filter((e) => e.checkins[data.today]).length;
  const required = data.employees.filter((e) => e.required.includes(data.today) || e.checkins[data.today]).length;

  return (
    <>
      <PageHeader
        title="Отметки"
        description={`Каждый сотрудник отмечается раз в день до ${data.deadline} — на сайте или в Telegram-боте. Нет отметки — бот публикует сообщение в канал.`}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={`Сегодня, ${fmtDate(data.today)}`} actions={<span className="text-xs text-muted">отметились {done} из {required}</span>}>
          <div className="p-4">
            <CheckinButton />
          </div>
        </Card>
        <TelegramLinkCard />
      </div>

      <Card className="mt-5" title={`Сотрудники · последние ${DAYS} дней`}>
        {data.employees.length === 0 ? (
          <Empty title="Нет сотрудников" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Сотрудник</th>
                <th className={th}>Сегодня</th>
                <th className={cx(th, 'hidden md:table-cell')}>
                  <div className="flex gap-1">
                    {days.map((d) => (
                      <span key={d} className="w-3.5 text-center text-[10px] font-normal text-faint">
                        {d.slice(8)}
                      </span>
                    ))}
                  </div>
                </th>
                <th className={th}>Telegram</th>
              </tr>
            </thead>
            <tbody>
              {data.employees.map((e) => {
                const mark = e.checkins[data.today];
                return (
                  <tr key={e.id} className={trHover}>
                    <td className={td}>
                      <div className="text-sm">{e.fullName}</div>
                      <div className="text-xs text-faint">{e.position || e.login}</div>
                    </td>
                    <td className={td}>
                      {mark ? (
                        <Badge tone="ok">
                          {fmtMskTime(mark.ts)} · {mark.source === 'telegram' ? 'TG' : 'сайт'}
                        </Badge>
                      ) : e.status === 'vacation' ? (
                        <Badge tone="warn">отпуск</Badge>
                      ) : e.required.includes(data.today) ? (
                        <Badge>ещё нет</Badge>
                      ) : (
                        <span className="text-xs text-faint">—</span>
                      )}
                    </td>
                    <td className={cx(td, 'hidden md:table-cell')}>
                      <div className="flex gap-1">
                        {days.map((d) => (
                          <DayCell key={d} e={e} day={d} today={data.today} />
                        ))}
                      </div>
                    </td>
                    <td className={td}>{e.telegram ? <Mono className="text-xs text-muted">{e.telegram.username ? `@${e.telegram.username}` : 'привязан'}</Mono> : <span className="text-xs text-faint">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <div className="flex flex-wrap gap-4 border-t border-line px-4 py-2.5 text-xs text-faint">
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-ok" /> отметился
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-bad/80" /> пропуск
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm border border-dashed border-line" /> не требуется (отпуск, ещё не работал)
          </span>
          {data.startDay && <span className="ml-auto">Сообщения в канал — начиная с {fmtDate(data.startDay)}</span>}
        </div>
      </Card>

      <div className="mt-5">
        <TemplateCard />
      </div>
    </>
  );
}
