import {
  ArrowDownLeft, ArrowLeftRight, Banknote, Bus, Car, Coffee, CreditCard, Fuel, Gamepad2, Gift, GraduationCap, HeartPulse, Home, Landmark, Laptop, Percent, PiggyBank,
  Plane, Receipt, Scissors, Shirt, ShoppingBag, ShoppingCart, Sparkles, Ticket, Wifi, Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cx } from './ui';

export const CATEGORY_STYLE: Record<string, { icon: LucideIcon; color: string }> = {
  groceries: { icon: ShoppingCart, color: '#16a34a' },
  restaurants: { icon: Coffee, color: '#f97316' },
  transport: { icon: Bus, color: '#0ea5e9' },
  fuel: { icon: Fuel, color: '#64748b' },
  clothes: { icon: Shirt, color: '#a855f7' },
  electronics: { icon: Laptop, color: '#3b82f6' },
  entertainment: { icon: Ticket, color: '#ec4899' },
  games: { icon: Gamepad2, color: '#8b5cf6' },
  health: { icon: HeartPulse, color: '#ef4444' },
  beauty: { icon: Scissors, color: '#db2777' },
  home: { icon: Home, color: '#ca8a04' },
  travel: { icon: Plane, color: '#0891b2' },
  education: { icon: GraduationCap, color: '#4f46e5' },
  utilities: { icon: Wifi, color: '#0d9488' },
  services: { icon: Wrench, color: '#78716c' },
  shopping: { icon: ShoppingBag, color: '#e11d48' },
  transfers: { icon: ArrowLeftRight, color: '#0fa760' },
  income: { icon: ArrowDownLeft, color: '#0fa760' },
  cash: { icon: Banknote, color: '#65a30d' },
  fees: { icon: Receipt, color: '#71717a' },
  credit: { icon: Landmark, color: '#2563eb' },
  savings: { icon: PiggyBank, color: '#d97706' },
  fx: { icon: Percent, color: '#0f766e' },
  bonus: { icon: Gift, color: '#f59e0b' },
  other: { icon: Sparkles, color: '#94a3b8' },
  car: { icon: Car, color: '#475569' },
  card: { icon: CreditCard, color: '#0fa760' },
};

/** Round coloured icon, like operation avatars in banking apps. */
export function CategoryIcon({ category, className, size = 'md' }: { category: string; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const s = CATEGORY_STYLE[category] ?? CATEGORY_STYLE.other;
  const Icon = s.icon;
  return (
    <span
      className={cx('inline-flex shrink-0 items-center justify-center rounded-full text-white', size === 'sm' ? 'size-8' : size === 'lg' ? 'size-14' : 'size-11', className)}
      style={{ background: s.color }}
    >
      <Icon className={size === 'sm' ? 'size-4' : size === 'lg' ? 'size-6' : 'size-5'} strokeWidth={2.2} />
    </span>
  );
}

/** Merchant / person avatar with initials when there is no category icon. */
export function Initials({ name, className }: { name: string; className?: string }) {
  const parts = name.replace(/[«»"]/g, '').trim().split(/\s+/);
  const ini = ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span className={cx('inline-flex size-11 shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white', className)} style={{ background: `hsl(${h} 55% 48%)` }}>
      {ini || '•'}
    </span>
  );
}
