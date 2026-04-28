/**
 * SQLite -> PostgreSQL Data Migration Script
 *
 * Usage:
 *   DATABASE_URL="postgresql://user:pass@host:5432/superice" npx tsx scripts/migrate-to-pg.ts
 *   npx tsx scripts/migrate-to-pg.ts [path-to-sqlite.db] [factory-key]
 *
 * factory-key (si | bearing | ktk) reads DATABASE_URL_<FACTORY> from .env.local.
 * If omitted, uses DATABASE_URL from env.
 *
 * This script:
 *  1. Reads all data from the local SQLite database
 *  2. Creates the PostgreSQL schema
 *  3. Copies data table-by-table in FK dependency order
 *  4. Converts date/time strings to proper types
 *  5. Resets PostgreSQL sequences
 *  6. Validates row counts and integrity
 */

import Database from "better-sqlite3";
import postgres from "postgres";
import * as fs from "fs";
import * as path from "path";
import {
  LEGACY_BY_ID,
  LEGACY_BY_NAME,
  NEW_ICE_BY_ID,
  NEW_ICE_PRODUCTS,
} from "../src/lib/product-definitions";

// ==================== Config ====================
const SQLITE_PATH = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, "..", "superice.db");

// Load .env.local for factory URLs
function parseEnvFile(fp: string): Record<string, string> {
  if (!fs.existsSync(fp)) return {};
  const out: Record<string, string> = {};
  for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) {
    const t = l.trim(); if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("="); if (i <= 0) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[t.slice(0, i).trim()] = v;
  }
  return out;
}

const env = parseEnvFile(path.join(process.cwd(), ".env.local"));
const factoryKey = process.argv[3];
let PG_URL = process.env.DATABASE_URL;
if (factoryKey) {
  const envVar = `DATABASE_URL_${factoryKey.toUpperCase()}`;
  PG_URL = process.env[envVar] || env[envVar] || PG_URL;
}

if (!PG_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required.");
  console.error(
    'Usage: npx tsx scripts/migrate-to-pg.ts [path-to-sqlite.db] [factory-key]'
  );
  console.error('  factory-key: si | bearing | ktk (reads from .env.local)');
  process.exit(1);
}

const BATCH_SIZE = 1000;

// ==================== Connect ====================
console.log("Connecting to SQLite:", SQLITE_PATH);
const sqlite = new Database(SQLITE_PATH, { readonly: true });

console.log("Connecting to PostgreSQL...");
const pg = postgres(PG_URL, { max: 5 });

type SqliteProductRow = {
  id: number;
  name: string;
  name_en?: string | null;
  has_bag?: number | boolean | null;
  decreases_bag?: number | boolean | null;
  is_active?: number | boolean | null;
  sort_order?: number | null;
};

type NormalizedProductRow = {
  id: number;
  name: string;
  name_en: string | null;
  has_bag: boolean;
  decreases_bag: boolean;
  is_active: boolean;
  sort_order: number;
  family: string | null;
  form: string | null;
  package_type: string | null;
  size_value: number | null;
  size_unit: string | null;
  size_label: string | null;
};

let sqliteProductRowsCache: SqliteProductRow[] | null = null;
let sqliteProductIdRemapCache: Map<number, number> | null = null;
let normalizedProductRowsCache: NormalizedProductRow[] | null = null;

// ==================== Helpers ====================
function toTimestamp(val: string | null | undefined): Date | null {
  if (!val || val === "") return new Date();
  // Handle ISO format: "2024-01-15T10:30:00" or "2024-01-15T10:30:00.000Z"
  const d = new Date(val);
  if (!isNaN(d.getTime())) return d;
  return new Date();
}

function toDate(val: string | null | undefined): string | null {
  if (!val || val === "") return null;
  // Already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  // Try to parse
  const d = new Date(val);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  return val;
}

function toTime(val: string | null | undefined): string | null {
  if (!val || val === "") return "00:00:00";
  // Already in HH:MM:SS format
  if (/^\d{2}:\d{2}:\d{2}$/.test(val)) return val;
  if (/^\d{2}:\d{2}$/.test(val)) return val + ":00";
  return val;
}

function toBool(val: number | boolean | null | undefined): boolean {
  if (typeof val === "boolean") return val;
  return val === 1;
}

