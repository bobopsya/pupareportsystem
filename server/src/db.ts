import Database from 'better-sqlite3-multiple-ciphers';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    login TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    must_change INTEGER NOT NULL DEFAULT 1,
    data TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    created_by TEXT,
    updated_by TEXT,
    deleted_at INTEGER,
    deleted_by TEXT
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE login_attempts (
    ip TEXT NOT NULL,
    ts INTEGER NOT NULL,
    login TEXT
  );
  CREATE INDEX login_attempts_ip ON login_attempts(ip, ts);

  CREATE TABLE records (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    created_by TEXT,
    updated_by TEXT,
    deleted_at INTEGER,
    deleted_by TEXT
  );
  CREATE INDEX records_type ON records(type, deleted_at);

  CREATE TABLE files (
    id TEXT PRIMARY KEY,
    owner_type TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    caption TEXT NOT NULL DEFAULT '',
    has_thumb INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    created_by TEXT,
    deleted_at INTEGER,
    deleted_by TEXT
  );
  CREATE INDEX files_owner ON files(owner_type, owner_id, deleted_at);

  CREATE TABLE audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    user_id TEXT,
    user_login TEXT,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    summary TEXT,
    ip TEXT
  );
  CREATE INDEX audit_ts ON audit(ts);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `
  -- Daily check-ins ("я на связи"); day is the Moscow calendar date YYYY-MM-DD.
  CREATE TABLE checkins (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    ts INTEGER NOT NULL,
    source TEXT NOT NULL,
    PRIMARY KEY (user_id, day)
  );
  CREATE INDEX checkins_day ON checkins(day);

  -- Missed check-ins already announced in the Telegram channel (one row per employee per day).
  CREATE TABLE checkin_reports (
    day TEXT NOT NULL,
    user_id TEXT NOT NULL,
    sent_at INTEGER NOT NULL,
    PRIMARY KEY (day, user_id)
  );

  CREATE TABLE tg_links (
    tg_id INTEGER PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    username TEXT,
    linked_at INTEGER NOT NULL
  );

  CREATE TABLE tg_link_codes (
    code_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  `,
];

export function openDb(dataDir: string, keyHex: string): DB {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'portal.db'));
  if (!/^[0-9a-f]+$/i.test(keyHex)) throw new Error('invalid DB key');
  db.pragma(`hexkey='${keyHex}'`);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db: DB) {
  const version = db.pragma('user_version', { simple: true }) as number;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

export function getSetting(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(db: DB, key: string, value: string | null) {
  if (value === null) db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  else db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
