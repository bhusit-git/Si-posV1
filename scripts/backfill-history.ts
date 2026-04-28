/**
 * Backfill Historical Data: Import 2015-2023 transactions from Access CSV into PostgreSQL
 *
 * Usage:
 *   DATABASE_URL="postgresql://localhost:5432/superice" npx tsx scripts/backfill-history.ts [csv-path]
 *
 * Or use .env.local factory URLs:
 *   FACTORY=si npx tsx scripts/backfill-history.ts /path/to/TransTable_full.csv
 *
 * This script:
 *  1. Reads TransTable_full.csv (the original Access export)
 *  2. Filters for rows BEFORE 2024-01-01 (the data excluded by the original import)
 *  3. Creates transactions + transaction_items in PostgreSQL
 *  4. Uses legacy product IDs 91-96
 *  5. Resets PostgreSQL sequences
 *  6. Verifies row counts
 */

import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";
import postgres from "postgres";
import { LEGACY_BY_ACCESS_EN } from "../src/lib/product-definitions";

// ==================== Config ====================
const CSV_PATH = process.argv[2] || path.join(__dirname, "..", "..", "data", "TransTable_full.csv");

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
const factory = process.env.FACTORY;
let PG_URL = process.env.DATABASE_URL;
if (factory) {
  const envVar = `DATABASE_URL_${factory.toUpperCase()}`;
  PG_URL = process.env[envVar] || env[envVar] || PG_URL;
}

if (!PG_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required (or set FACTORY=si|bearing|ktk).");
  console.error('Usage: DATABASE_URL="postgresql://..." npx tsx scripts/backfill-history.ts [csv-path]');
  process.exit(1);
}

if (!fs.existsSync(CSV_PATH)) {
  console.error("ERROR: CSV not found at", CSV_PATH);
  process.exit(1);
}

const pg = postgres(PG_URL, { max: 5 });

// ==================== Product type mapping ====================
// Access column names -> PostgreSQL product_type_id
// Legacy ice products are resolved from the shared legacy Access mapping so
// historical CSV backfills stay aligned with MDB imports.
function requireLegacyId(accessEn: string): number {
  const product = LEGACY_BY_ACCESS_EN.get(accessEn);
  if (!product) throw new Error(`Missing shared legacy mapping for Access column '${accessEn}'`);
  return product.newId;
}

const PRODUCT_MAPPING: { en: string; qtyCol: string; priceCol: string; ptId: number }[] = [
  { en: "Pack",      qtyCol: "Pack",      priceCol: "PackPrice",      ptId: requireLegacyId("Pack") },
  { en: "Unit",      qtyCol: "Unit",      priceCol: "UnitPrice",      ptId: requireLegacyId("Unit") },
  { en: "Bare",      qtyCol: "Bare",      priceCol: "BarePrice",      ptId: requireLegacyId("Bare") },
  { en: "Unit30",    qtyCol: "Unit30",    priceCol: "Unit30Price",    ptId: requireLegacyId("Unit30") },
  { en: "Crack",     qtyCol: "Crack",     priceCol: "CrackPrice",     ptId: requireLegacyId("Crack") },
  { en: "UnitSmall", qtyCol: "UnitSmall", priceCol: "UnitPriceSmall", ptId: requireLegacyId("UnitSmall") },
];

