import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Page, Section } from '../components/Page';
import { Button, cx, ErrorNote, Loading, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { dayTime, rub } from '../lib/format';
import { useMe } from '../lib/hooks';
import type { HistoryItem, TariffId } from '../lib/types';

interface Tariff {
  id: TariffId;
  title: string;
  base: number;
  perKm: number;
  perMin: number;
  min: number;
  waitPerMin: number;
  seats: number;
  cars: string[];
  etaMin: [number, number];
}
interface Settings {
  timeScale: number;
  surgeMode: 'auto' | 'fixed';
  surgeFixed: number;
  freeWaitMin: number;
  autoBoardS: number;
  cancelFee: number;
  childSeat: number;
  tariffs: Tariff[];
}
interface Overview {
  users: number;
  active: number;
  today: { n: number; s: number };
  total: { n: number; s: number; tips: number };
  failed: number;
  surgeNow: number;
}

const STATUS: Record<string, string> = { searching: 'Поиск', driver_coming: 'Едет к клиенту', arrived: 'Ждёт', in_ride: 'В пути', completed: 'Завершена', cancelled: 'Отменена' };

function Num({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted">{label}</span>
      <input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-10 w-full rounded-xl bg-surface px-3 text-[15px] outline-none focus:ring-2 focus:ring-ink num" />
    </label>
  );
}

export default function Admin() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: me } = useMe();
  const isAdmin = me?.user?.role === 'admin';
  const { data: ov } = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api<Overview>('/admin/overview'), enabled: isAdmin, refetchInterval: 5000 });
  const { data: rides } = useQuery({ queryKey: ['admin', 'rides'], queryFn: () => api<{ rides: (HistoryItem & { user: string; bankError: string | null })[] }>('/admin/rides'), enabled: isAdmin, refetchInterval: 5000 });
  const { data: settings, error } = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api<Settings>('/admin/settings'), enabled: isAdmin });
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (settings) setS(settings);
  }, [settings]);
  if (me && !isAdmin) return <Navigate to="/" replace />;
  if (error) return <Page title="Админка"><ErrorNote>{errorText(error)}</ErrorNote></Page>;
  if (!s || !ov) return <Page title="Админка"><Loading /></Page>;
  const setT = (i: number, patch: Partial<Tariff>) => setS({ ...s, tariffs: s.tariffs.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const saveSettings = async () => {
    setBusy(true);
    try {
      setS(await api<Settings>('/admin/settings', { method: 'PUT', body: s }));
      void qc.invalidateQueries({ queryKey: ['admin'] });
      toast('Настройки сохранены');
    } catch (e) {
      toast(errorText(e), 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page title="Админка">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['Сейчас в работе', String(ov.active)],
          ['За сутки', `${ov.today.n} · ${rub(ov.today.s)}`],
          ['Выручка всего', rub(ov.total.s)],
          ['Пассажиров', String(ov.users)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-2xl bg-sunken px-3 py-3">
            <div className="text-xs text-muted">{k}</div>
            <div className="mt-0.5 truncate text-lg font-bold num">{v}</div>
          </div>
        ))}
      </div>
      {ov.failed > 0 && <div className="mt-2"><ErrorNote>Не списалось поездок: {ov.failed}. Смотрите ошибки банка в списке ниже.</ErrorNote></div>}

      <Section title="Игра">
        <div className="grid grid-cols-2 gap-3 rounded-2xl bg-sunken p-4 sm:grid-cols-3">
          <Num label="Ускорение времени, ×" value={s.timeScale} step={0.5} onChange={(v) => setS({ ...s, timeScale: v })} />
          <Num label="Бесплатное ожидание, мин" value={s.freeWaitMin} onChange={(v) => setS({ ...s, freeWaitMin: v })} />
          <Num label="Сам садится через, с" value={s.autoBoardS} onChange={(v) => setS({ ...s, autoBoardS: v })} />
          <Num label="Плата за отмену, ₽" value={s.cancelFee} onChange={(v) => setS({ ...s, cancelFee: v })} />
          <Num label="Детское кресло, ₽" value={s.childSeat} onChange={(v) => setS({ ...s, childSeat: v })} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Спрос (сейчас ×{ov.surgeNow})</span>
            <select value={s.surgeMode} onChange={(e) => setS({ ...s, surgeMode: e.target.value as Settings['surgeMode'] })} className="h-10 rounded-xl bg-surface px-3 text-[15px]">
              <option value="auto">Авто: часы пик</option>
              <option value="fixed">Фиксированный</option>
            </select>
          </label>
          {s.surgeMode === 'fixed' && <Num label="Коэффициент" value={s.surgeFixed} step={0.1} onChange={(v) => setS({ ...s, surgeFixed: v })} />}
        </div>
      </Section>

      <Section title="Тарифы, ₽">
        <div className="flex flex-col gap-2">
          {s.tariffs.map((t, i) => (
            <div key={t.id} className="rounded-2xl bg-sunken p-4">
              <div className="mb-2 font-semibold">{t.title}</div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                <Num label="Посадка" value={t.base} onChange={(v) => setT(i, { base: v })} />
                <Num label="За км" value={t.perKm} onChange={(v) => setT(i, { perKm: v })} />
                <Num label="За мин" value={t.perMin} onChange={(v) => setT(i, { perMin: v })} />
                <Num label="Минимум" value={t.min} onChange={(v) => setT(i, { min: v })} />
                <Num label="Ожидание/мин" value={t.waitPerMin} onChange={(v) => setT(i, { waitPerMin: v })} />
              </div>
            </div>
          ))}
        </div>
        <Button className="mt-3 w-full" size="lg" variant="ink" loading={busy} onClick={() => void saveSettings()}>Сохранить настройки</Button>
      </Section>

      <Section title="Последние поездки">
        <div className="flex flex-col divide-y divide-line rounded-2xl bg-sunken">
          {rides?.rides.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{r.user} · {r.from.title} → {r.to.title}</div>
                <div className="truncate text-muted">{dayTime(r.createdAt)} · {r.tariff} · <span className={cx(r.bankStatus === 'failed' && 'text-bad')}>{STATUS[r.status] ?? r.status}{r.bankError ? ` · ${r.bankError}` : ''}</span></div>
              </div>
              <div className="shrink-0 font-semibold num">{rub(r.amount)}</div>
              {['searching', 'driver_coming', 'arrived', 'in_ride'].includes(r.status) && (
                <Button size="sm" variant="danger" onClick={() => void api(`/admin/rides/${r.id}/cancel`, { body: {} }).then(() => qc.invalidateQueries({ queryKey: ['admin'] }), (e) => toast(errorText(e), 'bad'))}>Отменить</Button>
              )}
            </div>
          ))}
          {!rides?.rides.length && <div className="px-4 py-6 text-center text-muted">Поездок пока нет</div>}
        </div>
      </Section>
    </Page>
  );
}
