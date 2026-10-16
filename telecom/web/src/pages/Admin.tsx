import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { Button, cx, Loading, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { dayTime, rub } from '../lib/format';
import { useMe } from '../lib/hooks';
import type { Addon, Line, Tariff } from '../lib/types';

interface Overview {
  users: number;
  active: number;
  blocked: number;
  revenueMonth: number;
  callsDay: number;
  smsDay: number;
}

export default function Admin() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'lines' | 'charges' | 'tariffs'>('lines');
  const ov = useQuery({ queryKey: ['admin', 'ov'], queryFn: () => api<Overview>('/admin/overview'), refetchInterval: 5000, enabled: me.data?.user?.role === 'admin' });
  const lines = useQuery({ queryKey: ['admin', 'lines'], queryFn: () => api<{ lines: (Line & { owner: string })[] }>('/admin/lines'), enabled: tab === 'lines' && me.data?.user?.role === 'admin' });
  const charges = useQuery({ queryKey: ['admin', 'charges'], queryFn: () => api<{ charges: { id: string; title: string; amount: number; status: string; createdAt: number; name: string; number: string }[] }>('/admin/charges'), enabled: tab === 'charges' });
  const settings = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api<{ tariffs: Tariff[]; addons: Addon[] }>('/admin/settings'), enabled: tab === 'tariffs' });
  const [draft, setDraft] = useState<Tariff[] | null>(null);
  useEffect(() => {
    if (settings.data) setDraft(settings.data.tariffs);
  }, [settings.data]);
  const block = useMutation({
    mutationFn: (v: { id: string; block: boolean }) => api(`/admin/lines/${v.id}/block`, { body: { block: v.block } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin'] }),
    onError: (e) => toast(errorText(e), 'bad'),
  });
  const save = useMutation({
    mutationFn: () => api('/admin/settings', { method: 'PUT', body: { tariffs: draft, addons: settings.data!.addons } }),
    onSuccess: () => {
      toast('Тарифы сохранены');
      void qc.invalidateQueries({ queryKey: ['tariffs'] });
    },
    onError: (e) => toast(errorText(e), 'bad'),
  });
  if (me.data && me.data.user?.role !== 'admin') return <Navigate to="/" replace />;
  const o = ov.data;
  const tile = (label: string, v: string | number) => (
    <div className="rounded-2xl bg-sunken p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-[20px] font-bold num">{v}</p>
    </div>
  );
  const num = (t: Tariff, k: 'price' | 'minutes' | 'gb' | 'sms') => (
    <label className="flex flex-col text-xs text-muted">
      {{ price: 'Цена, ₽', minutes: 'Минуты', gb: 'ГБ', sms: 'SMS' }[k]}
      <input type="number" value={t[k]} onChange={(e) => setDraft((d) => d!.map((x) => (x.id === t.id ? { ...x, [k]: Number(e.target.value) } : x)))} className="mt-1 h-10 rounded-xl bg-surface px-2 text-[15px] text-fg ring-1 ring-line" />
    </label>
  );
  return (
    <Shell title="Админка" back="/profile">
      {o && (
        <div className="grid grid-cols-3 gap-2">
          {tile('Абонентов', o.users)}
          {tile('Активных', o.active)}
          {tile('В блоке', o.blocked)}
          {tile('Выручка 30 дн.', rub(o.revenueMonth))}
          {tile('Звонков за сутки', o.callsDay)}
          {tile('SMS за сутки', o.smsDay)}
        </div>
      )}
      <div className="mt-4 grid grid-cols-3 gap-1 rounded-2xl bg-sunken p-1">
        {([['lines', 'Номера'], ['charges', 'Списания'], ['tariffs', 'Тарифы']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={cx('h-10 rounded-xl text-sm font-semibold', tab === k ? 'bg-surface shadow-sm' : 'text-muted')}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'lines' &&
        (lines.isLoading ? (
          <Loading />
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {lines.data?.lines.map((l) => (
              <div key={l.id} className="flex items-center gap-3 rounded-2xl bg-sunken p-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold num">{l.formatted}</span>
                  <span className="block truncate text-sm text-muted">
                    {l.owner} · «{l.tariff.title}» · {l.status === 'active' ? 'активен' : l.status === 'blocked' ? `блок (${l.blockReason})` : 'закрыт'}
                  </span>
                </span>
                {(l.status === 'active' || l.status === 'blocked') && (
                  <Button size="sm" variant={l.status === 'active' ? 'danger' : 'ink'} onClick={() => block.mutate({ id: l.id, block: l.status === 'active' })}>
                    {l.status === 'active' ? 'Блок' : 'Разблок.'}
                  </Button>
                )}
              </div>
            ))}
          </div>
        ))}
      {tab === 'charges' && (
        <div className="mt-3 flex flex-col">
          {charges.data?.charges.map((c) => (
            <div key={c.id} className="flex items-center gap-3 border-b border-line py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{c.title}</span>
                <span className="block truncate text-xs text-muted">
                  {dayTime(c.createdAt)} · {c.name} · {c.status}
                </span>
              </span>
              <span className="font-semibold num">{rub(c.amount)}</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'tariffs' && draft && (
        <div className="mt-3 flex flex-col gap-2">
          {draft.map((t) => (
            <div key={t.id} className="rounded-2xl bg-sunken p-3">
              <input value={t.title} onChange={(e) => setDraft((d) => d!.map((x) => (x.id === t.id ? { ...x, title: e.target.value } : x)))} className="h-10 w-full rounded-xl bg-surface px-3 text-[16px] font-semibold ring-1 ring-line" />
              <div className="mt-2 grid grid-cols-4 gap-2">
                {num(t, 'price')}
                {num(t, 'minutes')}
                {num(t, 'gb')}
                {num(t, 'sms')}
              </div>
            </div>
          ))}
          <p className="text-xs text-muted">−1 — без лимита. Новые цены и пакеты действуют со следующего списания.</p>
          <Button variant="brand" size="lg" loading={save.isPending} onClick={() => save.mutate()}>
            Сохранить
          </Button>
        </div>
      )}
    </Shell>
  );
}
