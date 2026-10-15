import { useQuery } from '@tanstack/react-query';
import { Building2, Check } from 'lucide-react';
import { api } from '../lib/api';
import { cx } from './ui';

export interface GosBusiness {
  id: number;
  number: string;
  name: string;
  org_type: 'ИП' | 'Компания';
  inn: string;
}

export interface GosInfo {
  enabled: boolean;
  url: string | null;
  linked: boolean;
  businesses: GosBusiness[];
}

/** The Бобуслуги emblem (the same as on their site). */
export function GosMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cx('shrink-0', className)} aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#0b5bd3" />
      <circle cx="32" cy="32" r="18" fill="#fff" />
      <path d="M24 22h10a6 6 0 0 1 0 12H24zm0 12h12a6 6 0 0 1 0 12H24z" fill="#0b5bd3" />
    </svg>
  );
}

export const usePublicGos = () => useQuery({ queryKey: ['public-gos'], queryFn: () => api<{ gos: { url: string } | null }>('/public/gos'), staleTime: 300_000 }).data?.gos ?? null;
export const useGos = () => useQuery({ queryKey: ['m-gos'], queryFn: () => api<GosInfo>('/m/gos') });

export const legalOf = (b: GosBusiness) => (b.org_type === 'ИП' ? `ИП ${b.name}` : `ООО «${b.name}»`);

export function GosButton({ next = '/app', link, label = 'Войти через Бобуслуги', className }: { next?: string; link?: boolean; label?: string; className?: string }) {
  return (
    <a
      href={`/api/auth/gos/start?next=${encodeURIComponent(next)}${link ? '&link=1' : ''}`}
      className={cx('flex h-12 items-center justify-center gap-2.5 rounded-[14px] bg-[#0b5bd3] px-5 text-[15px] font-semibold text-white hover:bg-[#0a4fb8]', className)}
    >
      <span className="flex size-7 items-center justify-center rounded-lg bg-white"><GosMark className="size-6" /></span>
      {label}
    </a>
  );
}

/** Pick a business from the Бобуслуги registry (or none). */
export function BusinessSelect({ businesses, value, onChange, allowNone = true }: { businesses: GosBusiness[]; value: number | null; onChange: (b: GosBusiness | null) => void; allowNone?: boolean }) {
  const row = (key: string, selected: boolean, onClick: () => void, title: string, sub: string) => (
    <button key={key} type="button" onClick={onClick} className={cx('flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors', selected ? 'border-brand bg-brand/5' : 'border-line hover:bg-hover')}>
      <span className="flex size-9 items-center justify-center rounded-lg bg-sunken text-muted"><Building2 className="size-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted">{sub}</span>
      </span>
      {selected && <Check className="size-4 text-brand" />}
    </button>
  );
  return (
    <div className="flex flex-col gap-2">
      {businesses.map((b) => row(String(b.id), value === b.id, () => onChange(b), legalOf(b), `ИНН ${b.inn} · запись ${b.number}`))}
      {allowNone && row('none', value === null, () => onChange(null), 'Без привязки к бизнесу', 'Реквизиты вводятся вручную, налог с оборота не начисляется')}
    </div>
  );
}
