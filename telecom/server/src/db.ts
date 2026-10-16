import Database from 'better-sqlite3-multiple-ciphers';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

/** Money in kopecks, coordinates in degrees, times in ms. Routes are stored as JSON arrays of [lat, lon]. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    bank_user_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    phone_masked TEXT NOT NULL DEFAULT '',
    mandate_id TEXT,
    account_last4 TEXT,
    role TEXT NOT NULL DEFAULT 'subscriber',
    created_at INTEGER NOT NULL,
    last_seen INTEGER
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  -- A phone line: the number, the tariff and what is left of its quotas in the paid period (-1 = unlimited).
  CREATE TABLE lines (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    number TEXT NOT NULL,
    tariff TEXT NOT NULL,
    next_tariff TEXT,
    status TEXT NOT NULL,
    block_reason TEXT,
    period_no INTEGER NOT NULL DEFAULT 1,
    period_start INTEGER NOT NULL,
    period_end INTEGER NOT NULL,
    minutes_left INTEGER NOT NULL,
    mb_left INTEGER NOT NULL,
    sms_left INTEGER NOT NULL,
    minutes_used INTEGER NOT NULL DEFAULT 0,
    mb_used INTEGER NOT NULL DEFAULT 0,
    sms_used INTEGER NOT NULL DEFAULT 0,
    roaming_until INTEGER,
    esim TEXT NOT NULL,
    retry_at INTEGER,
    data_at INTEGER NOT NULL,
    low_data_sent INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    closed_at INTEGER
  );
  -- One open line per person and per number; a closed number goes back to the pool.
  CREATE UNIQUE INDEX lines_user_open ON lines(user_id) WHERE status != 'closed';
  CREATE UNIQUE INDEX lines_number_open ON lines(number) WHERE status != 'closed';
  CREATE INDEX lines_due ON lines(status, period_end);

  -- Money taken through Bobobank: a number, the monthly fee, a tariff change, an add-on.
  CREATE TABLE charges (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    line_id TEXT NOT NULL REFERENCES lines(id),
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    amount INTEGER NOT NULL,
    external_id TEXT NOT NULL UNIQUE,
    bank_id TEXT,
    status TEXT NOT NULL,
    error TEXT,
    refunded INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    paid_at INTEGER
  );
  CREATE INDEX charges_user ON charges(user_id, created_at);

  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    from_number TEXT NOT NULL,
    to_number TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    read_at INTEGER
  );
  CREATE INDEX messages_to ON messages(to_number, created_at);
  CREATE INDEX messages_from ON messages(from_number, created_at);

  CREATE TABLE calls (
    id TEXT PRIMARY KEY,
    from_number TEXT NOT NULL,
    to_number TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    answered_at INTEGER,
    ended_at INTEGER,
    seconds INTEGER NOT NULL DEFAULT 0,
    billed_min INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX calls_from ON calls(from_number, created_at);
  CREATE INDEX calls_to ON calls(to_number, created_at);
  CREATE INDEX calls_status ON calls(status);
  `,
  `
  -- Numbers move from +7 9XX … to the game code +123: 79001234567 → 1239001234567.
  UPDATE lines SET number = '123' || substr(number, 2) WHERE length(number) = 11 AND number LIKE '79%';
  UPDATE messages SET from_number = '123' || substr(from_number, 2) WHERE length(from_number) = 11 AND from_number LIKE '79%';
  UPDATE messages SET to_number = '123' || substr(to_number, 2) WHERE length(to_number) = 11 AND to_number LIKE '79%';
  UPDATE calls SET from_number = '123' || substr(from_number, 2) WHERE length(from_number) = 11 AND from_number LIKE '79%';
  UPDATE calls SET to_number = '123' || substr(to_number, 2) WHERE length(to_number) = 11 AND to_number LIKE '79%';
  `,
  `
  -- Which number Bobobank and Бобуслуги know for the person (synced by the tick), and the Бобуслуги identity.
  ALTER TABLE users ADD COLUMN bank_phone TEXT;
  ALTER TABLE users ADD COLUMN gos_uid TEXT;
  ALTER TABLE users ADD COLUMN gos_login TEXT;
  ALTER TABLE users ADD COLUMN gos_name TEXT;
  ALTER TABLE users ADD COLUMN gos_passport TEXT;
  ALTER TABLE users ADD COLUMN gos_phone TEXT;
  ALTER TABLE users ADD COLUMN gos_linked_at INTEGER;
  CREATE UNIQUE INDEX users_gos_uid ON users(gos_uid) WHERE gos_uid IS NOT NULL;
  `,
];

export function openDb(dataDir: string | null, key = ''): DB {
  let db: DB;
  if (dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    db = new Database(path.join(dataDir, 'telecom.db'));
  } else {
    db = new Database(':memory:');
  }
  if (key) {
    if (!/^[0-9a-f]+$/i.test(key)) throw new Error('invalid DB key');
    db.pragma(`hexkey='${key}'`);
  }
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

export function getSetting<T>(db: DB, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : fallback;
}

export function setSetting(db: DB, key: string, value: unknown) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
}
