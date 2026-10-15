export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? (init.body !== undefined ? 'POST' : 'GET');
  const headers: Record<string, string> = { 'X-Requested-With': 'bobotransport' };
  let body: string | undefined;
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body, credentials: 'same-origin' });
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Ошибка ${res.status}`, data?.code);
  return data as T;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Что-то пошло не так');
