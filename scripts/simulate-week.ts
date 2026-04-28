#!/usr/bin/env npx tsx
/**
 * Simulate a week of transactions based on real October 2025 data.
 *
 * Reads Oct 1-7 2025 transactions from the local database, then replays them
 * via the API with remapped dates (to the current week or a target week).
 * This creates realistic data complete with audit logs, bag ledger entries,
 * and proper user tracking.
 *
 * Usage:
 *   DATABASE_URL=postgresql://localhost:5432/superice npx tsx scripts/simulate-week.ts
 *
 * Options (env vars):
 *   SIM_START_DATE=2026-02-09   # Target week start (default: this Monday)
 *   SIM_DRY_RUN=1               # Print stats without inserting
 *   SIM_SPEED=fast               # "fast" = parallel batches, "slow" = sequential
 *   SIM_INCLUDE_VOIDS=1         # Also simulate some voids (default: off)
 *   SIM_INCLUDE_CREDIT=1        # Include unpaid/partial transactions (default: off, all paid)
 */

import postgres from "postgres";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PG_URL = process.env.DATABASE_URL;
if (!PG_URL) {
  console.error("ERROR: DATABASE_URL is required. Example:");
  console.error("  DATABASE_URL=postgresql://localhost:5432/superice npx tsx scripts/simulate-week.ts");
  process.exit(1);
}

const BASE_URL = process.env.SIM_BASE_URL || "http://localhost:3000";
const USERNAME = process.env.SIM_USER || "Admin";
const PASSWORD = process.env.SIM_PASS || "lion";
const DRY_RUN = process.env.SIM_DRY_RUN === "1";
const SPEED = process.env.SIM_SPEED || "fast";
const INCLUDE_VOIDS = process.env.SIM_INCLUDE_VOIDS === "1";
const INCLUDE_CREDIT = process.env.SIM_INCLUDE_CREDIT === "1";
const BATCH_SIZE = 10; // concurrent API requests per batch

// Source data: Oct 1-7, 2025
const SOURCE_START = "2025-10-01";
const SOURCE_END = "2025-10-07";

