import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";
import { parse } from "csv-parse/sync";

type SqlExecutor = {
  unsafe: (query: string, params?: unknown[]) => Promise<unknown[]>;
};

type Mode = "dry-run" | "apply" | "rollback";

type Args = {
  mode: Mode;
  mdbPath: string;
  mdbExportBin: string;
  dbUrl: string;
  sourceLabel: string;
  marker: string;
  createdByUsername: string;
  createdById?: number;
  outputJson?: string;
  allowNullCreatedBy: boolean;
  strict: boolean;
};

type MdbCustomerRow = {
  customer_id: number;
  customer_name: string;
  mdb_total: number;
};

type PreviewRow = {
  customer_id: number;
  customer_name: string;
  customer_exists: boolean;
  live_balance: number;
  mdb_total: number;
  delta: number;
};

type SummaryRow = {
  mdb_customer_count: number;
  mdb_nonzero_count: number;
  changes_needed: number;
  positive_adjust_rows: number;
  negative_adjust_rows: number;
  sum_current_live: number;
  sum_target_mdb: number;
  net_delta: number;
};

const DEFAULT_MDB_PATH = "/tmp/si_rar_inspect/โปรแกรมขายน้ำแข็ง SI.mdb";
const DEFAULT_SOURCE_LABEL = "CustomerTable:/tmp/si_rar_inspect/โปรแกรมขายน้ำแข็ง SI.mdb";
const EXPECTED = {
  mdbCustomerCount: 221,
  mdbNonZeroCount: 91,
  changesNeeded: 100,
  positiveAdjustRows: 76,
  negativeAdjustRows: 24,
  sumTargetMdb: 224027,
};

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string>();
  const booleans = new Set<string>();

  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const raw = arg.slice(2);
    const eq = raw.indexOf("=");
    if (eq === -1) booleans.add(raw);
    else flags.set(raw.slice(0, eq), raw.slice(eq + 1));
  }

  const mode = (flags.get("mode") || "dry-run") as Mode;
  if (!["dry-run", "apply", "rollback"].includes(mode)) {
    throw new Error(`Invalid --mode '${mode}'. Use dry-run, apply, or rollback.`);
  }

  const dbUrl = flags.get("db-url") || process.env.DATABASE_URL_SI || "";
  if (!dbUrl) {
    throw new Error("Missing SI database URL. Set DATABASE_URL_SI or pass --db-url.");
  }

  const marker =
    flags.get("marker") ||
    `si-mdb-bag-backfill-${new Date().toISOString().replace(/[:.]/g, "-")}`;

  const createdById = flags.get("created-by-id");

  return {
    mode,
    mdbPath: flags.get("mdb-path") || DEFAULT_MDB_PATH,
    mdbExportBin: flags.get("mdb-export-bin") || "mdb-export",
    dbUrl,
    sourceLabel: flags.get("source-label") || DEFAULT_SOURCE_LABEL,
    marker,
    createdByUsername: flags.get("created-by-username") || "admin",
    createdById: createdById ? Number(createdById) : undefined,
    outputJson: flags.get("output-json"),
    allowNullCreatedBy: booleans.has("allow-null-created-by"),
    strict: !booleans.has("no-strict"),
  };
}

