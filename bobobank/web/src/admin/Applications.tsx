import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, ErrorNote, Field, Input, Loading, Modal, PageHeader, Segmented, Textarea, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { dateTime, money, toAmount } from '../lib/format';

interface AppRow {
  id: string;
  user_id: string;
  user_name: string;
  user_phone: string;
  product: 'loan' | 'credit_card';
  amount: number;
  term: number;
  status: string;
  score: number | null;
  offer_amount: number | null;
  offer_rate: number | null;
  reason: string | null;
  factors: { tenureDays?: number; income30?: number; overdue?: boolean; monthlyDebt?: number; limit?: number };
  created_at: number;
}

const STATUS: Record<string, [string, 'warn' | 'brand' | 'bad' | 'neutral' | 'info']> = {
  processing: ['скоринг', 'info'], review: ['на проверке', 'warn'], approved: ['одобрена', 'brand'], rejected: ['отказ', 'bad'], issued: ['выдан', 'neutral'], canceled: ['отменена', 'neutral'],
};

export function Applications() {
  const nav = useNavigate();
  const [status, setStatus] = useState('review');
  const [edit, setEdit] = useState<AppRow | null>(null);
  const { data, error, refetch } = useQuery({ queryKey: ['admin', 'apps', status], queryFn: () => api<{ items: AppRow[] }>(`/admin/applications?status=${status}`) });
  return (
    <>
      <PageHeader title="Заявки на кредит" sub="Автоскоринг решает сам; спорные заявки ждут здесь" />
      <Segmented className="mb-4" value={status} onChange={setStatus} options={[{ value: 'review', label: 'На проверке' }, { value: 'approved', label: 'Одобренные' }, { value: 'rejected', label: 'Отказы' }, { value: 'all', label: 'Все' }]} />
      {error && <ErrorNote>{errorText(error)}</ErrorNote>}
      {!data ? <Loading /> : (
        <div className="flex flex-col gap-3">
          {data.items.map((a) => (
            <Card key={a.id} className="!p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <button type="button" onClick={() => nav(`/admin/clients/${a.user_id}`)} className="font-semibold hover:text-brand">{a.user_name}</button>
                  <div className="text-sm text-muted num">{a.user_phone} · {dateTime(a.created_at)}</div>
                </div>
                <Badge tone={STATUS[a.status]?.[1] ?? 'neutral'}>{STATUS[a.status]?.[0] ?? a.status}</Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                <Fact k="Продукт" v={a.product === 'loan' ? `Кредит, ${a.term} мес.` : 'Кредитная карта'} />
                <Fact k="Запрошено" v={money(a.amount)} />
                <Fact k="Скоринг" v={a.score ? String(a.score) : '—'} />
                <Fact k="Доход за 30 дн." v={money(a.factors.income30 ?? 0)} />
                <Fact k="Стаж" v={`${a.factors.tenureDays ?? 0} дн.`} />
              </div>
              {a.reason && <p className="mt-2 text-sm text-muted">{a.reason}</p>}
              {['review', 'approved', 'rejected'].includes(a.status) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" onClick={() => setEdit(a)}>Решение</Button>
                </div>
              )}
            </Card>
          ))}
          {!data.items.length && <div className="py-12 text-center text-muted">Заявок нет</div>}
        </div>
      )}
      {edit && <ReviewModal a={edit} onClose={() => setEdit(null)} onDone={() => void refetch()} />}
    </>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return <div className="rounded-xl bg-sunken px-3 py-2"><div className="text-xs text-muted">{k}</div><div className="font-semibold num">{v}</div></div>;
}

function ReviewModal({ a, onClose, onDone }: { a: AppRow; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String((a.offer_amount ?? a.factors.limit ?? a.amount) / 100));
  const [rate, setRate] = useState(String(a.offer_rate ?? (a.product === 'loan' ? 24.9 : 34.9)));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const send = (approve: boolean) =>
    api(`/admin/applications/${a.id}/review`, { body: { approve, amount: approve ? toAmount(amount) : undefined, rate: approve ? Number(rate.replace(',', '.')) : undefined, reason: reason || undefined } })
      .then(() => { toast(approve ? 'Одобрено, клиент получил уведомление' : 'Отказ отправлен'); onDone(); onClose(); }, (e) => setErr(errorText(e)));
  return (
    <Modal open onClose={onClose} title={`Заявка: ${a.user_name}`} footer={<><Button variant="danger" onClick={() => void send(false)}>Отказать</Button><Button variant="primary" onClick={() => void send(true)}>Одобрить</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Сумма, ₽" hint={`Лимит по доходу ${money(a.factors.limit ?? 0)}`}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Ставка, %"><Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
        </div>
        <Field label="Комментарий клиенту"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Необязательно" /></Field>
        {err && <ErrorNote>{err}</ErrorNote>}
      </div>
    </Modal>
  );
}
