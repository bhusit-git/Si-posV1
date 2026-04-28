#!/usr/bin/env tsx
import * as fs from "fs";
import * as path from "path";
import postgres from "postgres";
import { TRANSFER_ALLOWLIST_CUSTOMER_IDS } from "@/lib/transfer-utils";

type Target = { label: string; url: string };

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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function collectTargets(): Target[] {
  const envFromFile = parseEnvFile(path.join(process.cwd(), ".env.local"));
  const keys = [
    { env: "DATABASE_URL", label: "main" },
    { env: "DATABASE_URL_SI", label: "si" },
    { env: "DATABASE_URL_BEARING", label: "bearing" },
    { env: "DATABASE_URL_KTK", label: "ktk" },
  ];
  const out: Target[] = [];
  for (const key of keys) {
    const url = process.env[key.env] || envFromFile[key.env];
    if (url) out.push({ label: key.label, url });
  }
  return out;
}

async function buildMetrics(target: Target) {
  const sql = postgres(target.url, { max: 2, connect_timeout: 15 });
  try {
    const allowlist = Array.from(TRANSFER_ALLOWLIST_CUSTOMER_IDS.values());
    const allowlistSql = allowlist.length
      ? `OR t.customer_id IN (${allowlist.join(",")})`
      : "";

    const [credit] = await sql`
      SELECT
        COUNT(*)::int AS credit_count,
        COALESCE(SUM(t.total_amount - t.paid), 0) AS credit_outstanding
      FROM transactions t
      WHERE t.status IN ('unpaid','partial')
        AND (t.total_amount - t.paid) > 0
    `;

    const [legacyTransfer] = await sql.unsafe(`
      SELECT COUNT(*)::int AS transfer_count
      FROM transactions t
      JOIN customers c ON c.id = t.customer_id
      WHERE t.status <> 'voided'
        AND (c.name LIKE 'XFER->%' ${allowlistSql})
        AND EXISTS (
          SELECT 1 FROM transaction_items ti
          WHERE ti.transaction_id = t.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM transaction_items ti
          WHERE ti.transaction_id = t.id
            AND COALESCE(ti.unit_price, 0) <> 0
        )
    `);

    const [invoiceRowsCurrentMonth] = await sql`
      WITH month_range AS (
        SELECT
          date_trunc('month', now())::date AS start_date,
          (date_trunc('month', now()) + interval '1 month - 1 day')::date AS end_date
      )
      SELECT COUNT(*)::int AS invoice_rows
      FROM transactions t
      JOIN month_range r ON true
      WHERE t.status <> 'voided'
        AND t.sale_date >= r.start_date
        AND t.sale_date <= r.end_date
    `;

    return {
      target: target.label,
      metrics: {
        legacyTransferCount: Number(legacyTransfer.transfer_count || 0),
        creditCount: Number(credit.credit_count || 0),
        creditOutstanding: Number(credit.credit_outstanding || 0),
        customerInvoiceRowCountCurrentMonth: Number(invoiceRowsCurrentMonth.invoice_rows || 0),
      },
    };
  } finally {
    await sql.end();
  }
}

async function main() {
  const targets = collectTargets();
  if (targets.length === 0) {
    console.error("No DATABASE_URL* values found.");
    process.exit(1);
  }

  const generatedAt = new Date().toISOString();
  const rows = [];
  for (const target of targets) {
    rows.push(await buildMetrics(target));
  }

  const report = { generatedAt, rows };
  const outDir = path.join(process.cwd(), "docs", "baselines");
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `baseline-${generatedAt.replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify(report, null, 2));
  console.log(`\nSaved baseline: ${file}`);
}

main().catch((error) => {
  console.error("freeze-baseline failed:", error);
  process.exit(1);
});

