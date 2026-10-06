import type { FastifyInstance } from 'fastify';
import { HttpError, type Ctx } from '../context.js';

/** In-memory LRU of recently served tiles (a tile is ~10–30 KB). */
const MAX_CACHED = 2000;
const TILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface Cached {
  buf: Buffer;
  type: string;
  at: number;
}

/**
 * Map tiles are fetched by the server and served from the portal's own origin.
 * Browsers then never talk to the tile provider directly: no CSP/Referer issues,
 * and maps keep working where the provider is blocked or throttled for end users.
 */
export function registerTileRoutes(app: FastifyInstance, ctx: Ctx) {
  const cache = new Map<string, Cached>();
  const inflight = new Map<string, Promise<Cached>>();

  const fetchTile = async (z: number, x: number, y: number): Promise<Cached> => {
    const url = ctx.cfg.tileUrl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
    let res: Response;
    try {
      res = await ctx.http(url, {
        headers: { 'User-Agent': 'ZhukoNet-Portal/1.0 (self-hosted internal portal)', Accept: 'image/png,image/*' },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new HttpError(502, 'Сервер карт недоступен');
    }
    if (!res.ok) throw new HttpError(502, `Сервер карт ответил ${res.status}`);
    return { buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') ?? 'image/png', at: ctx.now() };
  };

  app.get('/api/tiles/:z/:x/:y', { config: { rateLimit: false } }, async (req, reply) => {
    const p = req.params as { z: string; x: string; y: string };
    const z = Number(p.z);
    const x = Number(p.x);
    const y = Number(p.y.replace(/\.png$/, ''));
    if (![z, x, y].every(Number.isInteger) || z < 0 || z > 19 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
      throw new HttpError(400, 'Некорректные координаты плитки');
    }
    const key = `${z}/${x}/${y}`;
    let tile = cache.get(key);
    if (tile && ctx.now() - tile.at > TILE_TTL_MS) tile = undefined;
    if (!tile) {
      let pending = inflight.get(key);
      if (!pending) {
        pending = fetchTile(z, x, y).finally(() => inflight.delete(key));
        inflight.set(key, pending);
      }
      tile = await pending;
    }
    // Refresh LRU position.
    cache.delete(key);
    cache.set(key, tile);
    if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
    return reply.header('Content-Type', tile.type).header('Cache-Control', 'private, max-age=604800').send(tile.buf);
  });
}
