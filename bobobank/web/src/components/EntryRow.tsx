import { useNavigate } from 'react-router-dom';
import { money, timeOnly } from '../lib/format';
import type { Entry } from '../lib/types';
import { CategoryIcon, Initials } from './CategoryIcon';
import { cx } from './ui';

const PERSON_KINDS = new Set(['transfer']);

export function EntryRow({ e, showTime = true }: { e: Entry; showTime?: boolean }) {
  const nav = useNavigate();
  const income = e.amount > 0;
  const person = PERSON_KINDS.has(e.kind) && /^[А-ЯЁA-Z][а-яёa-z]+ [А-ЯЁA-Z]\.$/.test(e.title);
  return (
    <button type="button" onClick={() => nav(`/app/history/${e.id}`)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-sunken/70">
      {person ? <Initials name={e.title} /> : <CategoryIcon category={e.category} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px]">{e.title}</span>
        <span className="block truncate text-[13px] text-muted">{e.subtitle || e.categoryTitle}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className={cx('block text-[15px] font-medium num', income && 'text-ok')}>{money(e.amount, e.currency, { sign: true, exact: e.amount % 100 !== 0 })}</span>
        {showTime && <span className="block text-xs text-faint num">{timeOnly(e.createdAt)}</span>}
      </span>
    </button>
  );
}

export function PendingRow({ p }: { p: { id: string; amount: number; currency: string; title: string; subtitle: string; category: string } }) {
  return (
    <div className="flex w-full items-center gap-3 px-4 py-3 opacity-80">
      <CategoryIcon category={p.category} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px]">{p.title}</span>
        <span className="block truncate text-[13px] text-warn">{p.subtitle}</span>
      </span>
      <span className="shrink-0 text-[15px] font-semibold num text-muted">{money(p.amount, p.currency, { exact: p.amount % 100 !== 0 })}</span>
    </div>
  );
}
