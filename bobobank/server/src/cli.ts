/**
 * Server-side admin commands (run inside the container):
 *   node dist/cli.js create-admin <phone> "<Имя Фамилия>"
 *   node dist/cli.js reset-password <phone>
 *   node dist/cli.js has-admins        (exit code 0 if at least one admin exists)
 */
import crypto from 'node:crypto';
import { loadConfig } from './config.js';
import { createCtx } from './context.js';
import { openDb } from './db.js';
import { normalizePhone } from './domain/transfers.js';
import { createUser, hashPassword } from './domain/users.js';

const [cmd, rawPhone, name] = process.argv.slice(2);
const cfg = loadConfig();
const db = openDb(cfg.dataDir, cfg.dbKey);
const ctx = createCtx(db, cfg);
const tempPassword = () => crypto.randomBytes(9).toString('base64url');
const phone = rawPhone ? normalizePhone(rawPhone) : null;

try {
  if (cmd === 'create-admin' && phone) {
    const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone) as { id: string } | undefined;
    if (existing) {
      db.prepare(`UPDATE users SET role = 'admin', blocked = 0 WHERE id = ?`).run(existing.id);
      console.log(`Пользователь +${phone} назначен администратором Bobobank.`);
    } else {
      const pw = tempPassword();
      await createUser(ctx, phone, name || 'Администратор банка', pw, { role: 'admin' });
      console.log(`Администратор создан.\n  Телефон: +${phone}\n  Пароль:  ${pw}\nСмените пароль в профиле.`);
    }
  } else if (cmd === 'reset-password' && phone) {
    const row = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone) as { id: string } | undefined;
    if (!row) throw new Error('Пользователь не найден');
    const pw = tempPassword();
    db.prepare('UPDATE users SET pass_hash = ?, blocked = 0 WHERE id = ?').run(await hashPassword(pw), row.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
    console.log(`Новый пароль для +${phone}: ${pw}`);
  } else if (cmd === 'has-admins') {
    const { c } = db.prepare(`SELECT COUNT(*) c FROM users WHERE role = 'admin'`).get() as { c: number };
    console.log(c);
    process.exitCode = c > 0 ? 0 : 1;
  } else {
    console.log('Использование:\n  create-admin <телефон> "<Имя Фамилия>"\n  reset-password <телефон>\n  has-admins');
    process.exitCode = 1;
  }
} catch (e) {
  console.error('Ошибка:', (e as Error).message);
  process.exitCode = 1;
} finally {
  db.close();
}
