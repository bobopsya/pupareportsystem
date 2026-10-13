import bitcoin from '../assets/logos/bitcoin.svg';
import mastercard from '../assets/logos/mastercard.svg';
import mir from '../assets/logos/mir.svg';
import sbpChip from '../assets/logos/sbp-chip.svg';
import sbpMark from '../assets/logos/sbp-mark.svg';
import tether from '../assets/logos/tether.svg';
import unionpay from '../assets/logos/unionpay.svg';
import visa from '../assets/logos/visa.svg';
import { cx } from './ui';

export type LogoName = 'visa' | 'mastercard' | 'mir' | 'unionpay' | 'sbp' | 'bitcoin' | 'tether';

const SRC: Partial<Record<LogoName, { src: string; alt: string; fit: string }>> = {
  visa: { src: visa, alt: 'Visa', fit: 'h-[180%] -my-[40%]' },
  mastercard: { src: mastercard, alt: 'Mastercard', fit: 'h-[95%]' },
  mir: { src: mir, alt: 'МИР', fit: 'h-[62%]' },
  unionpay: { src: unionpay, alt: 'UnionPay', fit: 'h-[88%]' },
  bitcoin: { src: bitcoin, alt: 'Bitcoin', fit: 'h-[80%]' },
  tether: { src: tether, alt: 'USDT', fit: 'h-[80%]' },
};

/** A brand mark on a white "card" chip, like the badges under real checkout forms. */
export function PayLogo({ name, className }: { name: LogoName; className?: string }) {
  const base = cx('pay-logo inline-flex items-center justify-center overflow-hidden rounded-[5px] border border-[#e5e7ef] h-6 w-[38px] shrink-0', className);
  if (name === 'sbp') return <SbpLogo className={base} />;
  const l = SRC[name]!;
  return (
    <span className={base} title={l.alt}>
      <img src={l.src} alt={l.alt} className={cx('w-auto max-w-[86%] object-contain', l.fit)} draggable={false} />
    </span>
  );
}

export function SbpLogo({ className }: { className?: string }) {
  return (
    <span className={className} title="СБП">
      <img src={sbpChip} alt="СБП" className="h-[78%] w-auto" draggable={false} />
    </span>
  );
}

/** The multicolour SBP sign without the wordmark, for tabs and icons. */
export function SbpMark({ className }: { className?: string }) {
  return <img src={sbpMark} alt="" aria-hidden="true" className={cx('object-contain', className)} draggable={false} />;
}

export function CardLogos({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex flex-wrap gap-1.5', className)}>
      <PayLogo name="mir" />
      <PayLogo name="visa" />
      <PayLogo name="mastercard" />
      <PayLogo name="unionpay" />
    </span>
  );
}
