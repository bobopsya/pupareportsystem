import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BookOpen, ChevronRight, KeyRound, Plus, RefreshCw, Send, Terminal, Trash2, Webhook } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, CardHeader, Checkbox, CopyField, cx, Empty, ErrorNote, Field, IconButton, Input, Kbd, Loading, Modal, PageHeader, Segmented, Toggle, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { ago, dateTimeSec } from '../lib/format';
import { useShop } from './Layout';

const EVENT_TITLE: Record<string, string> = {
  'payment.succeeded': 'Платёж успешен',
  'payment.waiting_for_capture': 'Платёж ждёт списания',
  'payment.canceled': 'Платёж отменён',
  'refund.succeeded': 'Возврат выполнен',
  'payout.succeeded': 'Выплата зачислена',
};

export default function Developers() {
  const shop = useShop();
  const [tab, setTab] = useState<'keys' | 'webhooks' | 'logs'>('keys');
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Разработчикам"
        sub={<>REST API: <Kbd>{location.origin}/api/v1</Kbd> · ID магазина <Kbd>{shop.id}</Kbd></>}
        actions={<Link to="/docs"><Button icon={<BookOpen className="size-4" />}>Документация</Button></Link>}
      />
      <Segmented value={tab} onChange={setTab} options={[{ value: 'keys', label: 'API-ключи' }, { value: 'webhooks', label: 'Вебхуки' }, { value: 'logs', label: 'Журнал запросов' }]} />
      {tab === 'keys' && <Keys />}
      {tab === 'webhooks' && <Webhooks />}
      {tab === 'logs' && <Logs />}
    </div>
  );
}

