import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Home } from './types';

export function useHome() {
  return useQuery({ queryKey: ['home'], queryFn: () => api<Home>('/home') });
}

/** After any money movement: balances, history and analytics are stale. */
export function useRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['home', 'history', 'account', 'card', 'analytics', 'bonus', 'credits', 'notifications']) void qc.invalidateQueries({ queryKey: [k] });
  };
}

export interface Meta {
  bank: { name: string; legalName: string; bik: string; inn: string; kpp: string; address: string; phone: string };
  corr: string;
  categories: { id: string; title: string }[];
  designs: Record<string, string>;
  gpayUrl: string | null;
}

export function useMeta() {
  return useQuery({ queryKey: ['meta'], queryFn: () => api<Meta>('/meta'), staleTime: Infinity });
}
