import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, CheckCircle2, Clock, CreditCard, Landmark, RotateCcw, Snowflake } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BarList, ColumnChart, Delta } from '../components/charts';
import { Badge, Button, Card, CardHeader, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Segmented, Select, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { compact, dateTime, METHOD_TITLE, money, plural, REASONS, shortDate, toAmount } from '../lib/format';
import { useShop } from './Layout';
import { Kpi, useAnalytics } from './Overview';
import type { Balance, PayoutAccount } from './types';

// ---------- Refunds ----------
interface RefundItem {
  id: string;
  payment_id: string;
  amountMinor: number;
  currency: string;
  description?: string;
  createdAt: number;
  paymentDescription: string;
  methodTitle: string | null;
}

export function Refunds() {
  const shop = useShop();
  const { data } = useQuery({ queryKey: ['refunds', shop.id], queryFn: () => api<{ items: RefundItem[] }>(`/m/shops/${shop.id}/refunds`) });
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Возвраты" sub="Полные и частичные возвраты покупателям. Создаются из карточки платежа или через API." />
      <Card pad={false}>
        {!data ? (
          <Loading />
        ) : data.items.length === 0 ? (
          <Empty icon={<RotateCcw className="size-5" />} title="Возвратов не было" sub="Откройте успешный платёж и нажмите «Вернуть деньги»." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-faint border-b border-line">
                  <th className="font-medium py-2.5 pl-5 pr-3">Сумма</th>
                  <th className="font-medium py-2.5 px-3">Платёж</th>
                  <th className="font-medium py-2.5 px-3">Комментарий</th>
                  <th className="font-medium py-2.5 px-3">Способ</th>
                  <th className="font-medium py-2.5 pl-3 pr-5 text-right">Дата</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="py-3 pl-5 pr-3 whitespace-nowrap font-semibold tabular-nums">−{money(r.amountMinor, r.currency, { exact: true })}</td>
                    <td className="py-3 px-3 max-w-[260px]">
                      <Link to={`/app/${shop.id}/payments/${r.payment_id}`} className="block truncate text-brand">{r.paymentDescription || r.payment_id}</Link>
                      <span className="block text-[11px] text-faint font-mono truncate">{r.id}</span>
                    </td>
                    <td className="py-3 px-3 text-muted">{r.description || '—'}</td>
                    <td className="py-3 px-3 text-muted whitespace-nowrap">{r.methodTitle ?? '—'}</td>
                    <td className="py-3 pl-3 pr-5 text-right text-muted whitespace-nowrap">{dateTime(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------- Analytics ----------
export function AnalyticsPage() {
  const shop = useShop();
  const [days, setDays] = useState<'7' | '30' | '90' | '365'>('30');
  const { data } = useAnalytics(shop.id, Number(days));
  if (!data) return <Loading />;
  const k = data.kpi;
  const totalStatus = Object.values(data.byStatus).reduce((a, b) => a + b, 0);
  const STATUS: Record<string, string> = { succeeded: 'Оплачены', canceled: 'Отменены', pending: 'Ожидают оплаты', waiting_for_capture: 'Ждут списания' };
  const declinesTotal = Object.values(data.declines).reduce((a, b) => a + b, 0);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Аналитика"
        sub="Суммы в других валютах пересчитаны в рубли по текущему курсу GPAY"
        actions={<Segmented value={days} onChange={setDays} options={[{ value: '7', label: 'Неделя' }, { value: '30', label: 'Месяц' }, { value: '90', label: 'Квартал' }, { value: '365', label: 'Год' }]} />}
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Оборот" value={money(k.turnover)} delta={<Delta cur={k.turnover} prev={k.turnoverPrev} />} />
        <Kpi label="Чистая выручка" value={money(k.net)} hint="за вычетом комиссий и возвратов" />
        <Kpi label="Возвраты" value={money(k.refunds)} hint={k.turnover ? `${((k.refunds / (k.turnover + k.refunds)) * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}% от продаж` : undefined} />
        <Kpi label="Конверсия" value={k.conversion === null ? '—' : `${(k.conversion * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`} hint={k.conversionPrev !== null ? `было ${(k.conversionPrev * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%` : 'успешные из завершённых'} />
      </div>
      <Card>
        <CardHeader title="Количество успешных платежей" sub="По дням, московское время" />
        <ColumnChart
          label="Успешные платежи по дням"
          data={data.series.map((s) => ({ x: s.day, y: s.count * 100 }))}
          formatY={(v) => String(Math.round(v / 100))}
          formatX={shortDate}
          tooltip={(i) => (
            <>
              <div className="text-faint mb-0.5">{shortDate(data.series[i].day)}</div>
              <div className="font-semibold text-sm">{data.series[i].count} {plural(data.series[i].count, 'платёж', 'платежа', 'платежей')}</div>
              <div className="text-muted">{money(data.series[i].turnover)} · создано {data.series[i].created}</div>
            </>
          )}
        />
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Способы оплаты" sub="Оборот по способам" />
          <BarList items={Object.entries(data.byMethod).sort((a, b) => b[1].turnover - a[1].turnover).map(([m, v]) => ({ label: METHOD_TITLE[m] ?? m, value: v.turnover, sub: `${v.count} шт.` }))} format={(v) => money(v)} />
        </Card>
        <Card>
          <CardHeader title="Статусы платежей" sub={`Всего создано: ${totalStatus}`} />
          <BarList items={Object.entries(data.byStatus).sort((a, b) => b[1] - a[1]).map(([s, v]) => ({ label: STATUS[s] ?? s, value: v, sub: `${Math.round((v / totalStatus) * 100)}%` }))} format={(v) => String(v)} />
        </Card>
        <Card>
          <CardHeader title="Причины отказов" sub={declinesTotal ? `${declinesTotal} ${plural(declinesTotal, 'неудачная попытка', 'неудачные попытки', 'неудачных попыток')}` : 'Отказов не было'} />
          <BarList items={Object.entries(data.declines).sort((a, b) => b[1] - a[1]).map(([r, v]) => ({ label: REASONS[r] ?? r, value: v }))} format={(v) => String(v)} empty="Отказов не было — отлично!" />
        </Card>
        <Card>
          <CardHeader title="Валюты" sub="Успешные платежи в валюте платежа" />
          <BarList items={Object.entries(data.byCurrency).map(([c, v]) => ({ label: c, value: v.amount, sub: `${v.count} шт.` }))} format={(v) => compact(v)} />
        </Card>
      </div>
    </div>
  );
}

// ---------- Payouts ----------
interface Payout {
  id: string;
  status: 'pending' | 'succeeded' | 'canceled';
  amountMinor: number;
  currency: string;
  payout_destination: { type?: string; card_last4?: string; account_number?: string; holder?: string };
  createdAt: number;
  succeeded_at?: string;
}

export function Payouts() {
  const shop = useShop();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['payouts', shop.id],
    queryFn: () => api<{ balances: Balance[]; payoutAccount: PayoutAccount | null; bankEnabled: boolean; fees: { currency: string; fee: number; gross: number }[]; items: Payout[] }>(`/m/shops/${shop.id}/payouts`),
    refetchInterval: (q) => (q.state.data?.items.some((i) => i.status === 'pending') ? 2000 : 15000),
  });
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return <Loading />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Баланс и выплаты" sub="Выручка за вычетом комиссии GPAY и возвратов. Выплата на карту зачисляется за несколько секунд." />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {data.balances.map((b) => {
          const fee = data.fees.find((f) => f.currency === b.currency);
          return (
            <Card key={b.currency} className="flex flex-col">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-muted">Баланс {b.currency}</span>
                <Badge tone="neutral">{b.currency}</Badge>
              </div>
              <div className="mt-2 text-[28px] font-semibold tracking-tight tabular-nums">{money(b.available, b.currency, { exact: true })}</div>
              <dl className="mt-3 flex flex-col gap-1.5 text-[13px]">
                <div className="flex justify-between"><dt className="text-muted inline-flex items-center gap-1.5"><Snowflake className="size-3.5" />Заморожено</dt><dd className="tabular-nums">{money(b.held, b.currency)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted inline-flex items-center gap-1.5"><Clock className="size-3.5" />В пути</dt><dd className="tabular-nums">{money(b.inTransit, b.currency)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted inline-flex items-center gap-1.5"><CheckCircle2 className="size-3.5" />Выплачено</dt><dd className="tabular-nums">{money(b.paidOut, b.currency)}</dd></div>
                {fee && <div className="flex justify-between"><dt className="text-muted inline-flex items-center gap-1.5"><Landmark className="size-3.5" />Комиссия GPAY</dt><dd className="tabular-nums">{money(fee.fee, b.currency)}</dd></div>}
              </dl>
              {data.bankEnabled && (
                <div className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
                  <div className="rounded-xl bg-[#e2f6eb] px-3 py-2 text-[#0a6b3e] dark:bg-[#12261b] dark:text-[#45d98a]"><div className="opacity-80">Bobobank</div><div className="font-semibold tabular-nums">{money(b.live, b.currency)}</div></div>
                  <div className="rounded-xl bg-sunken px-3 py-2"><div className="text-muted">Тестовые</div><div className="font-semibold tabular-nums">{money(b.test, b.currency)}</div></div>
                </div>
              )}
              <Button className="mt-4" variant={b.currency === 'RUB' ? 'primary' : 'secondary'} disabled={b.available <= 0} icon={<ArrowDownToLine className="size-4" />} onClick={() => setOpen(b.currency)}>
                Вывести
              </Button>
            </Card>
          );
        })}
      </div>
      <Card>
        <CardHeader title="Тарифы" sub="Комиссия удерживается при зачислении платежа" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Object.entries(shop.fees).map(([m, pct]) => (
            <div key={m} className="rounded-xl bg-sunken px-3.5 py-3">
              <div className="text-[13px] text-muted">{METHOD_TITLE[m]}</div>
              <div className="text-lg font-semibold tabular-nums">{pct.toLocaleString('ru-RU')}%</div>
            </div>
          ))}
        </div>
      </Card>
      <Card pad={false}>
        <div className="px-5 pt-4 pb-3"><h2 className="text-[15px] font-semibold">История выплат</h2></div>
        {data.items.length === 0 ? (
          <Empty icon={<ArrowDownToLine className="size-5" />} title="Выплат ещё не было" />
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {data.items.map((po) => (
              <li key={po.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <CreditCard className="size-4 text-muted shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block">{po.payout_destination.type === 'bobobank' ? `На счёт Bobobank ${po.payout_destination.account_number ?? ''}` : `На карту •• ${po.payout_destination.card_last4}`}</span>
                  <span className="block text-xs text-faint font-mono truncate">{po.id} · {dateTime(po.createdAt)}</span>
                </span>
                <Badge tone={po.status === 'succeeded' ? 'ok' : po.status === 'pending' ? 'warn' : 'bad'}>{po.status === 'succeeded' ? 'Зачислено' : po.status === 'pending' ? 'В обработке' : 'Отменено'}</Badge>
                <span className="font-semibold tabular-nums w-28 text-right">{money(po.amountMinor, po.currency, { exact: true })}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {open && <PayoutModal key={open} currency={open} balance={data.balances.find((b) => b.currency === open)} account={data.bankEnabled ? data.payoutAccount : null} bankEnabled={data.bankEnabled} onClose={() => setOpen(null)} onDone={() => void qc.invalidateQueries({ queryKey: ['payouts', shop.id] })} />}
    </div>
  );
}

function PayoutModal({ currency, balance, account, bankEnabled, onClose, onDone }: { currency: string | null; balance?: Balance; account: PayoutAccount | null; bankEnabled: boolean; onClose: () => void; onDone: () => void }) {
  const shop = useShop();
  const toast = useToast();
  const [dest, setDest] = useState<'bobobank' | 'card'>(() => (balance && balance.live > 0 ? 'bobobank' : 'card'));
  const [amount, setAmount] = useState('');
  const [card, setCard] = useState(() => localStorage.getItem('gpay.payoutCard') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!currency || !balance) return null;
  const max = bankEnabled ? (dest === 'bobobank' ? balance.live : balance.test) : balance.available;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Вывод средств, ${currency}`}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              const a = amount ? toAmount(amount) : (max / 100).toFixed(2);
              if (!a) return setError('Некорректная сумма');
              if (dest === 'card' && !/^\d{4}$/.test(card)) return setError('Укажите последние 4 цифры карты');
              if (dest === 'bobobank' && !account) return setError('Подключите счёт Bobobank в настройках магазина');
              setBusy(true);
              setError(null);
              try {
                await api(`/m/shops/${shop.id}/payouts`, { body: { amount: a, currency, destination: dest, cardLast4: dest === 'card' ? card : undefined } });
                if (dest === 'card') localStorage.setItem('gpay.payoutCard', card);
                toast('Выплата отправлена');
                onDone();
                onClose();
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Вывести
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {bankEnabled && (
          <Segmented value={dest} onChange={setDest} options={[{ value: 'bobobank', label: 'На счёт Bobobank' }, { value: 'card', label: 'Тестовые — на карту' }]} />
        )}
        <Field label="Сумма" hint={`Доступно ${money(max, currency, { exact: true })}. Пусто — вывести всё.`}>
          <Input inputMode="decimal" placeholder={(max / 100).toFixed(2)} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        {dest === 'bobobank' ? (
          account ? (
            <div className="rounded-xl bg-sunken px-4 py-3 text-sm">
              <div className="font-semibold">{account.holder}</div>
              <div className="text-muted tabular-nums">Счёт {account.number.slice(0, 5)}…{account.number.slice(-4)} · Bobobank · деньги придут сразу</div>
            </div>
          ) : (
            <div className="rounded-xl bg-sunken px-4 py-3 text-sm text-muted">Счёт не подключён. Откройте <Link to={`/app/${shop.id}/settings`} className="font-medium text-fg underline">настройки магазина</Link> → «Выплаты в Bobobank».</div>
          )
        ) : (
          <Field label="Карта получателя" hint="Последние 4 цифры карты, привязанной к расчётному счёту">
            <Input inputMode="numeric" placeholder="1234" maxLength={4} value={card} onChange={(e) => setCard(e.target.value.replace(/\D/g, ''))} mono />
          </Field>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}

export function CurrencySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="RUB">₽ RUB</option>
      <option value="USD">$ USD</option>
      <option value="EUR">€ EUR</option>
    </Select>
  );
}