function getSqliteProductRows(): SqliteProductRow[] {
  if (!sqliteProductRowsCache) {
    sqliteProductRowsCache = sqlite
      .prepare("SELECT * FROM product_types ORDER BY id")
      .all()
      .map((row: any) => ({
        id: Number(row.id),
        name: String(row.name ?? ""),
        name_en: row.name_en == null ? null : String(row.name_en),
        has_bag: row.has_bag,
        decreases_bag: row.decreases_bag,
        is_active: row.is_active,
        sort_order: row.sort_order == null ? null : Number(row.sort_order),
      }));
  }
  return sqliteProductRowsCache;
}

function getProductIdRemap(): Map<number, number> {
  if (!sqliteProductIdRemapCache) {
    sqliteProductIdRemapCache = new Map(
      getSqliteProductRows().map((row) => {
        const legacy = LEGACY_BY_ID.get(row.id) ?? LEGACY_BY_NAME.get(row.name);
        return [row.id, legacy?.newId ?? row.id];
      })
    );
  }
  return sqliteProductIdRemapCache;
}

function mapProductTypeId(productTypeId: unknown): number {
  const normalizedId = Number(productTypeId ?? 0);
  const mappedId = getProductIdRemap().get(normalizedId);
  if (mappedId == null) {
    throw new Error(`Unable to map SQLite product_type_id ${normalizedId}`);
  }
  return mappedId;
}

function getNormalizedProductRows(): NormalizedProductRow[] {
  if (!normalizedProductRowsCache) {
    const byId = new Map<number, NormalizedProductRow>();

    for (const row of getSqliteProductRows()) {
      const legacy = LEGACY_BY_ID.get(row.id) ?? LEGACY_BY_NAME.get(row.name);
      const canonical = NEW_ICE_BY_ID.get(row.id);
      const normalized: NormalizedProductRow = legacy
        ? {
            id: legacy.newId,
            name: legacy.name,
            name_en: legacy.nameEn,
            has_bag: legacy.hasBag,
            decreases_bag: false,
            is_active: false,
            sort_order: 900 + legacy.newId,
            family: null,
            form: null,
            package_type: null,
            size_value: null,
            size_unit: null,
            size_label: null,
          }
        : canonical
          ? {
              id: canonical.id,
              name: canonical.name,
              name_en: canonical.nameEn,
              has_bag: canonical.hasBag,
              decreases_bag: false,
              is_active: canonical.isActive,
              sort_order: canonical.sortOrder,
              family: canonical.family,
              form: canonical.form,
              package_type: canonical.packageType,
              size_value: canonical.sizeValue,
              size_unit: canonical.sizeUnit,
              size_label: canonical.sizeLabel,
            }
          : {
              id: row.id,
              name: row.name,
              name_en: row.name_en ?? null,
              has_bag: toBool(row.has_bag),
              decreases_bag: toBool(row.decreases_bag),
              is_active: toBool(row.is_active),
              sort_order: row.sort_order ?? row.id,
              family: null,
              form: null,
              package_type: null,
              size_value: null,
              size_unit: null,
              size_label: null,
            };

      const existing = byId.get(normalized.id);
      if (
        existing &&
        (
          existing.name !== normalized.name ||
          existing.name_en !== normalized.name_en ||
          existing.has_bag !== normalized.has_bag ||
          existing.decreases_bag !== normalized.decreases_bag
        )
      ) {
        throw new Error(
          `Conflicting product normalization for target id ${normalized.id}: '${existing.name}' vs '${normalized.name}'`
        );
      }

      byId.set(normalized.id, normalized);
    }

    for (const canonical of NEW_ICE_PRODUCTS) {
      if (byId.has(canonical.id)) continue;
      byId.set(canonical.id, {
        id: canonical.id,
        name: canonical.name,
        name_en: canonical.nameEn,
        has_bag: canonical.hasBag,
        decreases_bag: false,
        is_active: canonical.isActive,
        sort_order: canonical.sortOrder,
        family: canonical.family,
        form: canonical.form,
        package_type: canonical.packageType,
        size_value: canonical.sizeValue,
        size_unit: canonical.sizeUnit,
        size_label: canonical.sizeLabel,
      });
    }

    normalizedProductRowsCache = Array.from(byId.values()).sort((left, right) => left.id - right.id);
  }

  return normalizedProductRowsCache;
}

