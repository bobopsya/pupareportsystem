import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, HttpError, type Ctx } from '../context.js';
import { randomId } from '../crypto.js';
import { TYPE_ROUTES, TYPES, type RecordType } from '../schemas.js';

export interface RecordRow {
  id: string;
  type: string;
  data: string;
  created_at: number;
  updated_at: number;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: number | null;
  deleted_by: string | null;
}

export type Rec = Record<string, unknown> & { id: string };

export function toRec(row: RecordRow): Rec {
  return {
    ...JSON.parse(row.data),
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

export function listRecords(ctx: Ctx, type: RecordType, filters: Record<string, string> = {}, q?: string): Rec[] {
  const where = ['type = ?', 'deleted_at IS NULL'];
  const args: unknown[] = [type];
  for (const [k, v] of Object.entries(filters)) {
    where.push(`json_extract(data, '$.${k}') = ?`);
    args.push(v);
  }
  if (q) {
    where.push('data LIKE ?');
    args.push(`%${q.replace(/[%_]/g, '')}%`);
  }
  const rows = ctx.db.prepare(`SELECT * FROM records WHERE ${where.join(' AND ')} ORDER BY created_at DESC`).all(...args) as RecordRow[];
  return rows.map(toRec);
}

export function getRow(ctx: Ctx, type: RecordType, id: string, includeDeleted = false): RecordRow | undefined {
  return ctx.db
    .prepare(`SELECT * FROM records WHERE id = ? AND type = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`)
    .get(id, type) as RecordRow | undefined;
}

export function insertRecord(ctx: Ctx, type: RecordType, data: Record<string, unknown>, userId: string | null): Rec {
  const id = randomId();
  const now = ctx.now();
  ctx.db
    .prepare('INSERT INTO records(id, type, data, created_at, updated_at, created_by, updated_by) VALUES(?,?,?,?,?,?,?)')
    .run(id, type, JSON.stringify(data), now, now, userId, userId);
  return toRec(getRow(ctx, type, id)!);
}

export function updateRecordData(ctx: Ctx, id: string, data: Record<string, unknown>, userId: string | null) {
  ctx.db.prepare('UPDATE records SET data = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(JSON.stringify(data), ctx.now(), userId, id);
}

const listQuery = z.record(z.string(), z.string());

/** Parses client input, ignoring fields only the server may set. */
function parseInput(type: RecordType, body: unknown): Record<string, unknown> {
  const def = TYPES[type];
  const input = { ...((body ?? {}) as Record<string, unknown>) };
  for (const f of def.serverFields ?? []) delete input[f];
  return def.schema.parse(input) as Record<string, unknown>;
}

function sameHolder(a: { type: string; id: string | null }, b: { type: string; id: string | null }) {
  return a.type === b.type && (a.id ?? null) === (b.id ?? null);
}

export function registerRecordRoutes(app: FastifyInstance, ctx: Ctx) {
  for (const [route, type] of Object.entries(TYPE_ROUTES)) {
    const def = TYPES[type];
    const base = `/api/${route}`;

    app.get(base, async (req) => {
      const query = listQuery.parse(req.query ?? {});
      const filters: Record<string, string> = {};
      for (const f of def.filters) if (query[f] !== undefined) filters[f] = query[f];
      return listRecords(ctx, type, filters, query.q);
    });

    app.get(`${base}/:id`, async (req) => {
      const { id } = req.params as { id: string };
      const row = getRow(ctx, type, id);
      if (!row) throw new HttpError(404, 'Запись не найдена');
      return toRec(row);
    });

    app.post(base, async (req) => {
      const data = parseInput(type, req.body);
      const rec = insertRecord(ctx, type, data, req.user!.id);
      audit(ctx, req, 'create', type, rec.id, def.title(data));
      return rec;
    });

    app.put(`${base}/:id`, async (req) => {
      const { id } = req.params as { id: string };
      const row = getRow(ctx, type, id);
      if (!row) throw new HttpError(404, 'Запись не найдена');
      const prev = JSON.parse(row.data) as Record<string, unknown>;
      const data = parseInput(type, req.body);
      for (const f of def.serverFields ?? []) data[f] = prev[f];

      if (type === 'device') {
        const from = prev.holder as { type: string; id: string | null };
        const to = data.holder as { type: string; id: string | null };
        if (from && !sameHolder(from, to)) {
          data.transfers = [...((prev.transfers as unknown[]) ?? []), { ts: ctx.now(), from, to, by: req.user!.login }];
        }
      }

      updateRecordData(ctx, id, data, req.user!.id);
      audit(ctx, req, 'update', type, id, def.title(data));
      return toRec(getRow(ctx, type, id)!);
    });

    app.delete(`${base}/:id`, async (req) => {
      const { id } = req.params as { id: string };
      const row = getRow(ctx, type, id);
      if (!row) throw new HttpError(404, 'Запись не найдена');
      ctx.db.prepare('UPDATE records SET deleted_at = ?, deleted_by = ? WHERE id = ?').run(ctx.now(), req.user!.id, id);
      audit(ctx, req, 'delete', type, id, def.title(JSON.parse(row.data)));
      return { ok: true };
    });
  }
}
