import { cx } from './ui';

/** GPAY mark: a flat ink tile with a "go" chevron and a settled dot. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cx('shrink-0 text-ink', className)} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path d="M11 9.5 18.5 16 11 22.5" fill="none" stroke="var(--color-on-ink)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="22.2" cy="16" r="2.2" fill="var(--color-brand)" />
    </svg>
  );
}

export function Logo({ className, size = 'md', suffix }: { className?: string; size?: 'sm' | 'md' | 'lg'; suffix?: string }) {
  const s = size === 'sm' ? 'size-6' : size === 'lg' ? 'size-9' : 'size-8';
  const t = size === 'sm' ? 'text-base' : size === 'lg' ? 'text-[26px]' : 'text-xl';
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      <LogoMark className={s} />
      <span className={cx('font-bold tracking-[-0.03em] leading-none', t)}>GPAY</span>
      {suffix && <span className={cx('font-medium text-muted leading-none', t)}>{suffix}</span>}
    </span>
  );
}
