/**
 * Setup Render database: apply schema migrations + verify structure.
 * Run from Render shell: npx tsx scripts/setup-render-db.ts
 *
 * This script:
 * 1. Creates the fulfillment_status enum if missing
 * 2. Adds the fulfillment column to transactions if missing
 * 3. Adds the loaded_qty column to transaction_items if missing
 * 4. Creates the fulfillment index if missing
 */

import postgres from "postgres";

const PG_URL = process.env.DATABASE_URL;
if (!PG_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required.");
  process.exit(1);
}

const sql = postgres(PG_URL, { max: 3 });

async function main() {
  console.log("Checking and applying schema migrations...\n");

  // 1. Check/create fulfillment_status enum
  const enumCheck = await sql`
    SELECT 1 FROM pg_type WHERE typname = 'fulfillment_status'
  `;
  if (enumCheck.length === 0) {
    console.log("Creating fulfillment_status enum...");
    await sql`CREATE TYPE fulfillment_status AS ENUM ('pending', 'loaded')`;
    console.log("  Done.");
  } else {
    console.log("fulfillment_status enum: exists");
  }

  // 2. Check/add fulfillment column on transactions
  const fulfillmentCol = await sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'fulfillment'
  `;
  if (fulfillmentCol.length === 0) {
    console.log("Adding fulfillment column to transactions...");
    await sql`ALTER TABLE transactions ADD COLUMN fulfillment fulfillment_status`;
    console.log("  Done.");
  } else {
    console.log("transactions.fulfillment column: exists");
  }

  // 3. Check/add loaded_qty column on transaction_items
  const loadedCol = await sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transaction_items' AND column_name = 'loaded_qty'
  `;
  if (loadedCol.length === 0) {
    console.log("Adding loaded_qty column to transaction_items...");
    await sql`ALTER TABLE transaction_items ADD COLUMN loaded_qty double precision NOT NULL DEFAULT 0`;
    console.log("  Done.");
  } else {
    console.log("transaction_items.loaded_qty column: exists");
  }

  // 4. Check/add fulfillment index
  const idxCheck = await sql`
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'transactions' AND indexname = 'idx_transactions_fulfillment'
  `;
  if (idxCheck.length === 0) {
    console.log("Creating idx_transactions_fulfillment index...");
    await sql`CREATE INDEX idx_transactions_fulfillment ON transactions (fulfillment)`;
    console.log("  Done.");
  } else {
    console.log("idx_transactions_fulfillment index: exists");
  }

  // 5. Summary
  console.log("\nSchema verification complete.");

  // Show table row counts
  const counts = await sql`
    SELECT 'product_types' as tbl, COUNT(*)::int as cnt FROM product_types
    UNION ALL SELECT 'customers', COUNT(*)::int FROM customers
    UNION ALL SELECT 'customer_prices', COUNT(*)::int FROM customer_prices
    UNION ALL SELECT 'transactions', COUNT(*)::int FROM transactions
    UNION ALL SELECT 'transaction_items', COUNT(*)::int FROM transaction_items
    UNION ALL SELECT 'bag_ledger', COUNT(*)::int FROM bag_ledger
    UNION ALL SELECT 'users', COUNT(*)::int FROM users
  `;
  console.log("\nCurrent row counts:");
  for (const row of counts) {
    console.log(`  ${row.tbl}: ${row.cnt}`);
  }

  await sql.end();
}

main().catch((e) => {
  console.error("Setup failed:", e);
  process.exit(1);
});
