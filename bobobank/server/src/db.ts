import Database from 'better-sqlite3-multiple-ciphers';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

/**
 * Money is stored in minor units (kopecks / cents). Balances change only through the ledger
 * (domain/ledger.ts): every transaction is a set of entries that sum to zero per currency.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    phone TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    birth_date TEXT NOT NULL DEFAULT '',
    pass_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'client',
    tariff TEXT NOT NULL DEFAULT 'standard',
    tariff_paid_until INTEGER,
    bonus INTEGER NOT NULL DEFAULT 0,
    cashback TEXT NOT NULL DEFAULT '{}',
    blocked INTEGER NOT NULL DEFAULT 0,
    block_reason TEXT,
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

  CREATE TABLE login_attempts (ip TEXT NOT NULL, ts INTEGER NOT NULL, phone TEXT);
  CREATE INDEX login_attempts_ip ON login_attempts(ip, ts);

  -- One-time confirmation codes for registration (shown on screen instead of SMS).
  CREATE TABLE phone_codes (
    phone TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0
  );

  -- user_id is NULL for the bank's own (system) accounts, which are addressed by system_code.
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    user_id TEXT REFERENCES users(id),
    kind TEXT NOT NULL,
    currency TEXT NOT NULL,
    name TEXT NOT NULL,
    balance INTEGER NOT NULL DEFAULT 0,
    credit_limit INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open',
    params TEXT NOT NULL DEFAULT '{}',
    system_code TEXT UNIQUE,
    created_at INTEGER NOT NULL,
    closed_at INTEGER
  );
  CREATE INDEX accounts_user ON accounts(user_id, status);

  CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    description TEXT NOT NULL DEFAULT '',
    initiator_id TEXT,
    meta TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX transactions_created ON transactions(created_at);

  -- What each side of a transaction sees in its history lives on its own entry.
  CREATE TABLE entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_id TEXT NOT NULL REFERENCES transactions(id),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    balance_after INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    subtitle TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'other',
    card_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX entries_account ON entries(account_id, created_at);
  CREATE INDEX entries_tx ON entries(tx_id);

  CREATE TABLE cards (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    network TEXT NOT NULL,
    kind TEXT NOT NULL,
    form TEXT NOT NULL,
    tariff TEXT NOT NULL,
    design TEXT NOT NULL,
    holder TEXT NOT NULL,
    pan_enc TEXT NOT NULL,
    pan_hash TEXT NOT NULL UNIQUE,
    first6 TEXT NOT NULL,
    last4 TEXT NOT NULL,
    exp_month INTEGER NOT NULL,
    exp_year INTEGER NOT NULL,
    cvc_enc TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    status_reason TEXT,
    limits TEXT NOT NULL DEFAULT '{}',
    confirm_purchases INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX cards_user ON cards(user_id);

  CREATE TABLE holds (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    card_id TEXT,
    amount INTEGER NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    status TEXT NOT NULL DEFAULT 'active',
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX holds_account ON holds(account_id, status);

  -- Card authorizations requested by GPAY.
  CREATE TABLE authorizations (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES cards(id),
    account_id TEXT NOT NULL,
    hold_id TEXT,
    external_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    account_amount INTEGER NOT NULL,
    merchant TEXT NOT NULL DEFAULT '{}',
    capture INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL,
    reason TEXT,
    captured INTEGER NOT NULL DEFAULT 0,
    refunded INTEGER NOT NULL DEFAULT 0,
    bonus INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    decided_at INTEGER
  );
  CREATE INDEX authorizations_card ON authorizations(card_id, status);

  CREATE TABLE loans (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    payout_account_id TEXT NOT NULL REFERENCES accounts(id),
    principal INTEGER NOT NULL,
    rate REAL NOT NULL,
    term INTEGER NOT NULL,
    payment INTEGER NOT NULL,
    schedule TEXT NOT NULL,
    penalty INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    closed_at INTEGER
  );

  CREATE TABLE applications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    product TEXT NOT NULL,
    amount INTEGER NOT NULL,
    term INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    score INTEGER,
    factors TEXT NOT NULL DEFAULT '{}',
    offer_amount INTEGER,
    offer_rate REAL,
    reason TEXT,
    decided_by TEXT,
    result_id TEXT,
    decide_at INTEGER,
    created_at INTEGER NOT NULL,
    decided_at INTEGER
  );

  CREATE TABLE restrictions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    account_id TEXT,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    reason TEXT NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    created_by TEXT,
    created_at INTEGER NOT NULL,
    lifted_at INTEGER,
    lifted_by TEXT,
    lift_comment TEXT
  );
  CREATE INDEX restrictions_user ON restrictions(user_id, lifted_at);

  CREATE TABLE support_threads (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    assignee_id TEXT,
    unread_client INTEGER NOT NULL DEFAULT 0,
    unread_support INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX support_threads_user ON support_threads(user_id, updated_at);

  CREATE TABLE support_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT NOT NULL REFERENCES support_threads(id),
    author TEXT NOT NULL,
    author_id TEXT,
    author_name TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX support_messages_thread ON support_messages(thread_id, id);

  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    read_at INTEGER
  );
  CREATE INDEX notifications_user ON notifications(user_id, id);

  -- One-time codes that connect a business account to a GPAY shop for payouts.
  CREATE TABLE gpay_links (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    code_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    shop_id INTEGER,
    shop_name TEXT,
    created_at INTEGER NOT NULL
  );

  -- Bobobonuses: 1 bonus = 1 ₽, stored in hundredths like money.
  CREATE TABLE bonus_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL,
    title TEXT NOT NULL,
    category TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX bonus_log_user ON bonus_log(user_id, created_at);

  CREATE TABLE sbp_payments (
    id TEXT PRIMARY KEY,
    external_id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    merchant TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL,
    tx_id TEXT,
    created_at INTEGER NOT NULL
  );

  -- Responses to signed requests from GPAY, replayed for the same Idempotence-Key.
  CREATE TABLE idempotency (
    key TEXT PRIMARY KEY,
    status INTEGER NOT NULL,
    response TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    user_id TEXT,
    user_name TEXT,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    summary TEXT,
    ip TEXT
  );
  CREATE INDEX audit_ts ON audit(ts);
  `,
  `
  CREATE TABLE favorites (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    bik TEXT,
    amount INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX favorites_user ON favorites(user_id, created_at);

  -- "Bobo Pay": GPAY orders paid from the app, by button (redirect) or by a request to the customer's phone.
  CREATE TABLE payment_requests (
    id TEXT PRIMARY KEY,
    external_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    merchant TEXT NOT NULL DEFAULT '{}',
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    account_id TEXT,
    tx_id TEXT,
    refunded INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    decided_at INTEGER
  );
  CREATE INDEX payment_requests_user ON payment_requests(user_id, status);
  CREATE INDEX payment_requests_ext ON payment_requests(external_id);
  ALTER TABLE sbp_payments ADD COLUMN method TEXT NOT NULL DEFAULT 'sbp';

  -- Flat card designs replace the gradient ones.
  UPDATE cards SET design = CASE design
    WHEN 'night' THEN 'black' WHEN 'graphite' THEN 'black' WHEN 'sunset' THEN 'black'
    WHEN 'emerald' THEN 'green' WHEN 'aurora' THEN 'green' WHEN 'gold' THEN 'prime' ELSE design END;
  `,
];

export function openDb(dataDir: string | null, key = ''): DB {
  let db: DB;
  if (dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    db = new Database(path.join(dataDir, 'bobobank.db'));
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
