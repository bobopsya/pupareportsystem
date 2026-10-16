import { cx } from './ui';

/** Own mark: a violet tile, a white «Б» and two signal arcs. Not related to any real operator. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cx('shrink-0', className ?? 'size-9')} aria-hidden="true">
      <rect width="48" height="48" rx="13" fill="#5B4BFF" />
      <path d="M13 12 H28 V16.5 H18 V21 H23.5 Q31 21 31 28 Q31 35 23.5 35 H13 Z M18 25.5 V30.5 H23 Q26 30.5 26 28 Q26 25.5 23 25.5 Z" fill="#fff" />
      <path d="M33.5 10.5 Q38.5 14 38.5 20" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" opacity=".9" />
      <path d="M32.5 15 Q34.8 16.6 34.8 19.4" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" opacity=".6" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      <LogoMark className="size-8" />
      <span className="text-[17px] font-bold leading-none tracking-tight">Бобтелеком</span>
    </span>
  );
}
