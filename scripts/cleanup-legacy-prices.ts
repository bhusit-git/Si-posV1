/**
 * Remove customer_prices rows for legacy product IDs (91-96) from factory databases.
 *
 * Legacy products were migrated to new IDs (1-18) and their prices copied via
 * the migrate-prices action. This script cleans up the leftover legacy rows.
 *
 * Supports local (direct DB) and remote (Render API) execution.
 *
 * Usage:
 *   # Local mode – direct DB connection (default)
 *   FACTORY=bearing npx tsx scripts/cleanup-legacy-prices.ts
 *   FACTORY=si      npx tsx scripts/cleanup-legacy-prices.ts
 *   FACTORY=all     npx tsx scripts/cleanup-legacy-prices.ts
 *
 *   # Remote mode – via /api/migrate on Render
 *   FACTORY=bearing MODE=render npx tsx scripts/cleanup-legacy-prices.ts
 *
 *   # Dry run – preview only, no deletes
 *   FACTORY=bearing DRY_RUN=1 npx tsx scripts/cleanup-legacy-prices.ts
 *
 * Environment variables:
 *   FACTORY       Required. "si", "bearing", "ktk", or "all"
 *   MODE          "local" (default) or "render"
 *   DRY_RUN       Set to "1" to preview without deleting
 *   RENDER_URL    Render app URL (default: https://superice-pos.onrender.com)
 *   MIGRATE_KEY   Key for the /api/migrate endpoint
 */

import postgres from "postgres";
import { LEGACY_ICE } from "../src/lib/product-definitions";

const FACTORY = process.env.FACTORY || "";
const MODE = process.env.MODE || "local";
const DRY_RUN = process.env.DRY_RUN === "1";
const RENDER_URL = process.env.RENDER_URL || "https://superice-pos.onrender.com";
const MIGRATE_KEY = process.env.MIGRATE_KEY || "superice2026migrate";

const LEGACY_IDS = LEGACY_ICE.map((l) => l.newId); // [91,92,93,94,95,96]

const FACTORY_DB_VARS: Record<string, string> = {
  si: "DATABASE_URL_SI",
  bearing: "DATABASE_URL_BEARING",
  ktk: "DATABASE_URL_KTK",
};

interface CleanupResult {
  factory: string;
  dryRun: boolean;
  before: { productId: number; name: string; count: number }[];
  totalDeleted: number;
  remainingRows: number;
}

// ---------------------------------------------------------------------------
// Local mode: direct PostgreSQL connection
// ---------------------------------------------------------------------------
async function cleanupLocal(factoryKey: string): Promise<CleanupResult> {
  const envVar = FACTORY_DB_VARS[factoryKey];
  if (!envVar) throw new Error(`Unknown factory: ${factoryKey}`);

  const dbUrl = process.env[envVar];
  if (!dbUrl) {
    // Try loading from .env.local
    try {
      const fs = await import("fs");
      const envContent = fs.readFileSync(".env.local", "utf8");
      for (const line of envContent.split("\n")) {
        const [key, ...rest] = line.split("=");
        if (key.trim() === envVar) {
          process.env[envVar] = rest.join("=").trim();
        }
      }
    } catch { /* ignore */ }
  }

  const url = process.env[envVar];
  if (!url) throw new Error(`${envVar} not set. Provide it as an environment variable or in .env.local`);

  const sql = postgres(url, { max: 1, connect_timeout: 10 });

  const legacyNames = new Map(LEGACY_ICE.map((l) => [l.newId, l.name]));

  // Count before
  const beforeRows = await sql`
    SELECT product_type_id as pid, COUNT(*)::int as cnt
    FROM customer_prices
    WHERE product_type_id = ANY(${LEGACY_IDS})
    GROUP BY product_type_id
    ORDER BY product_type_id
  `;
  const before = beforeRows.map((r) => ({
    productId: r.pid as number,
    name: legacyNames.get(r.pid as number) || `ID ${r.pid}`,
    count: r.cnt as number,
  }));
  const totalBefore = before.reduce((s, r) => s + r.count, 0);

  let totalDeleted = 0;
  if (!DRY_RUN && totalBefore > 0) {
    const deleted = await sql`DELETE FROM customer_prices WHERE product_type_id = ANY(${LEGACY_IDS})`;
    totalDeleted = deleted.count;
  }

  const [remaining] = await sql`SELECT COUNT(*)::int as cnt FROM customer_prices`;

  await sql.end();

  return {
    factory: factoryKey,
    dryRun: DRY_RUN,
    before,
    totalDeleted,
    remainingRows: remaining.cnt as number,
  };
}

