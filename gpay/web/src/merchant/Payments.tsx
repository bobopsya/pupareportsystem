import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, Empty, Input, Loading, PageHeader, Select } from '../components/ui';
import { api } from '../lib/api';
import { dateTime } from '../lib/format';
import { useShop } from './Layout';
import { PaymentsTable } from './PaymentsTable';
import type { PaymentRowT } from './types';

const PAGE = 25;

export default function Payments() {
  const shop = useShop();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const method = params.get('method') ?? '';
  const currency = params.get('currency') ?? '';
  const page = Number(params.get('page') ?? 0);
  const [q, setQ] = useState(params.get('q') ?? '');

  useEffect(() => {
    const t = setTimeout(() => set('q', q), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function set(k: string, v: string) {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }

  const query = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE) });
  if (status) query.set('status', status);
  if (method) query.set('method', method);
  if (currency) query.set('currency', currency);
  if (params.get('q')) query.set('q', params.get('q')!);

  const { data, isFetching } = useQuery({
    queryKey: ['payments', shop.id, query.toString()],
    queryFn: () => api<{ total: number; items: PaymentRowT[] }>(`/m/shops/${shop.id}/payments?${query}`),
    placeholderData: keepPreviousData,
    refetchInterval: 10_000,
  });

  const exportCsv = async () => {
    const all = await api<{ items: PaymentRowT[] }>(`/m/shops/${shop.id}/payments?${new URLSearchParams({ ...Object.fromEntries(query), limit: '200', offset: '0' })}`);
    const rows = [['ID', 'Дата', 'Статус', 'Сумма', 'Валюта', 'Комиссия', 'Возвращено', 'Способ', 'Описание', 'Email']];
    for (const p of all.items) rows.push([p.id, dateTime(p.createdAt), p.status, (p.amount / 100).toFixed(2), p.currency, (p.fee / 100).toFixed(2), (p.refunded / 100).toFixed(2), p.methodTitle ?? '', p.description, p.email ?? '']);
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `gpay-payments-${shop.id}.csv`;
    a.click();
  };

  const pages = data ? Math.ceil(data.total / PAGE) : 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Платежи" sub={data ? `${data.total.toLocaleString('ru-RU')} всего` : undefined} actions={<Button icon={<Download className="size-4" />} onClick={exportCsv}>Экспорт CSV</Button>} />
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-faint" />
          <Input placeholder="ID, описание, email, сумма, последние цифры карты" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <Select value={status} onChange={(e) => set('status', e.target.value)} className="w-auto" aria-label="Статус">
          <option value="">Все статусы</option>
          <option value="succeeded">Оплачен</option>
          <option value="waiting_for_capture">Ждёт списания</option>
          <option value="pending">Ожидает оплаты</option>
          <option value="canceled">Отменён</option>
          <option value="refunded">С возвратом</option>
        </Select>
        <Select value={method} onChange={(e) => set('method', e.target.value)} className="w-auto" aria-label="Способ">
          <option value="">Все способы</option>
          <option value="bank_card">Карта</option>
          <option value="sbp">СБП</option>
          <option value="installments">Частями</option>
          <option value="crypto">Криптовалюта</option>
        </Select>
        <Select value={currency} onChange={(e) => set('currency', e.target.value)} className="w-auto" aria-label="Валюта">
          <option value="">Все валюты</option>
          <option value="RUB">RUB</option>
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
        </Select>
      </div>
      <Card pad={false} className={isFetching && data ? 'opacity-80 transition-opacity' : ''}>
        {!data ? (
          <Loading />
        ) : data.items.length === 0 ? (
          <Empty icon={<ArrowLeftRight className="size-5" />} title="Ничего не найдено" sub="Измените фильтры или поисковый запрос." />
        ) : (
          <PaymentsTable items={data.items} shopId={shop.id} />
        )}
      </Card>
      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted">
          <span>Страница {page + 1} из {pages}</span>
          <div className="flex gap-2">
            <Button size="sm" disabled={page === 0} onClick={() => set('page', String(page - 1))} icon={<ChevronLeft className="size-4" />}>Назад</Button>
            <Button size="sm" disabled={page + 1 >= pages} onClick={() => set('page', String(page + 1))}>Вперёд <ChevronRight className="size-4" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}
