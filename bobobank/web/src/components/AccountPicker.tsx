import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { money } from '../lib/format';
import type { Account } from '../lib/types';
import { CategoryIcon } from './CategoryIcon';
import { Modal, cx } from './ui';

const cat = (a: Account) => (a.kind === 'savings' || a.kind === 'deposit' ? 'savings' : a.kind === 'credit_card' ? 'credit' : a.kind === 'business' ? 'services' : 'card');

/** Account selector styled like the "write-off from" field in banking apps. */
export function AccountPicker({ label, accounts, value, onChange, showAvailable = true }: { label: string; accounts: Account[]; value: string; onChange: (id: string) => void; showAvailable?: boolean }) {
  const [open, setOpen] = useState(false);
  const cur = accounts.find((a) => a.id === value);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-3 rounded-2xl bg-sunken px-4 py-3 text-left hover:bg-hover">
        {cur ? <CategoryIcon category={cat(cur)} size="sm" /> : null}
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-muted">{label}</span>
          <span className="block truncate font-semibold">{cur ? `${cur.name} •• ${cur.number.slice(-4)}` : 'Выберите счёт'}</span>
        </span>
        {cur && showAvailable && <span className="shrink-0 text-sm font-semibold num">{money(cur.available, cur.currency)}</span>}
        <ChevronDown className="size-4 shrink-0 text-muted" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={label} size="sm">
        <div className="-mx-2 flex flex-col">
          {accounts.map((a) => (
            <button key={a.id} type="button" onClick={() => (onChange(a.id), setOpen(false))} className={cx('flex items-center gap-3 rounded-2xl px-2 py-2.5 text-left hover:bg-sunken', a.id === value && 'bg-brand-soft')}>
              <CategoryIcon category={cat(a)} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{a.name}</span>
                <span className="block text-xs text-muted">•• {a.number.slice(-4)} · {a.currency}</span>
              </span>
              <span className="text-sm font-semibold num">{money(a.available, a.currency)}</span>
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}
