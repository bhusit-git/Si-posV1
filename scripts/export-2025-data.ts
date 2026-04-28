/**
 * Export 2025+ transaction data from local PostgreSQL to a SQL file.
 *
 * Usage:
 *   source .env.local && npx tsx scripts/export-2025-data.ts
 *
 * Output: scripts/seed-2025-data.sql
 */

import postgres from "postgres";
import * as fs from "fs";
import * as path from "path";

const PG_URL = process.env.DATABASE_URL;
if (!PG_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required.");
  process.exit(1);
}

const sql = postgres(PG_URL, { max: 3 });
const OUTPUT = path.join(__dirname, "seed-2025-data.sql");
const BATCH_SIZE = 500;
const START_DATE = "2025-01-01";

function escapeStr(val: string | null | undefined): string {
  if (val === null || val === undefined) return "NULL";
  return "'" + val.replace(/'/g, "''") + "'";
}

function formatVal(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "true" : "false";
  if (val instanceof Date) return escapeStr(val.toISOString());
  return escapeStr(String(val));
}

async function main() {
  const out = fs.createWriteStream(OUTPUT);

  out.write("-- Super Ice POS: 2025+ transaction data export\n");
  out.write(`-- Generated: ${new Date().toISOString()}\n`);
  out.write(`-- Source: local PostgreSQL, sale_date >= '${START_DATE}'\n\n`);
  out.write("SET client_encoding = 'UTF8';\n");
  out.write("SET standard_conforming_strings = on;\n\n");

  // --- 1. Transactions ---
  console.log("Querying transactions...");
  const txRows = await sql`
    SELECT id, customer_id, total_amount, paid, status,
           pool, "row", col, sale_date, sale_time, note,
           fulfillment, created_at
    FROM transactions
    WHERE sale_date >= ${START_DATE}
    ORDER BY id
  `;
  console.log(`  Found ${txRows.length} transactions`);

  const txCols = "id, customer_id, total_amount, paid, status, pool, \"row\", col, sale_date, sale_time, note, fulfillment, created_at";
  out.write(`-- Transactions: ${txRows.length} rows\n`);

  function formatDate(val: unknown): string {
    if (val === null || val === undefined) return "NULL";
    // If it's a Date object, convert to YYYY-MM-DD
    if (val instanceof Date) {
      const y = val.getFullYear();
      const m = String(val.getMonth() + 1).padStart(2, "0");
      const d = String(val.getDate()).padStart(2, "0");
      return `'${y}-${m}-${d}'`;
    }
    const s = String(val);
    // Extract YYYY-MM-DD from ISO string
    const match = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? `'${match[1]}'` : escapeStr(s);
  }

  for (let i = 0; i < txRows.length; i += BATCH_SIZE) {
    const batch = txRows.slice(i, i + BATCH_SIZE);
    out.write(`INSERT INTO transactions (${txCols}) VALUES\n`);
    const values = batch.map((r) => {
      return `(${r.id}, ${r.customer_id}, ${r.total_amount}, ${r.paid}, ${formatVal(r.status)}, ${formatVal(r.pool)}, ${formatVal(r.row)}, ${formatVal(r.col)}, ${formatDate(r.sale_date)}, ${formatVal(r.sale_time)}, ${formatVal(r.note)}, ${formatVal(r.fulfillment)}, ${formatVal(r.created_at)})`;
    });
    out.write(values.join(",\n"));
    out.write(";\n\n");
  }

  // --- 2. Transaction Items ---
  console.log("Querying transaction items...");
  const txIds = txRows.map((r) => r.id);

  // Query in batches of 10,000 IDs to avoid query size limits
  const allItems: Array<Record<string, unknown>> = [];
  for (let i = 0; i < txIds.length; i += 10000) {
    const chunk = txIds.slice(i, i + 10000);
    const items = await sql`
      SELECT id, transaction_id, product_type_id, quantity, unit_price, subtotal, loaded_qty
      FROM transaction_items
      WHERE transaction_id = ANY(${chunk})
      ORDER BY id
    `;
    allItems.push(...items);
  }
  console.log(`  Found ${allItems.length} transaction items`);

  const tiCols = "id, transaction_id, product_type_id, quantity, unit_price, subtotal, loaded_qty";
  out.write(`-- Transaction Items: ${allItems.length} rows\n`);

  for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
    const batch = allItems.slice(i, i + BATCH_SIZE);
    out.write(`INSERT INTO transaction_items (${tiCols}) VALUES\n`);
    const values = batch.map((r) => {
      return `(${r.id}, ${r.transaction_id}, ${r.product_type_id}, ${r.quantity}, ${r.unit_price}, ${r.subtotal}, ${r.loaded_qty})`;
    });
    out.write(values.join(",\n"));
    out.write(";\n\n");
  }

  // --- 3. Bag Ledger ---
  console.log("Querying bag ledger entries...");
  const bagRows = await sql`
    SELECT id, customer_id, product_type_id, type, quantity, transaction_id, note, created_at
    FROM bag_ledger
    WHERE transaction_id = ANY(${txIds})
    ORDER BY id
  `;
  console.log(`  Found ${bagRows.length} bag ledger entries`);

  if (bagRows.length > 0) {
    const blCols = "id, customer_id, product_type_id, type, quantity, transaction_id, note, created_at";
    out.write(`-- Bag Ledger: ${bagRows.length} rows\n`);

    for (let i = 0; i < bagRows.length; i += BATCH_SIZE) {
      const batch = bagRows.slice(i, i + BATCH_SIZE);
      out.write(`INSERT INTO bag_ledger (${blCols}) VALUES\n`);
      const values = batch.map((r) => {
        return `(${r.id}, ${r.customer_id}, ${r.product_type_id}, ${formatVal(r.type)}, ${r.quantity}, ${formatVal(r.transaction_id)}, ${formatVal(r.note)}, ${formatVal(r.created_at)})`;
      });
      out.write(values.join(",\n"));
      out.write(";\n\n");
    }
  }

  // --- 4. Also include bag ledger entries NOT tied to transactions (adjustments etc.) ---
  const bagNoTx = await sql`
    SELECT id, customer_id, product_type_id, type, quantity, transaction_id, note, created_at
    FROM bag_ledger
    WHERE transaction_id IS NULL
       OR transaction_id NOT IN (SELECT id FROM transactions WHERE sale_date >= ${START_DATE})
    ORDER BY id
  `;
  if (bagNoTx.length > 0) {
    console.log(`  Found ${bagNoTx.length} additional bag ledger entries (no tx or older tx)`);
    const blCols = "id, customer_id, product_type_id, type, quantity, transaction_id, note, created_at";
    out.write(`-- Bag Ledger (standalone): ${bagNoTx.length} rows\n`);
    out.write("-- Using ON CONFLICT to skip duplicates\n");

    for (let i = 0; i < bagNoTx.length; i += BATCH_SIZE) {
      const batch = bagNoTx.slice(i, i + BATCH_SIZE);
      out.write(`INSERT INTO bag_ledger (${blCols}) VALUES\n`);
      const values = batch.map((r) => {
        return `(${r.id}, ${r.customer_id}, ${r.product_type_id}, ${formatVal(r.type)}, ${r.quantity}, ${formatVal(r.transaction_id)}, ${formatVal(r.note)}, ${formatVal(r.created_at)})`;
      });
      out.write(values.join(",\n"));
      out.write("\nON CONFLICT (id) DO NOTHING;\n\n");
    }
  }

  // --- 5. Reset sequences ---
  out.write("-- Reset sequences to max IDs\n");
  const maxTxId = txRows.length > 0 ? txRows[txRows.length - 1].id : 0;
  const maxTiId = allItems.length > 0 ? allItems[allItems.length - 1].id : 0;
  const allBagIds = [...bagRows, ...bagNoTx].map((r) => r.id as number);
  const maxBlId = allBagIds.length > 0 ? Math.max(...allBagIds) : 0;

  out.write(`SELECT setval('transactions_id_seq', ${maxTxId + 1}, false);\n`);
  out.write(`SELECT setval('transaction_items_id_seq', ${maxTiId + 1}, false);\n`);
  out.write(`SELECT setval('bag_ledger_id_seq', ${maxBlId + 1}, false);\n\n`);

  out.write("-- Done!\n");
  out.end();

  await new Promise((resolve) => out.on("finish", resolve));
  await sql.end();

  const stats = fs.statSync(OUTPUT);
  console.log(`\nExport complete: ${OUTPUT}`);
  console.log(`File size: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
}

main().catch((e) => {
  console.error("Export failed:", e);
  process.exit(1);
});
