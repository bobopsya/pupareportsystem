import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, ArrowRight, BookOpen, KeyRound, Link2, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ColumnChart, Delta } from '../components/charts';
import { Button, Card, CardHeader, Empty, Loading, PageHeader, Segmented } from '../components/ui';
import { api } from '../lib/api';
import { compact, money, plural, shortDate } from '../lib/format';
import { useShop } from './Layout';
import { PaymentsTable } from './PaymentsTable';
import type { Analytics } from './types';

export function useAnalytics(shopId: number, days: number) {
  return useQuery({ queryKey: ['analytics', shopId, days], queryFn: () => api<Analytics>(`/m/shops/${shopId}/analytics?days=${days}`), refetchInterval: 15_000 });
}

export function Kpi({ label, value, delta, hint }: { label: string; value: string; delta?: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-3xl bg-sunken p-5">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-2 text-[21px] sm:text-[28px] leading-tight font-bold tracking-[-0.02em] break-words">{value}</div>
      <div className="mt-2 min-h-4">{delta ?? (hint && <span className="text-[13px] text-faint">{hint}</span>)}</div>
    </div>
  );
}

export default function Overview() {
  const shop = useShop();
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const { data } = useAnalytics(shop.id, Number(days));
  const hour = new Date().getHours();
  const hello = hour < 6 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';

  if (!data) return <Loading />;
  const k = data.kpi;
  const rub = data.balances.find((b) => b.currency === 'RUB')!;
  const others = data.balances.filter((b) => b.currency !== 'RUB' && (b.available || b.held));
  const empty = data.recent.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${hello}!`}
        sub={`${shop.name} · ID магазина ${shop.id}`}
        actions={<Segmented value={days} onChange={setDays} options={[{ value: '7', label: '7 дней' }, { value: '30', label: '30 дней' }, { value: '90', label: '90 дней' }]} />}
      />

      {empty && <GettingStarted shopId={shop.id} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Оборот" value={money(k.turnover)} delta={<Delta cur={k.turnover} prev={k.turnoverPrev} />} />
        <Kpi label="Успешных платежей" value={k.count.toLocaleString('ru-RU')} delta={<Delta cur={k.count} prev={k.countPrev} />} />
        <Kpi label="Средний чек" value={money(k.avg)} delta={<Delta cur={k.avg} prev={k.avgPrev} />} />
        <Kpi label="Конверсия" value={k.conversion === null ? '—' : `${(k.conversion * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`} hint="успешные из завершённых" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4">
        <Card>
          <CardHeader title="Оборот по дням" sub={`Успешные платежи за ${days} ${plural(Number(days), 'день', 'дня', 'дней')}, в рублях по курсу GPAY`} />
          <ColumnChart
            label="Оборот по дням"
            data={data.series.map((s) => ({ x: s.day, y: s.turnover }))}
            formatY={(v) => compact(v)}
            formatX={(x) => shortDate(x)}
            tooltip={(i) => {
              const s = data.series[i];
              return (
                <>
                  <div className="text-faint mb-0.5">{shortDate(s.day)}</div>
                  <div className="font-semibold text-sm">{money(s.turnover)}</div>
                  <div className="text-muted">{s.count} {plural(s.count, 'платёж', 'платежа', 'платежей')} · создано {s.created}</div>
                </>
              );
            }}
          />
        </Card>
        <Card className="flex flex-col">
          <CardHeader title="Баланс" sub="Доступно к выплате" />
          <div className="text-[30px] font-semibold tracking-tight tabular-nums">{money(rub.available, 'RUB', { exact: true })}</div>
          {others.map((b) => (
            <div key={b.currency} className="text-sm text-muted mt-1 tabular-nums">+ {money(b.available, b.currency, { exact: true })}</div>
          ))}
          <dl className="mt-4 flex flex-col gap-2 text-[13px]">
            <div className="flex justify-between"><dt className="text-muted">Заморожено (двухстадийные)</dt><dd className="tabular-nums">{money(rub.held)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">В пути на карту</dt><dd className="tabular-nums">{money(rub.inTransit)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Чистая выручка за период</dt><dd className="tabular-nums">{money(k.net)}</dd></div>
          </dl>
          <Link to={`/app/${shop.id}/payouts`} className="mt-auto pt-5">
            <Button className="w-full" icon={<ArrowRight className="size-4" />}>Вывести средства</Button>
          </Link>
        </Card>
      </div>

      <Card pad={false}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <h2 className="text-[15px] font-semibold">Последние платежи</h2>
          <Link to={`/app/${shop.id}/payments`} className="text-sm text-brand font-medium inline-flex items-center gap-1">
            Все платежи <ArrowRight className="size-3.5" />
          </Link>
        </div>
        {data.recent.length ? (
          <PaymentsTable items={data.recent} shopId={shop.id} compact />
        ) : (
          <Empty icon={<ArrowLeftRight className="size-5" />} title="Платежей пока нет" sub="Создайте ссылку на оплату или подключите API — платежи появятся здесь в реальном времени." />
        )}
      </Card>
    </div>
  );
}

function GettingStarted({ shopId }: { shopId: number }) {
  const steps = [
    { icon: Link2, title: 'Создайте ссылку на оплату', text: 'Без сайта и программиста: отправьте ссылку покупателю в мессенджер.', to: `/app/${shopId}/links`, cta: 'Создать ссылку' },
    { icon: KeyRound, title: 'Получите API-ключ', text: 'Подключите оплату на сайте или в боте через REST API и вебхуки.', to: `/app/${shopId}/developers`, cta: 'Выпустить ключ' },
    { icon: BookOpen, title: 'Изучите документацию', text: 'Примеры на curl, JavaScript, Python и PHP, песочница запросов.', to: '/docs', cta: 'Открыть доки' },
  ];
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="px-6 pt-6 pb-5">
        <h2 className="text-[15px] font-semibold">Магазин готов принимать платежи</h2>
        <p className="text-[13px] text-muted mt-0.5">Карты Bobobank, СБП и Bobo Pay уже подключены.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-line border-t border-line">
        {steps.map((s) => (
          <div key={s.title} className="p-5 flex flex-col gap-2">
            <s.icon className="size-5" />
            <div className="font-medium text-sm">{s.title}</div>
            <p className="text-[13px] text-muted flex-1">{s.text}</p>
            <Link to={s.to} className="mt-1">
              <Button size="sm" icon={<Plus className="size-3.5" />}>{s.cta}</Button>
            </Link>
          </div>
        ))}
      </div>
    </Card>
  );
}
