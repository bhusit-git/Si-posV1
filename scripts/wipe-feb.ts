import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL_SI || "postgresql://localhost:5432/superice";
const START = "2026-02-01";
const END = "2026-02-28";

async function main() {
  const sql = postgres(DB_URL, { max: 1, connect_timeout: 10 });

  const [before] = await sql`SELECT COUNT(*)::int AS c FROM transactions WHERE sale_date BETWEEN ${START}::date AND ${END}::date`;
  console.log(`Transactions in Feb before wipe: ${before.c}`);

  // Delete in dependency order
  // invoice_payment_allocations → invoice_lines → then transactions/items
  await sql`
    DELETE FROM invoice_payment_allocations
    WHERE transaction_id IN (
      SELECT id FROM transactions WHERE sale_date BETWEEN ${START}::date AND ${END}::date
    )
  `;
  await sql`
    DELETE FROM invoice_lines
    WHERE transaction_id IN (
      SELECT id FROM transactions WHERE sale_date BETWEEN ${START}::date AND ${END}::date
    )
  `;
  await sql`
    DELETE FROM payment_events
    WHERE transaction_id IN (
      SELECT id FROM transactions WHERE sale_date BETWEEN ${START}::date AND ${END}::date
    )
  `;
  await sql`
    DELETE FROM bag_ledger
    WHERE transaction_id IN (
      SELECT id FROM transactions WHERE sale_date BETWEEN ${START}::date AND ${END}::date
    )
  `;
  await sql`
    DELETE FROM transaction_items
    WHERE transaction_id IN (
      SELECT id FROM transactions WHERE sale_date BETWEEN ${START}::date AND ${END}::date
    )
  `;
  await sql`DELETE FROM transactions WHERE sale_date BETWEEN ${START}::date AND ${END}::date`;

  const [after] = await sql`SELECT COUNT(*)::int AS c FROM transactions WHERE sale_date BETWEEN ${START}::date AND ${END}::date`;
  console.log(`Transactions in Feb after wipe: ${after.c}`);

  await sql.end();
  console.log("Wipe complete.");
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
