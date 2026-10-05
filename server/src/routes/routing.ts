import type { FastifyInstance } from 'fastify';
import { audit, HttpError, type Ctx } from '../context.js';
import type { Point } from '../geo.js';
import { getRow, toRec, updateRecordData } from './records.js';

export type RouteFetch = (url: string, init: RequestInit) => Promise<Response>;

interface OsrmResponse {
  code: string;
  routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
}

/** Keeps at most `max` points, dropping evenly spaced ones in between (endpoints kept). */
function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = (arr.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]!);
  return out;
}

export async function routeByRoads(ctx: Ctx, routeId: string, userId: string, fetchImpl: RouteFetch = fetch) {
  const row = getRow(ctx, 'route', routeId);
  if (!row) throw new HttpError(404, 'Маршрут не найден');
  const data = JSON.parse(row.data) as Record<string, unknown> & { points: Point[] };
  const points = data.points ?? [];
  if (points.length < 2) throw new HttpError(400, 'Нужно минимум 2 точки');

  // OSRM wants lng,lat pairs separated by semicolons.
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
  const url = `${ctx.cfg.osrmUrl}/route/v1/driving/${coords}?overview=full&geometries=geojson`;

  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { 'User-Agent': 'ZhukoNet-Portal' }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new HttpError(502, 'Сервис маршрутизации недоступен');
  }
  if (!res.ok) throw new HttpError(502, `Сервис маршрутизации ответил ${res.status}`);
  const body = (await res.json()) as OsrmResponse;
  const r = body.routes?.[0];
  if (body.code !== 'Ok' || !r) throw new HttpError(502, 'Не удалось проложить маршрут по дорогам');

  const road = {
    distanceKm: Math.round((r.distance / 1000) * 100) / 100,
    durationMin: Math.round(r.duration / 60),
    // GeoJSON is [lng, lat]; store as [lat, lng] for Leaflet.
    geometry: downsample(r.geometry.coordinates, 2000).map(([lng, lat]) => [lat, lng] as [number, number]),
  };
  updateRecordData(ctx, routeId, { ...data, road }, userId);
  return road;
}

export function registerRoutingRoutes(app: FastifyInstance, ctx: Ctx) {
  app.post('/api/routes/:id/road', async (req) => {
    const { id } = req.params as { id: string };
    const road = await routeByRoads(ctx, id, req.user!.id);
    audit(ctx, req, 'sync', 'route', id, `${road.distanceKm} км по дорогам`);
    return toRec(getRow(ctx, 'route', id)!);
  });
}
