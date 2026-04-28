/**
 * Push data from a local PostgreSQL database to the Render production API.
 *
 * Usage:
 *   LOCAL_DB="postgresql://localhost:5432/superice_bearing" \
 *   RENDER_URL="https://superice-pos.onrender.com" \
 *   MIGRATE_KEY="superice2026migrate" \
 *   FACTORY="bearing" \
 *   npx tsx scripts/push-to-render.ts
 *
 * Reads all business data (products, customers, prices, transactions,
 * transaction_items, bag_ledger) from the local DB and sends them in
 * batches to POST /api/migrate?action=upload on the Render service.
 */

import postgres from "postgres";

const LOCAL_DB = process.env.LOCAL_DB || "postgresql://localhost:5432/superice_bearing";
const RENDER_URL = process.env.RENDER_URL || "https://superice-pos.onrender.com";
const MIGRATE_KEY = process.env.MIGRATE_KEY || "superice2026migrate";
const FACTORY = process.env.FACTORY || "bearing";
const BATCH_SIZE = 500;

const localSql = postgres(LOCAL_DB, { max: 2 });

async function sendBatch(table: string, rows: any[]): Promise<number> {
  const url = `${RENDER_URL}/api/migrate?action=upload&factory=${FACTORY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MIGRATE_KEY}`,
    },
    body: JSON.stringify({ table, rows }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Upload failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.inserted || 0;
}

async function pushTable(table: string, query: string, transform?: (row: any) => any) {
  const rows = await localSql.unsafe(query);
  const total = rows.length;
  console.log(`\n--- ${table}: ${total} rows ---`);
  if (total === 0) return;

  let sent = 0;
  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const mapped = transform ? batch.map(transform) : batch;

    let retries = 3;
    while (retries > 0) {
      try {
        const inserted = await sendBatch(table, mapped);
        sent += inserted;
        break;
      } catch (e: any) {
        retries--;
        if (retries === 0) throw e;
        console.log(`  Retry (${3 - retries}/3): ${e.message.slice(0, 80)}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    const pct = Math.round(((i + batch.length) / total) * 100);
    process.stdout.write(`\r  ${table}: ${sent} / ${total}  (${pct}%)`);
  }
  console.log(`\r  ${table}: ${sent} / ${total}  (100%) ✓`);
}

async function resetSequences() {
  const url = `${RENDER_URL}/api/migrate?action=reset-sequences&factory=${FACTORY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${MIGRATE_KEY}` },
  });
  if (!res.ok) throw new Error(`Reset sequences failed: ${res.status}`);
  return res.json();
}

async function main() {
  console.log("=".repeat(50));
  console.log(`  Push local DB -> Render (${FACTORY})`);
  console.log(`  Source: ${LOCAL_DB}`);
  console.log(`  Target: ${RENDER_URL}`);
  console.log("=".repeat(50));

  const [countCheck] = await localSql`SELECT COUNT(*)::int as c FROM product_types`;
  console.log(`\nLocal DB check: ${countCheck.c} product types found`);

  await pushTable(
    "product_types",
    "SELECT id, name, name_en, has_bag, is_active, sort_order FROM product_types ORDER BY id"
  );

  await pushTable(
    "customers",
    "SELECT id, name, phone, credit, created_at FROM customers ORDER BY id",
    (r) => ({ ...r, created_at: r.created_at?.toISOString?.() || r.created_at })
  );

  await pushTable(
    "customer_prices",
    "SELECT id, customer_id, product_type_id, unit_price, bag_deposit FROM customer_prices ORDER BY id"
  );

  await pushTable(
    "transactions",
    `SELECT id, customer_id, total_amount, paid, status, pool, "row", col,
            sale_date::text, sale_time::text, note, created_at
     FROM transactions ORDER BY id`,
    (r) => ({ ...r, created_at: r.created_at?.toISOString?.() || r.created_at })
  );

  await pushTable(
    "transaction_items",
    "SELECT id, transaction_id, product_type_id, quantity, unit_price, subtotal FROM transaction_items ORDER BY id"
  );

  await pushTable(
    "bag_ledger",
    "SELECT id, customer_id, product_type_id, type, quantity, transaction_id, note, created_at FROM bag_ledger ORDER BY id",
    (r) => ({ ...r, created_at: r.created_at?.toISOString?.() || r.created_at })
  );

  console.log("\n--- Resetting sequences ---");
  const seqResult = await resetSequences();
  console.log("  Sequences:", seqResult.sequences?.join(", "));
  console.log("  Counts:", JSON.stringify(seqResult.counts));

  console.log("\n" + "=".repeat(50));
  console.log("  Migration complete!");
  console.log("=".repeat(50));

  await localSql.end();
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
