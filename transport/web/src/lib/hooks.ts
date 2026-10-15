import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Account, Me, Ride, SavedPlace, Place } from './types';

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me'), staleTime: 60_000 });

export const useAccount = (enabled: boolean) => useQuery({ queryKey: ['account'], queryFn: () => api<Account>('/me/account'), enabled, staleTime: 15_000 });

export const usePlaces = (enabled: boolean) => useQuery({ queryKey: ['places'], queryFn: () => api<{ places: SavedPlace[]; recent: Place[] }>('/places'), enabled, staleTime: 30_000 });

/** The active ride, polled every 1.5 s; the clock offset lets the car move smoothly between polls. */
export function useCurrentRide(enabled: boolean) {
  return useQuery({
    queryKey: ['ride'],
    queryFn: async () => {
      const t0 = Date.now();
      const r = await api<{ ride: Ride | null }>('/rides/current');
      const t1 = Date.now();
      return { ride: r.ride, offset: r.ride ? r.ride.now - (t0 + t1) / 2 : 0 };
    },
    enabled,
    refetchInterval: (q) => (q.state.data?.ride ? 1500 : 10_000),
    refetchIntervalInBackground: false,
  });
}

export function useRefreshRide() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['ride'] });
    void qc.invalidateQueries({ queryKey: ['account'] });
  };
}
