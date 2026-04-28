/**
 * Migrate directly from a Microsoft Access (.mdb) file into PostgreSQL.
 *
 * Prerequisites: mdb-export from mdbtools (brew install mdbtools)
 *
 * Usage:
 *   npx tsx scripts/migrate-from-mdb.ts "/path/to/SI.mdb"        si
 *   npx tsx scripts/migrate-from-mdb.ts "/path/to/แบริ่ง.mdb"    bearing
 *   npx tsx scripts/migrate-from-mdb.ts "/path/to/KTK.mdb"       ktk
 *
 * The second argument is the factory key (si | bearing | ktk).
 * The script reads DATABASE_URL_<FACTORY> from .env.local.
 *
 * Product ID scheme:
 *   1-18   New ice products
 *   41-56  Unified dry goods (SI list)
 *   91-96  Legacy ice products (from MDB)
 *
 * Notes:
 * - Pool/Row/Col location data from the old system is DISCARDED.
 * - Only transactions from 2024+ are imported (recent 2 years).
 * - Existing data in the target PG database is TRUNCATED first.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";
import postgres from "postgres";
import {
  DRY_GOODS,
  LEGACY_BY_ACCESS_EN,
  LEGACY_ICE,
  NEW_ICE_PRODUCTS,
} from "../src/lib/product-definitions";

// ── CLI args ─────────────────────────────────────────────────────────────────
const mdbPath = process.argv[2];
const factoryKey = process.argv[3];
const sourceFactory = factoryKey?.toLowerCase();
const sourceFile = mdbPath ? path.basename(mdbPath) : null;

if (!mdbPath || !factoryKey) {
  console.error("Usage: npx tsx scripts/migrate-from-mdb.ts <path-to-file.mdb> <factory-key>");
  console.error("  factory-key: si | bearing | ktk");
  process.exit(1);
}

if (!fs.existsSync(mdbPath)) {
  console.error(`File not found: ${mdbPath}`);
  process.exit(1);
}

// ── Load DB URL from .env.local ──────────────────────────────────────────────
function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  for (const lineRaw of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

const envVarName = `DATABASE_URL_${factoryKey.toUpperCase()}`;
const envFromFile = parseEnvFile(path.join(process.cwd(), ".env.local"));
const PG_URL = process.env[envVarName] || envFromFile[envVarName];

if (!PG_URL) {
  console.error(`ERROR: ${envVarName} not found in .env.local or environment.`);
  process.exit(1);
}

console.log(`\n========================================`);
console.log(`  MDB -> PostgreSQL Migration`);
console.log(`  Source:  ${mdbPath}`);
console.log(`  Factory: ${factoryKey}`);
console.log(`  Target:  ${PG_URL.replace(/:\/\/.*@/, "://***@")}`);
console.log(`========================================\n`);

const sql = postgres(PG_URL, { max: 5 });

// ── Canonical product definitions ────────────────────────────────────────────

// Shared product definitions are imported from src/lib/product-definitions so every
// Access/MDB transfer path uses the same legacy labels and Access column mapping.
const legacyByAccessEn = new Map(
  Array.from(LEGACY_BY_ACCESS_EN.entries()).map(([accessEn, product]) => [accessEn, product.newId])
);

// ── MDB Helpers ──────────────────────────────────────────────────────────────

function exportMdbTable(tableName: string): Record<string, string>[] {
  try {
    const csv = execSync(`mdb-export "${mdbPath}" "${tableName}"`, {
      maxBuffer: 512 * 1024 * 1024,
      encoding: "utf-8",
    });
    return parse(csv, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
      relax_column_count: true,
    });
  } catch (err: any) {
    console.warn(`  Warning: Could not export table "${tableName}": ${err.message}`);
    return [];
  }
}

function exportMdbTableStreaming(
  tableName: string,
  batchSize: number,
  callback: (batch: Record<string, string>[]) => void
): number {
  const tmpFile = path.join(__dirname, `_tmp_${tableName}.csv`);
  try {
    execSync(`mdb-export "${mdbPath}" "${tableName}" > "${tmpFile}"`, {
      maxBuffer: 10 * 1024,
      shell: "/bin/bash",
    });
    const content = fs.readFileSync(tmpFile, "utf-8");
    const rows: Record<string, string>[] = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
      relax_column_count: true,
    });
    let totalProcessed = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      callback(batch);
      totalProcessed += batch.length;
      if (totalProcessed % 50000 === 0 || i + batchSize >= rows.length) {
        console.log(`    ... ${totalProcessed} / ${rows.length}`);
      }
    }
    return rows.length;
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
}

// ── Value Helpers ────────────────────────────────────────────────────────────

function toNum(val: string | undefined | null): number {
  if (!val || val === "" || val === "null") return 0;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

function toBool(val: string | undefined | null): boolean {
  if (!val) return false;
  return val === "1" || val.toLowerCase() === "true";
}

function now(): string {
  return new Date().toISOString();
}

function parseOriginalBillId(note: string | undefined | null): number | null {
  if (!note) return null;
  const match = /อ้างอิงบิล\s*#\s*(\d+)/.exec(note);
  if (!match) return null;
  const parsed = parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseTransferNote(note: string | undefined | null): {
  ref: string | null;
  destination: string | null;
  truck: string | null;
  accountingStatus: "open" | "closed";
} | null {
  if (!note) return null;
  const trimmed = note.trim();
  if (!trimmed.startsWith("XFER|")) return null;
  const fields = new Map<string, string>();
  for (const token of trimmed.split("|").slice(1)) {
    const idx = token.indexOf("=");
    if (idx <= 0) continue;
    fields.set(token.slice(0, idx).trim().toLowerCase(), token.slice(idx + 1).trim());
  }
  const rawStatus = (fields.get("status") || "").toLowerCase();
  const accountingStatus = rawStatus === "closed" ? "closed" : "open";
  return {
    ref: fields.get("ref") || null,
    destination: fields.get("to") || null,
    truck: fields.get("truck") || null,
    accountingStatus,
  };
}

function inferTransactionKind(
  note: string | undefined | null,
  totalAmount: number
): "sale" | "transfer_out" | "return" | "adjustment" {
  // Legacy MDB data does not give us a durable explicit "invoice later" field in the
  // imported transaction model, so we currently infer `transfer_out` from transfer-like
  // note metadata. That is enough for current reporting, but it is lossy for history.
  // TODO(next-version): add an explicit imported accounting/reporting classification so
  // legacy invoice-later rows are not dependent on heuristics during migration.
  if (parseTransferNote(note)) return "transfer_out";
  if (totalAmount < 0) return "return";
  return "sale";
}

function parseAccessDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const parts = dateStr.split(" ")[0].split("/");
  if (parts.length !== 3) return null;
  const month = parseInt(parts[0]);
  const day = parseInt(parts[1]);
  let year = parseInt(parts[2]);
  if (year < 100) year += 2000;
  return new Date(year, month - 1, day);
}

function formatDate(dateStr: string): string {
  const d = parseAccessDate(dateStr);
  if (!d) return dateStr;
  return d.toISOString().split("T")[0];
}

function formatTime(timeStr: string): string {
  if (!timeStr) return "00:00:00";
  const parts = timeStr.split(" ");
  return parts.length > 1 ? parts[1] : "00:00:00";
}

// ── Schema Creation ──────────────────────────────────────────────────────────

async function createSchema() {
  console.log("Creating PostgreSQL schema...");

  const ddl = [
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='transaction_status') THEN CREATE TYPE transaction_status AS ENUM ('paid','unpaid','partial','voided'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='bag_ledger_type') THEN CREATE TYPE bag_ledger_type AS ENUM ('out','return','adjust'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='user_role') THEN CREATE TYPE user_role AS ENUM ('admin','office','manager','factory'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='fulfillment_status') THEN CREATE TYPE fulfillment_status AS ENUM ('pending','loaded'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='transaction_kind') THEN CREATE TYPE transaction_kind AS ENUM ('sale','transfer_out','return','adjustment'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='transfer_accounting_status') THEN CREATE TYPE transfer_accounting_status AS ENUM ('open','closed'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='invoice_status') THEN CREATE TYPE invoice_status AS ENUM ('draft','issued','paid','void'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='invoice_line_type') THEN CREATE TYPE invoice_line_type AS ENUM ('sale','return'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='invoice_payment_method') THEN CREATE TYPE invoice_payment_method AS ENUM ('cash','bank_transfer','cheque','other'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='source_system') THEN CREATE TYPE source_system AS ENUM ('access_mdb','sqlite_legacy','app_pos','api_import','manual_adjustment'); END IF; END $$`,

    `CREATE TABLE IF NOT EXISTS product_types (
      id serial PRIMARY KEY, name text NOT NULL, name_en text,
      has_bag boolean NOT NULL DEFAULT false, decreases_bag boolean NOT NULL DEFAULT false,
      is_active boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 0,
      family text, form text, package_type text,
      size_value integer, size_unit text, size_label text)`,

    `CREATE TABLE IF NOT EXISTS customers (
      id serial PRIMARY KEY, name text NOT NULL, phone text,
      credit boolean NOT NULL DEFAULT false,
      transfer_customer boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now())`,

    `CREATE TABLE IF NOT EXISTS users (
      id serial PRIMARY KEY, username text NOT NULL UNIQUE,
      password text NOT NULL, role user_role NOT NULL DEFAULT 'office',
      factory_key text)`,

    `CREATE TABLE IF NOT EXISTS import_batches (
      id serial PRIMARY KEY,
      source_system source_system NOT NULL,
      source_factory text,
      source_file text,
      status text NOT NULL DEFAULT 'completed',
      row_count integer NOT NULL DEFAULT 0,
      error_count integer NOT NULL DEFAULT 0,
      metadata jsonb,
      started_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now())`,

    `CREATE TABLE IF NOT EXISTS customer_prices (
      id serial PRIMARY KEY,
      customer_id integer NOT NULL REFERENCES customers(id),
      product_type_id integer NOT NULL REFERENCES product_types(id),
      unit_price double precision NOT NULL DEFAULT 0,
      bag_deposit double precision NOT NULL DEFAULT 0)`,

    `CREATE TABLE IF NOT EXISTS transactions (
      id serial PRIMARY KEY,
      customer_id integer NOT NULL REFERENCES customers(id),
      total_amount double precision NOT NULL DEFAULT 0,
      paid double precision NOT NULL DEFAULT 0,
      status transaction_status NOT NULL DEFAULT 'paid',
      pool integer, "row" integer, col integer,
      sale_date date NOT NULL, sale_time time(0) NOT NULL,
      note text, printed_bill_number integer, fulfillment fulfillment_status,
      created_by integer, voided_by integer, void_reason text,
      client_id text, created_at timestamptz NOT NULL DEFAULT now())`,

    `CREATE TABLE IF NOT EXISTS transaction_items (
      id serial PRIMARY KEY,
      transaction_id integer NOT NULL REFERENCES transactions(id),
      product_type_id integer NOT NULL REFERENCES product_types(id),
      quantity double precision NOT NULL DEFAULT 0,
      unit_price double precision NOT NULL DEFAULT 0,
      subtotal double precision NOT NULL DEFAULT 0,
      loaded_qty double precision NOT NULL DEFAULT 0)`,

    `CREATE TABLE IF NOT EXISTS production_logs (
      id serial PRIMARY KEY,
      product_type_id integer NOT NULL REFERENCES product_types(id),
      quantity double precision NOT NULL DEFAULT 0, note text,
      created_by integer, created_at timestamptz NOT NULL DEFAULT now())`,

    `CREATE TABLE IF NOT EXISTS bag_ledger (
      id serial PRIMARY KEY,
      customer_id integer NOT NULL REFERENCES customers(id),
      product_type_id integer NOT NULL REFERENCES product_types(id),
      type bag_ledger_type NOT NULL,
      quantity integer NOT NULL DEFAULT 0,
      transaction_id integer REFERENCES transactions(id),
      note text, created_by integer,
      created_at timestamptz NOT NULL DEFAULT now())`,

    `CREATE TABLE IF NOT EXISTS audit_log (
      id serial PRIMARY KEY,
      user_id integer, username text NOT NULL,
      action text NOT NULL, entity text NOT NULL,
      entity_id integer, details jsonb,
      created_at timestamptz NOT NULL DEFAULT now())`,

    `CREATE TABLE IF NOT EXISTS bill_counters (
      id serial PRIMARY KEY,
      factory_key text NOT NULL,
      next_number integer NOT NULL DEFAULT 1,
      updated_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now())`,

    `CREATE TABLE IF NOT EXISTS invoice_counters (
      id serial PRIMARY KEY,
      factory_key text NOT NULL,
      year integer NOT NULL,
      next_number integer NOT NULL DEFAULT 1,
      updated_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now())`,

    `CREATE TABLE IF NOT EXISTS invoices (
      id serial PRIMARY KEY,
      invoice_no text,
      customer_id integer NOT NULL REFERENCES customers(id),
      period_start date NOT NULL,
      period_end date NOT NULL,
      status invoice_status NOT NULL DEFAULT 'draft',
      vat_enabled boolean NOT NULL DEFAULT false,
      vat_rate double precision NOT NULL DEFAULT 0.07,
      subtotal double precision NOT NULL DEFAULT 0,
      vat_amount double precision NOT NULL DEFAULT 0,
      grand_total double precision NOT NULL DEFAULT 0,
      paid_total double precision NOT NULL DEFAULT 0,
      outstanding_total double precision NOT NULL DEFAULT 0,
      issue_date date,
      due_date date,
      notes text,
      void_reason text,
      issued_by integer REFERENCES users(id),
      voided_by integer REFERENCES users(id),
      created_by integer REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now())`,

    `CREATE TABLE IF NOT EXISTS invoice_lines (
      id serial PRIMARY KEY,
      invoice_id integer NOT NULL REFERENCES invoices(id),
      transaction_id integer NOT NULL REFERENCES transactions(id),
      line_type invoice_line_type NOT NULL,
      sale_date date NOT NULL,
      sale_time time(0) NOT NULL,
      amount double precision NOT NULL DEFAULT 0,
      snapshot_json jsonb,
      created_at timestamptz NOT NULL DEFAULT now())`,

    `CREATE TABLE IF NOT EXISTS invoice_payments (
      id serial PRIMARY KEY,
      invoice_id integer NOT NULL REFERENCES invoices(id),
      paid_at timestamptz NOT NULL DEFAULT now(),
      amount double precision NOT NULL DEFAULT 0,
      method invoice_payment_method NOT NULL DEFAULT 'cash',
      note text,
      created_by integer REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now())`,

    `CREATE TABLE IF NOT EXISTS invoice_payment_allocations (
      id serial PRIMARY KEY,
      invoice_payment_id integer NOT NULL REFERENCES invoice_payments(id),
      invoice_line_id integer NOT NULL REFERENCES invoice_lines(id),
      transaction_id integer NOT NULL REFERENCES transactions(id),
      allocated_amount double precision NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now())`,

    `CREATE TABLE IF NOT EXISTS payment_events (
      id serial PRIMARY KEY,
      transaction_id integer REFERENCES transactions(id),
      invoice_id integer REFERENCES invoices(id),
      invoice_payment_id integer REFERENCES invoice_payments(id),
      event_date date NOT NULL,
      event_time time(0) NOT NULL,
      amount double precision NOT NULL DEFAULT 0,
      method invoice_payment_method,
      note text,
      created_by integer REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now())`,

    `CREATE TABLE IF NOT EXISTS idempotency_keys (
      id serial PRIMARY KEY,
      scope text NOT NULL,
      idempotency_key text NOT NULL,
      request_hash text NOT NULL,
      invoice_id integer REFERENCES invoices(id),
      invoice_payment_id integer REFERENCES invoice_payments(id),
      created_by integer REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now())`,

    `ALTER TABLE product_types ADD COLUMN IF NOT EXISTS decreases_bag boolean NOT NULL DEFAULT false`,
    `ALTER TABLE product_types ADD COLUMN IF NOT EXISTS family text`,
    `ALTER TABLE product_types ADD COLUMN IF NOT EXISTS form text`,
    `ALTER TABLE product_types ADD COLUMN IF NOT EXISTS package_type text`,
    `ALTER TABLE product_types ADD COLUMN IF NOT EXISTS size_value integer`,
    `ALTER TABLE product_types ADD COLUMN IF NOT EXISTS size_unit text`,
    `ALTER TABLE product_types ADD COLUMN IF NOT EXISTS size_label text`,

    // Bring older DBs up to current transaction/customer schema.
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS transfer_customer boolean NOT NULL DEFAULT false`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS source_system source_system`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS source_factory text`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS source_file text`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS source_row_key text`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS import_batch_id integer REFERENCES import_batches(id)`,

    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS outstanding_amount double precision NOT NULL DEFAULT 0`,
    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_kind transaction_kind NOT NULL DEFAULT 'sale'`,
    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS printed_bill_number integer`,
    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_ref text`,
    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_destination text`,
    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_truck text`,
    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_accounting_status transfer_accounting_status`,
    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS original_transaction_id integer REFERENCES transactions(id)`,
    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source_system source_system`,
    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source_factory text`,
    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source_file text`,
    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source_row_key text`,
    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS import_batch_id integer REFERENCES import_batches(id)`,

    `CREATE INDEX IF NOT EXISTS idx_customer_prices_customer_id ON customer_prices (customer_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_prices_customer_product ON customer_prices (customer_id, product_type_id)`,
    `CREATE INDEX IF NOT EXISTS idx_transactions_customer_id ON transactions (customer_id)`,
    `CREATE INDEX IF NOT EXISTS idx_transactions_sale_date ON transactions (sale_date)`,
    `CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions (status)`,
    `CREATE INDEX IF NOT EXISTS idx_transactions_kind_status_date ON transactions (transaction_kind, status, sale_date)`,
    `CREATE INDEX IF NOT EXISTS idx_transactions_printed_bill_number ON transactions (printed_bill_number)`,
    `CREATE INDEX IF NOT EXISTS idx_transactions_transfer_ref ON transactions (transfer_ref)`,
    `CREATE INDEX IF NOT EXISTS idx_transactions_outstanding_amount ON transactions (customer_id, outstanding_amount)`,
    `CREATE INDEX IF NOT EXISTS idx_transactions_date_status ON transactions (sale_date, status)`,
    `CREATE INDEX IF NOT EXISTS idx_transactions_fulfillment ON transactions (fulfillment)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_client_id ON transactions (client_id)`,
    `CREATE INDEX IF NOT EXISTS idx_transaction_items_transaction_id ON transaction_items (transaction_id)`,
    `CREATE INDEX IF NOT EXISTS idx_transaction_items_product_type_id ON transaction_items (product_type_id)`,
    `CREATE INDEX IF NOT EXISTS idx_bag_ledger_customer_id ON bag_ledger (customer_id)`,
    `CREATE INDEX IF NOT EXISTS idx_bag_ledger_transaction_id ON bag_ledger (transaction_id)`,
    `CREATE INDEX IF NOT EXISTS idx_bag_ledger_customer_product ON bag_ledger (customer_id, product_type_id)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (entity, entity_id)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log (user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log (created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_import_batches_source ON import_batches (source_system, source_factory)`,
    `CREATE INDEX IF NOT EXISTS idx_import_batches_status ON import_batches (status)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_bill_counters_factory ON bill_counters (factory_key)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_counters_factory_year ON invoice_counters (factory_key, year)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_invoice_no ON invoices (invoice_no)`,
    `CREATE INDEX IF NOT EXISTS idx_invoices_customer_status_period ON invoices (customer_id, status, period_start, period_end)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_lines_invoice_tx ON invoice_lines (invoice_id, transaction_id)`,
    `CREATE INDEX IF NOT EXISTS idx_invoice_lines_transaction ON invoice_lines (transaction_id)`,
    `CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments (invoice_id, paid_at)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_payment_allocations_payment_line ON invoice_payment_allocations (invoice_payment_id, invoice_line_id)`,
    `CREATE INDEX IF NOT EXISTS idx_invoice_payment_allocations_transaction ON invoice_payment_allocations (transaction_id)`,
    `CREATE INDEX IF NOT EXISTS idx_payment_events_transaction_date ON payment_events (transaction_id, event_date)`,
    `CREATE INDEX IF NOT EXISTS idx_payment_events_invoice ON payment_events (invoice_id, event_date)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_keys_scope_key ON idempotency_keys (scope, idempotency_key)`,
    `CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created_at ON idempotency_keys (created_at)`,
  ];

  for (const stmt of ddl) {
    try { await sql.unsafe(stmt); } catch (e: any) {
      if (!e.message?.includes("already exists")) console.warn(`  DDL warning: ${e.message?.slice(0, 80)}`);
    }
  }
  console.log("  Schema ready.");
}

async function truncateAllData() {
  console.log("Truncating existing data...");
  await sql.unsafe(`
    TRUNCATE TABLE
      idempotency_keys, payment_events, invoice_payment_allocations, invoice_payments, invoice_lines,
      invoices, invoice_counters,
      bill_counters,
      transaction_items, bag_ledger, production_logs,
      customer_prices, transactions, customers,
      product_types, import_batches, audit_log, users
    RESTART IDENTITY CASCADE
  `);
  console.log("  Truncated.");
}

async function createImportBatchRecord(): Promise<number | null> {
  try {
    const [row] = await sql`
      INSERT INTO import_batches (source_system, source_factory, source_file, status, metadata)
      VALUES (${ "access_mdb" }::source_system, ${sourceFactory || null}, ${sourceFile || null}, 'running', ${{
        script: "migrate-from-mdb.ts",
        migratedAt: now(),
      }}::jsonb)
      RETURNING id`;
    return row.id as number;
  } catch {
    console.warn("  Warning: failed to create import_batches row, continuing without batch linkage.");
    return null;
  }
}

async function finalizeImportBatchRecord(
  importBatchId: number | null,
  rowCount: number,
  errorCount: number,
  status: "completed" | "failed"
) {
  if (!importBatchId) return;
  await sql`
    UPDATE import_batches
    SET row_count = ${rowCount},
        error_count = ${errorCount},
        status = ${status},
        completed_at = now()
    WHERE id = ${importBatchId}`;
}

// ── 1. Seed Product Types ────────────────────────────────────────────────────

async function seedProductTypes() {
  console.log("\n--- Seeding product types ---");

  // 1a. Current ice products (1-21)
  for (const p of NEW_ICE_PRODUCTS) {
    await sql`INSERT INTO product_types (
      id, name, name_en, has_bag, is_active, sort_order,
      family, form, package_type, size_value, size_unit, size_label
    )
      VALUES (
        ${p.id}, ${p.name}, ${p.nameEn}, ${p.hasBag}, ${p.isActive}, ${p.sortOrder},
        ${p.family}, ${p.form}, ${p.packageType}, ${p.sizeValue}, ${p.sizeUnit}, ${p.sizeLabel}
      )`;
  }
  console.log(`  Inserted ${NEW_ICE_PRODUCTS.length} current ice products (IDs 1-21)`);

  // 1b. Dry goods (41-56)
  for (const d of DRY_GOODS) {
    await sql`INSERT INTO product_types (
      id, name, name_en, has_bag, decreases_bag, is_active, sort_order,
      family, form, package_type, size_value, size_unit, size_label
    )
      VALUES (${d.id}, ${d.name}, ${null}, false, ${d.decreasesBag ?? false}, true, ${d.id}, ${null}, ${null}, ${null}, ${null}, ${null}, ${null})`;
  }
  console.log(`  Inserted ${DRY_GOODS.length} dry goods (IDs 41-56)`);

  // 1c. Legacy ice products (91-96) — these are the ones referenced by MDB transactions
  for (const l of LEGACY_ICE) {
    await sql`INSERT INTO product_types (
      id, name, name_en, has_bag, is_active, sort_order,
      family, form, package_type, size_value, size_unit, size_label
    )
      VALUES (${l.newId}, ${l.name}, ${l.nameEn}, ${l.hasBag}, false, ${900 + l.newId}, ${null}, ${null}, ${null}, ${null}, ${null}, ${null})`;
  }
  console.log(`  Inserted ${LEGACY_ICE.length} legacy ice products (IDs 91-96)`);

  // Reset sequence
  const [maxRow] = await sql`SELECT COALESCE(MAX(id), 0) + 1 as next_val FROM product_types`;
  await sql.unsafe(`SELECT setval(pg_get_serial_sequence('product_types', 'id'), $1, false)`, [maxRow.next_val]);
  console.log(`  Sequence reset: next auto-ID = ${maxRow.next_val}`);
}

// ── 2. Import Customers ──────────────────────────────────────────────────────

// MDB column -> legacy product_type_id mapping
const priceMapping: { accessEn: string; priceCol: string; bagPriceCol: string; bagCol: string }[] = [
  { accessEn: "Pack", priceCol: "PackPrice", bagPriceCol: "", bagCol: "" },
  { accessEn: "Unit", priceCol: "UnitPrice", bagPriceCol: "UnitBagPrice", bagCol: "UnitBag" },
  { accessEn: "Bare", priceCol: "BarePrice", bagPriceCol: "BareBagPrice", bagCol: "BareBag" },
  { accessEn: "Unit30", priceCol: "Unit30Price", bagPriceCol: "Unit30BagPrice", bagCol: "Unit30Bag" },
  { accessEn: "Crack", priceCol: "CrackPrice", bagPriceCol: "CrackBagPrice", bagCol: "CrackBag" },
  { accessEn: "UnitSmall", priceCol: "UnitPriceSmall", bagPriceCol: "UnitBagPriceSmall", bagCol: "UnitBagSmall" },
];

async function importCustomers(importBatchId: number | null): Promise<number> {
  console.log("\n--- Importing customers ---");
  const customerRows = exportMdbTable("CustomerTable");
  console.log(`  Total customers in MDB: ${customerRows.length}`);

  let count = 0;
  for (const row of customerRows) {
    const customerId = toNum(row.CustomerID);
    if (customerId === 0) continue;

    await sql`INSERT INTO customers (
        id, name, phone, credit,
        source_system, source_factory, source_file, source_row_key, import_batch_id,
        created_at
      )
      VALUES (
        ${customerId},
        ${row.CustomerName || `ลูกค้า ${customerId}`},
        ${row.TelephoneNumber || null},
        ${toBool(row.Credit)},
        ${"access_mdb"}::source_system,
        ${sourceFactory || null},
        ${sourceFile || null},
        ${`CustomerTable:${customerId}`},
        ${importBatchId},
        ${row.DateIn || now()}
      )`;

    // Per-product pricing (using legacy IDs 91-96)
    for (const pm of priceMapping) {
      const ptId = legacyByAccessEn.get(pm.accessEn);
      if (!ptId) continue;
      const unitPrice = toNum(row[pm.priceCol]);
      const bagDeposit = pm.bagPriceCol ? toNum(row[pm.bagPriceCol]) : 0;
      await sql`INSERT INTO customer_prices (customer_id, product_type_id, unit_price, bag_deposit)
        VALUES (${customerId}, ${ptId}, ${unitPrice}, ${bagDeposit})`;
    }

    // Bag ledger initial balances
    for (const pm of priceMapping) {
      if (!pm.bagCol) continue;
      const ptId = legacyByAccessEn.get(pm.accessEn);
      if (!ptId) continue;
      const bagBalance = toNum(row[pm.bagCol]);
      if (bagBalance !== 0) {
        await sql`INSERT INTO bag_ledger (customer_id, product_type_id, type, quantity, note, created_at)
          VALUES (${customerId}, ${ptId}, 'adjust', ${Math.abs(bagBalance)},
            ${bagBalance > 0
              ? `ยอดยกมาจากระบบเดิม (ลูกค้าค้างถุง ${bagBalance} ใบ)`
              : `ยอดยกมาจากระบบเดิม (ถุงคืนเกิน ${Math.abs(bagBalance)} ใบ)`},
            ${now()})`;
      }
    }

    count++;
  }

  // Reset sequences
  for (const t of ["customers", "customer_prices", "bag_ledger"]) {
    const [row] = await sql.unsafe(`SELECT COALESCE(MAX(id), 0) + 1 as nv FROM ${t}`);
    await sql.unsafe(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), $1, false)`, [row.nv]);
  }

  console.log(`  Imported ${count} customers with pricing and bag balances`);
  return count;
}

// ── 3. Import Transactions ───────────────────────────────────────────────────

const transProductMapping: { accessEn: string; qtyCol: string; priceCol: string }[] = [
  { accessEn: "Pack", qtyCol: "Pack", priceCol: "PackPrice" },
  { accessEn: "Unit", qtyCol: "Unit", priceCol: "UnitPrice" },
  { accessEn: "Bare", qtyCol: "Bare", priceCol: "BarePrice" },
  { accessEn: "Unit30", qtyCol: "Unit30", priceCol: "Unit30Price" },
  { accessEn: "Crack", qtyCol: "Crack", priceCol: "CrackPrice" },
  { accessEn: "UnitSmall", qtyCol: "UnitSmall", priceCol: "UnitPriceSmall" },
];

async function importTransactions(importBatchId: number | null): Promise<{
  totalTrans: number;
  totalItems: number;
  skippedOld: number;
  skippedOrphan: number;
  totalMdbRows: number;
}> {
  console.log("\n--- Importing recent transactions (2024+) ---");
  console.log("  Exporting TransTable from MDB (may take a minute for large databases)...");

  // Get valid customer IDs
  const custRows = await sql`SELECT id FROM customers`;
  const validCustomerIds = new Set(custRows.map((r: any) => r.id));

  const cutoff = new Date(2024, 0, 1);
  const BATCH_SIZE = 5000;
  let totalTrans = 0;
  let totalItems = 0;
  let totalSkippedOld = 0;
  let totalSkippedOrphan = 0;
  let sourceRowCounter = 0;
  const batchQueue: Record<string, string>[][] = [];

  const totalMdbRows = exportMdbTableStreaming("TransTable", BATCH_SIZE, (batch) => {
    batchQueue.push(batch);
  });

  for (const batch of batchQueue) {
    const txInserts: any[] = [];

    for (const row of batch) {
      const customerId = toNum(row.CustomerID);
      if (customerId === 0) continue;

      const d = parseAccessDate(row.SaleDate);
      if (!d || d < cutoff) { totalSkippedOld++; continue; }
      if (!validCustomerIds.has(customerId)) { totalSkippedOrphan++; continue; }

      let total = 0;
      const items: { ptId: number; qty: number; price: number }[] = [];
      for (const pm of transProductMapping) {
        const qty = toNum(row[pm.qtyCol]);
        if (qty === 0) continue;
        const price = toNum(row[pm.priceCol]);
        const ptId = legacyByAccessEn.get(pm.accessEn);
        if (!ptId) continue;
        total += qty * price;
        items.push({ ptId, qty, price });
      }

      const bagQty = toNum(row.Bag);
      const bagPrice = toNum(row.BagPrice);
      total += bagQty * bagPrice;
      const othQty = toNum(row.Oth);
      const othPrice = toNum(row.OthPrice);
      total += othQty * othPrice;

      const paid = toNum(row.Paid);
      const saleDate = formatDate(row.SaleDate);
      const saleTime = formatTime(row.SaleTime);
      const note = row.Note || null;
      const transfer = parseTransferNote(note);
      const transactionKind = inferTransactionKind(note, total);
      const originalTransactionId = transactionKind === "return" ? parseOriginalBillId(note) : null;
      const sourceRowKey = `TransTable:${sourceRowCounter}`;
      sourceRowCounter++;

      let status: string;
      let paidAmount: number;
      if (paid === -1) { paidAmount = total; status = "paid"; }
      else if (paid >= total) { paidAmount = paid; status = "paid"; }
      else if (paid > 0) { paidAmount = paid; status = "partial"; }
      else { paidAmount = 0; status = total === 0 ? "paid" : "unpaid"; }

      txInserts.push({
        customer_id: customerId,
        total_amount: total,
        paid: paidAmount,
        outstanding_amount: total - paidAmount,
        status,
        transaction_kind: transactionKind,
        sale_date: saleDate,
        sale_time: saleTime,
        note,
        transfer_ref: transfer?.ref || null,
        transfer_destination: transfer?.destination || null,
        transfer_truck: transfer?.truck || null,
        transfer_accounting_status: transfer?.accountingStatus || null,
        original_transaction_id: originalTransactionId,
        source_system: "access_mdb",
        source_factory: sourceFactory || null,
        source_file: sourceFile || null,
        source_row_key: sourceRowKey,
        import_batch_id: importBatchId,
        created_at: saleDate + "T" + saleTime,
        items,
      });
    }

    // Insert transactions and items
    for (const tx of txInserts) {
      const [inserted] = await sql`
        INSERT INTO transactions (
          customer_id, total_amount, paid, outstanding_amount, status, transaction_kind,
          sale_date, sale_time, note, transfer_ref, transfer_destination, transfer_truck,
          transfer_accounting_status, original_transaction_id,
          source_system, source_factory, source_file, source_row_key, import_batch_id,
          created_at
        )
        VALUES (
          ${tx.customer_id}, ${tx.total_amount}, ${tx.paid}, ${tx.outstanding_amount},
          ${tx.status}::transaction_status, ${tx.transaction_kind}::transaction_kind,
          ${tx.sale_date}, ${tx.sale_time}, ${tx.note}, ${tx.transfer_ref}, ${tx.transfer_destination},
          ${tx.transfer_truck}, ${tx.transfer_accounting_status}::transfer_accounting_status,
          ${tx.original_transaction_id},
          ${tx.source_system}::source_system, ${tx.source_factory}, ${tx.source_file}, ${tx.source_row_key}, ${tx.import_batch_id},
          ${tx.created_at}
        )
        RETURNING id`;
      const txId = inserted.id;
      totalTrans++;

      for (const item of tx.items) {
        await sql`INSERT INTO transaction_items (transaction_id, product_type_id, quantity, unit_price, subtotal)
          VALUES (${txId}, ${item.ptId}, ${item.qty}, ${item.price}, ${item.qty * item.price})`;
        totalItems++;
      }
    }
  }

  // Reset sequences
  for (const t of ["transactions", "transaction_items"]) {
    const [row] = await sql.unsafe(`SELECT COALESCE(MAX(id), 0) + 1 as nv FROM ${t}`);
    await sql.unsafe(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), $1, false)`, [row.nv]);
  }

  console.log(`  Total rows in MDB TransTable: ${totalMdbRows}`);
  console.log(`  Skipped (before 2024): ${totalSkippedOld}`);
  console.log(`  Skipped (orphan customer): ${totalSkippedOrphan}`);
  console.log(`  Imported: ${totalTrans} transactions with ${totalItems} line items`);
  return {
    totalTrans,
    totalItems,
    skippedOld: totalSkippedOld,
    skippedOrphan: totalSkippedOrphan,
    totalMdbRows,
  };
}

// ── 4. Seed Users ────────────────────────────────────────────────────────────

async function seedUsers() {
  console.log("\n--- Seeding users ---");
  const passwordRows = exportMdbTable("PasswordTable");

  if (passwordRows.length > 0) {
    for (const row of passwordRows) {
      const username = row.UserName || "";
      const password = row.Password || "";
      const role = username.toLowerCase() === "admin" ? "admin" : "office";
      await sql`INSERT INTO users (username, password, role)
        VALUES (${username}, ${password}, ${role}::user_role)
        ON CONFLICT (username) DO NOTHING`;
      console.log(`  User: ${username} (${role})`);
    }
  } else {
    await sql`INSERT INTO users (username, password, role)
      VALUES ('Admin', 'lion', 'admin'::user_role)
      ON CONFLICT (username) DO NOTHING`;
    await sql`INSERT INTO users (username, password, role)
      VALUES ('User', 'User', 'office'::user_role)
      ON CONFLICT (username) DO NOTHING`;
    console.log("  Created default users (no PasswordTable found)");
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let importBatchId: number | null = null;
  try {
    await createSchema();
    await truncateAllData();
    await seedProductTypes();
    importBatchId = await createImportBatchRecord();
    const importedCustomers = await importCustomers(importBatchId);
    const txStats = await importTransactions(importBatchId);
    await seedUsers();
    await finalizeImportBatchRecord(importBatchId, importedCustomers + txStats.totalTrans, 0, "completed");

    // Final summary
    console.log("\n========================================");
    console.log("  Migration complete!");
    console.log("========================================\n");

    const counts = await sql`
      SELECT 'product_types' as tbl, COUNT(*)::int as cnt FROM product_types
      UNION ALL SELECT 'customers', COUNT(*)::int FROM customers
      UNION ALL SELECT 'customer_prices', COUNT(*)::int FROM customer_prices
      UNION ALL SELECT 'transactions', COUNT(*)::int FROM transactions
      UNION ALL SELECT 'transaction_items', COUNT(*)::int FROM transaction_items
      UNION ALL SELECT 'bag_ledger', COUNT(*)::int FROM bag_ledger
      UNION ALL SELECT 'import_batches', COUNT(*)::int FROM import_batches
      UNION ALL SELECT 'invoices', COUNT(*)::int FROM invoices
      UNION ALL SELECT 'invoice_lines', COUNT(*)::int FROM invoice_lines
      UNION ALL SELECT 'invoice_payments', COUNT(*)::int FROM invoice_payments
      UNION ALL SELECT 'invoice_payment_allocations', COUNT(*)::int FROM invoice_payment_allocations
      UNION ALL SELECT 'payment_events', COUNT(*)::int FROM payment_events
      UNION ALL SELECT 'idempotency_keys', COUNT(*)::int FROM idempotency_keys
      UNION ALL SELECT 'users', COUNT(*)::int FROM users
    `;
    for (const row of counts) console.log(`  ${row.tbl}: ${row.cnt}`);

    // FK integrity
    const [orphanTi] = await sql`SELECT COUNT(*)::int as c FROM transaction_items ti LEFT JOIN product_types pt ON ti.product_type_id = pt.id WHERE pt.id IS NULL`;
    const [orphanCp] = await sql`SELECT COUNT(*)::int as c FROM customer_prices cp LEFT JOIN product_types pt ON cp.product_type_id = pt.id WHERE pt.id IS NULL`;
    console.log(`\n  FK check - orphan transaction_items: ${orphanTi.c}`);
    console.log(`  FK check - orphan customer_prices: ${orphanCp.c}`);

    // Product list
    const prods = await sql`SELECT id, name, name_en, has_bag FROM product_types ORDER BY sort_order, id`;
    console.log(`\n  Product types (${prods.length}):`);
    for (const p of prods) {
      const cat = p.id <= 18 ? "ICE" : p.id <= 60 ? "DRY" : "LEG";
      console.log(`    [${cat}] ID ${String(p.id).padStart(2)}: ${p.name} (${p.name_en || "-"}) bag=${p.has_bag ? "Y" : "N"}`);
    }
  } catch (err) {
    await finalizeImportBatchRecord(importBatchId, 0, 1, "failed");
    console.error("\nMigration FAILED:", err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
