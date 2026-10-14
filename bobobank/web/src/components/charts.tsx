import { useState, type ReactNode } from 'react';
import { cx } from './ui';

/** Ring chart of spending by category; the centre shows the hovered slice or the total. */
export function Donut({ items, total, center, size = 200 }: { items: { id: string; value: number; color: string; label: string }[]; total: number; center: (hover: number | null) => ReactNode; size?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const r = 42;
  const c = 2 * Math.PI * r;
  const gap = items.length > 1 ? 1.2 : 0;
  let offset = 0;
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-sunken)" strokeWidth="11" />
        {total > 0 &&
          items.map((it, i) => {
            const len = (it.value / total) * c;
            const el = (
              <circle
                key={it.id}
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke={it.color}
                strokeWidth={hover === i ? 13 : 11}
                strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
                className="transition-[stroke-width] cursor-pointer"
                opacity={hover !== null && hover !== i ? 0.35 : 1}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setHover(hover === i ? null : i)}
              />
            );
            offset += len;
            return el;
          })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-6">{center(hover)}</div>
    </div>
  );
}

/** Six months of spending as rounded bars, the current month highlighted. */
export function MonthBars({ data, format, active, onPick }: { data: { label: string; value: number; key: string }[]; format: (v: number) => string; active?: string; onPick?: (key: string) => void }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex h-40 items-end gap-2 sm:gap-3">
      {data.map((d) => {
        const on = d.key === active;
        return (
          <button key={d.key} type="button" onClick={() => onPick?.(d.key)} className="group flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <span className={cx('text-[11px] num truncate max-w-full', on ? 'text-fg font-bold' : 'text-faint')}>{d.value ? format(d.value) : ''}</span>
            <span className="flex h-24 w-full items-end">
              <span className={cx('w-full rounded-lg transition-colors', on ? 'bg-brand' : 'bg-sunken group-hover:bg-hover')} style={{ height: `${Math.max(4, (d.value / max) * 100)}%` }} />
            </span>
            <span className={cx('text-xs', on ? 'text-fg font-semibold' : 'text-muted')}>{d.label}</span>
          </button>
        );
      })}
    </div>
  );
}
