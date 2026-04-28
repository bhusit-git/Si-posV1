#!/usr/bin/env tsx
// One-time backfill: flip customers.transfer_customer = TRUE for customers that
// today get treated as invoice-credit via the legacy allowlist or XFER-> name
// prefix. Run with --dry-run (default) to preview, --apply to persist.
import * as fs from "fs";
import * as path from "path";
import postgres from "postgres";
import {
  buildTransferCustomerBackfillAuditDetails,
  collectTransferCustomerBackfillCandidates,
  collectTransferCustomerBackfillTargets,
  parseTransferCustomerBackfillArgs,
  TRANSFER_CUSTOMER_BACKFILL_AUDIT_ACTION,
  TRANSFER_CUSTOMER_BACKFILL_AUDIT_USERNAME,
  type TransferCustomerBackfillRow,
  type TransferCustomerBackfillTarget,
} from "@/lib/transfer-customer-backfill";

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

function loadEnv(): Record<string, string | undefined> {
  const envFromFile = parseEnvFile(path.join(process.cwd(), ".env.local"));
  return {
    ...envFromFile,
    ...process.env,
  };
}

async function runForTarget(target: TransferCustomerBackfillTarget, apply: boolean) {
  const sql = postgres(target.url, { max: 2, connect_timeout: 15 });
  try {
    console.log(
      `\n--- Backfill target: ${target.factoryKey} (${apply ? "APPLY" : "dry-run"}) ---`
    );

    const rows = await sql<TransferCustomerBackfillRow[]>`
      SELECT id, name, transfer_customer
      FROM customers
      WHERE transfer_customer = FALSE
      ORDER BY id
    `;

    const candidates = collectTransferCustomerBackfillCandidates(rows);

    console.log(
      JSON.stringify(
        {
          target: target.factoryKey,
          scanned: rows.length,
          candidateCount: candidates.length,
          candidates: candidates.map((row) => ({
            id: row.id,
            name: row.name,
            source: row.source,
          })),
        },
        null,
        2
      )
    );

    if (!apply || candidates.length === 0) return;

    let updatedCount = 0;
    await sql.begin(async (tx) => {
      for (const candidate of candidates) {
        const updated = await tx`
          UPDATE customers
          SET transfer_customer = TRUE
          WHERE id = ${candidate.id}
            AND transfer_customer = FALSE
        `;
        if (updated.count < 1) continue;

        updatedCount += updated.count;
        const details = buildTransferCustomerBackfillAuditDetails({
          factoryKey: target.factoryKey,
          customerId: candidate.id,
          customerName: candidate.name,
          source: candidate.source,
          apply: true,
        });

        await tx`
          INSERT INTO audit_log (user_id, username, action, entity, entity_id, details, created_at)
          VALUES (
            NULL,
            ${TRANSFER_CUSTOMER_BACKFILL_AUDIT_USERNAME},
            ${TRANSFER_CUSTOMER_BACKFILL_AUDIT_ACTION},
            'customer',
            ${candidate.id},
            ${JSON.stringify(details)}::jsonb,
            NOW()
          )
        `;
      }
    });

    console.log(
      `[${target.factoryKey}] updated transfer_customer=TRUE for ${updatedCount} customers`
    );
  } finally {
    await sql.end();
  }
}

async function main() {
  const { apply, factorySelection } = parseTransferCustomerBackfillArgs(process.argv.slice(2));
  const env = loadEnv();
  const targets = collectTransferCustomerBackfillTargets(factorySelection, env);

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        factories: targets.map((target) => target.factoryKey),
      },
      null,
      2
    )
  );

  for (const target of targets) {
    await runForTarget(target, apply);
  }
  if (!apply) {
    console.log("\nDry-run only. Pass --apply to persist changes.");
  }
}

main().catch((error) => {
  console.error("backfill-transfer-customer-flag failed:", error);
  process.exit(1);
});
