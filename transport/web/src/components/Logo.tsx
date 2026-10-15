import { cx } from './ui';

/** Own mark: a yellow tile with a black road arrow. Not related to any real taxi brand. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cx('shrink-0', className ?? 'size-9')} aria-hidden="true">
      <rect width="48" height="48" rx="13" fill="#FFD600" />
      <path d="M14 34 L24 11 L34 34 L24 28.5 Z" fill="#141414" />
      <circle cx="24" cy="36.5" r="2.6" fill="#141414" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      <LogoMark className="size-8" />
      <span className="text-[17px] font-bold leading-none tracking-tight">
        Бобо<span className="text-muted">.</span>Транспорт
      </span>
    </span>
  );
}
