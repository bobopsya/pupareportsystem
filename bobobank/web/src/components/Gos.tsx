import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { cx } from './ui';

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

export function useGosConfig() {
  return useQuery({ queryKey: ['public-config'], queryFn: () => api<{ gos: { url: string } | null }>('/public/config'), staleTime: 300_000 }).data?.gos ?? null;
}

/** «Войти через Бобуслуги»: the bank sends the browser to Бобуслуги and back. */
export function GosButton({ next = '/app', link, label = 'Войти через Бобуслуги', className }: { next?: string; link?: boolean; label?: string; className?: string }) {
  const href = `/api/auth/gos/start?next=${encodeURIComponent(next)}${link ? '&link=1' : ''}`;
  return (
    <a href={href} className={cx('flex h-[52px] items-center justify-center gap-2.5 rounded-xl bg-[#0b5bd3] px-5 text-base font-semibold text-white hover:bg-[#0a4fb8]', className)}>
      <span className="flex size-7 items-center justify-center rounded-lg bg-white"><GosMark className="size-6" /></span>
      {label}
    </a>
  );
}

export function GosNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-sm text-muted">
      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" />
      <span>{children}</span>
    </p>
  );
}
