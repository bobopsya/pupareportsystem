import mastercard from '../assets/logos/mastercard.svg';
import mir from '../assets/logos/mir.svg';
import sbpChip from '../assets/logos/sbp-chip.svg';
import sbpMark from '../assets/logos/sbp-mark.svg';
import unionpay from '../assets/logos/unionpay.svg';
import visa from '../assets/logos/visa.svg';
import type { Network } from '../lib/types';
import { cx } from './ui';

const SRC: Record<Network, { src: string; alt: string; fit: string }> = {
  visa: { src: visa, alt: 'Visa', fit: 'h-[180%] -my-[40%]' },
  mastercard: { src: mastercard, alt: 'Mastercard', fit: 'h-[95%]' },
  mir: { src: mir, alt: 'МИР', fit: 'h-[62%]' },
  unionpay: { src: unionpay, alt: 'UnionPay', fit: 'h-[88%]' },
};

/** A payment system mark on a white chip. */
export function NetworkLogo({ network, className }: { network: Network; className?: string }) {
  const l = SRC[network];
  return (
    <span className={cx('pay-logo inline-flex items-center justify-center overflow-hidden rounded-[5px] h-6 w-[38px] shrink-0', className)} title={l.alt}>
      <img src={l.src} alt={l.alt} className={cx('w-auto max-w-[86%] object-contain', l.fit)} draggable={false} />
    </span>
  );
}

export function SbpLogo({ className }: { className?: string }) {
  return (
    <span className={cx('pay-logo inline-flex items-center justify-center overflow-hidden rounded-[5px] h-6 w-[38px] shrink-0', className)} title="СБП">
      <img src={sbpChip} alt="СБП" className="h-[78%] w-auto" draggable={false} />
    </span>
  );
}

export function SbpMark({ className }: { className?: string }) {
  return <img src={sbpMark} alt="" aria-hidden="true" className={cx('object-contain', className)} draggable={false} />;
}
