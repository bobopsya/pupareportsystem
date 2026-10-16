import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Account, LineState, Me, Tariff, Addon } from './types';

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me'), staleTime: 60_000 });

export const useAccount = (enabled: boolean) => useQuery({ queryKey: ['account'], queryFn: () => api<Account>('/me/account'), enabled, staleTime: 15_000 });

export const useTariffs = () => useQuery({ queryKey: ['tariffs'], queryFn: () => api<{ tariffs: Tariff[]; addons: Addon[] }>('/tariffs'), staleTime: 300_000 });

/** My line, unread SMS and the call on the screen: polled every 2 s so an incoming call rings quickly. */
export const useLine = (enabled: boolean) =>
  useQuery({
    queryKey: ['line'],
    queryFn: () => api<LineState>('/line'),
    enabled,
    refetchInterval: (q) => (q.state.data?.line ? 2000 : false),
    refetchIntervalInBackground: true,
  });