function num(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quoteLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function quoteSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildMdbCte(rows: MdbCustomerRow[]): string {
  const values = rows
    .map(
      (row) =>
        `(${row.customer_id}, ${quoteSqlString(row.customer_name)}, ${row.mdb_total})`
    )
    .join(",\n        ");

  return `
    WITH mdb AS (
      SELECT *
      FROM (VALUES
        ${values}
      ) AS x(customer_id, customer_name, mdb_total)
    )
  `;
}

function exportCustomerTableCsv(mdbExportBin: string, mdbPath: string): string {
  if (!fs.existsSync(mdbPath)) {
    throw new Error(`MDB file not found: ${mdbPath}`);
  }

  return execFileSync(mdbExportBin, [mdbPath, "CustomerTable"], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
}

function loadMdbCustomerTotals(mdbExportBin: string, mdbPath: string): MdbCustomerRow[] {
  const csv = exportCustomerTableCsv(mdbExportBin, mdbPath);
  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  }) as Record<string, string>[];

  const result = rows.map((row) => {
    const customerId = Math.trunc(num(row.CustomerID));
    const total =
      num(row.UnitBag) +
      num(row.BareBag) +
      num(row.Unit30Bag) +
      num(row.CrackBag) +
      num(row.UnitBagSmall);

    return {
      customer_id: customerId,
      customer_name: row.CustomerName || `ลูกค้า ${customerId}`,
      mdb_total: Math.trunc(total),
    };
  });

  result.sort((a, b) => {
    if (b.mdb_total !== a.mdb_total) return b.mdb_total - a.mdb_total;
    return a.customer_id - b.customer_id;
  });

  const ids = new Set<number>();
  for (const row of result) {
    if (row.customer_id <= 0) {
      throw new Error(`Invalid customer ID in MDB export: ${row.customer_id}`);
    }
    if (ids.has(row.customer_id)) {
      throw new Error(`Duplicate customer ID in MDB export: ${row.customer_id}`);
    }
    ids.add(row.customer_id);
  }

  return result;
}

function printMdbTotals(rows: MdbCustomerRow[]): void {
  console.log("\nMDB customer bag totals (sorted by total):");
  for (const row of rows) {
    console.log(`${String(row.mdb_total).padStart(7)} | #${row.customer_id} | ${row.customer_name}`);
  }
}

async function queryPreview(
  sql: SqlExecutor,
  mdbRows: MdbCustomerRow[]
): Promise<{ preview: PreviewRow[]; summary: SummaryRow }> {
  const mdbCte = buildMdbCte(mdbRows);
  const previewQuery = `
    ${mdbCte},
    live AS (
      SELECT
        c.id AS customer_id,
        COALESCE(SUM(CASE
          WHEN bl.type = 'out' THEN bl.quantity
          WHEN bl.type = 'return' THEN -bl.quantity
          WHEN bl.type = 'adjust' THEN bl.quantity
          ELSE 0
        END), 0)::int AS live_balance
      FROM customers c
      LEFT JOIN bag_ledger bl ON bl.customer_id = c.id
      GROUP BY c.id
    )
    SELECT
      m.customer_id,
      m.customer_name,
      (c.id IS NOT NULL) AS customer_exists,
      COALESCE(l.live_balance, 0)::int AS live_balance,
      m.mdb_total,
      (m.mdb_total - COALESCE(l.live_balance, 0))::int AS delta
    FROM mdb m
    LEFT JOIN customers c ON c.id = m.customer_id
    LEFT JOIN live l ON l.customer_id = m.customer_id
    WHERE (m.mdb_total - COALESCE(l.live_balance, 0)) <> 0
    ORDER BY ABS(m.mdb_total - COALESCE(l.live_balance, 0)) DESC, m.customer_id ASC
  `;

  const summaryQuery = `
    ${mdbCte},
    live AS (
      SELECT
        c.id AS customer_id,
        COALESCE(SUM(CASE
          WHEN bl.type = 'out' THEN bl.quantity
          WHEN bl.type = 'return' THEN -bl.quantity
          WHEN bl.type = 'adjust' THEN bl.quantity
          ELSE 0
        END), 0)::int AS live_balance
      FROM customers c
      LEFT JOIN bag_ledger bl ON bl.customer_id = c.id
      GROUP BY c.id
    ),
    diff AS (
      SELECT
        m.customer_id,
        m.customer_name,
        m.mdb_total,
        COALESCE(l.live_balance, 0)::int AS live_balance,
        (m.mdb_total - COALESCE(l.live_balance, 0))::int AS delta
      FROM mdb m
      LEFT JOIN live l ON l.customer_id = m.customer_id
    )
    SELECT
      (SELECT COUNT(*)::int FROM mdb) AS mdb_customer_count,
      (SELECT COUNT(*)::int FROM mdb WHERE mdb_total <> 0) AS mdb_nonzero_count,
      COUNT(*) FILTER (WHERE delta <> 0)::int AS changes_needed,
      COUNT(*) FILTER (WHERE delta > 0)::int AS positive_adjust_rows,
      COUNT(*) FILTER (WHERE delta < 0)::int AS negative_adjust_rows,
      COALESCE(SUM(live_balance), 0)::int AS sum_current_live,
      COALESCE(SUM(mdb_total), 0)::int AS sum_target_mdb,
      COALESCE(SUM(delta), 0)::int AS net_delta
    FROM diff
  `;

  const previewRows = (await sql.unsafe(previewQuery)) as unknown as PreviewRow[];
  const [summaryRow] = (await sql.unsafe(summaryQuery)) as unknown as SummaryRow[];
  return { preview: previewRows, summary: summaryRow };
}

