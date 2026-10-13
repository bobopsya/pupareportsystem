/**
 * Server-side admin commands (run inside the container):
 *   node dist/cli.js create-admin <email> "<Имя>"
 *   node dist/cli.js reset-password <email>
 *   node dist/cli.js has-admins        (exit code 0 if at least one admin exists)
 *   node dist/cli.js generate-history <shopId> [days]   (fills a shop with past payments via the real payment flow)
 */
import crypto from 'node:crypto';
import { createUser, hashPassword } from './auth.js';
import { loadConfig } from './config.js';
import { createCtx } from './context.js';
import { openDb } from './db.js';
import { generateHistory } from './history.js';

const [cmd, email, name] = process.argv.slice(2);
const cfg = loadConfig();
const db = openDb(cfg.dataDir, cfg.dbKey);
const ctx = createCtx(db, cfg);
const tempPassword = () => crypto.randomBytes(9).toString('base64url');

try {
  if (cmd === 'create-admin' && email) {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined;
    if (existing) {
      db.prepare(`UPDATE users SET role = 'admin', blocked = 0 WHERE id = ?`).run(existing.id);
      console.log(`Пользователь ${email} назначен администратором GPAY.`);
    } else {
      const pw = tempPassword();
      await createUser(ctx, email.toLowerCase(), name || 'Администратор', pw, 'admin');
      console.log(`Администратор создан.\n  Email:  ${email}\n  Пароль: ${pw}\nСмените пароль в настройках профиля.`);
    }
  } else if (cmd === 'reset-password' && email) {
    const row = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined;
    if (!row) throw new Error('Пользователь не найден');
    const pw = tempPassword();
    db.prepare('UPDATE users SET pass_hash = ?, blocked = 0 WHERE id = ?').run(await hashPassword(pw), row.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
    console.log(`Новый пароль для ${email}: ${pw}`);
  } else if (cmd === 'generate-history' && email) {
    const n = generateHistory(cfg, db, Number(email), Number(name ?? 60));
    console.log(`Создано платежей: ${n}`);
  } else if (cmd === 'has-admins') {
    const { c } = db.prepare(`SELECT COUNT(*) c FROM users WHERE role = 'admin'`).get() as { c: number };
    console.log(c);
    process.exitCode = c > 0 ? 0 : 1;
  } else {
    console.log('Использование:\n  create-admin <email> "<Имя>"\n  reset-password <email>\n  has-admins\n  generate-history <shopId> [дней]');
    process.exitCode = 1;
  }
} catch (e) {
  console.error('Ошибка:', (e as Error).message);
  process.exitCode = 1;
} finally {
  db.close();
}
