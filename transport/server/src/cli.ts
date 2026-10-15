/**
 * Server-side admin commands (run inside the container):
 *   node dist/cli.js users                  — who has signed in
 *   node dist/cli.js make-admin "<Имя>"     — give admin rights (sign in via Bobobank first)
 *   node dist/cli.js has-admins
 */
import { loadConfig } from './config.js';
import { openDb } from './db.js';

const [cmd, arg] = process.argv.slice(2);
const cfg = loadConfig();
const db = openDb(cfg.dataDir, cfg.dbKey);

try {
  if (cmd === 'users') {
    const rows = db.prepare('SELECT id, name, phone_masked, role FROM users ORDER BY created_at').all() as { id: string; name: string; phone_masked: string; role: string }[];
    if (!rows.length) console.log('Пока никто не входил. Откройте сайт и нажмите «Войти через Bobobank».');
    for (const r of rows) console.log(`${r.id}  ${r.name}  ${r.phone_masked}  ${r.role}`);
  } else if (cmd === 'make-admin' && arg) {
    const rows = db.prepare('SELECT id, name FROM users WHERE id = ? OR name LIKE ?').all(arg, `%${arg}%`) as { id: string; name: string }[];
    if (rows.length !== 1) {
      console.log(rows.length ? `Найдено несколько: ${rows.map((r) => `${r.name} (${r.id})`).join(', ')}. Укажите id.` : 'Пользователь не найден. Сначала войдите на сайт через Bobobank.');
      process.exitCode = 1;
    } else {
      db.prepare(`UPDATE users SET role = 'admin' WHERE id = ?`).run(rows[0].id);
      console.log(`${rows[0].name} теперь администратор Бобо.Транспорта.`);
    }
  } else if (cmd === 'has-admins') {
    const { c } = db.prepare(`SELECT COUNT(*) c FROM users WHERE role = 'admin'`).get() as { c: number };
    console.log(c);
    process.exitCode = c > 0 ? 0 : 1;
  } else {
    console.log('Использование:\n  users\n  make-admin "<Имя или id>"\n  has-admins');
    process.exitCode = 1;
  }
} finally {
  db.close();
}
