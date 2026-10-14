import mark from '../assets/brand/gpay-mark.png';
import { cx } from './ui';

/** GPAY sign: the ribbon "G". */
export function LogoMark({ className }: { className?: string }) {
  return <img src={mark} alt="" aria-hidden="true" draggable={false} className={cx('shrink-0 object-contain', className)} />;
}

export function Logo({ className, size = 'md', suffix }: { className?: string; size?: 'sm' | 'md' | 'lg'; suffix?: string }) {
  const s = size === 'sm' ? 'size-6' : size === 'lg' ? 'size-10' : 'size-8';
  const t = size === 'sm' ? 'text-base' : size === 'lg' ? 'text-[26px]' : 'text-xl';
  return (
    <span className={cx('inline-flex items-center gap-2', className)} aria-label="GPAY">
      <LogoMark className={s} />
      <span className={cx('font-bold tracking-[-0.02em] leading-none', t)}>GPAY</span>
      {suffix && <span className={cx('font-medium text-muted leading-none', t)}>{suffix}</span>}
    </span>
  );
}
