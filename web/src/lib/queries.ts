import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Client, ClientEvent, Device, Employee, Meta, SerialTemplate, Task, VaultItem, ZtMember, ZtNetwork } from './types';

export interface RouteTypes {
  clients: Client;
  'client-events': ClientEvent;
  'zt-networks': ZtNetwork;
  'zt-members': ZtMember;
  devices: Device;
  tasks: Task;
  'serial-templates': SerialTemplate;
  'vault-items': VaultItem;
}
export type Route = keyof RouteTypes;

/** Fields only the server sets; it ignores them on write. */
type ServerOnly = keyof Meta | 'lastSync' | 'poolsInfo' | 'transfers';
/** Data a record accepts on write. */
export type Input<R extends Route> = Omit<RouteTypes[R], ServerOnly> & Partial<Meta>;

export function useRecords<R extends Route>(route: R, filters: Record<string, string> = {}, enabled = true) {
  const qs = new URLSearchParams(filters).toString();
  return useQuery({
    queryKey: [route, filters],
    queryFn: () => api<RouteTypes[R][]>(`/${route}${qs ? `?${qs}` : ''}`),
    enabled,
  });
}

export function useSaveRecord<R extends Route>(route: R) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rec: Input<R>) =>
      rec.id ? api<RouteTypes[R]>(`/${route}/${rec.id}`, { method: 'PUT', body: rec }) : api<RouteTypes[R]>(`/${route}`, { body: rec }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [route] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useDeleteRecord(route: Route) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/${route}/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [route] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['trash'] });
    },
  });
}

export function useEmployees() {
  return useQuery({ queryKey: ['employees'], queryFn: () => api<Employee[]>('/employees') });
}

/** id → display name lookup for employees (including fired ones). */
export function useEmployeeNames() {
  const { data } = useEmployees();
  const map = new Map<string, string>();
  data?.forEach((e) => map.set(e.id, e.fullName));
  return (id: string | null | undefined) => (id ? (map.get(id) ?? '—') : '—');
}

export function useClientNames() {
  const { data } = useRecords('clients');
  const map = new Map<string, string>();
  data?.forEach((c) => map.set(c.id, c.fullName));
  return (id: string | null | undefined) => (id ? (map.get(id) ?? '—') : '—');
}
