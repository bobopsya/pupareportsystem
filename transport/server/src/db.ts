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
    role TEXT NOT NULL DEFAULT 'rider',
    rating REAL NOT NULL DEFAULT 4.9,
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

  CREATE TABLE places (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    address TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX places_user ON places(user_id);

  -- A priced route the customer saw: the order uses exactly this route and these prices.
  CREATE TABLE estimates (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    from_json TEXT NOT NULL,
    to_json TEXT NOT NULL,
    distance_m INTEGER NOT NULL,
    duration_s INTEGER NOT NULL,
    route TEXT NOT NULL,
    approx INTEGER NOT NULL DEFAULT 0,
    surge REAL NOT NULL,
    prices TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE rides (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL,
    tariff TEXT NOT NULL,
    from_json TEXT NOT NULL,
    to_json TEXT NOT NULL,
    distance_m INTEGER NOT NULL,
    duration_s INTEGER NOT NULL,
    route TEXT NOT NULL,
    surge REAL NOT NULL,
    price INTEGER NOT NULL,
    child_seat INTEGER NOT NULL DEFAULT 0,
    comment TEXT NOT NULL DEFAULT '',
    time_scale REAL NOT NULL,
    hold_amount INTEGER NOT NULL DEFAULT 0,
    hold_id TEXT,
    bank_op TEXT,
    bank_status TEXT NOT NULL DEFAULT 'none',
    bank_error TEXT,
    final_price INTEGER,
    wait_paid_s INTEGER NOT NULL DEFAULT 0,
    cancel_fee INTEGER NOT NULL DEFAULT 0,
    driver TEXT,
    car TEXT,
    car_route TEXT,
    car_duration_s INTEGER,
    assign_at INTEGER NOT NULL,
    assigned_at INTEGER,
    arrive_at INTEGER,
    arrived_at INTEGER,
    started_at INTEGER,
    finish_at INTEGER,
    finished_at INTEGER,
    cancelled_at INTEGER,
    cancelled_by TEXT,
    progress REAL,
    rating INTEGER,
    tip INTEGER NOT NULL DEFAULT 0,
    tip_status TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX rides_user ON rides(user_id, created_at);
  CREATE INDEX rides_status ON rides(status);

  -- Answers from Nominatim and OSRM: the public servers ask to cache and not to repeat requests.
  CREATE TABLE geo_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at INTEGER NOT NULL);
  `,
  `
  -- Buses, helicopters and private jets share the ride table; mode-specific details go to extra (JSON).
  ALTER TABLE rides ADD COLUMN mode TEXT NOT NULL DEFAULT 'taxi';
  ALTER TABLE rides ADD COLUMN extra TEXT NOT NULL DEFAULT '{}';
  -- An amount above the Bobobank mandate limit waits for the customer's confirmation in the bank app.
  ALTER TABLE rides ADD COLUMN confirmation_id TEXT;
  ALTER TABLE rides ADD COLUMN confirm_url TEXT;
  ALTER TABLE rides ADD COLUMN confirm_expires_at INTEGER;
  ALTER TABLE estimates ADD COLUMN mode TEXT NOT NULL DEFAULT 'taxi';
  `,
  `
  -- Real time by default and new prices: forget the old speed-ups and prices saved in the admin panel.
  UPDATE settings SET value = json_remove(value, '$.timeScale', '$.airTimeScale', '$.autoBoardS', '$.tariffs', '$.cancelFee', '$.childSeat') WHERE key = 'settings';
  `,
];

export function openDb(dataDir: string | null, key = ''): DB {
  let db: DB;
  if (dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    db = new Database(path.join(dataDir, 'transport.db'));
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
