import { Lock, Nfc, Snowflake } from 'lucide-react';
import mark from '../assets/brand/mark.svg';
import type { Card } from '../lib/types';
import { NetworkLogo } from './PaymentLogos';
import { cx } from './ui';

/** Flat single-colour card faces, like card art in banking apps. */
export const DESIGN_STYLE: Record<string, { bg: string; fg: string; border?: string; title: string }> = {
  green: { bg: '#21A038', fg: '#ffffff', title: 'Зелёная' },
  black: { bg: '#1C1C1E', fg: '#ffffff', border: 'rgb(255 255 255 / 0.14)', title: 'Чёрная' },
  white: { bg: '#ffffff', fg: '#1F1F22', border: '#E2E3E7', title: 'Белая' },
  silver: { bg: '#C9CDD3', fg: '#1F1F22', title: 'Серебряная' },
  prime: { bg: '#2B2A28', fg: '#E7C987', title: 'Prime' },
  kids: { bg: '#3D8BFD', fg: '#ffffff', title: 'Детская' },
};

/** Card art saved before the flat redesign maps onto the new set. */
const LEGACY: Record<string, string> = { night: 'black', graphite: 'black', sunset: 'black', emerald: 'green', aurora: 'green', gold: 'prime' };
export const designOf = (d: string) => DESIGN_STYLE[LEGACY[d] ?? d] ?? DESIGN_STYLE.green;
export const DESIGN_BG: Record<string, string> = Object.fromEntries(Object.entries(DESIGN_STYLE).map(([k, v]) => [k, v.bg]));

type CardFace = Pick<Card, 'design' | 'network' | 'last4' | 'exp' | 'holder' | 'form' | 'status' | 'kind' | 'tariff'>;

/** Small card icon for lists ("Кошелёк", history, pickers). */
export function MiniCard({ card, className }: { card: Pick<Card, 'design' | 'last4' | 'status'>; className?: string }) {
  const d = designOf(card.design);
  const off = card.status === 'frozen' || card.status === 'blocked' || card.status === 'closed';
  return (
    <span className={cx('relative inline-flex h-7 w-11 shrink-0 items-end justify-end overflow-hidden rounded-[5px] px-1 pb-0.5', className)} style={{ background: d.bg, color: d.fg, boxShadow: d.border ? `inset 0 0 0 1px ${d.border}` : undefined }}>
      <span className="text-[9px] font-semibold leading-none tabular-nums">{card.last4}</span>
      {off && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white">
          {card.status === 'frozen' ? <Snowflake className="size-3.5" /> : <Lock className="size-3.5" />}
        </span>
      )}
    </span>
  );
}

/** The card as a physical object: flat colour, chip, masked number, payment system. */
export function BankCard({ card, size = 'md', className, onClick, number, cvc }: {
  card: CardFace;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  onClick?: () => void;
  number?: string;
  cvc?: string;
}) {
  if (size === 'sm') return <MiniCard card={card} className={className} />;
  const d = designOf(card.design);
  const off = card.status === 'frozen' || card.status === 'blocked' || card.status === 'closed';
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cx('relative block aspect-[1.586] overflow-hidden rounded-2xl text-left select-none', size === 'lg' ? 'w-full max-w-[360px]' : 'w-[240px] sm:w-[264px] shrink-0', className)}
      style={{ background: d.bg, color: d.fg, boxShadow: d.border ? `inset 0 0 0 1px ${d.border}` : undefined }}
    >
      <div className="relative flex h-full flex-col justify-between p-[7%]">
        <div className="flex items-start justify-between">
          <span className="inline-flex items-center gap-1.5">
            <img src={mark} alt="" className="size-5 rounded-[5px]" draggable={false} />
            <span className="text-[14px] font-semibold tracking-tight">Bobobank</span>
          </span>
          <span className="text-[11px] font-medium opacity-70">
            {card.tariff === 'prime' ? 'Prime' : card.kind === 'credit' ? 'Кредитная' : card.tariff === 'kids' ? 'Детская' : card.form === 'virtual' ? 'Цифровая' : 'Дебетовая'}
          </span>
        </div>
        {card.form === 'plastic' && !number && (
          <div className="flex items-center gap-2">
            <span className="h-[22%] aspect-[1.3] min-h-6 rounded-[5px]" style={{ background: card.design === 'prime' ? '#C8A660' : '#D9C38A' }} />
            <Nfc className="size-4 opacity-60" />
          </div>
        )}
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <div className={cx('font-medium tabular-nums tracking-[0.06em]', number ? 'text-[17px]' : 'text-[15px]')}>{number ? number.replace(/(\d{4})(?=\d)/g, '$1 ') : `•• ${card.last4}`}</div>
            <div className="mt-0.5 flex gap-3 text-[11px] font-medium uppercase tracking-[0.04em] opacity-70">
              <span className="truncate">{card.holder}</span>
              <span className="tabular-nums">{card.exp}</span>
              {cvc && <span className="tabular-nums">CVC {cvc}</span>}
            </div>
          </div>
          <NetworkLogo network={card.network} className="h-7 w-11" />
        </div>
      </div>
      {off && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/45">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-[13px] font-medium text-white">
            {card.status === 'frozen' ? <Snowflake className="size-4" /> : <Lock className="size-4" />}
            {card.status === 'frozen' ? 'Заморожена' : card.status === 'blocked' ? 'Заблокирована' : 'Закрыта'}
          </span>
        </div>
      )}
    </Tag>
  );
}
