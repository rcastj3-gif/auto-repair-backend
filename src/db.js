import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DTC_CODES } from './data/dtc-codes.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  shop_name         TEXT    NOT NULL DEFAULT 'My Auto Shop',
  phone             TEXT,
  address           TEXT,
  labor_rate_cents  INTEGER NOT NULL DEFAULT 12000,
  tax_rate          REAL    NOT NULL DEFAULT 0,
  tax_labor         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS customers (
  id          INTEGER PRIMARY KEY,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  address     TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicles (
  id           INTEGER PRIMARY KEY,
  customer_id  INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  vin          TEXT,
  year         INTEGER,
  make         TEXT,
  model        TEXT,
  trim         TEXT,
  engine       TEXT,
  license_plate TEXT,
  color        TEXT,
  mileage      INTEGER,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vehicles_customer ON vehicles(customer_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_vin ON vehicles(vin);

CREATE TABLE IF NOT EXISTS work_orders (
  id           INTEGER PRIMARY KEY,
  vehicle_id   INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'estimate'
               CHECK (status IN ('estimate','approved','in_progress','completed','invoiced','cancelled')),
  complaint    TEXT,
  diagnosis    TEXT,
  technician   TEXT,
  mileage_in   INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_work_orders_vehicle ON work_orders(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);

CREATE TABLE IF NOT EXISTS work_order_items (
  id                INTEGER PRIMARY KEY,
  work_order_id     INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL CHECK (kind IN ('labor','part','fee')),
  description       TEXT NOT NULL,
  part_number       TEXT,
  quantity          REAL NOT NULL DEFAULT 1,
  unit_price_cents  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_work_order ON work_order_items(work_order_id);

CREATE TABLE IF NOT EXISTS work_order_codes (
  work_order_id  INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,
  notes          TEXT,
  PRIMARY KEY (work_order_id, code)
);

CREATE TABLE IF NOT EXISTS invoices (
  id                 INTEGER PRIMARY KEY,
  work_order_id      INTEGER NOT NULL UNIQUE REFERENCES work_orders(id),
  labor_cents        INTEGER NOT NULL,
  parts_cents        INTEGER NOT NULL,
  fees_cents         INTEGER NOT NULL,
  tax_cents          INTEGER NOT NULL,
  total_cents        INTEGER NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Line items are copied onto the invoice so later edits never change a bill already given to a customer.
CREATE TABLE IF NOT EXISTS invoice_items (
  id                INTEGER PRIMARY KEY,
  invoice_id        INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL,
  description       TEXT NOT NULL,
  part_number       TEXT,
  quantity          REAL NOT NULL,
  unit_price_cents  INTEGER NOT NULL,
  line_total_cents  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id            INTEGER PRIMARY KEY,
  invoice_id    INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  method        TEXT NOT NULL DEFAULT 'card' CHECK (method IN ('cash','card','check','other')),
  note          TEXT,
  paid_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dtc_codes (
  code           TEXT PRIMARY KEY,
  description    TEXT NOT NULL,
  system         TEXT NOT NULL,
  common_causes  TEXT
);
`;

export function openDatabase(path = process.env.DB_PATH || 'data/shop.db') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  db.exec('INSERT OR IGNORE INTO settings (id) VALUES (1);');
  seedCodes(db);
  return db;
}

function seedCodes(db) {
  const insert = db.prepare(
    'INSERT OR REPLACE INTO dtc_codes (code, description, system, common_causes) VALUES (?, ?, ?, ?)'
  );
  db.exec('BEGIN');
  try {
    for (const [code, description, causes] of DTC_CODES) {
      insert.run(code, description, systemFor(code), causes ? causes.join('; ') : null);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const SYSTEMS = { P: 'Powertrain', B: 'Body', C: 'Chassis', U: 'Network' };

export function systemFor(code) {
  return SYSTEMS[code[0]] ?? 'Unknown';
}

export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
