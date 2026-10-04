import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashPassword } from '../auth.js';
import { audit, HttpError, type Ctx } from '../context.js';
import { randomId, tempPassword } from '../crypto.js';
import { employeeProfileSchema } from '../schemas.js';

interface UserRow {
  id: string;
  login: string;
  must_change: number;
  data: string;
  created_at: number;
  updated_at: number;
}

export function toEmployee(row: UserRow) {
  return {
    ...JSON.parse(row.data),
    id: row.id,
    login: row.login,
    mustChange: !!row.must_change,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const loginSchema = z
  .string()
  .trim()
  .min(2, 'Логин слишком короткий')
  .max(50)
  .regex(/^[a-zA-Z0-9._-]+$/, 'Логин: латиница, цифры, точка, дефис, подчёркивание');

export async function createUser(ctx: Ctx, login: string, profile: z.input<typeof employeeProfileSchema>, createdBy: string | null) {
  const parsedLogin = loginSchema.parse(login);
  const data = employeeProfileSchema.parse(profile);
  const exists = ctx.db.prepare('SELECT id FROM users WHERE login = ?').get(parsedLogin);
  if (exists) throw new HttpError(409, 'Такой логин уже существует (проверьте корзину)');
  const password = tempPassword();
  const id = randomId();
  const now = ctx.now();
  ctx.db
    .prepare('INSERT INTO users(id, login, pass_hash, must_change, data, created_at, updated_at, created_by, updated_by) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id, parsedLogin, await hashPassword(password), 1, JSON.stringify(data), now, now, createdBy, createdBy);
  return { id, login: parsedLogin, tempPassword: password, data };
}

export function registerEmployeeRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;
  const getRow = (id: string) => db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(id) as UserRow | undefined;

  app.get('/api/employees', async () => {
    const rows = db.prepare('SELECT * FROM users WHERE deleted_at IS NULL ORDER BY created_at').all() as UserRow[];
    return rows.map(toEmployee);
  });

  app.get('/api/employees/:id', async (req) => {
    const row = getRow((req.params as { id: string }).id);
    if (!row) throw new HttpError(404, 'Сотрудник не найден');
    return toEmployee(row);
  });

  const createBody = z.object({ login: z.string(), profile: z.record(z.string(), z.unknown()) });
  app.post('/api/employees', async (req) => {
    const body = createBody.parse(req.body);
    const created = await createUser(ctx, body.login, body.profile as z.input<typeof employeeProfileSchema>, req.user!.id);
    audit(ctx, req, 'create', 'employee', created.id, `${created.data.fullName} (${created.login})`);
    return { employee: toEmployee(getRow(created.id)!), tempPassword: created.tempPassword };
  });

  app.put('/api/employees/:id', async (req) => {
    const { id } = req.params as { id: string };
    const row = getRow(id);
    if (!row) throw new HttpError(404, 'Сотрудник не найден');
    const data = employeeProfileSchema.parse(req.body);
    if (id === req.user!.id && data.status === 'fired') throw new HttpError(400, 'Нельзя уволить самого себя');
    db.prepare('UPDATE users SET data = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(JSON.stringify(data), ctx.now(), req.user!.id, id);
    if (data.status === 'fired') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    audit(ctx, req, 'update', 'employee', id, `${data.fullName} (${row.login})`);
    return toEmployee(getRow(id)!);
  });

  app.post('/api/employees/:id/reset-password', async (req) => {
    const { id } = req.params as { id: string };
    const row = getRow(id);
    if (!row) throw new HttpError(404, 'Сотрудник не найден');
    const password = tempPassword();
    db.prepare('UPDATE users SET pass_hash = ?, must_change = 1, updated_at = ? WHERE id = ?').run(await hashPassword(password), ctx.now(), id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    audit(ctx, req, 'password_reset', 'employee', id, row.login);
    return { tempPassword: password };
  });

  app.delete('/api/employees/:id', async (req) => {
    const { id } = req.params as { id: string };
    if (id === req.user!.id) throw new HttpError(400, 'Нельзя удалить самого себя');
    const row = getRow(id);
    if (!row) throw new HttpError(404, 'Сотрудник не найден');
    db.prepare('UPDATE users SET deleted_at = ?, deleted_by = ? WHERE id = ?').run(ctx.now(), req.user!.id, id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    audit(ctx, req, 'delete', 'employee', id, `${JSON.parse(row.data).fullName} (${row.login})`);
    return { ok: true };
  });
}
