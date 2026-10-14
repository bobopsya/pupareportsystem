import { Lock, Nfc, Snowflake } from 'lucide-react';
import mark from '../assets/brand/mark.svg';
import type { Card } from '../lib/types';
import { NetworkLogo } from './PaymentLogos';
import { cx } from './ui';

export const DESIGN_BG: Record<string, string> = {
  green: 'linear-gradient(135deg, #22c977 0%, #0d9b5c 48%, #06704a 100%)',
  emerald: 'linear-gradient(140deg, #14b8a6 0%, #0f766e 55%, #064e3b 100%)',
  night: 'linear-gradient(135deg, #2d3a35 0%, #151c19 60%, #0a0e0c 100%)',
  aurora: 'linear-gradient(125deg, #10b981 0%, #0ea5e9 52%, #7c3aed 100%)',
  sunset: 'linear-gradient(130deg, #fb923c 0%, #f43f5e 55%, #be185d 100%)',
  graphite: 'linear-gradient(135deg, #71717a 0%, #3f3f46 50%, #18181b 100%)',
  gold: 'linear-gradient(135deg, #f3d78a 0%, #c9a24b 45%, #7d5a17 100%)',
  kids: 'linear-gradient(135deg, #818cf8 0%, #6366f1 45%, #06b6d4 100%)',
};

/** The card as a physical object: gradient, chip, contactless mark, masked number, payment system. */
export function BankCard({ card, size = 'md', className, onClick, number, cvc }: {
  card: Pick<Card, 'design' | 'network' | 'last4' | 'exp' | 'holder' | 'form' | 'status' | 'kind' | 'tariff'>;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  onClick?: () => void;
  /** Full number when the customer revealed the details. */
  number?: string;
  cvc?: string;
}) {
  const dark = card.design === 'gold';
  const fg = dark ? 'text-[#2a1d05]' : 'text-white';
  const off = card.status === 'frozen' || card.status === 'blocked' || card.status === 'closed';
  if (size === 'sm') {
    return (
      <span className={cx('relative inline-flex h-8 w-12 shrink-0 flex-col justify-between overflow-hidden rounded-md p-1', className)} style={{ background: DESIGN_BG[card.design] ?? DESIGN_BG.green }}>
        <span className={cx('text-[8px] leading-none font-bold num', fg)}>{card.last4}</span>
        <span className="self-end scale-[0.55] origin-bottom-right -mb-0.5 -mr-1"><NetworkLogo network={card.network} /></span>
        {off && <span className="absolute inset-0 bg-white/40 dark:bg-black/40" />}
      </span>
    );
  }
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cx(
        'relative block aspect-[1.586] overflow-hidden rounded-[20px] text-left shadow-[0_18px_40px_-18px_rgb(6_60_38/0.55)] select-none',
        size === 'lg' ? 'w-full max-w-[380px]' : 'w-[260px] sm:w-[280px] shrink-0',
        fg,
        className,
      )}
      style={{ background: DESIGN_BG[card.design] ?? DESIGN_BG.green }}
    >
      {/* Brand pattern: the "bo" rings, oversized and translucent. */}
      <svg className="pointer-events-none absolute -right-10 -bottom-16 h-[115%] opacity-[0.16]" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="30" cy="38" r="9.5" fill="none" stroke="currentColor" strokeWidth="7" />
        <circle cx="44" cy="38" r="9.5" fill="none" stroke="currentColor" strokeWidth="7" />
      </svg>
      {card.design === 'kids' && <span className="pointer-events-none absolute inset-0 opacity-30 [background:radial-gradient(circle_at_20%_30%,#fff_1px,transparent_1.5px),radial-gradient(circle_at_70%_60%,#fff_1px,transparent_1.5px),radial-gradient(circle_at_45%_80%,#fff_1.2px,transparent_1.8px)] [background-size:60px_60px,80px_80px,70px_70px]" />}
      <div className="relative flex h-full flex-col justify-between p-[7%]">
        <div className="flex items-start justify-between">
          <span className="inline-flex items-center gap-1.5">
            <img src={mark} alt="" className={cx('size-6 rounded-md', !dark && 'ring-1 ring-white/30')} draggable={false} />
            <span className="text-[15px] font-extrabold tracking-tight">Bobobank</span>
            {card.tariff === 'prime' && <span className="text-[11px] font-bold uppercase tracking-wider opacity-80">Prime</span>}
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wider opacity-80">{card.kind === 'credit' ? 'Кредитная' : card.form === 'virtual' ? 'Виртуальная' : card.tariff === 'kids' ? 'Детская' : 'Дебетовая'}</span>
        </div>
        {card.form === 'plastic' && !number && (
          <div className="flex items-center gap-2">
            <span className="h-7 w-9 rounded-md bg-gradient-to-br from-[#f6e7a8] via-[#d8b45a] to-[#a8842f] shadow-inner" />
            <Nfc className="size-5 opacity-80" />
          </div>
        )}
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <div className={cx('font-semibold num tracking-wide', number ? 'text-[17px] sm:text-lg' : 'text-[15px]')}>{number ? number.replace(/(\d{4})(?=\d)/g, '$1 ') : `•• ${card.last4}`}</div>
            <div className="mt-0.5 flex gap-3 text-[11px] font-medium uppercase tracking-wider opacity-80">
              <span className="truncate">{card.holder}</span>
              <span className="num">{card.exp}</span>
              {cvc && <span className="num">CVC {cvc}</span>}
            </div>
          </div>
          <NetworkLogo network={card.network} className="h-7 w-11 shadow-sm" />
        </div>
      </div>
      {off && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/35 backdrop-blur-[3px] dark:bg-black/35">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-[13px] font-semibold text-white">
            {card.status === 'frozen' ? <Snowflake className="size-4" /> : <Lock className="size-4" />}
            {card.status === 'frozen' ? 'Заморожена' : card.status === 'blocked' ? 'Заблокирована' : 'Закрыта'}
          </span>
        </div>
      )}
    </Tag>
  );
}