async function resolveCreatedBy(
  sql: SqlExecutor,
  args: Args
): Promise<number | null> {
  const cols = (await sql.unsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'bag_ledger'`
  )) as Array<{ column_name: string }>;
  const hasCreatedBy = cols.some((col) => col.column_name === "created_by");
  if (!hasCreatedBy) return null;

  if (args.createdById !== undefined) {
    return args.createdById;
  }

  const usersTable = (await sql.unsafe(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'users'
    ) AS exists`
  )) as Array<{ exists: boolean }>;
  if (!usersTable[0]?.exists) {
    if (args.allowNullCreatedBy) return null;
    throw new Error("bag_ledger.created_by exists but users table is unavailable.");
  }

  const rows = (await sql.unsafe(
    `SELECT id, username FROM users WHERE lower(username) = lower($1) ORDER BY id LIMIT 1`,
    [args.createdByUsername]
  )) as Array<{ id: number; username: string }>;
  if (rows.length > 0) {
    return Number(rows[0].id);
  }

  if (args.allowNullCreatedBy) return null;
  throw new Error(
    `Could not resolve created_by user '${args.createdByUsername}'. Pass --created-by-id or --allow-null-created-by.`
  );
}

async function resolveCanonicalBagProductId(sql: SqlExecutor): Promise<number> {
  const rows = (await sql.unsafe(
    `SELECT id FROM product_types WHERE has_bag = true ORDER BY id LIMIT 1`
  )) as Array<{ id: number }>;
  if (rows.length === 0) {
    throw new Error("No canonical bag product type found.");
  }
  return Number(rows[0].id);
}