// ==================== Schema Creation ====================
async function createSchema() {
  console.log("\n=== Creating PostgreSQL schema ===");

  // Create enums
  await pg.unsafe(`
    DO $$ BEGIN
      CREATE TYPE transaction_status AS ENUM ('paid', 'unpaid', 'partial', 'voided');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
  `);
  await pg.unsafe(`
    DO $$ BEGIN
      CREATE TYPE bag_ledger_type AS ENUM ('out', 'return', 'adjust');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
  `);
  await pg.unsafe(`
    DO $$ BEGIN
      CREATE TYPE user_role AS ENUM ('admin', 'office', 'manager', 'factory');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
  `);

  // Create tables
  await pg.unsafe(`
    CREATE TABLE IF NOT EXISTS product_types (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      name_en TEXT,
      has_bag BOOLEAN NOT NULL DEFAULT false,
      decreases_bag BOOLEAN NOT NULL DEFAULT false,
      is_active BOOLEAN NOT NULL DEFAULT true,
      sort_order INTEGER NOT NULL DEFAULT 0,
      family TEXT,
      form TEXT,
      package_type TEXT,
      size_value INTEGER,
      size_unit TEXT,
      size_label TEXT
    );
  `);

  await pg.unsafe(`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      credit BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pg.unsafe(`
    CREATE TABLE IF NOT EXISTS customer_prices (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      product_type_id INTEGER NOT NULL REFERENCES product_types(id),
      unit_price DOUBLE PRECISION NOT NULL DEFAULT 0,
      bag_deposit DOUBLE PRECISION NOT NULL DEFAULT 0
    );
  `);

  await pg.unsafe(`
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      total_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      paid DOUBLE PRECISION NOT NULL DEFAULT 0,
      status transaction_status NOT NULL DEFAULT 'paid',
      pool INTEGER,
      "row" INTEGER,
      col INTEGER,
      sale_date DATE NOT NULL,
      sale_time TIME(0) NOT NULL,
      note TEXT,
      printed_bill_number INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pg.unsafe(`
    CREATE TABLE IF NOT EXISTS bill_counters (
      id SERIAL PRIMARY KEY,
      factory_key TEXT NOT NULL,
      next_number INTEGER NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pg.unsafe(`
    CREATE TABLE IF NOT EXISTS production_logs (
      id SERIAL PRIMARY KEY,
      product_type_id INTEGER NOT NULL REFERENCES product_types(id),
      quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pg.unsafe(`
    CREATE TABLE IF NOT EXISTS transaction_items (
      id SERIAL PRIMARY KEY,
      transaction_id INTEGER NOT NULL REFERENCES transactions(id),
      product_type_id INTEGER NOT NULL REFERENCES product_types(id),
      quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
      unit_price DOUBLE PRECISION NOT NULL DEFAULT 0,
      subtotal DOUBLE PRECISION NOT NULL DEFAULT 0
    );
  `);

  await pg.unsafe(`
    CREATE TABLE IF NOT EXISTS bag_ledger (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      product_type_id INTEGER NOT NULL REFERENCES product_types(id),
      type bag_ledger_type NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      transaction_id INTEGER REFERENCES transactions(id),
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pg.unsafe(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role user_role NOT NULL DEFAULT 'office'
    );
  `);

  // Create indexes
  await pg.unsafe(`CREATE INDEX IF NOT EXISTS idx_customer_prices_customer_id ON customer_prices(customer_id);`);
  await pg.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_prices_customer_product ON customer_prices(customer_id, product_type_id);`);
  await pg.unsafe(`CREATE INDEX IF NOT EXISTS idx_transactions_customer_id ON transactions(customer_id);`);
  await pg.unsafe(`CREATE INDEX IF NOT EXISTS idx_transactions_sale_date ON transactions(sale_date);`);
  await pg.unsafe(`CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);`);
  await pg.unsafe(`CREATE INDEX IF NOT EXISTS idx_transactions_date_status ON transactions(sale_date, status);`);
  await pg.unsafe(`CREATE INDEX IF NOT EXISTS idx_transactions_printed_bill_number ON transactions(printed_bill_number);`);
  await pg.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS idx_bill_counters_factory ON bill_counters(factory_key);`);
  await pg.unsafe(`CREATE INDEX IF NOT EXISTS idx_transaction_items_transaction_id ON transaction_items(transaction_id);`);
  await pg.unsafe(`CREATE INDEX IF NOT EXISTS idx_transaction_items_product_type_id ON transaction_items(product_type_id);`);
  await pg.unsafe(`CREATE INDEX IF NOT EXISTS idx_bag_ledger_customer_id ON bag_ledger(customer_id);`);
  await pg.unsafe(`CREATE INDEX IF NOT EXISTS idx_bag_ledger_transaction_id ON bag_ledger(transaction_id);`);
  await pg.unsafe(`CREATE INDEX IF NOT EXISTS idx_bag_ledger_customer_product ON bag_ledger(customer_id, product_type_id);`);

  console.log("Schema created successfully.");
}

async function truncateAllData() {
  console.log("\n=== Truncating existing PostgreSQL data (overwrite mode) ===");
  await pg.unsafe(`
    TRUNCATE TABLE
      transaction_items,
      bag_ledger,
      production_logs,
      customer_prices,
      transactions,
      customers,
      product_types,
      users
    RESTART IDENTITY CASCADE
  `);
  console.log("Existing data cleared.");
}

// ==================== Migration Functions ====================

async function migrateProductTypes() {
  const rows = getNormalizedProductRows();
  console.log(`  product_types: ${rows.length} rows`);
  if (rows.length === 0) return;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await pg.unsafe(
      `INSERT INTO product_types (
        id, name, name_en, has_bag, decreases_bag, is_active, sort_order,
        family, form, package_type, size_value, size_unit, size_label
      ) VALUES ${
        batch.map((_: any, j: number) => {
          const o = j * 13;
          return `($${o+1}, $${o+2}, $${o+3}, $${o+4}, $${o+5}, $${o+6}, $${o+7}, $${o+8}, $${o+9}, $${o+10}, $${o+11}, $${o+12}, $${o+13})`;
        }).join(", ")
      } ON CONFLICT (id) DO NOTHING`,
      batch.flatMap((r) => [
        r.id,
        r.name,
        r.name_en,
        r.has_bag,
        r.decreases_bag,
        r.is_active,
        r.sort_order,
        r.family,
        r.form,
        r.package_type,
        r.size_value,
        r.size_unit,
        r.size_label,
      ])
    );
  }
}

