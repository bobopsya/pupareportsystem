import { ZipArchive } from 'archiver';
import type { FastifyInstance, FastifyReply } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { audit, HttpError, type Ctx } from '../context.js';
import { TYPES, type RecordType } from '../schemas.js';
import { filesDir, purgeFile, readFileBlob, toFile, type FileRow } from './files.js';
import { getRow, listRecords, toRec, type RecordRow } from './records.js';

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type TrashKind = 'record' | 'employee' | 'file';

/** Permanently removes a record together with everything that only makes sense attached to it. */
export function purgeRecord(ctx: Ctx, id: string) {
  const row = ctx.db.prepare('SELECT * FROM records WHERE id = ?').get(id) as RecordRow | undefined;
  if (!row) return;
  ctx.db.transaction(() => {
    if (row.type === 'client') {
      const files = ctx.db.prepare("SELECT id FROM files WHERE owner_type = 'client' AND owner_id = ?").all(id) as { id: string }[];
      for (const f of files) purgeFile(ctx, f.id);
      ctx.db.prepare("DELETE FROM records WHERE type = 'client_event' AND json_extract(data, '$.clientId') = ?").run(id);
    }
    if (row.type === 'zt_network') {
      ctx.db.prepare("DELETE FROM records WHERE type = 'zt_member' AND json_extract(data, '$.networkRef') = ?").run(id);
    }
    if (row.type === 'device' || row.type === 'route') {
      const files = ctx.db.prepare('SELECT id FROM files WHERE owner_type = ? AND owner_id = ?').all(row.type, id) as { id: string }[];
      for (const f of files) purgeFile(ctx, f.id);
    }
    ctx.db.prepare('DELETE FROM records WHERE id = ?').run(id);
  })();
}

