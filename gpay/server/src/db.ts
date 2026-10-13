import Database from 'better-sqlite3-multiple-ciphers';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    pass_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'merchant',
    blocked INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
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

  CREATE TABLE login_attempts (ip TEXT NOT NULL, ts INTEGER NOT NULL, email TEXT);
  CREATE INDEX login_attempts_ip ON login_attempts(ip, ts);

  -- Numeric shop ids look like real acquiring accounts (used as the Basic auth login).
  CREATE TABLE shops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    legal_name TEXT NOT NULL,
    inn TEXT NOT NULL,
    tax_system TEXT NOT NULL,
    site TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#5b3df5',
    status TEXT NOT NULL DEFAULT 'active',
    methods TEXT NOT NULL DEFAULT '["bank_card","sbp","installments","crypto"]',
    fees TEXT NOT NULL DEFAULT '{}',
    return_url TEXT NOT NULL DEFAULT '',
    default_vat TEXT NOT NULL DEFAULT 'vat22',
    kkt_rn TEXT NOT NULL,
    fn_number TEXT NOT NULL,
    fd_counter INTEGER NOT NULL DEFAULT 0,
    shift_no INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  INSERT INTO sqlite_sequence(name, seq) VALUES('shops', 412037);

  CREATE TABLE api_keys (
    id TEXT PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id),
    name TEXT NOT NULL,
    hash TEXT NOT NULL UNIQUE,
    last4 TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked_at INTEGER
  );

  CREATE TABLE payments (
    id TEXT PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id),
    status TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    fee INTEGER NOT NULL DEFAULT 0,
    refunded INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    capture INTEGER NOT NULL DEFAULT 1,
    paid INTEGER NOT NULL DEFAULT 0,
    method_type TEXT,
    method TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    receipt TEXT,
    return_url TEXT,
    customer_email TEXT,
    cancellation TEXT,
    link_id TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    pending_action TEXT,
    processing_until INTEGER,
    source TEXT NOT NULL DEFAULT 'api',
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    authorized_at INTEGER,
    captured_at INTEGER,
    capture_deadline INTEGER
  );
  CREATE INDEX payments_shop ON payments(shop_id, created_at);
  CREATE INDEX payments_status ON payments(status);

  CREATE TABLE payment_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    type TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX payment_events_payment ON payment_events(payment_id, id);

  CREATE TABLE refunds (
    id TEXT PRIMARY KEY,
    payment_id TEXT NOT NULL REFERENCES payments(id),
    shop_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX refunds_shop ON refunds(shop_id, created_at);
  CREATE INDEX refunds_payment ON refunds(payment_id);

  CREATE TABLE receipts (
    id TEXT PRIMARY KEY,
    shop_id INTEGER NOT NULL,
    payment_id TEXT NOT NULL,
    refund_id TEXT,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX receipts_payment ON receipts(payment_id);

  CREATE TABLE payment_links (
    id TEXT PRIMARY KEY,
    shop_id INTEGER NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    amount INTEGER,
    min_amount INTEGER,
    max_amount INTEGER,
    currency TEXT NOT NULL,
    reusable INTEGER NOT NULL DEFAULT 1,
    uses INTEGER NOT NULL DEFAULT 0,
    paid_count INTEGER NOT NULL DEFAULT 0,
    paid_total INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    expires_at INTEGER,
    items TEXT,
    customer TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX payment_links_shop ON payment_links(shop_id, created_at);

  CREATE TABLE webhooks (
    id TEXT PRIMARY KEY,
    shop_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    secret TEXT NOT NULL,
    events TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE webhook_deliveries (
    id TEXT PRIMARY KEY,
    webhook_id TEXT NOT NULL,
    shop_id INTEGER NOT NULL,
    event TEXT NOT NULL,
    object_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_at INTEGER,
    last_code INTEGER,
    last_error TEXT,
    last_body TEXT,
    last_ms INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX webhook_deliveries_due ON webhook_deliveries(status, next_at);
  CREATE INDEX webhook_deliveries_shop ON webhook_deliveries(shop_id, created_at);

  CREATE TABLE api_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id INTEGER NOT NULL,
    key_id TEXT,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status INTEGER NOT NULL,
    ms INTEGER NOT NULL,
    idem_key TEXT,
    req_body TEXT,
    res_body TEXT,
    ip TEXT,
    ts INTEGER NOT NULL
  );
  CREATE INDEX api_requests_shop ON api_requests(shop_id, id);

  CREATE TABLE idempotency (
    shop_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    req_hash TEXT NOT NULL,
    status INTEGER NOT NULL,
    response TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (shop_id, key)
  );

  CREATE TABLE payouts (
    id TEXT PRIMARY KEY,
    shop_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    destination TEXT NOT NULL,
    status TEXT NOT NULL,
    processing_until INTEGER,
    created_at INTEGER NOT NULL,
    completed_at INTEGER
  );
  CREATE INDEX payouts_shop ON payouts(shop_id, created_at);

  CREATE TABLE game_cards (
    pan TEXT PRIMARY KEY,
    outcome TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    user_id TEXT,
    user_email TEXT,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    summary TEXT,
    ip TEXT
  );
  CREATE INDEX audit_ts ON audit(ts);
  `,
];

export function openDb(dataDir: string | null, key = ''): DB {
  let db: DB;
  if (dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    db = new Database(path.join(dataDir, 'gpay.db'));
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