interface Key {
  id: string;
  name: string;
  last4: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

function Keys() {
  const shop = useShop();
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ['keys', shop.id], queryFn: () => api<{ items: Key[] }>(`/m/shops/${shop.id}/keys`) });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoke, setRevoke] = useState<Key | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      const r = await api<{ secret: string }>(`/m/shops/${shop.id}/keys`, { body: { name: name.trim() || 'Основной ключ' } });
      setSecret(r.secret);
      setName('');
      void qc.invalidateQueries({ queryKey: ['keys', shop.id] });
    } catch (e) {
      toast(errorText(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card pad={false}>
      <div className="p-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Секретные ключи</h2>
          <p className="text-[13px] text-muted mt-0.5 max-w-xl">Ключ даёт полный доступ к API магазина. Храните его только на сервере и не публикуйте в коде сайта или приложения.</p>
        </div>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Выпустить ключ</Button>
      </div>
      {!data ? (
        <Loading />
      ) : data.items.length === 0 ? (
        <Empty icon={<KeyRound className="size-5" />} title="Ключей пока нет" sub="Выпустите ключ, чтобы создавать платежи через API." />
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {data.items.map((k) => (
            <li key={k.id} className={cx('flex flex-wrap items-center gap-3 px-5 py-3', !!k.revokedAt && 'opacity-55')}>
              <KeyRound className="size-4 text-muted" />
              <div className="flex-1 min-w-[200px]">
                <div className="text-sm font-medium">{k.name}</div>
                <div className="text-xs text-faint font-mono">sk_live_••••••••••••••••{k.last4}</div>
              </div>
              <div className="text-xs text-muted w-40">{k.revokedAt ? `Отозван ${ago(k.revokedAt)}` : k.lastUsedAt ? `Использован ${ago(k.lastUsedAt)}` : 'Ещё не использовался'}</div>
              {k.revokedAt ? <Badge>Отозван</Badge> : <Button size="sm" variant="danger" onClick={() => setRevoke(k)}>Отозвать</Button>}
            </li>
          ))}
        </ul>
      )}
      <Modal open={creating && !secret} onClose={() => setCreating(false)} title="Новый секретный ключ" footer={<><Button onClick={() => setCreating(false)}>Отмена</Button><Button variant="primary" loading={busy} onClick={create}>Выпустить</Button></>}>
        <Field label="Название" hint="Чтобы различать ключи: «Сайт», «Telegram-бот», «CRM»">
          <Input placeholder="Основной ключ" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} maxLength={60} />
        </Field>
      </Modal>
      <Modal open={!!secret} onClose={() => { setSecret(null); setCreating(false); }} title="Ключ создан" footer={<Button variant="primary" onClick={() => { setSecret(null); setCreating(false); }}>Я сохранил ключ</Button>}>
        <div className="flex flex-col gap-4">
          <div className="flex gap-3 rounded-xl bg-warn-soft text-warn px-4 py-3 text-sm">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" /> Скопируйте ключ сейчас — после закрытия окна его нельзя будет посмотреть снова.
          </div>
          {secret && <CopyField value={secret} />}
          <pre className="rounded-xl bg-sunken border border-line p-3 text-[12px] font-mono overflow-x-auto">{`curl ${location.origin}/api/v1/me \\\n  -H "Authorization: Bearer ${secret ?? ''}"`}</pre>
        </div>
      </Modal>
      <Modal
        open={!!revoke}
        onClose={() => setRevoke(null)}
        size="sm"
        title="Отозвать ключ?"
        footer={
          <>
            <Button onClick={() => setRevoke(null)}>Отмена</Button>
            <Button
              variant="danger"
              onClick={async () => {
                await api(`/m/shops/${shop.id}/keys/${revoke!.id}`, { method: 'DELETE' });
                setRevoke(null);
                void qc.invalidateQueries({ queryKey: ['keys', shop.id] });
                toast('Ключ отозван');
              }}
            >
              Отозвать
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">Запросы с ключом «{revoke?.name}» сразу начнут получать ошибку 401. Действие необратимо.</p>
      </Modal>
    </Card>
  );
}

interface Hook {
  id: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  createdAt: number;
  stats: { ok: number; failed: number; pending: number };
}

interface Delivery {
  id: string;
  webhookId: string;
  event: string;
  objectId: string;
  status: 'pending' | 'succeeded' | 'failed';
  attempts: number;
  nextAt: number | null;
  lastCode: number | null;
  lastError: string | null;
  lastBody: string | null;
  lastMs: number | null;
  payload: string;
  createdAt: number;
  url: string | null;
}

function Webhooks() {
  const shop = useShop();
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ['webhooks', shop.id], queryFn: () => api<{ items: Hook[]; events: string[] }>(`/m/shops/${shop.id}/webhooks`) });
  const { data: deliveries } = useQuery({ queryKey: ['deliveries', shop.id], queryFn: () => api<{ items: Delivery[] }>(`/m/shops/${shop.id}/deliveries`), refetchInterval: 5000 });
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['payment.succeeded', 'payment.canceled', 'payment.waiting_for_capture', 'refund.succeeded']);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['webhooks', shop.id] });
    void qc.invalidateQueries({ queryKey: ['deliveries', shop.id] });
  };

  const add = async () => {
    setError(null);
    setBusy('add');
    try {
      await api(`/m/shops/${shop.id}/webhooks`, { body: { url: url.trim(), events } });
      setAdding(false);
      setUrl('');
      refresh();
      toast('Эндпоинт добавлен');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const test = async (h: Hook) => {
    setBusy(h.id);
    try {
      const r = await api<{ delivery: { status: string; lastCode: number | null; lastError: string | null; lastMs: number } }>(`/m/shops/${shop.id}/webhooks/${h.id}/test`, { body: {} });
      const d = r.delivery;
      toast(d.status === 'succeeded' ? `Доставлено: HTTP ${d.lastCode} за ${d.lastMs} мс` : `Не доставлено: ${d.lastError}`, d.status === 'succeeded' ? 'ok' : 'bad');
      refresh();
    } finally {
      setBusy(null);
    }
  };

  if (!data) return <Loading />;
  return (
    <div className="flex flex-col gap-5">
      <Card pad={false}>
        <div className="p-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold">Эндпоинты</h2>
            <p className="text-[13px] text-muted mt-0.5 max-w-xl">GPAY отправит POST-запрос с JSON при изменении статуса. Подпись — в заголовке <Kbd>GPAY-Signature</Kbd> (HMAC-SHA256). При ошибке повторим через 1 мин, 5 мин, 30 мин, 2, 5 и 16 часов.</p>
          </div>
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Добавить эндпоинт</Button>
        </div>
        {data.items.length === 0 ? (
          <Empty icon={<Webhook className="size-5" />} title="Нет эндпоинтов" sub="Добавьте URL вашего сервера, чтобы получать уведомления о платежах." />
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {data.items.map((h) => (
              <li key={h.id} className="px-5 py-4 flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Webhook className={cx('size-4', h.active ? 'text-brand' : 'text-faint')} />
                  <span className="font-mono text-sm flex-1 min-w-[200px] break-all">{h.url}</span>
                  <Toggle
                    checked={h.active}
                    onChange={async (v) => {
                      await api(`/m/shops/${shop.id}/webhooks/${h.id}`, { method: 'PATCH', body: { active: v } });
                      refresh();
                    }}
                  />
                  <Button size="sm" loading={busy === h.id} icon={<Send className="size-3.5" />} onClick={() => void test(h)}>Тест</Button>
                  <IconButton
                    label="Удалить"
                    onClick={async () => {
                      if (!confirm('Удалить эндпоинт?')) return;
                      await api(`/m/shops/${shop.id}/webhooks/${h.id}`, { method: 'DELETE' });
                      refresh();
                    }}
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
                <div className="flex flex-wrap gap-1.5 pl-7">
                  {h.events.map((e) => <Badge key={e} className="font-mono">{e}</Badge>)}
                </div>
                <div className="pl-7 grid sm:grid-cols-[1fr_auto] gap-3 items-center">
                  <CopyField value={h.secret} secret />
                  <div className="text-xs text-muted flex gap-3">
                    <span className="text-ok">✓ {h.stats.ok}</span>
                    <span className="text-warn">⏳ {h.stats.pending}</span>
                    <span className="text-bad">✕ {h.stats.failed}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card pad={false}>
        <div className="px-5 pt-4 pb-3"><h2 className="text-[15px] font-semibold">Журнал доставок</h2></div>
        {!deliveries?.items.length ? (
          <p className="px-5 pb-5 text-sm text-muted">Пока ничего не отправлялось.</p>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {deliveries.items.map((d) => (
              <Fragment key={d.id}>
                <li className="px-5 py-2.5 flex items-center gap-3 text-sm cursor-pointer hover:bg-hover/60" onClick={() => setOpen(open === d.id ? null : d.id)}>
                  <ChevronRight className={cx('size-4 text-faint transition-transform', open === d.id && 'rotate-90')} />
                  <Badge tone={d.status === 'succeeded' ? 'ok' : d.status === 'failed' ? 'bad' : 'warn'} className="w-16 justify-center">{d.lastCode ?? (d.status === 'pending' ? 'очередь' : 'ошибка')}</Badge>
                  <span className="font-mono text-xs w-52 truncate">{d.event}</span>
                  <span className="hidden md:block text-muted text-xs flex-1 truncate font-mono">{d.objectId}</span>
                  <span className="text-xs text-faint whitespace-nowrap ml-auto">{dateTimeSec(d.createdAt)}</span>
                </li>
                {open === d.id && (
                  <li className="px-5 py-4 bg-sunken/60 flex flex-col gap-3 text-sm">
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
                      <span>{EVENT_TITLE[d.event] ?? d.event}</span>
                      <span>Попыток: {d.attempts}</span>
                      {d.lastMs !== null && <span>Время ответа: {d.lastMs} мс</span>}
                      {d.nextAt && d.status === 'pending' && <span>Следующая попытка: {dateTimeSec(d.nextAt)}</span>}
                      {d.url && <span className="font-mono">{d.url}</span>}
                    </div>
                    {d.lastError && <ErrorNote>{d.lastError}</ErrorNote>}
                    <div className="grid lg:grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs text-faint mb-1">Тело запроса</div>
                        <pre className="rounded-lg bg-surface border border-line p-3 text-[11px] font-mono overflow-auto max-h-72">{JSON.stringify(JSON.parse(d.payload), null, 2)}</pre>
                      </div>
                      <div>
                        <div className="text-xs text-faint mb-1">Ответ сервера</div>
                        <pre className="rounded-lg bg-surface border border-line p-3 text-[11px] font-mono overflow-auto max-h-72 whitespace-pre-wrap">{d.lastBody || '—'}</pre>
                      </div>
                    </div>
                    <div>
                      <Button
                        size="sm"
                        icon={<RefreshCw className="size-3.5" />}
                        onClick={async () => {
                          const r = await api<{ delivery: { status: string; lastCode: number | null; lastError: string | null } }>(`/m/shops/${shop.id}/deliveries/${d.id}/resend`, { body: {} });
                          toast(r.delivery.status === 'succeeded' ? `Доставлено: HTTP ${r.delivery.lastCode}` : `Ошибка: ${r.delivery.lastError}`, r.delivery.status === 'succeeded' ? 'ok' : 'bad');
                          refresh();
                        }}
                      >
                        Отправить повторно
                      </Button>
                    </div>
                  </li>
                )}
              </Fragment>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={adding} onClose={() => setAdding(false)} title="Новый эндпоинт" footer={<><Button onClick={() => setAdding(false)}>Отмена</Button><Button variant="primary" loading={busy === 'add'} onClick={add}>Добавить</Button></>}>
        <div className="flex flex-col gap-4">
          <Field label="URL" hint="Должен отвечать 2xx в течение 10 секунд">
            <Input placeholder="https://example.com/gpay/webhook" value={url} onChange={(e) => setUrl(e.target.value)} mono />
          </Field>
          <div>
            <div className="text-[13px] font-medium text-muted mb-2">События</div>
            <div className="flex flex-col gap-2">
              {data.events.map((e) => (
                <Checkbox key={e} checked={events.includes(e)} onChange={(v) => setEvents(v ? [...events, e] : events.filter((x) => x !== e))} label={<span><span className="font-mono text-[13px]">{e}</span> <span className="text-muted">— {EVENT_TITLE[e]}</span></span>} />
              ))}
            </div>
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
      </Modal>
    </div>
  );
}

interface LogRow {
  id: number;
  method: string;
  path: string;
  status: number;
  ms: number;
  idemKey: string | null;
  reqBody: string | null;
  resBody: string | null;
  ip: string;
  ts: number;
  keyName: string | null;
}

const pretty = (s: string | null) => {
  if (!s) return '—';
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
};

function Logs() {
  const shop = useShop();
  const { data } = useQuery({ queryKey: ['logs', shop.id], queryFn: () => api<{ items: LogRow[] }>(`/m/shops/${shop.id}/logs`), refetchInterval: 5000 });
  const [open, setOpen] = useState<number | null>(null);
  if (!data) return <Loading />;
  return (
    <Card pad={false}>
      <div className="p-5 pb-3"><CardHeader title="Последние запросы к API" sub="Хранятся 500 последних запросов" icon={<Terminal className="size-4" />} /></div>
      {data.items.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted">Запросов ещё не было. Попробуйте песочницу в <Link to="/docs" className="text-brand">документации</Link>.</p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {data.items.map((l) => (
            <Fragment key={l.id}>
              <li className="px-5 py-2.5 flex items-center gap-3 text-sm cursor-pointer hover:bg-hover/60" onClick={() => setOpen(open === l.id ? null : l.id)}>
                <Badge tone={l.status < 300 ? 'ok' : l.status < 500 ? 'warn' : 'bad'} className="w-11 justify-center font-mono">{l.status}</Badge>
                <span className="font-mono text-xs w-12 text-muted">{l.method}</span>
                <span className="font-mono text-xs flex-1 truncate">{l.path}</span>
                <span className="hidden sm:block text-xs text-faint w-28 truncate">{l.keyName}</span>
                <span className="text-xs text-faint w-14 text-right">{l.ms} мс</span>
                <span className="text-xs text-faint whitespace-nowrap w-36 text-right">{dateTimeSec(l.ts)}</span>
              </li>
              {open === l.id && (
                <li className="px-5 py-4 bg-sunken/60 grid lg:grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-faint mb-1">Запрос{l.idemKey && <> · Idempotence-Key: <span className="font-mono">{l.idemKey}</span></>}</div>
                    <pre className="rounded-lg bg-surface border border-line p-3 text-[11px] font-mono overflow-auto max-h-80">{pretty(l.reqBody)}</pre>
                  </div>
                  <div>
                    <div className="text-xs text-faint mb-1">Ответ</div>
                    <pre className="rounded-lg bg-surface border border-line p-3 text-[11px] font-mono overflow-auto max-h-80">{pretty(l.resBody)}</pre>
                  </div>
                </li>
              )}
            </Fragment>
          ))}
        </ul>
      )}
    </Card>
  );
}