async function migrateCustomers() {
  const rows = sqlite.prepare("SELECT * FROM customers ORDER BY id").all() as any[];
  console.log(`  customers: ${rows.length} rows`);
  if (rows.length === 0) return;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await pg.unsafe(
      `INSERT INTO customers (id, name, phone, credit, created_at) VALUES ${
        batch.map((_: any, j: number) => {
          const o = j * 5;
          return `($${o+1}, $${o+2}, $${o+3}, $${o+4}, $${o+5})`;
        }).join(", ")
      } ON CONFLICT (id) DO NOTHING`,
      batch.flatMap((r: any) => [r.id, r.name, r.phone, toBool(r.credit), toTimestamp(r.created_at)])
    );
  }
}

async function migrateUsers() {
  const rows = sqlite.prepare("SELECT * FROM users ORDER BY id").all() as any[];
  console.log(`  users: ${rows.length} rows`);
  if (rows.length === 0) return;

  for (const r of rows as any[]) {
    // Current app roles: admin | office | manager | factory
    const role = r.role === "admin" ? "admin" : "office";
    await pg.unsafe(
      `INSERT INTO users (id, username, password, role) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
      [r.id, r.username, r.password, role]
    );
  }
}

async function migrateCustomerPrices() {
  const rows = sqlite.prepare("SELECT * FROM customer_prices ORDER BY id").all() as any[];
  console.log(`  customer_prices: ${rows.length} rows`);
  if (rows.length === 0) return;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await pg.unsafe(
      `INSERT INTO customer_prices (id, customer_id, product_type_id, unit_price, bag_deposit) VALUES ${
        batch.map((_: any, j: number) => {
          const o = j * 5;
          return `($${o+1}, $${o+2}, $${o+3}, $${o+4}, $${o+5})`;
        }).join(", ")
      } ON CONFLICT (id) DO NOTHING`,
      batch.flatMap((r: any) => [
        r.id,
        r.customer_id,
        mapProductTypeId(r.product_type_id),
        r.unit_price || 0,
        r.bag_deposit || 0,
      ])
    );
  }
}

async function migrateTransactions() {
  const count = (sqlite.prepare("SELECT COUNT(*) as c FROM transactions").get() as any).c;
  console.log(`  transactions: ${count} rows`);
  if (count === 0) return;

  let offset = 0;
  while (offset < count) {
    const rows = sqlite.prepare(`SELECT * FROM transactions ORDER BY id LIMIT ${BATCH_SIZE} OFFSET ${offset}`).all() as any[];
    if (rows.length === 0) break;

    // Insert one at a time due to the complexity of type conversions
    for (const r of rows) {
      const status = ["paid", "unpaid", "partial", "voided"].includes(r.status) ? r.status : "paid";
      await pg.unsafe(
        `INSERT INTO transactions (id, customer_id, total_amount, paid, status, pool, "row", col, sale_date, sale_time, note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (id) DO NOTHING`,
        [
          r.id,
          r.customer_id,
          r.total_amount || 0,
          r.paid || 0,
          status,
          r.pool || null,
          r.row || null,
          r.col || null,
          toDate(r.sale_date),
          toTime(r.sale_time),
          r.note || null,
          toTimestamp(r.created_at),
        ]
      );
    }

    offset += rows.length;
    if (offset % 10000 === 0 || offset >= count) {
      console.log(`    ... ${offset} / ${count}`);
    }
  }
}

async function migrateTransactionItems() {
  const count = (sqlite.prepare("SELECT COUNT(*) as c FROM transaction_items").get() as any).c;
  console.log(`  transaction_items: ${count} rows`);
  if (count === 0) return;

  let offset = 0;
  while (offset < count) {
    const rows = sqlite.prepare(`SELECT * FROM transaction_items ORDER BY id LIMIT ${BATCH_SIZE} OFFSET ${offset}`).all() as any[];
    if (rows.length === 0) break;

    await pg.unsafe(
      `INSERT INTO transaction_items (id, transaction_id, product_type_id, quantity, unit_price, subtotal) VALUES ${
        rows.map((_: any, j: number) => {
          const o = j * 6;
          return `($${o+1}, $${o+2}, $${o+3}, $${o+4}, $${o+5}, $${o+6})`;
        }).join(", ")
      } ON CONFLICT (id) DO NOTHING`,
      rows.flatMap((r: any) => [
        r.id,
        r.transaction_id,
        mapProductTypeId(r.product_type_id),
        r.quantity || 0,
        r.unit_price || 0,
        r.subtotal || 0,
      ])
    );

    offset += rows.length;
    if (offset % 50000 === 0 || offset >= count) {
      console.log(`    ... ${offset} / ${count}`);
    }
  }
}

async function migrateBagLedger() {
  const count = (sqlite.prepare("SELECT COUNT(*) as c FROM bag_ledger").get() as any).c;
  console.log(`  bag_ledger: ${count} rows`);
  if (count === 0) return;

  let offset = 0;
  while (offset < count) {
    const rows = sqlite.prepare(`SELECT * FROM bag_ledger ORDER BY id LIMIT ${BATCH_SIZE} OFFSET ${offset}`).all() as any[];
    if (rows.length === 0) break;

    for (const r of rows) {
      const bagType = ["out", "return", "adjust"].includes(r.type) ? r.type : "adjust";
      await pg.unsafe(
        `INSERT INTO bag_ledger (id, customer_id, product_type_id, type, quantity, transaction_id, note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
        [
          r.id,
          r.customer_id,
          mapProductTypeId(r.product_type_id),
          bagType,
          r.quantity || 0,
          r.transaction_id || null,
          r.note || null,
          toTimestamp(r.created_at),
        ]
      );
    }

    offset += rows.length;
    if (offset % 10000 === 0 || offset >= count) {
      console.log(`    ... ${offset} / ${count}`);
    }
  }
}

async function migrateProductionLogs() {
  const rows = sqlite.prepare("SELECT * FROM production_logs ORDER BY id").all() as any[];
  console.log(`  production_logs: ${rows.length} rows`);
  if (rows.length === 0) return;

  for (const r of rows as any[]) {
    await pg.unsafe(
      `INSERT INTO production_logs (id, product_type_id, quantity, note, created_at)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [
        r.id,
        mapProductTypeId(r.product_type_id),
        r.quantity || 0,
        r.note || null,
        toTimestamp(r.created_at),
      ]
    );
  }
}

// ==================== Sequence Reset ====================
async function resetSequences() {
  console.log("\n=== Resetting sequences ===");

  const tables = [
    "product_types",
    "customers",
    "customer_prices",
    "transactions",
    "transaction_items",
    "bag_ledger",
    "production_logs",
    "users",
  ];

  for (const table of tables) {
    const [result] = await pg.unsafe(`SELECT COALESCE(MAX(id), 0) + 1 as next_val FROM ${table}`);
    const nextVal = result.next_val;
    await pg.unsafe(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), $1, false)`, [nextVal]);
    console.log(`  ${table}: next ID = ${nextVal}`);
  }
}

// ==================== Verification ====================
async function verify() {
  console.log("\n=== Verifying migration ===");

  const tables = [
    "product_types",
    "customers",
    "customer_prices",
    "transactions",
    "transaction_items",
    "bag_ledger",
    "production_logs",
    "users",
  ];

  let allGood = true;
  for (const table of tables) {
    const sqliteCount = (sqlite.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as any).c;
    const [pgResult] = await pg.unsafe(`SELECT COUNT(*) as c FROM ${table}`);
    const pgCount = parseInt(pgResult.c);
    const match = sqliteCount === pgCount ? "OK" : "MISMATCH";
    if (match !== "OK") allGood = false;
    console.log(`  ${table}: SQLite=${sqliteCount} PG=${pgCount} [${match}]`);
  }

  // Verify transaction totals
  const sqliteTotals = sqlite.prepare(
    "SELECT COUNT(*) as cnt, SUM(total_amount) as total FROM transactions WHERE status != 'voided'"
  ).get() as any;
  const [pgTotals] = await pg.unsafe(
    "SELECT COUNT(*) as cnt, SUM(total_amount) as total FROM transactions WHERE status != 'voided'"
  );

  console.log(`\n  Transaction totals:`);
  console.log(`    SQLite: ${sqliteTotals.cnt} txns, total=${sqliteTotals.total}`);
  console.log(`    PG:     ${pgTotals.cnt} txns, total=${pgTotals.total}`);

  // FK integrity checks
  console.log(`\n  FK integrity checks:`);
  const fkChecks = [
    { name: "transactions -> customers", sql: "SELECT COUNT(*) as c FROM transactions t LEFT JOIN customers c ON t.customer_id = c.id WHERE c.id IS NULL" },
    { name: "transaction_items -> transactions", sql: "SELECT COUNT(*) as c FROM transaction_items ti LEFT JOIN transactions t ON ti.transaction_id = t.id WHERE t.id IS NULL" },
    { name: "bag_ledger -> customers", sql: "SELECT COUNT(*) as c FROM bag_ledger bl LEFT JOIN customers c ON bl.customer_id = c.id WHERE c.id IS NULL" },
    { name: "customer_prices -> customers", sql: "SELECT COUNT(*) as c FROM customer_prices cp LEFT JOIN customers c ON cp.customer_id = c.id WHERE c.id IS NULL" },
  ];

  for (const check of fkChecks) {
    const [result] = await pg.unsafe(check.sql);
    const orphans = parseInt(result.c);
    console.log(`    ${check.name}: ${orphans === 0 ? "OK" : `${orphans} orphans!`}`);
    if (orphans > 0) allGood = false;
  }

  return allGood;
}

// ==================== Main ====================
async function main() {
  console.log("\n========================================");
  console.log("  SuperICE SQLite -> PostgreSQL Migration");
  console.log("========================================\n");

  try {
    // Step 1: Create schema
    await createSchema();
    await truncateAllData();

    // Step 2: Migrate data in FK dependency order
    console.log("\n=== Migrating data ===");
    await migrateProductTypes();
    await migrateCustomers();
    await migrateUsers();
    await migrateCustomerPrices();
    await migrateTransactions();
    await migrateTransactionItems();
    await migrateBagLedger();
    await migrateProductionLogs();

    // Step 3: Reset sequences
    await resetSequences();

    // Step 4: Verify
    const ok = await verify();

    console.log("\n========================================");
    if (ok) {
      console.log("  Migration completed successfully!");
    } else {
      console.log("  Migration completed with WARNINGS - check output above");
    }
    console.log("========================================\n");
  } catch (err) {
    console.error("\nMigration FAILED:", err);
    process.exit(1);
  } finally {
    sqlite.close();
    await pg.end();
  }
}

main();
