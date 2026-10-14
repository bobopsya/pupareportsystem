import mark from '../assets/brand/mark.svg';
import { cx } from './ui';

export function LogoMark({ className }: { className?: string }) {
  return <img src={mark} alt="" aria-hidden="true" className={cx('size-9 shrink-0', className)} draggable={false} />;
}

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-2.5', className)}>
      <LogoMark className={compact ? 'size-8' : 'size-9'} />
      <span className={cx('font-extrabold tracking-tight', compact ? 'text-lg' : 'text-xl')}>Bobobank</span>
    </span>
  );
}
