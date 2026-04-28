#!/usr/bin/env tsx
import * as fs from "fs";
import * as path from "path";
import postgres from "postgres";
import {
  getTransferAccountingStatus,
  parseTransferNote,
  isTransferEligibleCustomer,
} from "@/lib/transfer-utils";

type Target = { label: string; url: string };

type TxRow = {
  id: number;
  customer_id: number;
  customer_name: string | null;
  total_amount: number;
  note: string | null;
};

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

function parseOriginalBillId(note: string | null): number | null {
  if (!note) return null;
  const match = /อ้างอิงบิล\s*#\s*(\d+)/.exec(note);
  if (!match) return null;
  const id = parseInt(match[1], 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function deriveKind(row: TxRow): "sale" | "transfer_out" | "return" | "adjustment" {
  if (row.total_amount < 0) return "return";
  const parsedTransfer = parseTransferNote(row.note);
  if (parsedTransfer) return "transfer_out";
  // Historical rows can land here without an explicit transfer flag. We currently
  // fall back to transfer-customer heuristics so reporting can keep invoice-later
  // rows out of same-day sales. This should become an explicit imported attribute in
  // the next version instead of relying on customer/name inference.
  // TODO(next-version): persist a dedicated legacy invoice-later marker at import time.
  if (
    isTransferEligibleCustomer({
      id: row.customer_id,
      name: row.customer_name,
    })
  ) {
    return "transfer_out";
  }
  return "sale";
}

async function runForTarget(target: Target) {
  const sql = postgres(target.url, { max: 2, connect_timeout: 15 });
  try {
    console.log(`\n--- Backfill target: ${target.label} ---`);

    await sql`UPDATE transactions SET outstanding_amount = total_amount - paid`;

    const rows = await sql<TxRow[]>`
      SELECT t.id, t.customer_id, c.name as customer_name, t.total_amount, t.note
      FROM transactions t
      LEFT JOIN customers c ON c.id = t.customer_id
    `;

    let transferCount = 0;
    let returnCount = 0;
    let originalRefCount = 0;

    await sql.begin(async (tx) => {
      for (const row of rows) {
        const kind = deriveKind(row);
        if (kind === "transfer_out") transferCount += 1;
        if (kind === "return") returnCount += 1;

        const parsedTransfer = parseTransferNote(row.note);
        const transferRef = parsedTransfer?.ref || null;
        const transferDestination = parsedTransfer?.to || null;
        const transferTruck = parsedTransfer?.truck || null;
        const transferAccountingStatus =
          kind === "transfer_out" ? getTransferAccountingStatus(row.note) : null;

        const originalBill = kind === "return" ? parseOriginalBillId(row.note) : null;
        if (originalBill) originalRefCount += 1;

        await tx`
          UPDATE transactions
          SET
            transaction_kind = ${kind}::transaction_kind,
            transfer_ref = ${transferRef},
            transfer_destination = ${transferDestination},
            transfer_truck = ${transferTruck},
            transfer_accounting_status = ${
              transferAccountingStatus ? tx`${transferAccountingStatus}::transfer_accounting_status` : tx`NULL`
            },
            original_transaction_id = ${originalBill},
            outstanding_amount = total_amount - paid
          WHERE id = ${row.id}
        `;
      }
    });

    const [counts] = await sql`
      SELECT
        SUM(CASE WHEN transaction_kind = 'transfer_out' THEN 1 ELSE 0 END)::int AS transfer_count,
        SUM(CASE WHEN transaction_kind = 'return' THEN 1 ELSE 0 END)::int AS return_count,
        SUM(CASE WHEN original_transaction_id IS NOT NULL THEN 1 ELSE 0 END)::int AS original_ref_count
      FROM transactions
    `;

    console.log(
      JSON.stringify(
        {
          target: target.label,
          processed: rows.length,
          transferOut: Number(counts.transfer_count || transferCount),
          returns: Number(counts.return_count || returnCount),
          withOriginalRef: Number(counts.original_ref_count || originalRefCount),
        },
        null,
        2
      )
    );
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
  for (const target of targets) {
    await runForTarget(target);
  }
}

main().catch((error) => {
  console.error("backfill-transaction-kind failed:", error);
  process.exit(1);
});
