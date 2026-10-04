import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { audit, HttpError, type Ctx } from '../context.js';
import { randomId } from '../crypto.js';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export interface FileRow {
  id: string;
  owner_type: string;
  owner_id: string;
  kind: string;
  name: string;
  mime: string;
  size: number;
  caption: string;
  has_thumb: number;
  created_at: number;
  created_by: string | null;
  deleted_at: number | null;
}

export function toFile(row: FileRow) {
  return {
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    kind: row.kind,
    name: row.name,
    mime: row.mime,
    size: row.size,
    caption: row.caption,
    hasThumb: !!row.has_thumb,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export function filesDir(ctx: Ctx) {
  const dir = path.join(ctx.cfg.dataDir, 'files');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function blobPath(ctx: Ctx, id: string, thumb = false) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(400, 'Некорректный id');
  return path.join(filesDir(ctx), `${id}${thumb ? '.thumb' : ''}.bin`);
}

export function readFileBlob(ctx: Ctx, id: string, thumb = false): Buffer {
  return ctx.fileCrypto.decrypt(fs.readFileSync(blobPath(ctx, id, thumb)));
}

export function purgeFile(ctx: Ctx, id: string) {
  for (const thumb of [false, true]) fs.rmSync(blobPath(ctx, id, thumb), { force: true });
  ctx.db.prepare('DELETE FROM files WHERE id = ?').run(id);
}

const OWNER_TYPES = ['client', 'employee', 'device'] as const;
const KINDS = ['photo', 'file', 'avatar'] as const;

const listQuery = z.object({ ownerType: z.enum(OWNER_TYPES), ownerId: z.string().min(1).max(64), kind: z.enum(KINDS).optional() });

function safeName(name: string) {
  return name.replace(/[\\/\0\r\n"]/g, '_').slice(0, 200) || 'file';
}

export function registerFileRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;
  const getRow = (id: string) => db.prepare('SELECT * FROM files WHERE id = ? AND deleted_at IS NULL').get(id) as FileRow | undefined;

  app.get('/api/files', async (req) => {
    const q = listQuery.parse(req.query);
    const rows = db
      .prepare(`SELECT * FROM files WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL ${q.kind ? 'AND kind = ?' : ''} ORDER BY created_at DESC`)
      .all(...[q.ownerType, q.ownerId, ...(q.kind ? [q.kind] : [])]) as FileRow[];
    return rows.map(toFile);
  });

  app.post('/api/files', async (req) => {
    const fields: Record<string, string> = {};
    let upload: { buffer: Buffer; filename: string; mimetype: string } | null = null;
    for await (const part of req.parts({ limits: { fileSize: MAX_FILE_BYTES, files: 1 } })) {
      if (part.type === 'file') {
        const buffer = await part.toBuffer();
        if (part.file.truncated) throw new HttpError(413, 'Файл больше 20 МБ');
        upload = { buffer, filename: part.filename, mimetype: part.mimetype };
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
    if (!upload) throw new HttpError(400, 'Файл не передан');
    const meta = z
      .object({ ownerType: z.enum(OWNER_TYPES), ownerId: z.string().min(1).max(64), kind: z.enum(KINDS), caption: z.string().max(500).default('') })
      .parse(fields);

    const id = randomId();
    let data = upload.buffer;
    let mime = upload.mimetype || 'application/octet-stream';
    let name = safeName(upload.filename);
    let thumb: Buffer | null = null;

    if (meta.kind === 'photo' || meta.kind === 'avatar') {
      try {
        // sharp drops EXIF/GPS metadata unless explicitly asked to keep it; rotate() applies orientation first.
        const max = meta.kind === 'avatar' ? 512 : 2560;
        data = await sharp(upload.buffer).rotate().resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
        thumb = await sharp(data).resize({ width: 400, height: 400, fit: 'cover' }).webp({ quality: 75 }).toBuffer();
        mime = 'image/jpeg';
        name = name.replace(/\.[^.]+$/, '') + '.jpg';
      } catch {
        throw new HttpError(400, 'Не удалось обработать изображение (поддерживаются JPEG, PNG, WebP, GIF, TIFF, AVIF)');
      }
    }

    fs.writeFileSync(blobPath(ctx, id), ctx.fileCrypto.encrypt(data));
    if (thumb) fs.writeFileSync(blobPath(ctx, id, true), ctx.fileCrypto.encrypt(thumb));
    db.prepare(
      'INSERT INTO files(id, owner_type, owner_id, kind, name, mime, size, caption, has_thumb, created_at, created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    ).run(id, meta.ownerType, meta.ownerId, meta.kind, name, mime, data.length, meta.caption, thumb ? 1 : 0, ctx.now(), req.user!.id);
    audit(ctx, req, 'create', 'file', id, `${name} → ${meta.ownerType}`);
    return toFile(getRow(id)!);
  });

  app.get('/api/files/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { thumb, download } = req.query as { thumb?: string; download?: string };
    const row = getRow(id);
    if (!row) throw new HttpError(404, 'Файл не найден');
    const useThumb = thumb === '1' && !!row.has_thumb;
    const buf = readFileBlob(ctx, id, useThumb);
    const inline = !download && row.mime.startsWith('image/');
    reply
      .header('Content-Type', useThumb ? 'image/webp' : row.mime)
      .header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.name)}`)
      .header('Cache-Control', 'private, max-age=3600')
      .header('X-Content-Type-Options', 'nosniff');
    return reply.send(buf);
  });

  app.patch('/api/files/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { caption } = z.object({ caption: z.string().max(500) }).parse(req.body);
    if (!getRow(id)) throw new HttpError(404, 'Файл не найден');
    db.prepare('UPDATE files SET caption = ? WHERE id = ?').run(caption, id);
    return toFile(getRow(id)!);
  });

  app.delete('/api/files/:id', async (req) => {
    const { id } = req.params as { id: string };
    const row = getRow(id);
    if (!row) throw new HttpError(404, 'Файл не найден');
    db.prepare('UPDATE files SET deleted_at = ?, deleted_by = ? WHERE id = ?').run(ctx.now(), req.user!.id, id);
    audit(ctx, req, 'delete', 'file', id, row.name);
    return { ok: true };
  });
}
