import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { cx } from './ui';

/** Sub-screen header: back arrow + title, like screens inside a banking app. */
export function Screen({ title, sub, back = -1, actions, children, className }: { title: ReactNode; sub?: ReactNode; back?: string | -1 | null; actions?: ReactNode; children: ReactNode; className?: string }) {
  const nav = useNavigate();
  return (
    <div className={cx('bb-fade', className)}>
      <div className="mb-5 flex items-center gap-2">
        {back !== null && (
          <button type="button" aria-label="Назад" onClick={() => (back === -1 ? (window.history.length > 1 ? nav(-1) : nav('/app')) : nav(back))} className="-ml-2 inline-flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-sunken">
            <ChevronLeft className="size-6" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[22px] sm:text-[26px] font-extrabold leading-tight">{title}</h1>
          {sub && <p className="text-sm text-muted truncate">{sub}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** A tappable row with icon, title, subtitle and an optional right part. */
export function Row({ icon, title, sub, right, onClick, className, danger }: { icon?: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode; onClick?: () => void; className?: string; danger?: boolean }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={cx('flex w-full items-center gap-3 px-4 py-3 text-left', onClick && 'hover:bg-sunken/70 transition-colors', className)}>
      {icon}
      <span className="min-w-0 flex-1">
        <span className={cx('block truncate text-[15px] font-semibold', danger && 'text-bad')}>{title}</span>
        {sub && <span className="block truncate text-[13px] text-muted">{sub}</span>}
      </span>
      {right}
    </Tag>
  );
}

/** Round icon tile for quick actions. */
export function ActionTile({ icon, label, onClick, badge }: { icon: ReactNode; label: string; onClick: () => void; badge?: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="group flex w-[76px] shrink-0 flex-col items-center gap-2 text-center">
      <span className="relative flex size-14 items-center justify-center rounded-[20px] bg-surface text-brand shadow-card transition-transform group-active:scale-95">
        {icon}
        {badge}
      </span>
      <span className="text-[12.5px] font-semibold leading-tight">{label}</span>
    </button>
  );
}
