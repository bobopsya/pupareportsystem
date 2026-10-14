import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, Ban, Check, CheckCircle2, CircleDot, Clock, CreditCard, ExternalLink, FileText, Loader2, Receipt, RotateCcw, ShieldCheck, Webhook, XCircle,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PaymentStatus } from '../components/Status';
import { Badge, Button, Card, CardHeader, CopyButton, cx, ErrorNote, Field, Input, Loading, Modal, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { dateTime, dateTimeSec, money, REASONS, toAmount } from '../lib/format';
import { useShop } from './Layout';
import { MethodCell } from './PaymentsTable';
import type { PaymentRowT } from './types';

interface Detail {
  row: PaymentRowT;
  api: Record<string, unknown> & { payment_method?: Record<string, unknown>; authorization_details?: { rrn: string; auth_code: string; three_d_secure: { applied: boolean } }; metadata: Record<string, string>; confirmation?: { confirmation_url: string } };
  events: { ts: number; type: string; data: Record<string, string> }[];
  refunds: { id: string; status: string; amount: { value: string; currency: string }; description?: string; created_at: string }[];
  receipts: { id: string; type: string; fiscal_document_number: string; total: { value: string }; registered_at: string; url: string }[];
  deliveries: { id: string; event: string; status: string; attempts: number; last_code: number | null; created_at: number; url: string }[];
}

const EVENT: Record<string, { label: (d: Record<string, string>) => string; icon: ReactNode; tone: string }> = {
  created: { label: (d) => `Платёж создан (${d.source === 'link' ? 'ссылка на оплату' : d.source === 'api' ? 'API' : 'кабинет'})`, icon: <CircleDot className="size-3.5" />, tone: 'text-muted' },
  attempt: { label: (d) => `Попытка оплаты: ${d.method}`, icon: <CreditCard className="size-3.5" />, tone: 'text-muted' },
  '3ds_required': { label: () => 'Банк проверяет платёж (3-D Secure)', icon: <ShieldCheck className="size-3.5" />, tone: 'text-info' },
  '3ds_passed': { label: () => 'Банк подтвердил платёж', icon: <ShieldCheck className="size-3.5" />, tone: 'text-ok' },
  attempt_failed: { label: (d) => `Отказ: ${REASONS[d.reason] ?? d.reason}${d.method ? ` · ${d.method}` : ''}`, icon: <XCircle className="size-3.5" />, tone: 'text-bad' },
  processing: { label: (d) => `Ожидание подтверждения: ${d.method}`, icon: <Loader2 className="size-3.5" />, tone: 'text-info' },
  method_reset: { label: () => 'Покупатель сменил способ оплаты', icon: <RotateCcw className="size-3.5" />, tone: 'text-muted' },
  authorized: { label: (d) => `Средства заморожены · ${d.method}`, icon: <ShieldCheck className="size-3.5" />, tone: 'text-info' },
  captured: { label: (d) => `Списано ${d.amount}${d.partial ? ' (частично)' : ''}`, icon: <Check className="size-3.5" />, tone: 'text-ok' },
  succeeded: { label: (d) => `Оплачен · ${d.method} · комиссия ${d.fee}`, icon: <CheckCircle2 className="size-3.5" />, tone: 'text-ok' },
  canceled: { label: (d) => `Отменён: ${REASONS[d.reason] ?? d.reason}`, icon: <Ban className="size-3.5" />, tone: 'text-bad' },
  refunded: { label: (d) => `${d.full ? 'Полный' : 'Частичный'} возврат ${d.amount}`, icon: <RotateCcw className="size-3.5" />, tone: 'text-warn' },
};

export default function PaymentDetail() {
  const shop = useShop();
  const { pid = '' } = useParams();
  const qc = useQueryClient();
  const { data, error } = useQuery({
    queryKey: ['payment', shop.id, pid],
    queryFn: () => api<Detail>(`/m/shops/${shop.id}/payments/${pid}`),
    refetchInterval: (q) => (q.state.data?.row.status === 'pending' ? 3000 : false),
  });
  const [modal, setModal] = useState<'refund' | 'capture' | 'cancel' | null>(null);
  const [tab, setTab] = useState<'details' | 'json'>('details');

  if (error) return <ErrorNote>{errorText(error)}</ErrorNote>;
  if (!data) return <Loading />;
  const p = data.row;
  const m = data.api.payment_method as { card?: Record<string, string>; title?: string; crypto?: Record<string, string>; plan?: { part_amount: { value: string } }; sbp_operation_id?: string; phone?: string } | undefined;
  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ['payment', shop.id, pid] });
    void qc.invalidateQueries({ queryKey: ['payments', shop.id] });
    void qc.invalidateQueries({ queryKey: ['analytics', shop.id] });
  };

  return (
    <div className="flex flex-col gap-5">
      <Link to={`/app/${shop.id}/payments`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg w-fit">
        <ArrowLeft className="size-4" /> Платежи
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-[30px] font-semibold tracking-tight tabular-nums">{money(p.amount, p.currency, { exact: true })}</h1>
            <span className="text-faint">{p.currency}</span>
            <PaymentStatus status={p.status} refunded={p.refunded} amount={p.amount} />
          </div>
          <div className="mt-1 flex items-center gap-1 text-sm text-muted">
            <span className="font-mono">{p.id}</span>
            <CopyButton text={p.id} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {p.status === 'waiting_for_capture' && (
            <>
              <Button variant="primary" icon={<Check className="size-4" />} onClick={() => setModal('capture')}>Списать</Button>
              <Button variant="danger" icon={<Ban className="size-4" />} onClick={() => setModal('cancel')}>Отменить</Button>
            </>
          )}
          {p.status === 'pending' && <Button variant="danger" icon={<Ban className="size-4" />} onClick={() => setModal('cancel')}>Отменить платёж</Button>}
          {p.status === 'succeeded' && p.refunded < p.amount && <Button icon={<RotateCcw className="size-4" />} onClick={() => setModal('refund')}>Вернуть деньги</Button>}
          {p.status === 'pending' && data.api.confirmation && (
            <a href={data.api.confirmation.confirmation_url} target="_blank" rel="noreferrer">
              <Button icon={<ExternalLink className="size-4" />}>Страница оплаты</Button>
            </a>
          )}
        </div>
      </div>

      {p.status === 'waiting_for_capture' && (
        <div className="flex items-start gap-3 rounded-xl border border-info/25 bg-info-soft px-4 py-3 text-sm text-info">
          <Clock className="size-4 mt-0.5 shrink-0" />
          Деньги заморожены на счёте покупателя. Спишите или отмените платёж до {dateTime(Date.parse(String(data.api.expires_at)))}, иначе он будет отменён автоматически.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5 items-start">
        <div className="flex flex-col gap-5 min-w-0">
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-semibold">Детали</h2>
              <div className="flex gap-1 text-[13px]">
                {(['details', 'json'] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setTab(t)} className={cx('px-2.5 h-7 rounded-md', tab === t ? 'bg-sunken text-fg font-medium' : 'text-muted hover:text-fg')}>
                    {t === 'details' ? 'Обзор' : 'JSON (API)'}
                  </button>
                ))}
              </div>
            </div>
            {tab === 'json' ? (
              <pre className="rounded-xl bg-sunken p-4 text-[12px] font-mono overflow-x-auto max-h-[480px]">{JSON.stringify(data.api, null, 2)}</pre>
            ) : (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
                <Item k="Описание" v={p.description || '—'} />
                <Item k="Создан" v={dateTime(p.createdAt)} />
                <Item k="Способ оплаты" v={<MethodCell p={p} />} />
                <Item k="Оплачен" v={p.capturedAt ? dateTime(p.capturedAt) : '—'} />
                {m?.card && <Item k="Карта" v={`${m.card.card_type} ${m.card.first6.slice(0, 4)} ${m.card.first6.slice(4)}•• •••• ${m.card.last4} · ${m.card.expiry_month}/${m.card.expiry_year.slice(-2)}`} />}
                {m?.card && <Item k="Банк-эмитент" v={`${m.card.issuer_name} · ${m.card.issuer_country}`} />}
                {m?.sbp_operation_id && <Item k="ID операции СБП" v={<span className="font-mono text-xs">{m.sbp_operation_id}</span>} />}
                {m?.crypto && <Item k="Криптовалюта" v={`${m.crypto.amount} ${m.crypto.asset}`} />}
                {m?.crypto?.tx_hash && <Item k="Хэш транзакции" v={<span className="font-mono text-xs break-all">{m.crypto.tx_hash}</span>} />}
                {m?.plan && <Item k="План рассрочки" v={`4 × ${m.plan.part_amount.value}`} />}
                {m?.phone && <Item k="Телефон" v={m.phone} />}
                {data.api.authorization_details && <Item k="RRN / код авторизации" v={<span className="font-mono">{data.api.authorization_details.rrn} / {data.api.authorization_details.auth_code}</span>} />}
                {data.api.authorization_details && <Item k="3-D Secure" v={data.api.authorization_details.three_d_secure.applied ? 'Пройден' : 'Не применялся'} />}
                <Item k="Email покупателя" v={p.email ?? '—'} />
                {p.cancellation && <Item k="Причина отмены" v={<span className="text-bad">{REASONS[p.cancellation.reason] ?? p.cancellation.reason}</span>} />}
                {Object.keys(data.api.metadata ?? {}).length > 0 && (
                  <div className="sm:col-span-2">
                    <dt className="text-muted text-[13px] mb-1">metadata</dt>
                    <dd className="flex flex-wrap gap-1.5">
                      {Object.entries(data.api.metadata).map(([k, v]) => <Badge key={k} className="font-mono">{k}: {v}</Badge>)}
                    </dd>
                  </div>
                )}
              </dl>
            )}
          </Card>

          <Card>
            <CardHeader title="История" />
            <ol className="relative flex flex-col gap-4 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-px before:bg-line">
              {[...data.events].reverse().map((e, i) => {
                const meta = EVENT[e.type] ?? { label: () => e.type, icon: <CircleDot className="size-3.5" />, tone: 'text-muted' };
                return (
                  <li key={i} className="relative flex items-start gap-3">
                    <span className={cx('relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface', meta.tone)}>{meta.icon}</span>
                    <div className="min-w-0 pt-0.5">
                      <div className="text-sm">{meta.label(e.data)}</div>
                      {e.data.message && <div className="text-xs text-muted">{e.data.message}</div>}
                      <div className="text-xs text-faint">{dateTimeSec(e.ts)}</div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Расчёт" />
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Сумма платежа</dt><dd className="tabular-nums">{money(p.amount, p.currency, { exact: true })}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Комиссия GPAY</dt><dd className="tabular-nums">−{money(p.fee, p.currency, { exact: true })}</dd></div>
              {p.refunded > 0 && <div className="flex justify-between"><dt className="text-muted">Возвраты</dt><dd className="tabular-nums text-warn">−{money(p.refunded, p.currency, { exact: true })}</dd></div>}
              <div className="flex justify-between border-t border-line pt-2 font-semibold"><dt>К зачислению</dt><dd className="tabular-nums">{money(p.status === 'succeeded' ? p.amount - p.fee - p.refunded : 0, p.currency, { exact: true })}</dd></div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Чеки" sub="Онлайн-касса GPAY · 54-ФЗ" />
            {data.receipts.length === 0 ? (
              <p className="text-sm text-muted">Чек будет сформирован после успешного списания.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.receipts.map((r) => (
                  <li key={r.id}>
                    <a href={`/r/${r.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 hover:bg-hover">
                      <Receipt className={cx('size-4', r.type === 'refund' ? 'text-warn' : 'text-ok')} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm">{r.type === 'refund' ? 'Возврат прихода' : 'Приход'} · {r.total.value}</span>
                        <span className="block text-xs text-faint">ФД № {r.fiscal_document_number} · {dateTime(Date.parse(r.registered_at))}</span>
                      </span>
                      <ExternalLink className="size-3.5 text-faint" />
                    </a>
                  </li>
                ))}
                {p.status === 'succeeded' && (
                  <li>
                    <a href={`/q/${p.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 hover:bg-hover">
                      <FileText className="size-4 text-brand" />
                      <span className="flex-1 text-sm">Квитанция об оплате</span>
                      <ExternalLink className="size-3.5 text-faint" />
                    </a>
                  </li>
                )}
              </ul>
            )}
          </Card>

          {data.refunds.length > 0 && (
            <Card>
              <CardHeader title="Возвраты" />
              <ul className="flex flex-col gap-2 text-sm">
                {data.refunds.map((r) => (
                  <li key={r.id} className="flex justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block font-mono text-xs truncate">{r.id}</span>
                      <span className="block text-xs text-muted">{r.description || 'Без комментария'} · {dateTime(Date.parse(r.created_at))}</span>
                    </span>
                    <span className="font-medium tabular-nums">−{r.amount.value}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader title="Уведомления" sub="Вебхуки по этому платежу" />
            {data.deliveries.length === 0 ? (
              <p className="text-sm text-muted">Нет отправленных уведомлений. <Link to={`/app/${shop.id}/developers`} className="text-brand">Настроить вебхуки</Link></p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {data.deliveries.map((d) => (
                  <li key={d.id} className="flex items-center gap-2">
                    <Webhook className={cx('size-4', d.status === 'succeeded' ? 'text-ok' : d.status === 'failed' ? 'text-bad' : 'text-warn')} />
                    <span className="font-mono text-xs flex-1 truncate">{d.event}</span>
                    <Badge tone={d.status === 'succeeded' ? 'ok' : d.status === 'failed' ? 'bad' : 'warn'}>{d.last_code ?? (d.status === 'pending' ? 'в очереди' : 'ошибка')}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <RefundModal open={modal === 'refund'} onClose={() => setModal(null)} p={p} shopId={shop.id} onDone={refreshAll} />
      <CaptureModal open={modal === 'capture'} onClose={() => setModal(null)} p={p} shopId={shop.id} onDone={refreshAll} />
      <CancelModal open={modal === 'cancel'} onClose={() => setModal(null)} p={p} shopId={shop.id} onDone={refreshAll} />
    </div>
  );
}

function Item({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted text-[13px]">{k}</dt>
      <dd className="mt-0.5 break-words">{v}</dd>
    </div>
  );
}

type ModalProps = { open: boolean; onClose: () => void; p: PaymentRowT; shopId: number; onDone: () => void };

function RefundModal({ open, onClose, p, shopId, onDone }: ModalProps) {
  const left = p.amount - p.refunded;
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const submit = async () => {
    const a = amount ? toAmount(amount) : (left / 100).toFixed(2);
    if (!a) return setError('Некорректная сумма');
    setBusy(true);
    setError(null);
    try {
      await api(`/m/shops/${shopId}/payments/${p.id}/refund`, { body: { amount: a, description: reason || undefined } });
      toast(`Возврат ${a} ${p.currency} выполнен`);
      onDone();
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Возврат платежа" footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" loading={busy} onClick={submit}>Вернуть {amount ? toAmount(amount) ?? '' : money(left, p.currency, { exact: true })}</Button></>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">Деньги вернутся покупателю тем же способом, которым он платил. Будет сформирован чек «Возврат прихода». Комиссия GPAY за исходный платёж не возвращается.</p>
        <Field label="Сумма возврата" hint={`Можно вернуть до ${money(left, p.currency, { exact: true })}. Оставьте пустым для полного возврата.`}>
          <Input inputMode="decimal" placeholder={(left / 100).toFixed(2)} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Причина (видна в истории)">
          <Input placeholder="Например: товар не подошёл" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={250} />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}

function CaptureModal({ open, onClose, p, shopId, onDone }: ModalProps) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Списать деньги"
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              const a = amount ? toAmount(amount) : undefined;
              if (amount && !a) return setError('Некорректная сумма');
              setBusy(true);
              try {
                await api(`/m/shops/${shopId}/payments/${p.id}/capture`, { body: { amount: a } });
                toast('Платёж подтверждён');
                onDone();
                onClose();
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Списать
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">Можно списать всю сумму или её часть — остаток автоматически разморозится на счёте покупателя.</p>
        <Field label="Сумма списания" hint={`Не больше ${money(p.amount, p.currency, { exact: true })}`}>
          <Input inputMode="decimal" placeholder={(p.amount / 100).toFixed(2)} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}

function CancelModal({ open, onClose, p, shopId, onDone }: ModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Отменить платёж?"
      footer={
        <>
          <Button onClick={onClose}>Не отменять</Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/m/shops/${shopId}/payments/${p.id}/cancel`, { body: {} });
                toast('Платёж отменён');
                onDone();
                onClose();
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Отменить платёж
          </Button>
        </>
      }
    >
      <div className="flex gap-3 text-sm text-muted">
        <AlertTriangle className="size-5 text-warn shrink-0" />
        {p.status === 'waiting_for_capture' ? 'Замороженные средства вернутся покупателю. Действие нельзя отменить.' : 'Покупатель больше не сможет оплатить этот платёж.'}
      </div>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
    </Modal>
  );
}