// Target week: default to current Monday
function getTargetStart(): string {
  if (process.env.SIM_START_DATE) return process.env.SIM_START_DATE;
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return formatDate(monday);
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SourceTransaction {
  id: number;
  customer_id: number;
  total_amount: number;
  paid: number;
  status: string;
  pool: number | null;
  row: number | null;
  col: number | null;
  sale_date: string;
  sale_time: string;
  note: string | null;
  fulfillment: string | null;
}

interface SourceItem {
  transaction_id: number;
  product_type_id: number;
  quantity: number;
  unit_price: number;
}

interface BagEntry {
  transaction_id: number;
  product_type_id: number;
  type: string;
  quantity: number;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

let sessionCookie = "";

async function login(): Promise<void> {
  console.log(`  Logging in as "${USERNAME}"...`);
  const res = await fetch(`${BASE_URL}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    redirect: "manual",
  });
  if (!res.ok) throw new Error(`Login failed (${res.status}): ${await res.text()}`);
  const setCookies: string[] =
    res.headers.getSetCookie?.() ||
    (res.headers.get("set-cookie") || "").split(/,(?=\s*\w+=)/).filter(Boolean);
  const cookie = setCookies.find((c) => c.includes("superice_session="));
  if (!cookie) throw new Error("No session cookie returned");
  const match = cookie.match(/(superice_session=[^;]+)/);
  if (!match) throw new Error("Could not parse session cookie");
  sessionCookie = match[1];
  console.log("  Login successful.\n");
}

async function apiPost(
  path: string,
  body: unknown
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: sessionCookie,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data: data as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const targetStart = getTargetStart();
  const targetDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(targetStart);
    d.setDate(d.getDate() + i);
    return formatDate(d);
  });

  console.log("=".repeat(60));
  console.log("  Simulate Week — Based on Oct 1-7, 2025 Historical Data");
  console.log("=".repeat(60));
  console.log(`  Source period:  ${SOURCE_START} to ${SOURCE_END}`);
  console.log(`  Target period:  ${targetDates[0]} to ${targetDates[6]}`);
  console.log(`  API target:     ${BASE_URL}`);
  console.log(`  Dry run:        ${DRY_RUN}`);
  console.log(`  Speed:          ${SPEED}`);
  console.log(`  Include credit: ${INCLUDE_CREDIT}`);
  console.log(`  Include voids:  ${INCLUDE_VOIDS}`);
  console.log("");

  // -----------------------------------------------------------------------
  // 1. Read source data from local PostgreSQL
  // -----------------------------------------------------------------------
  console.log("[1/4] Reading source data from database...");
  const sql = postgres(PG_URL!, { max: 5 });

  const sourceTxs: SourceTransaction[] = await sql`
    SELECT id, customer_id, total_amount, paid, status,
           pool, "row", col, sale_date::text, sale_time::text, note, fulfillment
    FROM transactions
    WHERE sale_date >= ${SOURCE_START} AND sale_date <= ${SOURCE_END}
      AND status != 'voided'
    ORDER BY sale_date, sale_time, id
  `;

  const txIds = sourceTxs.map((t) => t.id);

  // Items (batch query)
  const allItems: SourceItem[] = [];
  for (let i = 0; i < txIds.length; i += 5000) {
    const chunk = txIds.slice(i, i + 5000);
    const items = await sql`
      SELECT transaction_id, product_type_id, quantity, unit_price
      FROM transaction_items
      WHERE transaction_id = ANY(${chunk})
      ORDER BY id
    `;
    allItems.push(...(items as unknown as SourceItem[]));
  }

  // Bag ledger entries (for bag returns)
  const bagReturns: BagEntry[] = [];
  for (let i = 0; i < txIds.length; i += 5000) {
    const chunk = txIds.slice(i, i + 5000);
    const bags = await sql`
      SELECT transaction_id, product_type_id, type, quantity
      FROM bag_ledger
      WHERE transaction_id = ANY(${chunk}) AND type = 'return'
      ORDER BY id
    `;
    bagReturns.push(...(bags as unknown as BagEntry[]));
  }

  await sql.end();

  // Group items and bag returns by transaction
  const itemsByTx = new Map<number, SourceItem[]>();
  for (const item of allItems) {
    const arr = itemsByTx.get(item.transaction_id) || [];
    arr.push(item);
    itemsByTx.set(item.transaction_id, arr);
  }

  const bagReturnsByTx = new Map<number, BagEntry[]>();
  for (const bag of bagReturns) {
    const arr = bagReturnsByTx.get(bag.transaction_id) || [];
    arr.push(bag);
    bagReturnsByTx.set(bag.transaction_id, arr);
  }

  // Map source dates to day indices (0-6)
  const sourceDates = Array.from(new Set(sourceTxs.map((t) => t.sale_date.slice(0, 10)))).sort();
  const dateDayMap = new Map<string, number>();
  sourceDates.forEach((d, i) => dateDayMap.set(d, i));

  console.log(`  ${sourceTxs.length} transactions, ${allItems.length} items, ${bagReturns.length} bag returns`);
  console.log(`  Source dates: ${sourceDates.join(", ")}`);

  // -----------------------------------------------------------------------
  // 2. Build simulation payloads
  // -----------------------------------------------------------------------
  console.log("\n[2/4] Building simulation payloads...");

  interface SimPayload {
    targetDate: string;
    saleTime: string;
    payload: Record<string, unknown>;
  }

  const payloads: SimPayload[] = [];
  let skipped = 0;

  for (const tx of sourceTxs) {
    const items = itemsByTx.get(tx.id);
    if (!items || items.length === 0) {
      skipped++;
      continue;
    }

    // Skip zero-quantity items
    const validItems = items.filter((it) => it.quantity > 0);
    if (validItems.length === 0) {
      skipped++;
      continue;
    }

    const dayIdx = dateDayMap.get(tx.sale_date.slice(0, 10)) ?? 0;
    const targetDate = targetDates[dayIdx];

    // Determine status
    let status: string = "paid";
    let paid: number | undefined = undefined;
    if (INCLUDE_CREDIT) {
      if (tx.status === "unpaid") {
        status = "unpaid";
        paid = 0;
      } else if (tx.status === "partial") {
        status = "partial";
        paid = tx.paid;
      }
    }

    // Build bag returns
    const txBagReturns = bagReturnsByTx.get(tx.id);
    const bagReturnPayload = txBagReturns
      ? txBagReturns
          .filter((b) => b.quantity > 0)
          .map((b) => ({
            productTypeId: b.product_type_id,
            quantity: b.quantity,
          }))
      : undefined;

    const body: Record<string, unknown> = {
      clientId: `sim-oct-${tx.id}-${targetDate}`,
      customerId: tx.customer_id,
      items: validItems.map((it) => ({
        productTypeId: it.product_type_id,
        quantity: it.quantity,
        unitPrice: it.unit_price,
      })),
      status,
      saleDate: targetDate,
      saleTime: tx.sale_time.slice(0, 8),
      fulfillment: "loaded",
    };

    if (paid !== undefined) body.paid = paid;
    if (tx.pool) body.pool = tx.pool;
    if (tx.row) body.row = tx.row;
    if (tx.col) body.col = tx.col;
    if (tx.note) body.note = tx.note;
    if (bagReturnPayload && bagReturnPayload.length > 0) {
      body.bagReturns = bagReturnPayload;
    }

    payloads.push({
      targetDate,
      saleTime: tx.sale_time.slice(0, 8),
      payload: body,
    });
  }

  // Per-day breakdown
  const byDay = new Map<string, number>();
  for (const p of payloads) {
    byDay.set(p.targetDate, (byDay.get(p.targetDate) || 0) + 1);
  }

  console.log(`  ${payloads.length} payloads built (${skipped} skipped)`);
  console.log("  Per-day breakdown:");
  for (const [date, count] of [...byDay.entries()].sort()) {
    console.log(`    ${date}: ${count} transactions`);
  }

  if (DRY_RUN) {
    console.log("\n  DRY RUN — no data inserted. Set SIM_DRY_RUN=0 to insert.\n");
    return;
  }

  // -----------------------------------------------------------------------
  // 3. Insert via API
  // -----------------------------------------------------------------------
  console.log("\n[3/4] Inserting via API...");
  await login();

  let inserted = 0;
  let duplicates = 0;
  let errors = 0;
  const startTime = performance.now();

  if (SPEED === "fast") {
    // Parallel batches
    for (let i = 0; i < payloads.length; i += BATCH_SIZE) {
      const batch = payloads.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map((p) => apiPost("/api/transactions", p.payload))
      );

      for (const r of results) {
        if (r.status === 201) inserted++;
        else if (r.status === 200 && r.data.duplicate) duplicates++;
        else errors++;
      }

      // Progress
      const done = Math.min(i + BATCH_SIZE, payloads.length);
      if (done % 100 === 0 || done === payloads.length) {
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
        const tps = (inserted / parseFloat(elapsed)).toFixed(0);
        process.stdout.write(
          `\r  Progress: ${done}/${payloads.length} (${inserted} inserted, ${duplicates} dupes, ${errors} errors) [${elapsed}s, ~${tps} TPS]`
        );
      }
    }
  } else {
    // Sequential (slower but easier on the server)
    for (let i = 0; i < payloads.length; i++) {
      const r = await apiPost("/api/transactions", payloads[i].payload);
      if (r.status === 201) inserted++;
      else if (r.status === 200 && r.data.duplicate) duplicates++;
      else errors++;

      if ((i + 1) % 50 === 0 || i === payloads.length - 1) {
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
        process.stdout.write(
          `\r  Progress: ${i + 1}/${payloads.length} (${inserted} inserted, ${duplicates} dupes, ${errors} errors) [${elapsed}s]`
        );
      }
    }
  }

  const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log("\n");

  // -----------------------------------------------------------------------
  // 4. Summary
  // -----------------------------------------------------------------------
  console.log("[4/4] Summary");
  console.log("=".repeat(60));
  console.log(`  Total payloads:  ${payloads.length}`);
  console.log(`  Inserted:        ${inserted}`);
  console.log(`  Duplicates:      ${duplicates} (already existed, safe to re-run)`);
  console.log(`  Errors:          ${errors}`);
  console.log(`  Time:            ${totalTime}s`);
  console.log(`  TPS:             ${(inserted / parseFloat(totalTime)).toFixed(0)}`);
  console.log(`  Target week:     ${targetDates[0]} to ${targetDates[6]}`);
  console.log("=".repeat(60));

  if (INCLUDE_VOIDS && inserted > 0) {
    console.log("\n  Simulating voids on ~2% of inserted transactions...");
    // We don't have the new IDs easily, so skip for now
    console.log("  (Void simulation not yet implemented — void manually via the UI for testing)");
  }

  if (errors > 0) {
    console.log("\n  WARNING: Some inserts failed. Check the server logs for details.");
  }

  console.log("\n  Done! Check the dashboard and reports for your simulated week.\n");
}

main().catch((e) => {
  console.error("\nSimulation failed:", e);
  process.exit(1);
});
