import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import {
  transactions,
  transactionItems,
  productTypes,
  customers,
  bagLedger,
  auditLog,
  paymentEvents as paymentEventsTable,
} from "@/db/schema";
import { eq, and, gte, lte, sql, desc, ne, lt, asc, ilike, inArray } from "drizzle-orm";
import { requireManagerUp } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";
import {
  buildBehaviorSignalsResponse,
  TRACKED_BEHAVIOR_ACTIONS,
} from "@/lib/behavior-signals";
import { parseCustomerQuery } from "@/lib/filter-utils";
import { getBagDisplayQuantities, summarizeBagLedgerEntries } from "@/lib/bag-flow";
import {
  buildBagUsageReportResponse,
  buildBagUsageRowsFromMovementGroups,
  getPreviousPeriodDateRange,
  getRollingWeeklyDateRange,
  type BagUsageMovementGroup,
} from "@/lib/bag-usage-report";
import { computeFinancialTotals } from "@/lib/financial-totals";

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;
  const type = request.nextUrl.searchParams.get("type") || "daily";
  const startDate = request.nextUrl.searchParams.get("startDate");
  const endDate = request.nextUrl.searchParams.get("endDate");
  const startTime = request.nextUrl.searchParams.get("startTime");
  const endTime = request.nextUrl.searchParams.get("endTime");
  const customerQuery = request.nextUrl.searchParams.get("customerQuery");
  const parsedCustomerQuery = parseCustomerQuery(customerQuery);

  const db = await getDb();
  // Standard reports treat `transfer_out` as invoice-later volume, not same-day
  // "actual sales" subtotal. The real amount still exists on the transaction row,
  // but these endpoints intentionally exclude it until the invoice flow is used.
  const nonTransferCondition = ne(transactions.transactionKind, "transfer_out");
  const customerFilterOnCustomers =
    parsedCustomerQuery.customerIds.length > 0
      ? inArray(customers.id, parsedCustomerQuery.customerIds)
      : parsedCustomerQuery.customerNameQuery
        ? ilike(customers.name, `%${parsedCustomerQuery.customerNameQuery}%`)
        : undefined;

  // ===================== Credit Summary (dates optional) =====================
  if (type === "creditSummary") {
    // Server-side aggregation of all unpaid/partial transactions grouped by customer
    // with aging buckets. Dates are optional -- default: all time.
    const creditConditions = [
      sql`${transactions.status} IN ('unpaid', 'partial')`,
      sql`(${transactions.totalAmount} - ${transactions.paid}) > 0`,
      nonTransferCondition,
    ];
    if (startDate) creditConditions.push(gte(transactions.saleDate, startDate));
    if (endDate) creditConditions.push(lte(transactions.saleDate, endDate));
    if (customerFilterOnCustomers) creditConditions.push(customerFilterOnCustomers);

    const results = await db
      .select({
        customerId: customers.id,
        customerName: customers.name,
        unpaidCount: sql<number>`COUNT(*)::int`,
        totalOutstanding: sql<number>`COALESCE(SUM(${transactions.totalAmount} - ${transactions.paid}), 0)`,
        aging0to30: sql<number>`COALESCE(SUM(CASE WHEN CURRENT_DATE - ${transactions.saleDate} <= 30 THEN ${transactions.totalAmount} - ${transactions.paid} ELSE 0 END), 0)`,
        aging31to60: sql<number>`COALESCE(SUM(CASE WHEN CURRENT_DATE - ${transactions.saleDate} BETWEEN 31 AND 60 THEN ${transactions.totalAmount} - ${transactions.paid} ELSE 0 END), 0)`,
        aging60plus: sql<number>`COALESCE(SUM(CASE WHEN CURRENT_DATE - ${transactions.saleDate} > 60 THEN ${transactions.totalAmount} - ${transactions.paid} ELSE 0 END), 0)`,
        oldestDate: sql<string>`MIN(${transactions.saleDate})`,
        newestDate: sql<string>`MAX(${transactions.saleDate})`,
      })
      .from(transactions)
      .innerJoin(customers, eq(transactions.customerId, customers.id))
      .where(and(...creditConditions))
      .groupBy(customers.id, customers.name)
      .orderBy(desc(sql`SUM(${transactions.totalAmount} - ${transactions.paid})`));

    // Also compute the grand totals
    const grandTotals = results.reduce(
      (acc, r) => ({
        totalCustomers: acc.totalCustomers + 1,
        totalOutstanding: acc.totalOutstanding + Number(r.totalOutstanding),
        totalUnpaidCount: acc.totalUnpaidCount + Number(r.unpaidCount),
      }),
      { totalCustomers: 0, totalOutstanding: 0, totalUnpaidCount: 0 }
    );

    return NextResponse.json({
      customers: results.map((r) => ({
        customerId: r.customerId,
        customerName: r.customerName,
        unpaidCount: Number(r.unpaidCount),
        totalOutstanding: Number(r.totalOutstanding),
        aging0to30: Number(r.aging0to30),
        aging31to60: Number(r.aging31to60),
        aging60plus: Number(r.aging60plus),
        oldestDate: r.oldestDate,
        newestDate: r.newestDate,
      })),
      grandTotals,
    });
  }

  // ===================== Customer Statement (bank-statement style) =====================
  if (type === "customerStatement") {
    const customerId = request.nextUrl.searchParams.get("customerId");
    if (!customerId || !startDate || !endDate) {
      return NextResponse.json(
        { error: "ต้องระบุ customerId, startDate และ endDate" },
        { status: 400 }
      );
    }
    const custId = parseInt(customerId);

    // 1. Get customer info
    const customer = await db.query.customers.findFirst({
      where: eq(customers.id, custId),
    });
    if (!customer) {
      return NextResponse.json({ error: "ไม่พบลูกค้า" }, { status: 404 });
    }

    // 2. Compute opening balance: sum of (totalAmount - paid) for all unpaid/partial
    //    transactions BEFORE startDate
    const openingResult = await db
      .select({
        balance: sql<number>`COALESCE(SUM(${transactions.totalAmount} - ${transactions.paid}), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.customerId, custId),
          lt(transactions.saleDate, startDate),
          ne(transactions.status, "voided"),
          nonTransferCondition,
          sql`(${transactions.totalAmount} - ${transactions.paid}) > 0`
        )
      );
    const openingBalance = Number(openingResult[0]?.balance ?? 0);

    // 3. Get all transactions in the date range (including voided for full audit trail)
    const txRows = await db
      .select({
        id: transactions.id,
        date: transactions.saleDate,
        time: transactions.saleTime,
        status: transactions.status,
        totalAmount: transactions.totalAmount,
        paid: transactions.paid,
        note: transactions.note,
        voidReason: transactions.voidReason,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.customerId, custId),
          gte(transactions.saleDate, startDate),
          lte(transactions.saleDate, endDate),
          nonTransferCondition
        )
      )
      .orderBy(asc(transactions.saleDate), asc(transactions.saleTime));

    // 4. Get transaction items for description
    const txIds = txRows.map((t) => t.id);
    const itemsMap = new Map<number, { productName: string; quantity: number; unitPrice: number; subtotal: number }[]>();
    if (txIds.length > 0) {
      const allItems = await db
        .select({
          transactionId: transactionItems.transactionId,
          productName: productTypes.name,
          quantity: transactionItems.quantity,
          unitPrice: transactionItems.unitPrice,
          subtotal: transactionItems.subtotal,
        })
        .from(transactionItems)
        .innerJoin(productTypes, eq(transactionItems.productTypeId, productTypes.id))
        .where(sql`${transactionItems.transactionId} IN (${sql.join(txIds.map(id => sql`${id}`), sql`, `)})`);

      for (const item of allItems) {
        const arr = itemsMap.get(item.transactionId) || [];
        arr.push({
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          subtotal: item.subtotal,
        });
        itemsMap.set(item.transactionId, arr);
      }
    }

    // 5. Get payment events for transactions in range.
    // Primary source is payment_events; fallback to audit_log for legacy data.
    let paymentEvents: {
      transactionId: number;
      date: string;
      time: string;
      amount: number;
    }[] = [];
    if (txIds.length > 0) {
      const txIdsSql = sql.join(txIds.map((id) => sql`${id}`), sql`, `);
      try {
        const eventRows = await db
          .select({
            transactionId: paymentEventsTable.transactionId,
            eventDate: paymentEventsTable.eventDate,
            eventTime: paymentEventsTable.eventTime,
            amount: paymentEventsTable.amount,
          })
          .from(paymentEventsTable)
          .where(
            and(
              sql`${paymentEventsTable.transactionId} IN (${txIdsSql})`,
              gte(paymentEventsTable.eventDate, startDate),
              lte(paymentEventsTable.eventDate, endDate)
            )
          )
          .orderBy(asc(paymentEventsTable.eventDate), asc(paymentEventsTable.eventTime));

        paymentEvents = eventRows
          .filter((row) => row.transactionId != null)
          .map((row) => ({
            transactionId: row.transactionId!,
            date: row.eventDate,
            time: row.eventTime || "00:00:00",
            amount: Number(row.amount ?? 0),
          }));
      } catch {
        const auditPayments = await db
          .select({
            entityId: auditLog.entityId,
            createdAt: auditLog.createdAt,
            details: auditLog.details,
          })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.entity, "transaction"),
              sql`${auditLog.action} IN ('transaction.payment', 'payment')`,
              sql`${auditLog.entityId} IN (${txIdsSql})`,
              gte(auditLog.createdAt, new Date(`${startDate}T00:00:00.000Z`)),
              lte(auditLog.createdAt, new Date(`${endDate}T23:59:59.999Z`))
            )
          )
          .orderBy(asc(auditLog.createdAt));

        paymentEvents = auditPayments
          .filter((a) => a.entityId != null)
          .map((a) => {
            const details = a.details as Record<string, unknown> | null;
            return {
              transactionId: a.entityId!,
              date: a.createdAt.toISOString().slice(0, 10),
              time: a.createdAt.toISOString().slice(11, 19),
              amount: Number(details?.amount ?? 0),
            };
          });
      }
    }

    // 6. Build statement events in chronological order
    type StatementEvent = {
      date: string;
      time: string;
      type: "SALE" | "PAYMENT" | "RETURN" | "VOID";
      refId: number;
      description: string;
      debit: number;
      credit: number;
    };

    const events: StatementEvent[] = [];

    // Track which transactions have had their initial payment handled
    // (paid at sale time = immediate payment, not a separate event)
    const txInitialPaymentHandled = new Set<number>();

    for (const tx of txRows) {
      const items = itemsMap.get(tx.id) || [];
      const itemDesc = items
        .map((i) => `${i.productName} x${i.quantity}`)
        .join(", ");

      if (tx.status === "voided") {
        // Voided transaction
        events.push({
          date: tx.date,
          time: tx.time,
          type: "VOID",
          refId: tx.id,
          description: tx.voidReason ? `ยกเลิก: ${tx.voidReason}` : "ยกเลิกรายการ",
          debit: 0,
          credit: tx.totalAmount,
        });
        continue;
      }

      const isReturn = tx.totalAmount < 0;

      if (isReturn) {
        // Return transaction (negative amount)
        events.push({
          date: tx.date,
          time: tx.time,
          type: "RETURN",
          refId: tx.id,
          description: itemDesc || "คืนสินค้า",
          debit: 0,
          credit: Math.abs(tx.totalAmount),
        });
      } else {
        // Sale transaction
        events.push({
          date: tx.date,
          time: tx.time,
          type: "SALE",
          refId: tx.id,
          description: itemDesc || `ขายสินค้า #${tx.id}`,
          debit: tx.totalAmount,
          credit: 0,
        });

        // If paid at sale time, add a matching payment event
        if (tx.paid > 0 && tx.status === "paid") {
          events.push({
            date: tx.date,
            time: tx.time,
            type: "PAYMENT",
            refId: tx.id,
            description: `ชำระเงิน (บิล #${tx.id})`,
            debit: 0,
            credit: tx.paid,
          });
          txInitialPaymentHandled.add(tx.id);
        }
      }
    }

    // Add separate payment events from audit log (for later payments on credit)
    for (const pe of paymentEvents) {
      // Skip if this is a paid-at-sale that we already added
      if (txInitialPaymentHandled.has(pe.transactionId)) {
        txInitialPaymentHandled.delete(pe.transactionId);
        continue;
      }
      events.push({
        date: pe.date,
        time: pe.time || "00:00:00",
        type: "PAYMENT",
        refId: pe.transactionId,
        description: `ชำระเงิน (บิล #${pe.transactionId})`,
        debit: 0,
        credit: pe.amount,
      });
    }

    // Sort by date, then time
    events.sort((a, b) => {
      const dateCmp = a.date.localeCompare(b.date);
      if (dateCmp !== 0) return dateCmp;
      return a.time.localeCompare(b.time);
    });

    // 7. Compute running balance
    let runningBalance = openingBalance;
    const rows = events.map((e) => {
      runningBalance += e.debit - e.credit;
      return { ...e, balance: runningBalance };
    });

    // 8. Compute totals
    const totalDebits = events.reduce((s, e) => s + e.debit, 0);
    const totalCredits = events.reduce((s, e) => s + e.credit, 0);
    const closingBalance = openingBalance + totalDebits - totalCredits;

    return NextResponse.json({
      customer: { id: customer.id, name: customer.name, phone: customer.phone },
      startDate,
      endDate,
      openingBalance,
      closingBalance,
      totalDebits,
      totalCredits,
      events: rows,
      eventCount: rows.length,
    });
  }

  if (type === "behaviorSignals") {
    const now = new Date();
    const behaviorEnd = endDate || now.toISOString().slice(0, 10);
    const behaviorStart =
      startDate ||
      (() => {
        const d = new Date(now);
        d.setDate(d.getDate() - 29);
        return d.toISOString().slice(0, 10);
      })();

    const txRows = await db
      .select({
        customerId: transactions.customerId,
        totalAmount: transactions.totalAmount,
        status: transactions.status,
      })
      .from(transactions)
      .where(
        and(
          gte(transactions.saleDate, behaviorStart),
          lte(transactions.saleDate, behaviorEnd),
          ne(transactions.status, "voided"),
          nonTransferCondition
        )
      );

    const createdFrom = new Date(`${behaviorStart}T00:00:00.000Z`);
    const createdTo = new Date(`${behaviorEnd}T23:59:59.999Z`);

    const [actionRows, [offlineSyncRow]] = await Promise.all([
      db
        .select({
          action: auditLog.action,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(auditLog)
        .where(
          and(
            gte(auditLog.createdAt, createdFrom),
            lte(auditLog.createdAt, createdTo),
            sql`${auditLog.action} IN (${sql.join(TRACKED_BEHAVIOR_ACTIONS.map((a) => sql`${a}`), sql`, `)})`
          )
        )
        .groupBy(auditLog.action),
      db
        .select({
          count: sql<number>`COUNT(*)::int`,
        })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "transaction.create"),
            gte(auditLog.createdAt, createdFrom),
            lte(auditLog.createdAt, createdTo),
            sql`${auditLog.details} -> 'behavior' ->> 'source' = 'offline_sync'`
          )
        ),
    ]);

    return NextResponse.json(
      buildBehaviorSignalsResponse({
        startDate: behaviorStart,
        endDate: behaviorEnd,
        txRows,
        actionRows,
        offlineSyncedSales: Number(offlineSyncRow?.count || 0),
      })
    );
  }

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "ต้องระบุวันที่เริ่มต้นและสิ้นสุด" }, { status: 400 });
  }

  const conditions = [
    gte(transactions.saleDate, startDate),
    lte(transactions.saleDate, endDate),
    ne(transactions.status, "voided"),
    nonTransferCondition,
  ];
  if (startTime) conditions.push(gte(transactions.saleTime, startTime));
  if (endTime) conditions.push(lte(transactions.saleTime, endTime));

  const dateFilter = and(...conditions);

  if (type === "daily") {
    const results = await db
      .select({
        date: transactions.saleDate,
        totalTransactions: sql<number>`COUNT(DISTINCT ${transactions.id})`,
        totalAmount: sql<number>`SUM(${transactions.totalAmount})`,
      })
      .from(transactions)
      .where(dateFilter)
      .groupBy(transactions.saleDate)
      .orderBy(desc(transactions.saleDate));

    return NextResponse.json(results);
  }

  if (type === "byProduct") {
    const results = await db
      .select({
        productId: productTypes.id,
        productName: productTypes.name,
        totalQuantity: sql<number>`SUM(CASE WHEN ${transactionItems.quantity} > 0 THEN ${transactionItems.quantity} ELSE 0 END)`,
        returnedQuantity: sql<number>`SUM(CASE WHEN ${transactionItems.quantity} < 0 THEN ABS(${transactionItems.quantity}) ELSE 0 END)`,
        netQuantity: sql<number>`SUM(${transactionItems.quantity})`,
        totalAmount: sql<number>`SUM(CASE WHEN ${transactionItems.subtotal} > 0 THEN ${transactionItems.subtotal} ELSE 0 END)`,
        returnedAmount: sql<number>`SUM(CASE WHEN ${transactionItems.subtotal} < 0 THEN ABS(${transactionItems.subtotal}) ELSE 0 END)`,
        netAmount: sql<number>`SUM(${transactionItems.subtotal})`,
      })
      .from(transactionItems)
      .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
      .innerJoin(productTypes, eq(transactionItems.productTypeId, productTypes.id))
      .where(dateFilter)
      .groupBy(productTypes.id, productTypes.name)
      .orderBy(desc(sql`SUM(${transactionItems.subtotal})`));

    return NextResponse.json(results);
  }

  if (type === "byCustomer") {
    const byCustomerWhere = customerFilterOnCustomers
      ? and(dateFilter, customerFilterOnCustomers)
      : dateFilter;
    const results = await db
      .select({
        customerId: customers.id,
        customerName: customers.name,
        totalTransactions: sql<number>`COUNT(DISTINCT ${transactions.id})`,
        totalAmount: sql<number>`SUM(${transactions.totalAmount})`,
      })
      .from(transactions)
      .innerJoin(customers, eq(transactions.customerId, customers.id))
      .where(byCustomerWhere)
      .groupBy(customers.id, customers.name)
      .orderBy(desc(sql`SUM(${transactions.totalAmount})`));

    return NextResponse.json(results);
  }

  if (type === "cash") {
    // Cash reconciliation with canonical debt/refund split.
    const rows = await db
      .select({
        date: transactions.saleDate,
        status: transactions.status,
        transactionKind: transactions.transactionKind,
        totalAmount: transactions.totalAmount,
        paid: transactions.paid,
      })
      .from(transactions)
      .where(dateFilter)
      .orderBy(desc(transactions.saleDate), desc(transactions.saleTime), desc(transactions.id));

    const grouped = new Map<
      string,
      {
        rows: Array<{
          status: string;
          transactionKind: string | null;
          totalAmount: number;
          paid: number;
        }>;
        paidCount: number;
        unpaidCount: number;
        partialCount: number;
      }
    >();

    for (const row of rows) {
      const key = row.date;
      const bucket =
        grouped.get(key) ??
        {
          rows: [],
          paidCount: 0,
          unpaidCount: 0,
          partialCount: 0,
        };

      bucket.rows.push({
        status: row.status,
        transactionKind: row.transactionKind,
        totalAmount: Number(row.totalAmount || 0),
        paid: Number(row.paid || 0),
      });

      if (row.status === "paid") bucket.paidCount += 1;
      if (row.status === "unpaid") bucket.unpaidCount += 1;
      if (row.status === "partial") bucket.partialCount += 1;
      grouped.set(key, bucket);
    }

    const summary = Array.from(grouped.entries())
      .map(([date, bucket]) => {
        const totals = computeFinancialTotals(bucket.rows);
        return {
          date,
          totalSales: totals.netSales,
          totalPaid: totals.netCash,
          // Compatibility field: debt-only (non-negative)
          totalOutstanding: totals.outstandingDebt,
          outstandingDebt: totals.outstandingDebt,
          refundBalance: totals.refundBalance,
          paidCount: bucket.paidCount,
          unpaidCount: bucket.unpaidCount,
          partialCount: bucket.partialCount,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    return NextResponse.json(summary);
  }

  if (type === "priceBreakdown") {
    const priceWhere = customerFilterOnCustomers
      ? and(dateFilter, customerFilterOnCustomers)
      : dateFilter;
    // Sales breakdown by customer and product with price tier info
    const results = await db
      .select({
        customerId: customers.id,
        customerName: customers.name,
        productId: productTypes.id,
        productName: productTypes.name,
        unitPrice: transactionItems.unitPrice,
        totalQuantity: sql<number>`SUM(${transactionItems.quantity})`,
        totalAmount: sql<number>`SUM(${transactionItems.subtotal})`,
      })
      .from(transactionItems)
      .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
      .innerJoin(customers, eq(transactions.customerId, customers.id))
      .innerJoin(productTypes, eq(transactionItems.productTypeId, productTypes.id))
      .where(priceWhere)
      .groupBy(
        customers.id,
        customers.name,
        productTypes.id,
        productTypes.name,
        transactionItems.unitPrice
      )
      .orderBy(customers.name, productTypes.name, transactionItems.unitPrice);

    return NextResponse.json(results);
  }

  if (type === "monthly") {
    // Monthly summary with canonical debt/refund split.
    const rows = customerFilterOnCustomers
      ? await db
          .select({
            saleDate: transactions.saleDate,
            status: transactions.status,
            transactionKind: transactions.transactionKind,
            totalAmount: transactions.totalAmount,
            paid: transactions.paid,
          })
          .from(transactions)
          .innerJoin(customers, eq(transactions.customerId, customers.id))
          .where(and(dateFilter, customerFilterOnCustomers))
          .orderBy(transactions.saleDate, transactions.id)
      : await db
          .select({
            saleDate: transactions.saleDate,
            status: transactions.status,
            transactionKind: transactions.transactionKind,
            totalAmount: transactions.totalAmount,
            paid: transactions.paid,
          })
          .from(transactions)
          .where(dateFilter)
          .orderBy(transactions.saleDate, transactions.id);

    const grouped = new Map<
      string,
      {
        year: number;
        month: number;
        rows: Array<{
          status: string;
          transactionKind: string | null;
          totalAmount: number;
          paid: number;
        }>;
      }
    >();

    for (const row of rows) {
      const saleDate = row.saleDate;
      const year = Number.parseInt(saleDate.slice(0, 4), 10);
      const month = Number.parseInt(saleDate.slice(5, 7), 10);
      const key = `${year}-${String(month).padStart(2, "0")}`;
      const bucket =
        grouped.get(key) ??
        {
          year,
          month,
          rows: [],
        };
      bucket.rows.push({
        status: row.status,
        transactionKind: row.transactionKind,
        totalAmount: Number(row.totalAmount || 0),
        paid: Number(row.paid || 0),
      });
      grouped.set(key, bucket);
    }

    const results = Array.from(grouped.values())
      .map((bucket) => {
        const totals = computeFinancialTotals(bucket.rows);
        return {
          year: bucket.year,
          month: bucket.month,
          totalTransactions: totals.activeCount,
          totalAmount: totals.netSales,
          totalPaid: totals.netCash,
          // Compatibility field: debt-only (non-negative)
          totalOutstanding: totals.outstandingDebt,
          outstandingDebt: totals.outstandingDebt,
          refundBalance: totals.refundBalance,
        };
      })
      .sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year;
        return a.month - b.month;
      });

    return NextResponse.json(results);
  }

  if (type === "historyDaily") {
    // Daily totals for long-term trendline (ordered by date ascending for chart)
    const results = await db
      .select({
        date: transactions.saleDate,
        totalAmount: sql<number>`COALESCE(SUM(${transactions.totalAmount}), 0)`,
        totalPaid: sql<number>`COALESCE(SUM(${transactions.paid}), 0)`,
        txCount: sql<number>`COUNT(DISTINCT ${transactions.id})`,
      })
      .from(transactions)
      .where(dateFilter)
      .groupBy(transactions.saleDate)
      .orderBy(transactions.saleDate);

    return NextResponse.json(results);
  }

  if (type === "historyCustomerBehavior") {
    // Monthly customer behavior: active, new, avg spend
    const results = await db.execute(sql`
      WITH first_purchase AS (
        SELECT customer_id, MIN(sale_date) as first_date
        FROM transactions
        WHERE status != 'voided'
          AND transaction_kind != 'transfer_out'
        GROUP BY customer_id
      )
      SELECT
        EXTRACT(YEAR FROM t.sale_date)::int as year,
        EXTRACT(MONTH FROM t.sale_date)::int as month,
        COUNT(DISTINCT t.customer_id)::int as "activeCustomers",
        COUNT(DISTINCT CASE
          WHEN fp.first_date >= DATE_TRUNC('month', t.sale_date)
           AND fp.first_date < DATE_TRUNC('month', t.sale_date) + INTERVAL '1 month'
          THEN t.customer_id
        END)::int as "newCustomers",
        COALESCE(SUM(t.total_amount), 0) as "totalAmount"
      FROM transactions t
      JOIN first_purchase fp ON t.customer_id = fp.customer_id
      WHERE t.status != 'voided'
        AND t.transaction_kind != 'transfer_out'
        AND t.sale_date >= ${startDate}
        AND t.sale_date <= ${endDate}
      GROUP BY 1, 2
      ORDER BY 1, 2
    `);

    return NextResponse.json(results);
  }

  if (type === "historyTopCustomers") {
    const historyTopWhere = customerFilterOnCustomers
      ? and(dateFilter, customerFilterOnCustomers)
      : dateFilter;
    // Top 10 customers by spend + their monthly breakdown
    const topCustomers = await db
      .select({
        customerId: customers.id,
        customerName: customers.name,
        totalAmount: sql<number>`COALESCE(SUM(${transactions.totalAmount}), 0)`,
        txCount: sql<number>`COUNT(DISTINCT ${transactions.id})`,
      })
      .from(transactions)
      .innerJoin(customers, eq(transactions.customerId, customers.id))
      .where(historyTopWhere)
      .groupBy(customers.id, customers.name)
      .orderBy(desc(sql`SUM(${transactions.totalAmount})`))
      .limit(10);

    // Get monthly breakdown for these top customers
    const topIds = topCustomers.map((c) => c.customerId);
    let monthlyBreakdown: { customerId: number; year: number; month: number; amount: number }[] = [];

    if (topIds.length > 0) {
      const mbResult = await db
        .select({
          customerId: transactions.customerId,
          year: sql<number>`EXTRACT(YEAR FROM ${transactions.saleDate})::int`,
          month: sql<number>`EXTRACT(MONTH FROM ${transactions.saleDate})::int`,
          amount: sql<number>`COALESCE(SUM(${transactions.totalAmount}), 0)`,
        })
        .from(transactions)
        .where(
          and(
            ne(transactions.status, "voided"),
            nonTransferCondition,
            gte(transactions.saleDate, startDate),
            lte(transactions.saleDate, endDate),
            sql`${transactions.customerId} IN (${sql.join(topIds.map(id => sql`${id}`), sql`, `)})`
          )
        )
        .groupBy(
          transactions.customerId,
          sql`EXTRACT(YEAR FROM ${transactions.saleDate})`,
          sql`EXTRACT(MONTH FROM ${transactions.saleDate})`
        )
        .orderBy(
          transactions.customerId,
          sql`EXTRACT(YEAR FROM ${transactions.saleDate})`,
          sql`EXTRACT(MONTH FROM ${transactions.saleDate})`
        );
      monthlyBreakdown = mbResult.map(r => ({
        customerId: Number(r.customerId),
        year: Number(r.year),
        month: Number(r.month),
        amount: Number(r.amount),
      }));
    }

    // Merge monthly data into each customer
    const result = topCustomers.map((c) => ({
      ...c,
      monthly: monthlyBreakdown
        .filter((m) => Number(m.customerId) === c.customerId)
        .map((m) => ({ year: Number(m.year), month: Number(m.month), amount: Number(m.amount) })),
    }));

    return NextResponse.json(result);
  }

  if (type === "bagUsage") {
    const loadBagUsageRowsForRange = async (
      rangeStartDate: string,
      rangeEndDate: string
    ) => {
      const bagDateFilter = and(
        gte(bagLedger.createdAt, new Date(`${rangeStartDate}T00:00:00.000Z`)),
        lte(bagLedger.createdAt, new Date(`${rangeEndDate}T23:59:59.999Z`))
      );
      const bagUsageWhere = customerFilterOnCustomers
        ? and(bagDateFilter, customerFilterOnCustomers)
        : bagDateFilter;

      const movementRows = await db
        .select({
          customerId: customers.id,
          customerName: customers.name,
          phone: customers.phone,
          type: bagLedger.type,
          note: bagLedger.note,
          quantity: sql<number>`COALESCE(SUM(${bagLedger.quantity}), 0)`,
        })
        .from(bagLedger)
        .innerJoin(customers, eq(bagLedger.customerId, customers.id))
        .where(bagUsageWhere)
        .groupBy(
          customers.id,
          customers.name,
          customers.phone,
          bagLedger.type,
          bagLedger.note
        )
        .orderBy(customers.name);

      const grouped = new Map<number, BagUsageMovementGroup>();
      for (const row of movementRows) {
        const customerId = Number(row.customerId);
        const existing = grouped.get(customerId) || {
          customerId,
          customerName: row.customerName,
          phone: row.phone,
          entries: [],
        };
        existing.entries.push({
          type: row.type,
          quantity: Number(row.quantity || 0),
          note: row.note,
        });
        grouped.set(customerId, existing);
      }

      return buildBagUsageRowsFromMovementGroups(Array.from(grouped.values()));
    };

    const previousRange = getPreviousPeriodDateRange(startDate, endDate);
    const weeklyRange = getRollingWeeklyDateRange(endDate);

    const [currentRows, previousRows, weeklyRows] = await Promise.all([
      loadBagUsageRowsForRange(startDate, endDate),
      loadBagUsageRowsForRange(previousRange.startDate, previousRange.endDate),
      loadBagUsageRowsForRange(weeklyRange.startDate, weeklyRange.endDate),
    ]);

    return NextResponse.json(
      buildBagUsageReportResponse({
        currentRows,
        previousRows,
        weeklyOutflowTotal: weeklyRows.reduce((sum, row) => sum + row.totalOut, 0),
        weeklyWindowStart: weeklyRange.startDate,
        weeklyWindowEnd: weeklyRange.endDate,
      })
    );
  }

  if (type === "customerInvoice") {
    const customerId = request.nextUrl.searchParams.get("customerId");
    if (!customerId) {
      return NextResponse.json({ error: "ต้องระบุลูกค้า" }, { status: 400 });
    }
    const custId = parseInt(customerId);

    // 1. Get customer info
    const customer = await db.query.customers.findFirst({
      where: eq(customers.id, custId),
    });
    if (!customer) {
      return NextResponse.json({ error: "ไม่พบลูกค้า" }, { status: 404 });
    }

    // 2. Get all active product types (for column headers)
    const allProductTypes = await db
      .select()
      .from(productTypes)
      .where(eq(productTypes.isActive, true))
      .orderBy(productTypes.sortOrder);

    // 3. Get all non-voided transactions for this customer in date range
    const txFilter = and(
      eq(transactions.customerId, custId),
      gte(transactions.saleDate, startDate),
      lte(transactions.saleDate, endDate),
      ne(transactions.status, "voided"),
      nonTransferCondition
    );

    const txRows = await db
      .select({
        id: transactions.id,
        date: transactions.saleDate,
        time: transactions.saleTime,
        pool: transactions.pool,
        row: transactions.row,
        col: transactions.col,
        status: transactions.status,
        totalAmount: transactions.totalAmount,
        paid: transactions.paid,
      })
      .from(transactions)
      .where(txFilter)
      .orderBy(transactions.saleDate, transactions.saleTime);

    if (txRows.length === 0) {
      return NextResponse.json({
        customer: { id: customer.id, name: customer.name, phone: customer.phone },
        productTypes: [],
        rows: [],
        summary: {
          totalsByProduct: {},
          grandTotal: 0,
          totalPaid: 0,
          totalUnpaid: 0,
          totalBagsOut: 0,
          totalBagsReturned: 0,
          rowCount: 0,
        },
      });
    }

    // 4. Get all transaction items via JOIN subquery (scalable for large result sets)
    const items = await db
      .select({
        transactionId: transactionItems.transactionId,
        productTypeId: transactionItems.productTypeId,
        quantity: transactionItems.quantity,
      })
      .from(transactionItems)
      .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
      .where(txFilter);

    // 5. Get bag ledger entries via JOIN subquery
    const bagEntries = await db
      .select({
        transactionId: bagLedger.transactionId,
        type: bagLedger.type,
        quantity: bagLedger.quantity,
        note: bagLedger.note,
      })
      .from(bagLedger)
      .innerJoin(transactions, eq(bagLedger.transactionId, transactions.id))
      .where(txFilter);

    // 6. Build per-transaction lookup maps
    const itemsByTx = new Map<number, { productTypeId: number; quantity: number }[]>();
    for (const item of items) {
      const arr = itemsByTx.get(item.transactionId) || [];
      arr.push({ productTypeId: item.productTypeId, quantity: item.quantity });
      itemsByTx.set(item.transactionId, arr);
    }

    const bagsByTx = new Map<number, { type: string; quantity: number; note?: string | null }[]>();
    for (const entry of bagEntries) {
      if (!entry.transactionId) continue;
      const arr = bagsByTx.get(entry.transactionId) || [];
      arr.push({ type: entry.type, quantity: entry.quantity, note: entry.note });
      bagsByTx.set(entry.transactionId, arr);
    }

    // 7. Determine which product types actually appear in the data
    const usedProductIds = new Set<number>();
    for (const item of items) {
      if (item.quantity !== 0) usedProductIds.add(item.productTypeId);
    }
    const relevantPTs = allProductTypes.filter((pt) => usedProductIds.has(pt.id));

    // 8. Build rows + summary, filtering out orphan transactions (zero amount, no items, no bags)
    const totalsByProduct: Record<number, number> = {};
    let totalBagsOut = 0;
    let totalBagsReturned = 0;
    let filteredCount = 0;

    const rows: {
      seq: number; id: number; date: string; time: string;
      pool: number | null; row: number | null; col: number | null;
      status: string; totalAmount: number; paid: number;
      quantities: Record<number, number>; bagsOut: number; bagsReturned: number;
      bagsBought: number; bagAdjustDelta: number;
      isOrphan: boolean;
    }[] = [];

    for (const tx of txRows) {
      const txItems = itemsByTx.get(tx.id) || [];
      const txBags = bagsByTx.get(tx.id) || [];

      const hasItems = txItems.length > 0;
      const hasBags = txBags.length > 0;
      const hasAmount = tx.totalAmount > 0;

      // Skip pure orphan rows: no items, no bags, zero amount
      if (!hasItems && !hasBags && !hasAmount) continue;

      filteredCount++;

      const quantities: Record<number, number> = {};
      for (const pt of relevantPTs) {
        const found = txItems.find((i) => i.productTypeId === pt.id);
        const qty = found ? found.quantity : 0;
        quantities[pt.id] = qty;
        totalsByProduct[pt.id] = (totalsByProduct[pt.id] || 0) + qty;
      }

      const bagSummary = summarizeBagLedgerEntries(txBags);
      const bagDisplay = getBagDisplayQuantities(bagSummary);
      const bagsOut = bagDisplay.bagsOut;
      const bagsReturned = bagDisplay.bagsReturned;

      totalBagsOut += bagsOut;
      totalBagsReturned += bagsReturned;

      rows.push({
        seq: filteredCount,
        id: tx.id,
        date: tx.date,
        time: tx.time,
        pool: tx.pool,
        row: tx.row,
        col: tx.col,
        status: tx.status,
        totalAmount: tx.totalAmount,
        paid: tx.paid,
        quantities,
        bagsOut,
        bagsReturned,
        bagsBought: bagSummary.bagsBought,
        bagAdjustDelta: bagSummary.bagAdjustDelta,
        // Flag orphans: has amount but no items (from legacy import)
        isOrphan: !hasItems && hasAmount,
      });
    }

    const financialSummary = computeFinancialTotals(
      rows.map((row) => ({
        status: row.status,
        totalAmount: row.totalAmount,
        paid: row.paid,
      })),
      { includeTransferOut: true }
    );

    return NextResponse.json({
      customer: { id: customer.id, name: customer.name, phone: customer.phone },
      productTypes: relevantPTs.map((pt) => ({
        id: pt.id,
        name: pt.name,
        nameEn: pt.nameEn,
        hasBag: pt.hasBag,
      })),
      rows,
      summary: {
        totalsByProduct,
        grandTotal: financialSummary.netSales,
        totalPaid: financialSummary.netCash,
        totalUnpaid: financialSummary.outstandingDebt,
        refundBalance: financialSummary.refundBalance,
        totalBagsOut,
        totalBagsReturned,
        rowCount: rows.length,
      },
    });
  }

  return NextResponse.json({ error: "ประเภทรายงานไม่ถูกต้อง" }, { status: 400 });
});
