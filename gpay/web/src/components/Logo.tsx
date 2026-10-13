import { useId } from 'react';
import { cx } from './ui';

/** GPAY mark: a rounded violet tile with a "go" chevron and a settled dot. */
export function LogoMark({ className }: { className?: string }) {
  // Unique gradient id: a hidden copy of the logo elsewhere on the page would otherwise break the reference.
  const gid = `gpay-g-${useId().replace(/:/g, '')}`;
  return (
    <svg viewBox="0 0 32 32" className={cx('shrink-0', className)} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7a5cff" />
          <stop offset="1" stopColor="#4326e0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${gid})`} />
      <path d="M11 9.5 18.5 16 11 22.5" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="22" cy="16" r="2.2" fill="#fff" />
    </svg>
  );
}

export function Logo({ className, size = 'md', suffix }: { className?: string; size?: 'sm' | 'md' | 'lg'; suffix?: string }) {
  const s = size === 'sm' ? 'size-6' : size === 'lg' ? 'size-9' : 'size-7';
  const t = size === 'sm' ? 'text-[15px]' : size === 'lg' ? 'text-2xl' : 'text-lg';
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      <LogoMark className={s} />
      <span className={cx('font-bold tracking-[-0.04em] leading-none', t)}>GPAY</span>
      {suffix && <span className={cx('font-medium text-muted leading-none', t)}>{suffix}</span>}
    </span>
  );
}