// ---------------------------------------------------------------------------
// Render mode: call /api/migrate?action=cleanup-legacy-prices
// ---------------------------------------------------------------------------
async function cleanupRender(factoryKey: string): Promise<CleanupResult> {
  const headers = { Authorization: `Bearer ${MIGRATE_KEY}` };
  if (DRY_RUN) {
    // Dry run for render: use GET check-products to show current state
    const checkUrl = `${RENDER_URL}/api/migrate?action=check-products&factory=${factoryKey}`;
    const checkRes = await fetch(checkUrl, { headers });
    if (!checkRes.ok) throw new Error(`Check failed (${checkRes.status}): ${await checkRes.text()}`);
    const checkData = await checkRes.json();

    const legacyNames = new Map(LEGACY_ICE.map((l) => [l.newId, l.name]));
    const cpCounts = (checkData.fkReferenceCounts?.customer_prices || []) as { product_id: number; count: number }[];
    const before = LEGACY_IDS.map((id) => ({
      productId: id,
      name: legacyNames.get(id) || `ID ${id}`,
      count: cpCounts.find((r) => r.product_id === id)?.count || 0,
    })).filter((r) => r.count > 0);

    return {
      factory: factoryKey,
      dryRun: true,
      before,
      totalDeleted: 0,
      remainingRows: checkData.totalRows?.customer_prices || 0,
    };
  }

  const url = `${RENDER_URL}/api/migrate?action=cleanup-legacy-prices&factory=${factoryKey}`;
  const res = await fetch(url, { method: "POST", headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cleanup failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();

  return {
    factory: factoryKey,
    dryRun: false,
    before: [],
    totalDeleted: data.deletedRows || 0,
    remainingRows: data.remainingRows || 0,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function printResult(result: CleanupResult) {
  console.log(`\n${"─".repeat(50)}`);
  console.log(`  Factory: ${result.factory.toUpperCase()}${result.dryRun ? " (DRY RUN)" : ""}`);
  console.log(`${"─".repeat(50)}`);

  if (result.before.length > 0) {
    console.log("  Legacy prices found:");
    for (const r of result.before) {
      console.log(`    ID ${r.productId} (${r.name}): ${r.count} rows`);
    }
    const total = result.before.reduce((s, r) => s + r.count, 0);
    console.log(`    Total: ${total} legacy price rows`);
  } else if (result.dryRun) {
    console.log("  No legacy price rows found.");
  }

  if (!result.dryRun) {
    console.log(`  Deleted: ${result.totalDeleted} rows`);
  }
  console.log(`  Remaining customer_prices: ${result.remainingRows}`);
}

async function main() {
  if (!FACTORY) {
    console.error("Error: FACTORY env var is required (si, bearing, ktk, or all)");
    process.exit(1);
  }

  const factories = FACTORY === "all"
    ? Object.keys(FACTORY_DB_VARS)
    : [FACTORY];

  for (const f of factories) {
    if (!FACTORY_DB_VARS[f]) {
      console.error(`Error: Unknown factory "${f}". Use si, bearing, ktk, or all.`);
      process.exit(1);
    }
  }

  console.log("=".repeat(50));
  console.log(`  Cleanup Legacy Prices (IDs ${LEGACY_IDS.join(", ")})`);
  console.log(`  Mode: ${MODE} | Dry run: ${DRY_RUN}`);
  console.log(`  Factories: ${factories.join(", ")}`);
  console.log("=".repeat(50));

  const cleanup = MODE === "render" ? cleanupRender : cleanupLocal;

  for (const f of factories) {
    try {
      const result = await cleanup(f);
      printResult(result);
    } catch (err) {
      console.error(`\n  ERROR [${f}]: ${err}`);
    }
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log("  Done.");
  console.log("=".repeat(50));
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
