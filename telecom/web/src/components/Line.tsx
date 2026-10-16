import { useMutation, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { data, rub } from '../lib/format';
import { useTariffs } from '../lib/hooks';
import type { Line, Tariff } from '../lib/types';
import { Button, cx, Modal, useToast } from './ui';

export const INF = '∞';
export const quotaText = (t: Pick<Tariff, 'minutes' | 'gb' | 'sms'>) =>
  [t.minutes < 0 ? 'безлимит минут' : `${t.minutes} мин`, t.gb < 0 ? 'безлимит ГБ' : `${t.gb} ГБ`, t.sms < 0 ? 'безлимит SMS' : `${t.sms} SMS`].join(' · ');

/** A ring with what is left of a quota. */
export function Ring({ label, left, total, unit }: { label: string; left: number; total: number; unit: 'min' | 'mb' | 'sms' }) {
  const unlimited = left < 0 || total < 0;
  const share = unlimited ? 1 : total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
  const R = 34;
  const C = 2 * Math.PI * R;
  const value = unlimited ? INF : unit === 'mb' ? data(left) : String(left);
  return (
    <div className="flex flex-col items-center">
      <div className="relative size-[88px]">
        <svg viewBox="0 0 80 80" className="size-full -rotate-90">
          <circle cx="40" cy="40" r={R} fill="none" strokeWidth="7" className="stroke-sunken" />
          <circle cx="40" cy="40" r={R} fill="none" strokeWidth="7" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - share)} className={cx(share < 0.15 && !unlimited ? 'stroke-bad' : 'stroke-brand', 'transition-[stroke-dashoffset] duration-500')} />
        </svg>
        <span className={cx('absolute inset-0 flex items-center justify-center font-bold num', unlimited ? 'text-[26px]' : value.length > 5 ? 'text-[14px]' : 'text-[18px]')}>{value}</span>
      </div>
      <span className="mt-1 text-[13px] font-medium text-muted">{label}</span>
      {!unlimited && <span className="text-[11px] text-faint">из {unit === 'mb' ? data(total) : total}</span>}
    </div>
  );
}

export function EsimModal({ line, open, onClose }: { line: Line; open: boolean; onClose: () => void }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (open) void QRCode.toDataURL(line.esim, { margin: 1, width: 360, color: { dark: '#1b1450', light: '#ffffff' } }).then(setSrc);
  }, [open, line.esim]);
  return (
    <Modal open={open} onClose={onClose} title="eSIM">
      <div className="flex flex-col items-center text-center">
        {src ? <img src={src} alt="QR-код eSIM" className="size-56 rounded-2xl bg-white p-2 ring-1 ring-line" /> : <div className="size-56 animate-pulse rounded-2xl bg-sunken" />}
        <p className="mt-3 text-[15px] font-semibold num">{line.formatted}</p>
        <p className="mt-1 text-sm text-muted">Игровая eSIM: QR-код для коллекции, в настоящий телефон он не установится.</p>
        <code className="mt-3 w-full break-all rounded-xl bg-sunken px-3 py-2 text-xs text-muted">{line.esim}</code>
      </div>
    </Modal>
  );
}

export function AddonsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: d } = useTariffs();
  const qc = useQueryClient();
  const toast = useToast();
  const buy = useMutation({
    mutationFn: (id: string) => api<Line>('/line/addons', { body: { id } }),
    onSuccess: (_l, id) => {
      toast(`Пакет «${d?.addons.find((a) => a.id === id)?.title}» подключён`);
      void qc.invalidateQueries({ queryKey: ['line'] });
      void qc.invalidateQueries({ queryKey: ['account'] });
      onClose();
    },
    onError: (e) => toast(errorText(e), 'bad'),
  });
  return (
    <Modal open={open} onClose={onClose} title="Доп. пакеты">
      <div className="flex flex-col gap-2">
        {d?.addons.map((a) => (
          <div key={a.id} className="flex items-center gap-3 rounded-2xl bg-sunken p-3">
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-semibold">{a.title}</p>
              <p className="text-sm text-muted">{a.roamingDays ? 'Звонки и интернет в поездке' : 'До конца текущего периода'}</p>
            </div>
            <Button size="sm" variant="brand" loading={buy.isPending && buy.variables === a.id} onClick={() => buy.mutate(a.id)}>
              {rub(a.price * 100)}
            </Button>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">Деньги спишутся со счёта Bobobank сразу.</p>
    </Modal>
  );
}