function purgeEmployee(ctx: Ctx, id: string) {
  const files = ctx.db.prepare("SELECT id FROM files WHERE owner_type = 'employee' AND owner_id = ?").all(id) as { id: string }[];
  for (const f of files) purgeFile(ctx, f.id);
  ctx.db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

export function purgeExpired(ctx: Ctx) {
  const cutoff = ctx.now() - TRASH_RETENTION_MS;
  const recs = ctx.db.prepare('SELECT id FROM records WHERE deleted_at IS NOT NULL AND deleted_at < ?').all(cutoff) as { id: string }[];
  recs.forEach((r) => purgeRecord(ctx, r.id));
  const users = ctx.db.prepare('SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < ?').all(cutoff) as { id: string }[];
  users.forEach((u) => purgeEmployee(ctx, u.id));
  const files = ctx.db.prepare('SELECT id FROM files WHERE deleted_at IS NOT NULL AND deleted_at < ?').all(cutoff) as { id: string }[];
  files.forEach((f) => purgeFile(ctx, f.id));
  return recs.length + users.length + files.length;
}

async function sendZip(reply: FastifyReply, filename: string, fill: (zip: ZipArchive) => void) {
  const zip = new ZipArchive({ zlib: { level: 6 } });
  reply
    .header('Content-Type', 'application/zip')
    .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  fill(zip);
  void zip.finalize();
  return reply.send(zip);
}

function stamp(ts: number) {
  return new Date(ts).toISOString().slice(0, 16).replace(/[:T]/g, '-');
}

export function registerAdminRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;

  // ---------- Audit log ----------
  const auditQuery = z.object({
    limit: z.coerce.number().int().min(1).max(1000).default(200),
    before: z.coerce.number().int().optional(),
    userId: z.string().max(64).optional(),
    action: z.string().max(30).optional(),
    entity: z.string().max(30).optional(),
    entityId: z.string().max(64).optional(),
  });
  app.get('/api/audit', async (req) => {
    const q = auditQuery.parse(req.query);
    const where: string[] = ['1=1'];
    const args: unknown[] = [];
    if (q.before) (where.push('id < ?'), args.push(q.before));
    if (q.userId) (where.push('user_id = ?'), args.push(q.userId));
    if (q.action) (where.push('action = ?'), args.push(q.action));
    if (q.entity) (where.push('entity = ?'), args.push(q.entity));
    if (q.entityId) (where.push('entity_id = ?'), args.push(q.entityId));
    return db.prepare(`SELECT * FROM audit WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`).all(...args, q.limit);
  });

  // ---------- Dashboard ----------
  app.get('/api/dashboard', async () => {
    const countType = (t: RecordType) => (db.prepare('SELECT COUNT(*) c FROM records WHERE type = ? AND deleted_at IS NULL').get(t) as { c: number }).c;
    const employees = (db.prepare("SELECT COUNT(*) c FROM users WHERE deleted_at IS NULL AND json_extract(data, '$.status') != 'fired'").get() as { c: number }).c;
    const members = listRecords(ctx, 'zt_member');
    const networks = listRecords(ctx, 'zt_network');
    const netName = new Map(networks.map((n) => [n.id, n.name as string]));
    const tasks = listRecords(ctx, 'task');
    return {
      counts: {
        employees,
        clients: countType('client'),
        activeClients: (db.prepare("SELECT COUNT(*) c FROM records WHERE type='client' AND deleted_at IS NULL AND json_extract(data,'$.status')='active'").get() as { c: number }).c,
        networks: networks.length,
        members: members.length,
        membersOnline: members.filter((m) => m.online).length,
        devices: countType('device'),
        vaultItems: countType('vault_item'),
        wifi: countType('wifi'),
        openTasks: tasks.filter((t) => !t.done).length,
      },
      members: members
        .filter((m) => netName.has(m.networkRef as string))
        .map((m) => ({ id: m.id, name: m.name, nodeId: m.nodeId, online: m.online, lastSeen: m.lastSeen, ips: m.ips, network: netName.get(m.networkRef as string) }))
        .sort((a, b) => Number(b.online) - Number(a.online) || String(a.name).localeCompare(String(b.name)))
        .slice(0, 30),
      lastSync: networks.reduce<number | null>((acc, n) => (n.lastSync && (!acc || (n.lastSync as number) > acc) ? (n.lastSync as number) : acc), null),
      recent: db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 15').all(),
    };
  });

  // ---------- Trash ----------
  app.get('/api/trash', async () => {
    const recs = (db.prepare('SELECT * FROM records WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all() as RecordRow[])
      // Children of a deleted parent are restored with it; listing them separately is noise.
      .filter((r) => r.type !== 'client_event' || !!getRow(ctx, 'client', JSON.parse(r.data).clientId));
    const users = db.prepare('SELECT * FROM users WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all() as { id: string; login: string; data: string; deleted_at: number; deleted_by: string }[];
    const files = db.prepare('SELECT * FROM files WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all() as (FileRow & { deleted_by: string })[];
    const items = [
      ...recs.map((r) => ({ kind: 'record' as TrashKind, id: r.id, type: r.type, title: TYPES[r.type as RecordType]?.title(JSON.parse(r.data)) ?? r.type, deletedAt: r.deleted_at!, deletedBy: r.deleted_by })),
      ...users.map((u) => ({ kind: 'employee' as TrashKind, id: u.id, type: 'employee', title: `${JSON.parse(u.data).fullName} (${u.login})`, deletedAt: u.deleted_at, deletedBy: u.deleted_by })),
      ...files.map((f) => ({ kind: 'file' as TrashKind, id: f.id, type: `file_${f.kind}`, title: f.name, deletedAt: f.deleted_at!, deletedBy: f.deleted_by })),
    ].sort((a, b) => b.deletedAt - a.deletedAt);
    return items.map((i) => ({ ...i, purgeAt: i.deletedAt + TRASH_RETENTION_MS }));
  });

  const trashBody = z.object({ kind: z.enum(['record', 'employee', 'file']), id: z.string().min(1).max(64) });
  const table = { record: 'records', employee: 'users', file: 'files' } as const;

  app.post('/api/trash/restore', async (req) => {
    const { kind, id } = trashBody.parse(req.body);
    const res = db.prepare(`UPDATE ${table[kind]} SET deleted_at = NULL, deleted_by = NULL WHERE id = ? AND deleted_at IS NOT NULL`).run(id);
    if (!res.changes) throw new HttpError(404, 'В корзине не найдено');
    audit(ctx, req, 'restore', kind, id);
    return { ok: true };
  });

  app.post('/api/trash/purge', async (req) => {
    const { kind, id } = trashBody.parse(req.body);
    const exists = db.prepare(`SELECT id FROM ${table[kind]} WHERE id = ? AND deleted_at IS NOT NULL`).get(id);
    if (!exists) throw new HttpError(404, 'В корзине не найдено');
    if (kind === 'record') purgeRecord(ctx, id);
    else if (kind === 'employee') purgeEmployee(ctx, id);
    else purgeFile(ctx, id);
    audit(ctx, req, 'purge', kind, id);
    return { ok: true };
  });

  // ---------- Clients: GDPR export & permanent deletion ----------
  app.get('/api/clients/:id/export', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getRow(ctx, 'client', id);
    if (!row) throw new HttpError(404, 'Клиент не найден');
    const client = toRec(row);
    const files = (db.prepare("SELECT * FROM files WHERE owner_type = 'client' AND owner_id = ? AND deleted_at IS NULL").all(id) as FileRow[]);
    const payload = {
      exportedAt: new Date(ctx.now()).toISOString(),
      client,
      history: listRecords(ctx, 'client_event', { clientId: id }),
      networks: listRecords(ctx, 'zt_network', { clientId: id }),
      devices: listRecords(ctx, 'device').filter((d) => (d.holder as { type: string; id: string }).type === 'client' && (d.holder as { id: string }).id === id),
      tasks: listRecords(ctx, 'task', { clientId: id }),
      files: files.map(toFile),
    };
    audit(ctx, req, 'export', 'client', id, String(client.fullName));
    const base = String(client.fullName).replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 60) || 'client';
    return sendZip(reply, `${base}_${stamp(ctx.now())}.zip`, (zip) => {
      zip.append(JSON.stringify(payload, null, 2), { name: 'client.json' });
      for (const f of files) zip.append(readFileBlob(ctx, f.id), { name: `${f.kind === 'file' ? 'files' : 'photos'}/${f.id.slice(0, 8)}_${f.name}` });
    });
  });

  app.delete('/api/clients/:id/permanent', async (req) => {
    const { id } = req.params as { id: string };
    const row = getRow(ctx, 'client', id, true);
    if (!row) throw new HttpError(404, 'Клиент не найден');
    const name = String(JSON.parse(row.data).fullName);
    purgeRecord(ctx, id);
    audit(ctx, req, 'purge', 'client', id, `${name} — удалён навсегда`);
    return { ok: true };
  });

  // ---------- Backup ----------
  app.get('/api/backup', async (req, reply) => {
    db.pragma('wal_checkpoint(TRUNCATE)');
    const dbFile = fs.readFileSync(path.join(ctx.cfg.dataDir, 'portal.db')); // encrypted with DB_KEY
    const dir = filesDir(ctx);
    const blobs = fs.readdirSync(dir).filter((f) => f.endsWith('.bin'));
    audit(ctx, req, 'backup', 'system', null, `${blobs.length} файлов`);
    return sendZip(reply, `zhukonet-backup-${stamp(ctx.now())}.zip`, (zip) => {
      zip.append(dbFile, { name: 'portal.db' });
      for (const b of blobs) zip.file(path.join(dir, b), { name: `files/${b}` });
      zip.append(RESTORE_README, { name: 'RESTORE.txt' });
    });
  });
}

const RESTORE_README = `Резервная копия портала ZhukoNet
================================

portal.db и files/*.bin зашифрованы. Для восстановления нужны DB_KEY и FILES_KEY
из файла .env на сервере — без них архив прочитать невозможно. Храните ключи отдельно от бэкапа.

Восстановление:
  1. cd /opt/zhukonet && docker compose stop app
  2. Распакуйте архив в каталог данных (по умолчанию том /opt/zhukonet/data):
       unzip -o zhukonet-backup-*.zip -d data/   (RESTORE.txt можно удалить)
  3. Убедитесь, что в .env те же DB_KEY и FILES_KEY, что и при создании бэкапа.
  4. docker compose start app
`;
