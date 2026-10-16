import { useQuery } from '@tanstack/react-query';
import { Car as CarIcon, FileText, Star } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Page } from '../components/Page';
import { AircraftIcon } from '../components/Air';
import { BusBadge } from '../components/Bus';
import { Plate, TariffCar } from '../components/Ride';
import { Button, cx, ErrorNote, Loading } from '../components/ui';
import { api, errorText } from '../lib/api';
import { clock, dayLabel, dayTime, km, rub } from '../lib/format';
import type { HistoryItem, Ride } from '../lib/types';
import { FitBounds, MapView, PointMarker, RouteLine } from '../map/Map';

export default function History() {
  const { data, error } = useQuery({ queryKey: ['history'], queryFn: () => api<{ rides: HistoryItem[]; stats: { rides: number; spent: number; km: number } }>('/rides') });
  if (error) return <Page title="Мои поездки"><ErrorNote>{errorText(error)}</ErrorNote></Page>;
  if (!data) return <Page title="Мои поездки"><Loading /></Page>;
  const groups = new Map<string, HistoryItem[]>();
  for (const r of data.rides) {
    const k = dayLabel(r.createdAt);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return (
    <Page title="Мои поездки">
      <div className="grid grid-cols-3 gap-2">
        {[
          ['Поездок', String(data.stats.rides)],
          ['Километров', String(data.stats.km)],
          ['Потрачено', rub(data.stats.spent)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-2xl bg-sunken px-3 py-3">
            <div className="text-xs text-muted">{k}</div>
            <div className="mt-0.5 truncate text-lg font-bold num">{v}</div>
          </div>
        ))}
      </div>
      {!data.rides.length && (
        <div className="mt-16 flex flex-col items-center text-center">
          <CarIcon className="size-12 text-faint" />
          <p className="mt-3 text-[15px] text-muted">Поездок пока нет</p>
          <Link to="/" className="mt-4"><Button variant="brand">Вызвать машину</Button></Link>
        </div>
      )}
      {[...groups].map(([day, items]) => (
        <section key={day} className="mt-6">
          <h2 className="mb-1 px-1 text-sm font-semibold text-muted">{day}</h2>
          <div className="flex flex-col">
            {items.map((r) => (
              <Link key={r.id} to={`/rides/${r.id}`} className="flex items-center gap-3 rounded-2xl px-1 py-3 hover:bg-sunken">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-sunken">
                  {r.mode === 'bus' ? <BusBadge num={r.tariff.split(' ').pop() ?? ''} colour={r.colour} className="h-6 min-w-8 text-[13px]" /> : r.mode === 'heli' || r.mode === 'jet' ? <AircraftIcon kind={r.mode} className="size-9" /> : <TariffCar tariff={r.tariffId} className="h-6 w-11" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{r.to.title}</span>
                  <span className="block truncate text-sm text-muted">
                    {clock(r.createdAt)} · {r.status === 'cancelled' ? 'Отменена' : `${r.tariff}, ${km(r.distance)}`}
                  </span>
                </span>
                <span className={cx('shrink-0 text-right text-[15px] font-semibold num', r.status === 'cancelled' && !r.amount && 'text-muted')}>
                  {r.amount ? rub(r.amount) : '0 ₽'}
                  {r.rating && (
                    <span className="flex items-center justify-end gap-0.5 text-xs font-normal text-muted">
                      <Star className="size-3 fill-current text-[#f5b400]" />
                      {r.rating}
                    </span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </Page>
  );
}

export function RidePage() {
  const { id } = useParams();
  const { data: r, error } = useQuery({ queryKey: ['ride', id], queryFn: () => api<Ride>(`/rides/${id}`) });
  if (error) return <Page title="Поездка" back="/rides"><ErrorNote>{errorText(error)}</ErrorNote></Page>;
  if (!r) return <Page title="Поездка" back="/rides"><Loading /></Page>;
  const lines: [string, string][] = [
    r.bus ? ['Маршрут', `${r.bus.ref} → ${r.bus.to}`] : r.air ? ['Борт', `${r.air.model}${r.car ? `, ${r.car.plate}` : ''}`] : ['Тариф', r.tariff.title],
    ...(r.car && r.mode === 'taxi' ? ([[/^(bus|minibus)/.test(r.tariff.id) ? 'Автобус' : 'Машина', `${r.car.color} ${r.car.model}`.trim()]] as [string, string][]) : []),
    ...(r.driver && r.mode !== 'bus' ? ([[r.air ? 'Командир' : 'Водитель', `${r.driver.name}, ★ ${r.driver.rating.toFixed(2).replace('.', ',')}`]] as [string, string][]) : []),
    ['Расстояние', km(r.distance * (r.progress ?? 1))],
    ...(r.surge > 1 ? ([['Повышенный спрос', `×${r.surge.toFixed(1).replace('.', ',')}`]] as [string, string][]) : []),
    ...(r.cancelFee ? ([['Плата за отмену', rub(r.cancelFee)]] as [string, string][]) : []),
    ...(r.tip ? ([['Чаевые', rub(r.tip)]] as [string, string][]) : []),
    ['Оплата', r.bank.status === 'captured' ? 'Bobobank, списано' : r.bank.status === 'voided' ? 'Холд снят, без оплаты' : r.bank.status === 'failed' ? `Не списано: ${r.bank.error ?? ''}` : 'Ожидает списания'],
  ];
  return (
    <Page title={r.status === 'cancelled' ? 'Отменённый заказ' : 'Поездка'} back="/rides">
      <div className="relative h-56 overflow-hidden rounded-3xl">
        <MapView center={[r.from.lat, r.from.lon]} className="absolute inset-0">
          <RouteLine path={r.route.length > 1 ? r.route : r.fullRoute} />
          <PointMarker pos={[r.from.lat, r.from.lon]} kind="from" />
          <PointMarker pos={[r.to.lat, r.to.lon]} kind="to" />
          <FitBounds points={r.fullRoute.length > 1 ? r.fullRoute : [[r.from.lat, r.from.lon], [r.to.lat, r.to.lon]]} padding={[28, 28]} />
        </MapView>
      </div>
      <div className="mt-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-muted">{dayTime(r.createdAt)}</div>
          <div className="mt-2 flex items-start gap-3">
            <span className="mt-1.5 size-3 shrink-0 rounded-full border-[3px] border-ink bg-brand" />
            <span className="min-w-0"><span className="block font-semibold">{r.from.title}</span><span className="block truncate text-sm text-muted">{r.from.subtitle}</span></span>
          </div>
          <div className="mt-2 flex items-start gap-3">
            <span className="mt-1.5 size-3 shrink-0 rounded-[3px] border-[3px] border-ink bg-surface" />
            <span className="min-w-0"><span className="block font-semibold">{r.to.title}</span><span className="block truncate text-sm text-muted">{r.to.subtitle}</span></span>
          </div>
        </div>
        <div className="shrink-0 text-right text-2xl font-bold num">{rub(r.finalPrice ?? 0)}</div>
      </div>
      {r.car && r.mode === 'taxi' && <div className="mt-4"><Plate plate={r.car.plate} /></div>}
      <dl className="mt-4 divide-y divide-line rounded-2xl bg-sunken px-4">
        {lines.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-3 text-[15px]">
            <dt className="text-muted">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {r.bank.status === 'captured' && (
        <a href={`/api/rides/${r.id}/receipt.pdf`} target="_blank" rel="noopener" className="mt-4 block">
          <Button className="w-full" size="lg" icon={<FileText className="size-5" />}>Чек в PDF</Button>
        </a>
      )}
    </Page>
  );
}
