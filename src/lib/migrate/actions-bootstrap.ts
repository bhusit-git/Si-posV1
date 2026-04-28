import { getDb, getMainDb } from "@/db";
import { sql } from "drizzle-orm";
import { DRY_GOODS, NEW_ICE_PRODUCTS } from "@/lib/product-definitions";
import { buildBootstrapSeedUsers } from "@/lib/user-seeds";
import type { MigrateActionContext, MigrateActionResult, SqlPrimitive } from "./types";
import {
  dropUserForeignKeysOnFactoryDbs,
  getConfiguredFactoryConnection,
  getErrorMessage,
  getSeedPasswords,
  normalizeTableNames,
} from "./shared";

const INIT_FACTORY_PRODUCT_TAXONOMY_COLUMNS = [
  { name: "catalog_code", def: "integer" },
  { name: "family", def: "text" },
  { name: "form", def: "text" },
  { name: "package_type", def: "text" },
  { name: "size_value", def: "integer" },
  { name: "size_unit", def: "text" },
  { name: "size_label", def: "text" },
] as const;

export async function runV5Action(): Promise<MigrateActionResult> {
  const results: string[] = [];
  try {
    const mainDb = getMainDb();

    await mainDb.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "factory_key" text`);
    results.push("Added factory_key column");

    results.push(...(await dropUserForeignKeysOnFactoryDbs()));

    const seedPasswords = getSeedPasswords();
    const seedUsers = buildBootstrapSeedUsers(seedPasswords);

    let created = 0;
    let skipped = 0;
    for (const user of seedUsers) {
      const hashed = await import("bcryptjs").then((mod) => mod.default.hash(user.password, 10));
      const insertResult = await mainDb.execute(
        sql`INSERT INTO users (username, password, role, factory_key)
            VALUES (${user.username}, ${hashed}, ${user.role}, ${user.factoryKey})
            ON CONFLICT (username) DO NOTHING RETURNING id`
      );
      if (Array.from(insertResult).length > 0) {
        created += 1;
        results.push(`Created user: ${user.username}`);
      } else {
        skipped += 1;
        results.push(`Skipped user: ${user.username} (exists)`);
      }
    }

    const allUsers = await mainDb.execute(
      sql`SELECT id, username, role, factory_key FROM users ORDER BY id`
    );

    return {
      body: {
        success: true,
        results,
        usersCreated: created,
        usersSkipped: skipped,
        allUsers: Array.from(allUsers),
      },
      auditSummary: {
        usersCreated: created,
        usersSkipped: skipped,
      },
    };
  } catch (error) {
    return {
      status: 500,
      body: { error: String(error), results },
      auditSummary: { resultsCount: results.length },
    };
  }
}

export async function runUploadAction(
  context: MigrateActionContext
): Promise<MigrateActionResult> {
  const factoryKey = context.factoryKey;
  if (!factoryKey) {
    return { status: 400, body: { error: "Missing ?factory= parameter" } };
  }
  const connection = getConfiguredFactoryConnection(factoryKey);
  if (!connection) {
    return { status: 400, body: { error: `No DB configured for factory '${factoryKey}'` } };
  }

  try {
    const body = await context.request.json();
    const { table, rows } = body as {
      table: string;
      rows: Record<string, SqlPrimitive>[];
    };
    if (!table || !rows?.length) {
      return { status: 400, body: { error: "Missing table or rows" } };
    }

    const allowed = [
      "product_types",
      "customers",
      "customer_prices",
      "transactions",
      "transaction_items",
      "bag_ledger",
    ];
    if (!allowed.includes(table)) {
      return { status: 400, body: { error: `Table '${table}' not allowed` } };
    }

    const pg = (await import("postgres")).default;
    const fSql = pg(connection.url, { max: 1, connect_timeout: 15 });

    let inserted = 0;
    if (table === "product_types") {
      for (const row of rows) {
        await fSql`INSERT INTO product_types (
            id, name, name_en, has_bag, decreases_bag, is_active, sort_order,
            catalog_code, family, form, package_type, size_value, size_unit, size_label
          )
          VALUES (
            ${row.id}, ${row.name}, ${row.name_en}, ${row.has_bag}, ${row.decreases_bag || false}, ${row.is_active}, ${row.sort_order},
            ${row.catalog_code ?? null}, ${row.family ?? null}, ${row.form ?? null}, ${row.package_type ?? null}, ${row.size_value ?? null}, ${row.size_unit ?? null}, ${row.size_label ?? null}
          )
          ON CONFLICT (id) DO NOTHING`;
        inserted += 1;
      }
    } else if (table === "customers") {
      for (const row of rows) {
        await fSql`INSERT INTO customers (
            id, name, phone, credit,
            source_system, source_factory, source_file, source_row_key, import_batch_id,
            created_at
          )
          VALUES (
            ${row.id}, ${row.name}, ${row.phone}, ${row.credit},
            ${row.source_system || null}::source_system, ${row.source_factory || null}, ${row.source_file || null}, ${row.source_row_key || null}, ${row.import_batch_id || null},
            ${row.created_at || new Date()}
          )
          ON CONFLICT (id) DO NOTHING`;
        inserted += 1;
      }
    } else if (table === "customer_prices") {
      for (const row of rows) {
        await fSql`INSERT INTO customer_prices (id, customer_id, product_type_id, unit_price, bag_deposit)
          VALUES (${row.id}, ${row.customer_id}, ${row.product_type_id}, ${row.unit_price}, ${row.bag_deposit})
          ON CONFLICT (id) DO NOTHING`;
        inserted += 1;
      }
    } else if (table === "transactions") {
      for (const row of rows) {
        const totalAmount = Number(row.total_amount || 0);
        const paid = Number(row.paid || 0);
        const outstandingAmount =
          row.outstanding_amount == null ? totalAmount - paid : Number(row.outstanding_amount);
        await fSql`INSERT INTO transactions (
            id, customer_id, total_amount, paid, outstanding_amount, status, transaction_kind,
            pool, "row", col, sale_date, sale_time, note,
            transfer_ref, transfer_destination, transfer_truck, transfer_accounting_status,
            original_transaction_id, source_system, source_factory, source_file, source_row_key, import_batch_id,
            created_at
          )
          VALUES (
            ${row.id}, ${row.customer_id}, ${totalAmount}, ${paid}, ${outstandingAmount},
            ${(row.status || "paid")}::transaction_status, ${(row.transaction_kind || "sale")}::transaction_kind,
            ${row.pool}, ${row.row}, ${row.col}, ${row.sale_date}, ${row.sale_time}, ${row.note},
            ${row.transfer_ref || null}, ${row.transfer_destination || null}, ${row.transfer_truck || null},
            ${row.transfer_accounting_status || null}::transfer_accounting_status,
            ${row.original_transaction_id || null},
            ${row.source_system || null}::source_system, ${row.source_factory || null}, ${row.source_file || null}, ${row.source_row_key || null}, ${row.import_batch_id || null},
            ${row.created_at || new Date()}
          )
          ON CONFLICT (id) DO NOTHING`;
        inserted += 1;
      }
    } else if (table === "transaction_items") {
      for (const row of rows) {
        await fSql`INSERT INTO transaction_items (id, transaction_id, product_type_id, quantity, unit_price, subtotal)
          VALUES (${row.id}, ${row.transaction_id}, ${row.product_type_id}, ${row.quantity}, ${row.unit_price}, ${row.subtotal})
          ON CONFLICT (id) DO NOTHING`;
        inserted += 1;
      }
    } else if (table === "bag_ledger") {
      for (const row of rows) {
        await fSql`INSERT INTO bag_ledger (id, customer_id, product_type_id, type, quantity, transaction_id, note, created_at)
          VALUES (${row.id}, ${row.customer_id}, ${row.product_type_id}, ${row.type}, ${row.quantity}, ${row.transaction_id}, ${row.note}, ${row.created_at || new Date()})
          ON CONFLICT (id) DO NOTHING`;
        inserted += 1;
      }
    }

    await fSql.end();
    return {
      body: { success: true, table, inserted },
      auditSummary: { factoryKey, table, inserted },
    };
  } catch (error) {
    return { status: 500, body: { error: String(error) } };
  }
}

export async function runInitFactoryAction(
  context: MigrateActionContext
): Promise<MigrateActionResult> {
  const factoryKey = context.factoryKey;
  if (!factoryKey) {
    return { status: 400, body: { error: "Missing ?factory= parameter" } };
  }

  const connection = getConfiguredFactoryConnection(factoryKey);
  if (!connection) {
    return {
      status: 400,
      body: { error: `No DATABASE_URL configured for factory '${factoryKey}'` },
    };
  }

  const results: string[] = [];
  try {
    const pg = (await import("postgres")).default;
    const fSql = pg(connection.url, { max: 1, connect_timeout: 15 });

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
        catalog_code integer,
        family text, form text, package_type text,
        size_value integer, size_unit text, size_label text)`,
      `CREATE TABLE IF NOT EXISTS customers (
        id serial PRIMARY KEY, name text NOT NULL, phone text,
        credit boolean NOT NULL DEFAULT false,
        transfer_customer boolean NOT NULL DEFAULT false,
        source_system source_system,
        source_factory text,
        source_file text,
        source_row_key text,
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
        outstanding_amount double precision NOT NULL DEFAULT 0,
        status transaction_status NOT NULL DEFAULT 'paid',
        transaction_kind transaction_kind NOT NULL DEFAULT 'sale',
        pool integer, "row" integer, col integer,
        sale_date date NOT NULL, sale_time time(0) NOT NULL,
        note text,
        printed_bill_number integer,
        transfer_ref text,
        transfer_destination text,
        transfer_truck text,
        transfer_accounting_status transfer_accounting_status,
        original_transaction_id integer REFERENCES transactions(id),
        source_system source_system,
        source_factory text,
        source_file text,
        source_row_key text,
        import_batch_id integer REFERENCES import_batches(id),
        fulfillment fulfillment_status,
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
      `CREATE TABLE IF NOT EXISTS audit_findings (
        id serial PRIMARY KEY,
        fingerprint text NOT NULL,
        rule_key text NOT NULL,
        category text NOT NULL,
        severity text NOT NULL,
        risk_score integer NOT NULL DEFAULT 0,
        status text NOT NULL DEFAULT 'open',
        entity text NOT NULL,
        entity_id integer,
        user_id integer,
        username text,
        customer_id integer,
        transaction_id integer,
        title text NOT NULL,
        reason text NOT NULL,
        evidence jsonb,
        review_note text,
        first_seen_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now())`,
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
        issued_by integer,
        voided_by integer,
        created_by integer,
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
        created_by integer,
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
        created_by integer,
        created_at timestamptz NOT NULL DEFAULT now())`,
      `CREATE TABLE IF NOT EXISTS idempotency_keys (
        id serial PRIMARY KEY,
        scope text NOT NULL,
        idempotency_key text NOT NULL,
        request_hash text NOT NULL,
        invoice_id integer REFERENCES invoices(id),
        invoice_payment_id integer REFERENCES invoice_payments(id),
        created_by integer,
        created_at timestamptz NOT NULL DEFAULT now())`,
      `ALTER TABLE product_types ADD COLUMN IF NOT EXISTS decreases_bag boolean NOT NULL DEFAULT false`,
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS transfer_customer boolean NOT NULL DEFAULT false`,
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS source_system source_system`,
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS source_factory text`,
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS source_file text`,
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS source_row_key text`,
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS import_batch_id integer REFERENCES import_batches(id)`,
      ...INIT_FACTORY_PRODUCT_TAXONOMY_COLUMNS.map(
        (column) => `ALTER TABLE product_types ADD COLUMN IF NOT EXISTS ${column.name} ${column.def}`
      ),
      `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS outstanding_amount double precision NOT NULL DEFAULT 0`,
      `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_kind transaction_kind NOT NULL DEFAULT 'sale'`,
      `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_ref text`,
      `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS printed_bill_number integer`,
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
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_findings_fingerprint ON audit_findings (fingerprint)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_findings_status_severity ON audit_findings (status, severity)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_findings_category_status ON audit_findings (category, status)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_findings_transaction ON audit_findings (transaction_id, last_seen_at)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_findings_customer ON audit_findings (customer_id, last_seen_at)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_findings_last_seen ON audit_findings (last_seen_at)`,
      `CREATE INDEX IF NOT EXISTS idx_import_batches_source ON import_batches (source_system, source_factory)`,
      `CREATE INDEX IF NOT EXISTS idx_import_batches_status ON import_batches (status)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_product_types_catalog_code ON product_types (catalog_code)`,
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

    for (const statement of ddl) {
      try {
        await fSql.unsafe(statement);
        results.push(`OK: ${statement.slice(0, 50)}...`);
      } catch (error) {
        if (getErrorMessage(error).includes("already exists")) {
          results.push(`EXISTS: ${statement.slice(0, 50)}...`);
        } else {
          results.push(`ERR: ${statement.slice(0, 40)}... => ${String(error).slice(0, 80)}`);
        }
      }
    }

    const tables = await fSql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
    await fSql.end();

    return {
      body: {
        success: true,
        factory: factoryKey,
        results,
        tables: normalizeTableNames(tables as Iterable<Record<string, unknown>>).map(
          (table) => table.tablename
        ),
      },
      auditSummary: {
        factoryKey,
        resultCount: results.length,
      },
    };
  } catch (error) {
    return {
      status: 500,
      body: { error: String(error), results },
      auditSummary: { factoryKey, resultCount: results.length },
    };
  }
}

export async function runDefaultMigrationAction(): Promise<MigrateActionResult> {
  const results: string[] = [];

  try {
    const db = await getDb();

    for (const role of ["office", "manager", "factory"]) {
      try {
        await db.execute(sql.raw(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS '${role}'`));
        results.push(`Added enum value '${role}'`);
      } catch (error) {
        results.push(`Enum '${role}': ${String(error).substring(0, 100)}`);
      }
    }

    try {
      const updated = await db.execute(sql`UPDATE users SET role = 'office' WHERE role = 'user'`);
      results.push(`Converted 'user' rows to 'office': ${Array.from(updated).length} affected`);
    } catch (error) {
      results.push(`Convert user->office: ${String(error).substring(0, 100)}`);
    }

    for (const column of [
      { name: "created_by", def: "integer" },
      { name: "voided_by", def: "integer" },
      { name: "void_reason", def: "text" },
    ]) {
      try {
        const exists = await db.execute(
          sql.raw(
            `SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = '${column.name}'`
          )
        );
        if (Array.from(exists).length === 0) {
          await db.execute(sql.raw(`ALTER TABLE transactions ADD COLUMN ${column.name} ${column.def}`));
          results.push(`Added transactions.${column.name}`);
        } else {
          results.push(`transactions.${column.name}: already exists`);
        }
      } catch (error) {
        results.push(`transactions.${column.name}: ${String(error).substring(0, 100)}`);
      }
    }

    try {
      const exists = await db.execute(
        sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'production_logs' AND column_name = 'created_by'`
      );
      if (Array.from(exists).length === 0) {
        await db.execute(sql.raw(`ALTER TABLE production_logs ADD COLUMN created_by integer`));
        results.push("Added production_logs.created_by");
      } else {
        results.push("production_logs.created_by: already exists");
      }
    } catch (error) {
      results.push(`production_logs.created_by: ${String(error).substring(0, 100)}`);
    }

    try {
      const exists = await db.execute(
        sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'bag_ledger' AND column_name = 'created_by'`
      );
      if (Array.from(exists).length === 0) {
        await db.execute(sql.raw(`ALTER TABLE bag_ledger ADD COLUMN created_by integer`));
        results.push("Added bag_ledger.created_by");
      } else {
        results.push("bag_ledger.created_by: already exists");
      }
    } catch (error) {
      results.push(`bag_ledger.created_by: ${String(error).substring(0, 100)}`);
    }

    try {
      const exists = await db.execute(
        sql`SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_log'`
      );
      if (Array.from(exists).length === 0) {
        await db.execute(sql.raw(`
          CREATE TABLE audit_log (
            id serial PRIMARY KEY NOT NULL,
            user_id integer,
            username text NOT NULL,
            action text NOT NULL,
            entity text NOT NULL,
            entity_id integer,
            details jsonb,
            created_at timestamp with time zone DEFAULT now() NOT NULL
          )
        `));
        results.push("Created audit_log table");
        await db.execute(sql.raw(`CREATE INDEX idx_audit_log_entity ON audit_log (entity, entity_id)`));
        await db.execute(sql.raw(`CREATE INDEX idx_audit_log_user ON audit_log (user_id)`));
        await db.execute(sql.raw(`CREATE INDEX idx_audit_log_created ON audit_log (created_at)`));
        results.push("Created audit_log indexes");
      } else {
        results.push("audit_log table: already exists");
      }
    } catch (error) {
      results.push(`audit_log: ${String(error).substring(0, 100)}`);
    }

    try {
      const exists = await db.execute(
        sql`SELECT 1 FROM information_schema.tables WHERE table_name = 'migrate_audit_log'`
      );
      if (Array.from(exists).length === 0) {
        await db.execute(sql.raw(`
          CREATE TABLE migrate_audit_log (
            id serial PRIMARY KEY NOT NULL,
            action_name text NOT NULL,
            factory_scope text NOT NULL,
            factory_keys jsonb NOT NULL,
            db_target text NOT NULL,
            mutation_type text NOT NULL,
            dry_run boolean NOT NULL DEFAULT false,
            caller_ip text,
            actor_identifier text,
            confirmation_provided boolean NOT NULL DEFAULT false,
            started_at timestamp with time zone DEFAULT now() NOT NULL,
            completed_at timestamp with time zone NOT NULL,
            success boolean NOT NULL,
            summary jsonb,
            error_message text
          )
        `));
        await db.execute(
          sql.raw(
            `CREATE INDEX idx_migrate_audit_log_action_started ON migrate_audit_log (action_name, started_at)`
          )
        );
        await db.execute(
          sql.raw(
            `CREATE INDEX idx_migrate_audit_log_success_started ON migrate_audit_log (success, started_at)`
          )
        );
        results.push("Created migrate_audit_log table and indexes");
      } else {
        results.push("migrate_audit_log table: already exists");
      }
    } catch (error) {
      results.push(`migrate_audit_log: ${String(error).substring(0, 100)}`);
    }

    try {
      await db.execute(sql.raw(`ALTER TABLE users ALTER COLUMN role SET DEFAULT 'office'`));
      results.push("Updated default role to 'office'");
    } catch (error) {
      results.push(`Default role: ${String(error).substring(0, 100)}`);
    }

    try {
      const exists = await db.execute(
        sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'client_id'`
      );
      if (Array.from(exists).length === 0) {
        await db.execute(sql.raw(`ALTER TABLE transactions ADD COLUMN client_id TEXT`));
        await db.execute(
          sql.raw(
            `CREATE UNIQUE INDEX idx_transactions_client_id ON transactions (client_id) WHERE client_id IS NOT NULL`
          )
        );
        results.push("Added transactions.client_id with unique index");
      } else {
        results.push("transactions.client_id: already exists");
      }
    } catch (error) {
      results.push(`transactions.client_id: ${String(error).substring(0, 100)}`);
    }

    try {
      const exists = await db.execute(
        sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'product_types' AND column_name = 'decreases_bag'`
      );
      if (Array.from(exists).length === 0) {
        await db.execute(
          sql.raw(`ALTER TABLE product_types ADD COLUMN decreases_bag boolean NOT NULL DEFAULT false`)
        );
        results.push("Added product_types.decreases_bag");
      } else {
        results.push("product_types.decreases_bag: already exists");
      }
      await db.execute(sql.raw(`UPDATE product_types SET decreases_bag = true WHERE id = 41`));
      await db.execute(sql.raw(`UPDATE product_types SET name = 'ซื้อกระสอบ' WHERE id = 41`));
      results.push("Set product 41 decreases_bag=true and name='ซื้อกระสอบ'");
    } catch (error) {
      results.push(`product_types.decreases_bag: ${String(error).substring(0, 100)}`);
    }

    for (const column of [
      { name: "catalog_code", def: "integer" },
      { name: "family", def: "text" },
      { name: "form", def: "text" },
      { name: "package_type", def: "text" },
      { name: "size_value", def: "integer" },
      { name: "size_unit", def: "text" },
      { name: "size_label", def: "text" },
    ]) {
      try {
        const exists = await db.execute(
          sql.raw(
            `SELECT 1 FROM information_schema.columns WHERE table_name = 'product_types' AND column_name = '${column.name}'`
          )
        );
        if (Array.from(exists).length === 0) {
          await db.execute(sql.raw(`ALTER TABLE product_types ADD COLUMN ${column.name} ${column.def}`));
          results.push(`Added product_types.${column.name}`);
        } else {
          results.push(`product_types.${column.name}: already exists`);
        }
      } catch (error) {
        results.push(`product_types.${column.name}: ${String(error).substring(0, 100)}`);
      }
    }

    try {
      await db.execute(
        sql.raw(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_product_types_catalog_code ON product_types (catalog_code)`
        )
      );
      results.push("Ensured unique index on product_types.catalog_code");
    } catch (error) {
      results.push(`product_types.catalog_code_index: ${String(error).substring(0, 100)}`);
    }

    try {
      for (const product of NEW_ICE_PRODUCTS) {
        await db.execute(sql`
          INSERT INTO product_types (
            id, name, name_en, has_bag, decreases_bag, is_active, sort_order,
            catalog_code, family, form, package_type, size_value, size_unit, size_label
          )
          VALUES (
            ${product.id}, ${product.name}, ${product.nameEn}, ${product.hasBag}, ${false}, ${product.isActive}, ${product.sortOrder},
            ${product.catalogCode}, ${product.family}, ${product.form}, ${product.packageType}, ${product.sizeValue}, ${product.sizeUnit}, ${product.sizeLabel}
          )
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            name_en = EXCLUDED.name_en,
            has_bag = EXCLUDED.has_bag,
            is_active = EXCLUDED.is_active,
            sort_order = EXCLUDED.sort_order,
            catalog_code = EXCLUDED.catalog_code,
            family = EXCLUDED.family,
            form = EXCLUDED.form,
            package_type = EXCLUDED.package_type,
            size_value = EXCLUDED.size_value,
            size_unit = EXCLUDED.size_unit,
            size_label = EXCLUDED.size_label
        `);
      }
      for (const product of DRY_GOODS) {
        await db.execute(sql`
          UPDATE product_types
          SET catalog_code = ${product.catalogCode}
          WHERE id = ${product.id}
        `);
      }
      results.push(`Backfilled canonical ice product catalog (${NEW_ICE_PRODUCTS.length} rows)`);
    } catch (error) {
      results.push(`product_types.catalog_backfill: ${String(error).substring(0, 100)}`);
    }

    try {
      await db.execute(sql`
        UPDATE product_types
        SET is_active = false,
            sort_order = 900 + id
        WHERE id BETWEEN 91 AND 96
      `);

      const canonicalNames = NEW_ICE_PRODUCTS.map((product) => product.name);
      const canonicalIds = NEW_ICE_PRODUCTS.map((product) => product.id);
      await db.execute(sql`
        UPDATE product_types
        SET is_active = false,
            sort_order = 900 + id
        WHERE name = ANY(${canonicalNames})
          AND id <> ALL(${canonicalIds})
      `);

      results.push("Deactivated legacy and duplicate non-canonical ice products");
    } catch (error) {
      results.push(`product_types.legacy_cleanup: ${String(error).substring(0, 100)}`);
    }

    return {
      body: { success: true, results },
      auditSummary: { resultCount: results.length },
    };
  } catch (error) {
    return {
      status: 500,
      body: { error: String(error), results },
      auditSummary: { resultCount: results.length },
    };
  }
}
