import { Check, FileText } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './ui';

/** Final screen of a payment: green check, amount, details, receipt. */
export function Success({ title, amount, lines, entryId, onDone, extra, doneLabel = 'Готово' }: { title: string; amount: string; lines: [string, ReactNode][]; entryId?: number; onDone: () => void; extra?: ReactNode; doneLabel?: string }) {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center text-center bb-fade">
      <div className="flex size-20 items-center justify-center rounded-full bg-brand text-on-brand bb-pop">
        <svg viewBox="0 0 24 24" className="size-10" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" className="bb-draw" /></svg>
      </div>
      <h1 className="mt-5 text-[22px] font-semibold">{title}</h1>
      <div className="mt-1 text-[36px] font-semibold num">{amount}</div>
      <div className="mt-5 w-full max-w-sm rounded-2xl bg-surface p-4 text-left shadow-card">
        {lines.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 py-1.5 text-sm">
            <span className="text-muted">{k}</span>
            <span className="min-w-0 text-right font-semibold break-words">{v}</span>
          </div>
        ))}
      </div>
      {extra}
      <div className="mt-6 flex w-full max-w-sm flex-col gap-2">
        {entryId && <Button size="lg" icon={<FileText className="size-5" />} onClick={() => window.open(`/api/history/${entryId}/receipt.pdf`, '_blank')}>Чек по операции</Button>}
        <Button size="lg" variant="primary" icon={<Check className="size-5" />} onClick={onDone}>{doneLabel}</Button>
      </div>
    </div>
  );
}
