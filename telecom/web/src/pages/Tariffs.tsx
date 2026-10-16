import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { quotaText } from '../components/Line';
import { Shell } from '../components/Shell';
import { Button, cx, Loading, Modal, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { day, rub } from '../lib/format';
import { useLine, useMe, useTariffs } from '../lib/hooks';
import type { Line, Tariff } from '../lib/types';

export default function Tariffs() {
  const me = useMe();
  const line = useLine(!!me.data?.user);
  const { data } = useTariffs();
  const qc = useQueryClient();
  const toast = useToast();
  const [pick, setPick] = useState<Tariff | null>(null);
  const change = useMutation({
    mutationFn: (when: 'now' | 'next') => api<Line>('/line/tariff', { body: { tariff: pick!.id, when } }),
    onSuccess: (l, when) => {
      toast(when === 'now' ? `Тариф «${l.tariff.title}» подключён` : `Тариф «${pick!.title}» начнёт действовать ${day(l.periodEnd)}`);
      setPick(null);
      void qc.invalidateQueries({ queryKey: ['line'] });
    },
    onError: (e) => toast(errorText(e), 'bad'),
  });
  if (me.data && !me.data.user) return <Navigate to="/" replace />;
  const l = line.data?.line;
  if (!l || !data) return <Shell title="Тарифы" back="/"><Loading /></Shell>;
  return (
    <Shell title="Тарифы" back="/">
      <div className="flex flex-col gap-2">
        {data.tariffs.map((t) => {
          const current = t.id === l.tariff.id;
          const next = t.id === l.nextTariff?.id;
          return (
            <button key={t.id} type="button" onClick={() => setPick(t)} className={cx('rounded-3xl p-4 text-left ring-1', current ? 'bg-brand-soft ring-brand' : 'bg-surface ring-line hover:bg-sunken')}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex items-center gap-2 text-[19px] font-bold">
                  {t.title}
                  {current && <Check className="size-5 text-brand-text" />}
                </span>
                <span className="text-[19px] font-bold num">
                  {rub(t.price * 100)}
                  <span className="text-sm font-medium text-muted">/мес</span>
                </span>
              </div>
              <p className="mt-0.5 text-[15px] font-medium">{quotaText(t)}</p>
              <p className="mt-1 text-sm text-muted">{t.perks.join(' · ')}</p>
              {current && <p className="mt-2 text-sm font-semibold text-brand-text">Ваш тариф</p>}
              {next && <p className="mt-2 text-sm font-semibold text-brand-text">С {day(l.periodEnd)}</p>}
            </button>
          );
        })}
      </div>
      <Modal open={!!pick} onClose={() => setPick(null)} title={pick ? `Тариф «${pick.title}»` : ''}>
        {pick && (
          <>
            <p className="text-[15px]">{quotaText(pick)}</p>
            <div className="mt-4 flex flex-col gap-2">
              {!(pick.id === l.tariff.id && l.status === 'active') && (
                <Button variant="brand" size="lg" loading={change.isPending && change.variables === 'now'} onClick={() => change.mutate('now')}>
                  Перейти сейчас · {rub(pick.price * 100)}
                </Button>
              )}
              {pick.id !== l.tariff.id && pick.id !== l.nextTariff?.id && (
                <Button size="lg" loading={change.isPending && change.variables === 'next'} onClick={() => change.mutate('next')}>
                  С {day(l.periodEnd)} — без доплаты сейчас
                </Button>
              )}
              {pick.id === l.tariff.id && l.nextTariff && (
                <Button size="lg" loading={change.isPending} onClick={() => change.mutate('next')}>
                  Остаться на этом тарифе
                </Button>
              )}
            </div>
            <p className="mt-3 text-xs text-muted">«Сейчас» — новый период начнётся сегодня, пакеты обновятся, деньги спишутся со счёта Bobobank. Иначе тариф сменится при следующем списании.</p>
          </>
        )}
      </Modal>
    </Shell>
  );
}
