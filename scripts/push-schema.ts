#!/usr/bin/env tsx
/**
 * Push the Drizzle schema to all configured PostgreSQL databases.
 *
 * Reads DATABASE_URL and every DATABASE_URL_* env var, then runs
 * `drizzle-kit push` against each one so that schema changes are
 * applied automatically during the Render build step.
 *
 * Usage (called automatically by the Render build command):
 *   npx tsx scripts/push-schema.ts
 */

import postgres from "postgres";
import { spawnSync } from "child_process";

const SCHEMA_PATH = "./src/db/schema.ts";

type SchemaTarget = {
  envVar: string;
  label: string;
  url: string;
};

function parseSchemaPushTargets(): Set<string> | null {
  const raw = process.env.SCHEMA_PUSH_TARGETS?.trim();
  if (!raw) return null;

  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return values.length > 0 ? new Set(values) : null;
}

function collectDatabaseUrls(): SchemaTarget[] {
  const targets: SchemaTarget[] = [];
  const allowedTargets = parseSchemaPushTargets();

  if (process.env.DATABASE_URL) {
    targets.push({
      envVar: "DATABASE_URL",
      label: "DATABASE_URL (main)",
      url: process.env.DATABASE_URL,
    });
  }

  const factoryVars = ["DATABASE_URL_SI", "DATABASE_URL_BEARING", "DATABASE_URL_KTK"];
  for (const envVar of factoryVars) {
    const url = process.env[envVar];
    if (url) {
      targets.push({ envVar, label: envVar, url });
    }
  }

  if (!allowedTargets) {
    return targets;
  }

  const filteredTargets = targets.filter((target) => allowedTargets.has(target.envVar));
  const unknownTargets = Array.from(allowedTargets).filter(
    (envVar) => !targets.some((target) => target.envVar === envVar)
  );

  if (unknownTargets.length > 0) {
    console.warn(
      `Ignoring unknown SCHEMA_PUSH_TARGETS entries: ${unknownTargets.join(", ")}`
    );
  }

  return filteredTargets;
}

async function sanitizeLegacyData(label: string, url: string): Promise<boolean> {
  let sql: postgres.Sql | null = null;
  try {
    sql = postgres(url, {
      max: 1,
      connect_timeout: 10,
      idle_timeout: 5,
      ssl: "prefer",
    });

    // Keep nullable user references valid before FK validation during schema push.
    const nullableUserRefs = [
      { table: "audit_log", column: "user_id" },
      { table: "transactions", column: "created_by" },
      { table: "transactions", column: "voided_by" },
      { table: "production_logs", column: "created_by" },
      { table: "bag_ledger", column: "created_by" },
      { table: "invoices", column: "issued_by" },
      { table: "invoices", column: "voided_by" },
      { table: "invoices", column: "created_by" },
      { table: "invoice_payments", column: "created_by" },
      { table: "payment_events", column: "created_by" },
      { table: "idempotency_keys", column: "created_by" },
    ] as const;

    const referencedTables = Array.from(
      new Set(["users", ...nullableUserRefs.map(({ table }) => table)])
    );
    const existingColumns = await sql.unsafe(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [referencedTables]
    );

    const columnsByTable = new Map<string, Set<string>>();
    for (const row of existingColumns) {
      const tableName = String(row.table_name ?? "");
      const columnName = String(row.column_name ?? "");
      if (!tableName || !columnName) continue;
      const tableColumns = columnsByTable.get(tableName) ?? new Set<string>();
      tableColumns.add(columnName);
      columnsByTable.set(tableName, tableColumns);
    }

    const userColumns = columnsByTable.get("users");
    if (!userColumns?.has("id")) {
      console.log(`--- ${label}: skipping legacy-data sanitize (users.id not present yet) ---`);
      return true;
    }

    for (const { table, column } of nullableUserRefs) {
      const tableColumns = columnsByTable.get(table);
      if (!tableColumns?.has(column)) {
        console.log(`--- ${label}: skipping ${table}.${column} sanitize (column missing) ---`);
        continue;
      }

      const result = await sql.unsafe(`
        UPDATE ${table} AS t
        SET ${column} = NULL
        WHERE t.${column} IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM users AS u
            WHERE u.id = t.${column}
          )
      `);

      const repaired = Number(result.count ?? 0);
      if (repaired > 0) {
        console.log(`--- ${label}: normalized ${repaired} orphan ${table}.${column} row(s) ---`);
      }
    }
    return true;
  } catch (e) {
    console.error(`--- ${label}: failed legacy-data sanitize step ---`);
    console.error(e);
    return false;
  } finally {
    if (sql) {
      await sql.end({ timeout: 5 });
    }
  }
}

function pushSchema(label: string, url: string): boolean {
  console.log(`\n--- Pushing schema to ${label} ---`);
  try {
    const proc = spawnSync(
      "npx",
      [
        "drizzle-kit",
        "push",
        "--dialect",
        "postgresql",
        "--schema",
        SCHEMA_PATH,
        "--url",
        url,
        "--force",
      ],
      {
        timeout: 60_000,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    if (proc.stdout) process.stdout.write(proc.stdout);
    if (proc.stderr) process.stderr.write(proc.stderr);

    const mergedOutput = `${proc.stdout ?? ""}\n${proc.stderr ?? ""}`;
    if (proc.status !== 0) {
      throw new Error(`drizzle-kit exited with status ${proc.status}`);
    }
    if (/PostgresError:/i.test(mergedOutput)) {
      throw new Error("drizzle-kit reported PostgresError in output");
    }

    console.log(`--- ${label}: OK ---`);
    return true;
  } catch (e) {
    console.error(`--- ${label}: FAILED ---`);
    console.error(e);
    return false;
  }
}

const targets = collectDatabaseUrls();

if (targets.length === 0) {
  console.log("No DATABASE_URL* env vars found -- skipping schema push.");
  process.exit(0);
}

console.log(`Found ${targets.length} database(s) to push schema to:`);
for (const t of targets) {
  console.log(`  - ${t.label}`);
}

async function main() {
  let failures = 0;
  for (const t of targets) {
    const sanitized = await sanitizeLegacyData(t.label, t.url);
    if (!sanitized || !pushSchema(t.label, t.url)) {
      failures++;
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} database(s) failed schema push.`);
    process.exit(1);
  }

  console.log(`\nAll ${targets.length} database(s) synced successfully.`);
}

void main();
