import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, HttpError, type Ctx } from '../context.js';
import { getSetting, setSetting } from '../db.js';
import { ztMemberSchema } from '../schemas.js';
import { getRow, insertRecord, listRecords, updateRecordData } from './records.js';

const TOKEN_KEY = 'zt_token';
/** A member counts as online if Central saw it within this window. */
export const ONLINE_WINDOW_MS = 5 * 60 * 1000;

export function getZtToken(ctx: Ctx): string | null {
  const enc = getSetting(ctx.db, TOKEN_KEY);
  return enc ? ctx.secretCrypto.decryptString(enc) : null;
}

interface CentralMember {
  nodeId?: string;
  name?: string;
  description?: string;
  lastOnline?: number;
  lastSeen?: number;
  physicalAddress?: string;
  clientVersion?: string;
  config?: { authorized?: boolean; ipAssignments?: string[] };
}

interface CentralNetwork {
  config?: { name?: string; routes?: { target: string; via: string | null }[]; ipAssignmentPools?: { ipRangeStart: string; ipRangeEnd: string }[] };
}

export type ZtFetch = (url: string, init: RequestInit) => Promise<Response>;

export async function syncNetwork(ctx: Ctx, networkRecId: string, userId: string, fetchImpl: ZtFetch = fetch) {
  const row = getRow(ctx, 'zt_network', networkRecId);
  if (!row) throw new HttpError(404, 'Сеть не найдена');
  const token = getZtToken(ctx);
  if (!token) throw new HttpError(400, 'API-токен ZeroTier не задан (Настройки)');
  const net = JSON.parse(row.data) as Record<string, unknown> & { networkId: string; routes: unknown[] };
  const headers = { Authorization: `token ${token}`, Accept: 'application/json' };

  const call = async <T>(p: string): Promise<T> => {
    let res: Response;
    try {
      res = await fetchImpl(`${ctx.cfg.ztApiUrl}${p}`, { headers, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new HttpError(502, 'ZeroTier Central недоступен');
    }
    if (res.status === 401 || res.status === 403) throw new HttpError(502, 'ZeroTier отклонил токен');
    if (res.status === 404) throw new HttpError(502, 'Сеть не найдена в ZeroTier Central (проверьте Network ID и права токена)');
    if (!res.ok) throw new HttpError(502, `ZeroTier Central ответил ${res.status}`);
    return (await res.json()) as T;
  };

  const [central, members] = await Promise.all([
    call<CentralNetwork>(`/network/${net.networkId}`),
    call<CentralMember[]>(`/network/${net.networkId}/member`),
  ]);

  const now = ctx.now();
  const existing = new Map(listRecords(ctx, 'zt_member', { networkRef: networkRecId }).map((m) => [m.nodeId as string, m]));
  let added = 0;
  let updated = 0;
  for (const m of members) {
    if (!m.nodeId) continue;
    const lastSeen = m.lastOnline ?? m.lastSeen ?? null;
    const fresh = {
      ips: m.config?.ipAssignments ?? [],
      online: lastSeen ? now - lastSeen < ONLINE_WINDOW_MS : false,
      lastSeen,
      authorized: m.config?.authorized ?? false,
      physicalAddress: m.physicalAddress ?? '',
      clientVersion: m.clientVersion ?? '',
    };
    const prev = existing.get(m.nodeId);
    if (prev) {
      // Keep manual fields (name, owner, notes); refresh what Central knows.
      const { id, createdAt, updatedAt, createdBy, updatedBy, ...rest } = prev;
      const data = ztMemberSchema.parse({ ...rest, ...fresh, name: (rest.name as string) || m.name || '' });
      updateRecordData(ctx, id, data, userId);
      updated++;
    } else {
      const data = ztMemberSchema.parse({ networkRef: networkRecId, nodeId: m.nodeId, name: m.name ?? '', notes: m.description ?? '', source: 'sync', ...fresh });
      insertRecord(ctx, 'zt_member', data, userId);
      added++;
    }
  }

  const routes = (central.config?.routes ?? []).map((r) => ({ target: r.target, via: r.via ?? '' }));
  const pools = (central.config?.ipAssignmentPools ?? []).map((p) => `${p.ipRangeStart} – ${p.ipRangeEnd}`);
  const subnets = Array.from(new Set([...(net.subnets as string[]), ...routes.filter((r) => !r.via).map((r) => r.target)]));
  updateRecordData(ctx, networkRecId, { ...net, routes: routes.length ? routes : net.routes, subnets, lastSync: now, poolsInfo: pools }, userId);
  return { added, updated, total: members.length };
}

export function registerZerotierRoutes(app: FastifyInstance, ctx: Ctx) {
  app.post('/api/zt-networks/:id/sync', async (req) => {
    const { id } = req.params as { id: string };
    const result = await syncNetwork(ctx, id, req.user!.id);
    audit(ctx, req, 'sync', 'zt_network', id, `+${result.added} / обновлено ${result.updated}`);
    return result;
  });

  app.get('/api/settings', async () => ({ ztTokenSet: !!getSetting(ctx.db, TOKEN_KEY), ztApiUrl: ctx.cfg.ztApiUrl }));

  app.put('/api/settings/zt-token', async (req) => {
    const { token } = z.object({ token: z.string().trim().min(10).max(500) }).parse(req.body);
    setSetting(ctx.db, TOKEN_KEY, ctx.secretCrypto.encryptString(token));
    audit(ctx, req, 'settings', 'settings', null, 'API-токен ZeroTier обновлён');
    return { ok: true };
  });

  app.delete('/api/settings/zt-token', async (req) => {
    setSetting(ctx.db, TOKEN_KEY, null);
    audit(ctx, req, 'settings', 'settings', null, 'API-токен ZeroTier удалён');
    return { ok: true };
  });
}
