import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Delete, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing } from 'lucide-react';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Avatar, Shell } from '../components/Shell';
import { cx, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { clock, dayLabel, phoneDigits, talk, typePhone } from '../lib/format';
import { useLine, useMe } from '../lib/hooks';
import type { Call } from '../lib/types';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '0', '⌫'];

export default function Calls() {
  const me = useMe();
  const line = useLine(!!me.data?.user);
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState('');
  const recent = useQuery({ queryKey: ['calls'], queryFn: () => api<{ calls: Call[] }>('/calls'), enabled: !!line.data?.line, refetchInterval: 5000 });
  const call = useMutation({
    mutationFn: (to: string) => api<Call>('/calls', { body: { to } }),
    onSuccess: (c) => {
      qc.setQueryData(['line'], (old: object | undefined) => (old ? { ...old, call: c } : old));
      void qc.invalidateQueries({ queryKey: ['calls'] });
    },
    onError: (e) => toast(errorText(e), 'bad'),
  });
  if (me.data && !me.data.user) return <Navigate to="/" replace />;
  const press = (k: string) => setV((s) => (k === '⌫' ? typePhone(phoneDigits(s).slice(0, -1)) : k === '+' ? s : typePhone(s + k)));
  const ok = phoneDigits(v).length === 11;
  const minutes = line.data?.line?.left.minutes;

  return (
    <Shell title="Звонки">
      <div className="rounded-3xl bg-surface p-4 ring-1 ring-line">
        <div className="flex h-12 items-center justify-center gap-2">
          <input value={v} onChange={(e) => setV(typePhone(e.target.value))} inputMode="tel" placeholder="Номер абонента" aria-label="Номер" className="h-full min-w-0 flex-1 bg-transparent text-center text-[26px] font-semibold tracking-tight outline-none placeholder:text-[18px] placeholder:font-normal num" />
        </div>
        <div className="mx-auto mt-2 grid max-w-[280px] grid-cols-3 gap-2">
          {KEYS.map((k) => (
            <button key={k} type="button" aria-label={k === '⌫' ? 'Стереть' : k} onClick={() => press(k)} className={cx('flex h-14 items-center justify-center rounded-full text-[24px] font-medium', k === '+' ? 'invisible' : 'bg-sunken hover:bg-hover')}>
              {k === '⌫' ? <Delete className="size-6 text-muted" /> : k}
            </button>
          ))}
        </div>
        <button type="button" disabled={!ok || call.isPending} onClick={() => call.mutate(v)} aria-label="Позвонить" className="mx-auto mt-3 flex size-16 items-center justify-center rounded-full bg-[#22c55e] text-white disabled:opacity-40">
          <Phone className="size-7" />
        </button>
        <p className="mt-2 text-center text-xs text-muted">{minutes === undefined ? '' : minutes < 0 ? 'Минуты без лимита' : `Осталось ${minutes} мин · входящие бесплатно`}</p>
      </div>

      <h2 className="mb-1 mt-6 px-1 text-[13px] font-semibold uppercase tracking-wide text-muted">Недавние</h2>
      {!recent.data?.calls.length ? (
        <p className="py-8 text-center text-muted">Звонков пока не было</p>
      ) : (
        <div className="-mx-2 flex flex-col">
          {recent.data.calls.map((c) => {
            const missed = c.direction === 'in' && (c.status === 'missed' || c.status === 'declined');
            const Icon = missed ? PhoneMissed : c.direction === 'in' ? PhoneIncoming : PhoneOutgoing;
            return (
              <button key={c.id} type="button" onClick={() => call.mutate(c.number)} className="flex items-center gap-3 rounded-2xl px-2 py-2.5 text-left hover:bg-sunken">
                <Avatar name={c.name} />
                <span className="min-w-0 flex-1">
                  <span className={cx('block truncate text-[16px] font-semibold', missed && 'text-bad')}>{c.name ?? c.formatted}</span>
                  <span className="flex items-center gap-1 text-sm text-muted">
                    <Icon className="size-3.5" />
                    {c.status === 'ended' && c.seconds ? talk(c.seconds) : c.status === 'busy' ? 'Занято' : c.status === 'declined' ? 'Отклонён' : c.status === 'missed' ? (c.direction === 'in' ? 'Пропущенный' : 'Нет ответа') : c.status === 'ended' ? 'Отменён' : 'Идёт'}
                    {c.billedMin > 0 && ` · −${c.billedMin} мин`}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted">{dayLabel(c.createdAt) === 'Сегодня' ? clock(c.createdAt) : dayLabel(c.createdAt)}</span>
              </button>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
