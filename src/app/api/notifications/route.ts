import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { transactions, bagLedger, auditFindings } from "@/db/schema";
import { eq, and, ne, sql, lt } from "drizzle-orm";
import { requireManagerUp } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";

export const GET = withErrorHandler(async function GET() {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;

  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  const overdueDate = sixtyDaysAgo.toISOString().slice(0, 10);

  const db = await getDb();
  const [[overdueResult], [findingResult]] = await Promise.all([
    db
      .select({
        count: sql<number>`COUNT(DISTINCT ${transactions.customerId})::int`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.status, "unpaid"),
          lt(transactions.saleDate, overdueDate),
          ne(transactions.status, "voided"),
          ne(transactions.transactionKind, "transfer_out")
        )
      ),
    db
      .select({
        count: sql<number>`COUNT(*)::int`,
      })
      .from(auditFindings)
      .where(
        and(
          eq(auditFindings.status, "open"),
          sql`${auditFindings.severity} IN ('high', 'critical')`
        )
      ),
  ]);

  const bagBalances = await db
    .select({
      customerId: bagLedger.customerId,
      netBags: sql<number>`SUM(${bagLedger.quantity})::int`,
    })
    .from(bagLedger)
    .groupBy(bagLedger.customerId);

  const highBagCount = bagBalances.filter((b) => b.netBags > 50).length;

  return NextResponse.json({
    overdueCredit: overdueResult?.count || 0,
    highBagBalance: highBagCount,
    unresolvedHighRiskFindings: findingResult?.count || 0,
  });
});