// ==================== Helpers ====================
function toNum(val: string | undefined | null): number {
  if (!val || val === "" || val === "null") return 0;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

function parseAccessDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  // Format: "MM/DD/YY HH:MM:SS" (from Access export)
  const parts = dateStr.replace(/"/g, "").split(" ")[0].split("/");
  if (parts.length !== 3) return null;
  const month = parseInt(parts[0]);
  const day = parseInt(parts[1]);
  let year = parseInt(parts[2]);
  if (year < 100) year += 2000;
  return new Date(year, month - 1, day);
}

function formatDate(dateStr: string): string {
  const d = parseAccessDate(dateStr);
  if (!d) return "2020-01-01"; // fallback
  return d.toISOString().split("T")[0]; // YYYY-MM-DD
}

function formatTime(timeStr: string): string {
  if (!timeStr) return "00:00:00";
  // Format: "12/30/99 HH:MM:SS"
  const parts = timeStr.replace(/"/g, "").split(" ");
  return parts.length > 1 ? parts[1] : "00:00:00";
}

// ==================== Main ====================
async function main() {
  console.log("\n========================================");
  console.log("  SuperICE Historical Data Backfill");
  console.log("  (2015-2023 transactions from Access)");
  console.log("========================================\n");

  // Step 0: Get existing customer IDs and current max IDs
  console.log("Step 0: Checking existing data...");
  const [txCountResult] = await pg.unsafe("SELECT COUNT(*) as c, MAX(id) as max_id FROM transactions");
  const [tiCountResult] = await pg.unsafe("SELECT COUNT(*) as c, MAX(id) as max_id FROM transaction_items");
  const existingTxCount = parseInt(txCountResult.c);
  const existingTiCount = parseInt(tiCountResult.c);
  const currentMaxTxId = parseInt(txCountResult.max_id) || 0;
  const currentMaxTiId = parseInt(tiCountResult.max_id) || 0;

  console.log(`  Existing transactions: ${existingTxCount} (max ID: ${currentMaxTxId})`);
  console.log(`  Existing transaction_items: ${existingTiCount} (max ID: ${currentMaxTiId})`);

  // Get valid customer IDs
  const customerRows = await pg.unsafe("SELECT id FROM customers");
  const validCustomerIds = new Set(customerRows.map((r: any) => parseInt(r.id)));
  console.log(`  Valid customers: ${validCustomerIds.size}`);

  // Step 1: Read and filter CSV
  console.log("\nStep 1: Reading CSV...");
  const csvContent = fs.readFileSync(CSV_PATH, "utf-8");
  const allRows: Record<string, string>[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true,
  });
  console.log(`  Total rows in CSV: ${allRows.length}`);

  const cutoff = new Date(2024, 0, 1); // January 1, 2024
  const historicalRows = allRows.filter((row) => {
    const d = parseAccessDate(row.SaleDate);
    return d && d < cutoff;
  });
  console.log(`  Historical rows (pre-2024): ${historicalRows.length}`);

  // Step 2: Insert in batches
  console.log("\nStep 2: Inserting historical transactions...");

  const BATCH_SIZE = 500;
  let newTxCount = 0;
  let newTiCount = 0;
  let skippedNoCustomer = 0;
  let skippedZeroTotal = 0;
  let nextTxId = currentMaxTxId + 1;
  let nextTiId = currentMaxTiId + 1;

  for (let batchStart = 0; batchStart < historicalRows.length; batchStart += BATCH_SIZE) {
    const batch = historicalRows.slice(batchStart, batchStart + BATCH_SIZE);

    // Collect all transaction and item inserts for this batch
    const txValues: any[][] = [];
    const tiValues: any[][] = [];

    for (const row of batch) {
      const customerId = toNum(row.CustomerID);
      if (customerId === 0 || !validCustomerIds.has(customerId)) {
        skippedNoCustomer++;
        continue;
      }

      // Calculate total from product columns
      let total = 0;
      const items: { ptId: number; qty: number; price: number }[] = [];

      for (const pm of PRODUCT_MAPPING) {
        const qty = toNum(row[pm.qtyCol]);
        if (qty === 0) continue;
        const price = toNum(row[pm.priceCol]);
        total += qty * price;
        items.push({ ptId: pm.ptId, qty, price });
      }

      // Also add Bag and Oth columns (if present)
      const bagQty = toNum(row.Bag);
      const bagPrice = toNum(row.BagPrice);
      total += bagQty * bagPrice;
      const othQty = toNum(row.Oth);
      const othPrice = toNum(row.OthPrice);
      total += othQty * othPrice;

      if (total === 0 && items.length === 0) {
        skippedZeroTotal++;
        continue;
      }

      const paid = toNum(row.Paid);
      const saleDate = formatDate(row.SaleDate);
      const saleTime = formatTime(row.SaleTime);

      // Determine payment status
      let status: string;
      let paidAmount: number;
      if (paid === -1) {
        // -1 means fully paid in old system
        paidAmount = total;
        status = "paid";
      } else if (paid >= total) {
        paidAmount = paid;
        status = "paid";
      } else if (paid > 0) {
        paidAmount = paid;
        status = "partial";
      } else {
        paidAmount = 0;
        status = "unpaid";
      }

      const txId = nextTxId++;
      txValues.push([
        txId,
        customerId,
        total,
        paidAmount,
        status,
        toNum(row.Pool) || null,
        toNum(row.Row) || null,
        toNum(row.Col) || null,
        saleDate,
        saleTime,
        null, // note
        new Date(saleDate + "T" + saleTime), // created_at
      ]);
      newTxCount++;

      // Create transaction_items for each non-zero product
      for (const item of items) {
        tiValues.push([
          nextTiId++,
          txId,
          item.ptId,
          item.qty,
          item.price,
          item.qty * item.price,
        ]);
        newTiCount++;
      }
    }

    // Batch insert transactions
    if (txValues.length > 0) {
      const txPlaceholders = txValues.map((_, i) => {
        const o = i * 12;
        return `($${o+1},$${o+2},$${o+3},$${o+4},$${o+5}::transaction_status,$${o+6},$${o+7},$${o+8},$${o+9},$${o+10},$${o+11},$${o+12})`;
      }).join(",");

      await pg.unsafe(
        `INSERT INTO transactions (id, customer_id, total_amount, paid, status, pool, "row", col, sale_date, sale_time, note, created_at)
         VALUES ${txPlaceholders}
         ON CONFLICT (id) DO NOTHING`,
        txValues.flat()
      );
    }

    // Batch insert transaction_items
    if (tiValues.length > 0) {
      const tiPlaceholders = tiValues.map((_, i) => {
        const o = i * 6;
        return `($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6})`;
      }).join(",");

      await pg.unsafe(
        `INSERT INTO transaction_items (id, transaction_id, product_type_id, quantity, unit_price, subtotal)
         VALUES ${tiPlaceholders}
         ON CONFLICT (id) DO NOTHING`,
        tiValues.flat()
      );
    }

    // Progress
    const processed = Math.min(batchStart + BATCH_SIZE, historicalRows.length);
    if (processed % 10000 === 0 || processed >= historicalRows.length) {
      console.log(`  ${processed.toLocaleString()} / ${historicalRows.length.toLocaleString()} rows processed (${newTxCount.toLocaleString()} tx, ${newTiCount.toLocaleString()} items)`);
    }
  }

  console.log(`\n  Inserted: ${newTxCount.toLocaleString()} transactions, ${newTiCount.toLocaleString()} items`);
  console.log(`  Skipped (no customer): ${skippedNoCustomer}`);
  console.log(`  Skipped (zero total): ${skippedZeroTotal}`);

  // Step 3: Reset sequences
  console.log("\nStep 3: Resetting sequences...");
  for (const table of ["transactions", "transaction_items"]) {
    const [result] = await pg.unsafe(`SELECT COALESCE(MAX(id), 0) + 1 as next_val FROM ${table}`);
    await pg.unsafe(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), $1, false)`, [result.next_val]);
    console.log(`  ${table}: next ID = ${result.next_val}`);
  }

  // Step 4: Verify
  console.log("\nStep 4: Verification...");
  const [finalTxCount] = await pg.unsafe("SELECT COUNT(*) as c FROM transactions");
  const [finalTiCount] = await pg.unsafe("SELECT COUNT(*) as c FROM transaction_items");
  const expectedTx = existingTxCount + newTxCount;
  const expectedTi = existingTiCount + newTiCount;

  console.log(`  Transactions: ${finalTxCount.c} (expected: ${expectedTx}) ${parseInt(finalTxCount.c) === expectedTx ? "OK" : "MISMATCH"}`);
  console.log(`  Transaction items: ${finalTiCount.c} (expected: ${expectedTi}) ${parseInt(finalTiCount.c) === expectedTi ? "OK" : "MISMATCH"}`);

  // Year distribution
  const yearDist = await pg.unsafe(`
    SELECT EXTRACT(YEAR FROM sale_date)::int as year, COUNT(*) as c
    FROM transactions
    GROUP BY 1
    ORDER BY 1
  `);
  console.log("\n  Transactions by year:");
  for (const row of yearDist) {
    console.log(`    ${row.year}: ${parseInt(row.c).toLocaleString()}`);
  }

  // DB size
  const [dbSize] = await pg.unsafe("SELECT pg_size_pretty(pg_database_size(current_database())) as size");
  console.log(`\n  Database size: ${dbSize.size}`);

  // FK integrity
  const [orphanTx] = await pg.unsafe("SELECT COUNT(*) as c FROM transactions t LEFT JOIN customers c ON t.customer_id = c.id WHERE c.id IS NULL");
  const [orphanTi] = await pg.unsafe("SELECT COUNT(*) as c FROM transaction_items ti LEFT JOIN transactions t ON ti.transaction_id = t.id WHERE t.id IS NULL");
  console.log(`  FK check - orphan transactions: ${orphanTx.c}`);
  console.log(`  FK check - orphan items: ${orphanTi.c}`);

  console.log("\n========================================");
  console.log("  Backfill complete!");
  console.log("========================================\n");

  await pg.end();
}

main().catch((err) => {
  console.error("\nBackfill FAILED:", err);
  process.exit(1);
});