function assertExpected(summary: SummaryRow, preview: PreviewRow[], strict: boolean): void {
  const missing = preview.filter((row) => !row.customer_exists);
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.length} customer IDs in target DB: ${missing
        .slice(0, 10)
        .map((row) => row.customer_id)
        .join(", ")}`
    );
  }

  if (!strict) return;

  const mismatches: string[] = [];
  if (summary.mdb_customer_count !== EXPECTED.mdbCustomerCount) {
    mismatches.push(
      `mdb_customer_count expected ${EXPECTED.mdbCustomerCount}, got ${summary.mdb_customer_count}`
    );
  }
  if (summary.mdb_nonzero_count !== EXPECTED.mdbNonZeroCount) {
    mismatches.push(
      `mdb_nonzero_count expected ${EXPECTED.mdbNonZeroCount}, got ${summary.mdb_nonzero_count}`
    );
  }
  if (summary.changes_needed !== EXPECTED.changesNeeded) {
    mismatches.push(
      `changes_needed expected ${EXPECTED.changesNeeded}, got ${summary.changes_needed}`
    );
  }
  if (summary.positive_adjust_rows !== EXPECTED.positiveAdjustRows) {
    mismatches.push(
      `positive_adjust_rows expected ${EXPECTED.positiveAdjustRows}, got ${summary.positive_adjust_rows}`
    );
  }
  if (summary.negative_adjust_rows !== EXPECTED.negativeAdjustRows) {
    mismatches.push(
      `negative_adjust_rows expected ${EXPECTED.negativeAdjustRows}, got ${summary.negative_adjust_rows}`
    );
  }
  if (summary.sum_target_mdb !== EXPECTED.sumTargetMdb) {
    mismatches.push(
      `sum_target_mdb expected ${EXPECTED.sumTargetMdb}, got ${summary.sum_target_mdb}`
    );
  }

  if (mismatches.length > 0) {
    throw new Error(`Preflight mismatch:\n- ${mismatches.join("\n- ")}`);
  }
}

function printPreview(summary: SummaryRow, preview: PreviewRow[]): void {
  console.log("\nDry-run summary:");
  console.log(`  MDB customers:           ${summary.mdb_customer_count}`);
  console.log(`  MDB non-zero totals:     ${summary.mdb_nonzero_count}`);
  console.log(`  Changes needed:          ${summary.changes_needed}`);
  console.log(`  Positive adjustments:    ${summary.positive_adjust_rows}`);
  console.log(`  Negative adjustments:    ${summary.negative_adjust_rows}`);
  console.log(`  Current live total:      ${summary.sum_current_live}`);
  console.log(`  Target MDB total:        ${summary.sum_target_mdb}`);
  console.log(`  Net delta:               ${summary.net_delta}`);

  console.log("\nTop adjustment deltas:");
  for (const row of preview.slice(0, 25)) {
    console.log(
      `  ${String(row.delta).padStart(8)} | #${row.customer_id} | live ${String(
        row.live_balance
      ).padStart(6)} -> mdb ${String(row.mdb_total).padStart(6)} | ${row.customer_name}`
    );
  }

  const negative = preview.filter((row) => row.delta < 0).slice(0, 10);
  if (negative.length > 0) {
    console.log("\nNegative adjustment samples:");
    for (const row of negative) {
      console.log(
        `  ${String(row.delta).padStart(8)} | #${row.customer_id} | live ${String(
          row.live_balance
        ).padStart(6)} -> mdb ${String(row.mdb_total).padStart(6)} | ${row.customer_name}`
      );
    }
  }
}

function maybeWriteJson(args: Args, data: unknown): void {
  if (!args.outputJson) return;
  const target = path.resolve(args.outputJson);
  fs.writeFileSync(target, JSON.stringify(data, null, 2), "utf8");
  console.log(`\nWrote report: ${target}`);
}

async function applyBackfill(
  sql: postgres.Sql<Record<string, never>>,
  args: Args,
  mdbRows: MdbCustomerRow[]
): Promise<void> {
  await sql.begin(async (tx) => {
    const { preview, summary } = await queryPreview(tx, mdbRows);
    assertExpected(summary, preview, args.strict);

    const canonicalBagProductId = await resolveCanonicalBagProductId(tx);
    const createdBy = await resolveCreatedBy(tx, args);
    const createdAt = new Date().toISOString();

    const rowsToInsert = preview.map((row) => ({
      customer_id: row.customer_id,
      product_type_id: canonicalBagProductId,
      type: "adjust",
      quantity: row.delta,
      transaction_id: null,
      note: `[${args.marker}] SI MDB bag backfill | source=${args.sourceLabel} | customer_id=${row.customer_id} | target=${row.mdb_total} | previous=${row.live_balance} | delta=${row.delta}`,
      created_at: createdAt,
      created_by: createdBy,
    }));

    console.log("\nApplying bag ledger adjustments in one transaction...");
    for (const row of rowsToInsert) {
      if (createdBy !== null) {
        await tx.unsafe(
          `INSERT INTO bag_ledger (
            customer_id, product_type_id, type, quantity, transaction_id, note, created_at, created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            row.customer_id,
            row.product_type_id,
            row.type,
            row.quantity,
            row.transaction_id,
            row.note,
            row.created_at,
            row.created_by,
          ]
        );
      } else {
        await tx.unsafe(
          `INSERT INTO bag_ledger (
            customer_id, product_type_id, type, quantity, transaction_id, note, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            row.customer_id,
            row.product_type_id,
            row.type,
            row.quantity,
            row.transaction_id,
            row.note,
            row.created_at,
          ]
        );
      }
    }

    const { preview: afterPreview, summary: afterSummary } = await queryPreview(tx, mdbRows);
    if (afterPreview.length !== 0) {
      throw new Error(
        `Post-insert verification failed: ${afterPreview.length} customers still differ from MDB totals.`
      );
    }
    if (afterSummary.sum_current_live !== afterSummary.sum_target_mdb) {
      throw new Error(
        `Post-insert total mismatch: live ${afterSummary.sum_current_live} vs target ${afterSummary.sum_target_mdb}`
      );
    }

    const notePattern = `%[${quoteLike(args.marker)}]%`;
    const insertedRows = (await tx.unsafe(
      `SELECT COUNT(*)::int AS cnt FROM bag_ledger WHERE note LIKE $1 ESCAPE '\\'`,
      [notePattern]
    )) as Array<{ cnt: number }>;
    const count = Number(insertedRows[0]?.cnt || 0);
    if (count !== summary.changes_needed) {
      throw new Error(
        `Inserted row count mismatch: expected ${summary.changes_needed}, got ${count}.`
      );
    }

    console.log(`  Inserted rows:           ${count}`);
    console.log(`  Canonical bag product:   ${canonicalBagProductId}`);
    console.log(`  created_by:              ${createdBy === null ? "NULL" : createdBy}`);
    console.log(`  Marker:                  ${args.marker}`);
    console.log(`  Verified total:          ${afterSummary.sum_current_live}`);
  });
}

async function rollbackBackfill(
  sql: postgres.Sql<Record<string, never>>,
  marker: string
): Promise<void> {
  const pattern = `%[${quoteLike(marker)}]%`;
  await sql.begin(async (tx) => {
    const before = (await tx.unsafe(
      `SELECT COUNT(*)::int AS cnt FROM bag_ledger WHERE note LIKE $1 ESCAPE '\\'`,
      [pattern]
    )) as Array<{ cnt: number }>;
    const count = Number(before[0]?.cnt || 0);
    if (count === 0) {
      throw new Error(`No bag_ledger rows found for marker '${marker}'.`);
    }

    await tx.unsafe(`DELETE FROM bag_ledger WHERE note LIKE $1 ESCAPE '\\'`, [pattern]);
    const after = (await tx.unsafe(
      `SELECT COUNT(*)::int AS cnt FROM bag_ledger WHERE note LIKE $1 ESCAPE '\\'`,
      [pattern]
    )) as Array<{ cnt: number }>;
    const remaining = Number(after[0]?.cnt || 0);
    if (remaining !== 0) {
      throw new Error(`Rollback failed; ${remaining} rows still match marker '${marker}'.`);
    }

    console.log(`Rolled back ${count} bag_ledger rows for marker '${marker}'.`);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mdbRows = loadMdbCustomerTotals(args.mdbExportBin, args.mdbPath);
  printMdbTotals(mdbRows);

  const sql = postgres(args.dbUrl, { max: 1, connect_timeout: 15, idle_timeout: 20 });
  try {
    if (args.mode === "rollback") {
      await rollbackBackfill(sql, args.marker);
      return;
    }

    const { preview, summary } = await queryPreview(sql, mdbRows);
    assertExpected(summary, preview, args.strict);
    printPreview(summary, preview);
    maybeWriteJson(args, { summary, preview, mdbRows });

    if (args.mode === "dry-run") {
      console.log("\nDry run complete. No changes were written.");
      return;
    }

    await applyBackfill(sql, args, mdbRows);
    console.log("\nApply complete.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("\nBackfill failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
