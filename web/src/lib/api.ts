export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();

/** Notified when the server says the session is gone (idle timeout, logout elsewhere). */
export function onUnauthorized(fn: Listener) {
  unauthorizedListeners.add(fn);
  return () => {
    unauthorizedListeners.delete(fn);
  };
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const method = init.method ?? (init.body !== undefined || init.form ? 'POST' : 'GET');
  const headers: Record<string, string> = { 'X-Requested-With': 'zhukonet' };
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body, credentials: 'same-origin' });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') unauthorizedListeners.forEach((fn) => fn());
    throw new ApiError(res.status, (data as { error?: string })?.error ?? `Ошибка ${res.status}`, data);
  }
  return data as T;
}

export function fileUrl(id: string, opts: { thumb?: boolean; download?: boolean } = {}) {
  const q = new URLSearchParams();
  if (opts.thumb) q.set('thumb', '1');
  if (opts.download) q.set('download', '1');
  const s = q.toString();
  return `/api/files/${id}${s ? `?${s}` : ''}`;
}

export function uploadFile(file: File, meta: { ownerType: 'client' | 'employee' | 'device' | 'route'; ownerId: string; kind: 'photo' | 'file' | 'avatar'; caption?: string }) {
  const form = new FormData();
  form.set('ownerType', meta.ownerType);
  form.set('ownerId', meta.ownerId);
  form.set('kind', meta.kind);
  form.set('caption', meta.caption ?? '');
  form.set('file', file);
  return api<FileMeta>('/files', { form });
}

export interface FileMeta {
  id: string;
  ownerType: string;
  ownerId: string;
  kind: 'photo' | 'file' | 'avatar';
  name: string;
  mime: string;
  size: number;
  caption: string;
  hasThumb: boolean;
  createdAt: number;
  createdBy: string | null;
}

/** Downloads a server response as a file (used for ZIP exports and backups). */
export async function downloadFrom(path: string) {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error ?? `Ошибка ${res.status}`);
  }
  const cd = res.headers.get('content-disposition') ?? '';
  const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
  const name = m ? decodeURIComponent(m[1]) : 'download';
  saveBlob(await res.blob(), name);
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
