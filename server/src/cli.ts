/**
 * Server-side admin commands (run inside the container):
 *   node dist/cli.js create-user <login> "<ФИО>"
 *   node dist/cli.js reset-password <login>
 *   node dist/cli.js has-users          (exit code 0 if at least one user exists)
 */
import { hashPassword } from './auth.js';
import { loadConfig } from './config.js';
import { createCtx } from './context.js';
import { tempPassword } from './crypto.js';
import { openDb } from './db.js';
import { createUser } from './routes/employees.js';

const [cmd, login, fullName] = process.argv.slice(2);
const cfg = loadConfig();
const db = openDb(cfg.dataDir, cfg.dbKey);
const ctx = createCtx(db, cfg);

try {
  if (cmd === 'create-user' && login) {
    const u = await createUser(ctx, login, { fullName: fullName || login }, null);
    console.log(`Пользователь создан.\n  Логин:  ${u.login}\n  Временный пароль: ${u.tempPassword}\nПри первом входе потребуется сменить пароль.`);
  } else if (cmd === 'has-users') {
    const { c } = db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number };
    console.log(c);
    process.exitCode = c > 0 ? 0 : 1;
  } else if (cmd === 'reset-password' && login) {
    const row = db.prepare('SELECT id FROM users WHERE login = ?').get(login) as { id: string } | undefined;
    if (!row) throw new Error('Пользователь не найден');
    const pw = tempPassword();
    db.prepare('UPDATE users SET pass_hash = ?, must_change = 1, deleted_at = NULL WHERE id = ?').run(await hashPassword(pw), row.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
    console.log(`Новый временный пароль для ${login}: ${pw}`);
  } else {
    console.log('Использование:\n  create-user <login> "<ФИО>"\n  reset-password <login>\n  has-users');
    process.exitCode = 1;
  }
} catch (e) {
  console.error('Ошибка:', (e as Error).message);
  process.exitCode = 1;
} finally {
  db.close();
}
