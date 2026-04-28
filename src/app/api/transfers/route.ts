import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, inArray, lte, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { bagLedger, customers, transactionItems, transactions } from "@/db/schema";
import { requireManagerUp } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";
import {
  applyLegacyAccountingStatusToNote,
  TRANSFER_ALLOWLIST_CUSTOMER_IDS,
  buildTransferNote,
  getTransferAccountingStatus,
  isTransferEligibleCustomer,
  parseTransferNote,
  type TransferAccountingStatus,
} from "@/lib/transfer-utils";
import { updateTransferAccountingStatusSchema, validateBody } from "@/lib/validations";
import { parseCustomerQuery } from "@/lib/filter-utils";
import { requireFactoryWriteContext } from "@/lib/factory-context";

type AccountingStatusFilter = TransferAccountingStatus | "all";

function parseAccountingStatusFilter(value: string | null): AccountingStatusFilter {
  if (value === "closed") return "closed";
  if (value === "all") return "all";
  return "open";
}

function buildTransferScopeSql() {
  const allowlistIds = Array.from(TRANSFER_ALLOWLIST_CUSTOMER_IDS.values());
  const allowlistSql =
    allowlistIds.length > 0
      ? sql`${transactions.customerId} IN (${sql.join(allowlistIds.map((id) => sql`${id}`), sql`, `)})`
      : sql`FALSE`;

  return {
    transferCustomerSql: sql`(${customers.transferCustomer} = TRUE OR ${customers.name} LIKE 'XFER->%' OR ${allowlistSql})`,
    mustHaveItemsSql: sql`EXISTS (
      SELECT 1
      FROM ${transactionItems}
      WHERE ${transactionItems.transactionId} = ${transactions.id}
    )`,
    mustBeZeroPriceSql: sql`NOT EXISTS (
      SELECT 1
      FROM ${transactionItems}
      WHERE ${transactionItems.transactionId} = ${transactions.id}
        AND COALESCE(${transactionItems.unitPrice}, 0) <> 0
    )`,
  };
}

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;

  const startDate = request.nextUrl.searchParams.get("startDate");
  const endDate = request.nextUrl.searchParams.get("endDate");
  const ref = request.nextUrl.searchParams.get("ref")?.trim().toUpperCase();
  const customerId = request.nextUrl.searchParams.get("customerId");
  const customerQuery = request.nextUrl.searchParams.get("customerQuery");
  const accountingStatusFilter = parseAccountingStatusFilter(
    request.nextUrl.searchParams.get("accountingStatus")
  );

  const db = await getDb();
  const transferScope = buildTransferScopeSql();

  const conditions = [
    ne(transactions.status, "voided"),
    or(
      eq(transactions.transactionKind, "transfer_out"),
      and(
        transferScope.transferCustomerSql,
        transferScope.mustHaveItemsSql,
        transferScope.mustBeZeroPriceSql
      )
    ),
  ];

  if (startDate) conditions.push(gte(transactions.saleDate, startDate));
  if (endDate) conditions.push(lte(transactions.saleDate, endDate));
  if (customerId) {
    const parsedCustomerId = parseInt(customerId, 10);
    if (Number.isFinite(parsedCustomerId) && parsedCustomerId > 0) {
      conditions.push(eq(transactions.customerId, parsedCustomerId));
    }
  }
  const parsedCustomerQuery = parseCustomerQuery(customerQuery);
  if (parsedCustomerQuery.customerIds.length > 0) {
    conditions.push(inArray(transactions.customerId, parsedCustomerQuery.customerIds));
  } else if (parsedCustomerQuery.customerNameQuery) {
    conditions.push(sql`${customers.name} ILIKE ${`%${parsedCustomerQuery.customerNameQuery}%`}`);
  }

  const rows = await db
    .select({
      id: transactions.id,
      customerId: transactions.customerId,
      customerName: customers.name,
      customerTransferFlag: customers.transferCustomer,
      saleDate: transactions.saleDate,
      saleTime: transactions.saleTime,
      totalAmount: transactions.totalAmount,
      paid: transactions.paid,
      status: transactions.status,
      note: transactions.note,
      transactionKind: transactions.transactionKind,
      transferRefCol: transactions.transferRef,
      transferDestinationCol: transactions.transferDestination,
      transferTruckCol: transactions.transferTruck,
      transferAccountingStatusCol: transactions.transferAccountingStatus,
      itemQty: sql<number>`COALESCE((
        SELECT SUM(${transactionItems.quantity})
        FROM ${transactionItems}
        WHERE ${transactionItems.transactionId} = ${transactions.id}
      ), 0)`,
      bagReturnQty: sql<number>`COALESCE((
        SELECT SUM(${bagLedger.quantity})
        FROM ${bagLedger}
        WHERE ${bagLedger.transactionId} = ${transactions.id}
          AND ${bagLedger.type} = 'return'
      ), 0)`,
    })
    .from(transactions)
    .innerJoin(customers, eq(transactions.customerId, customers.id))
    .where(and(...conditions))
    .orderBy(desc(transactions.saleDate), desc(transactions.saleTime), desc(transactions.id));

  const mapped = rows
    .map((row) => {
      const parsedNote = parseTransferNote(row.note);
      const fromExplicitKind = row.transactionKind === "transfer_out";
      if (
        !fromExplicitKind &&
        !isTransferEligibleCustomer({
          id: row.customerId,
          name: row.customerName,
          transferCustomer: row.customerTransferFlag,
        }) &&
        !parsedNote
      ) {
        return null;
      }

      const transferRef = row.transferRefCol || parsedNote?.ref || null;
      if (ref && transferRef?.toUpperCase() !== ref) return null;

      const accountingStatus = row.transferAccountingStatusCol || getTransferAccountingStatus(row.note);
      return {
        ...row,
        transferRef,
        destination: row.transferDestinationCol || parsedNote?.to || null,
        truck: row.transferTruckCol || parsedNote?.truck || null,
        memo: parsedNote?.memo || null,
        accountingStatus,
        canToggleAccounting: true,
        isLegacyFallback: !fromExplicitKind,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .filter((row) => accountingStatusFilter === "all" || row.accountingStatus === accountingStatusFilter);

  const legacyFallbackCount = mapped.filter((row) => row.isLegacyFallback).length;
  if (legacyFallbackCount > 0) {
    console.warn(
      `[transfers] using legacy fallback rows=${legacyFallbackCount} of total=${mapped.length}`
    );
  }

  const totals = mapped.reduce(
    (acc, row) => ({
      count: acc.count + 1,
      totalAmount: acc.totalAmount + Number(row.totalAmount || 0),
      totalQty: acc.totalQty + Number(row.itemQty || 0),
      totalBagReturnQty: acc.totalBagReturnQty + Number(row.bagReturnQty || 0),
    }),
    { count: 0, totalAmount: 0, totalQty: 0, totalBagReturnQty: 0 }
  );

  return NextResponse.json({ rows: mapped, totals });
});

export const PATCH = withErrorHandler(async function PATCH(request: NextRequest) {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;

  const body = await request.json();
  const validated = validateBody(updateTransferAccountingStatusSchema, body);
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const { id, accountingStatus } = validated.data;
  const factoryContext = requireFactoryWriteContext(request, auth.user);
  if ("error" in factoryContext) return factoryContext.error;
  const { db } = factoryContext;
  const transferScope = buildTransferScopeSql();

  const [target] = await db
    .select({
      id: transactions.id,
      note: transactions.note,
      customerId: transactions.customerId,
      customerName: customers.name,
      transactionKind: transactions.transactionKind,
      transferRef: transactions.transferRef,
      transferDestination: transactions.transferDestination,
      transferTruck: transactions.transferTruck,
    })
    .from(transactions)
    .innerJoin(customers, eq(transactions.customerId, customers.id))
    .where(
      and(
        eq(transactions.id, id),
        ne(transactions.status, "voided"),
        or(
          eq(transactions.transactionKind, "transfer_out"),
          and(
            transferScope.transferCustomerSql,
            transferScope.mustHaveItemsSql,
            transferScope.mustBeZeroPriceSql
          )
        )
      )
    )
    .limit(1);

  if (!target) {
    return NextResponse.json({ error: "ไม่พบบิลเครดิตที่แก้ไขได้" }, { status: 404 });
  }

  const parsed = parseTransferNote(target.note);
  const previousAccountingStatus = getTransferAccountingStatus(target.note);
  const nextTransferRef = target.transferRef || parsed?.ref || null;
  const nextTransferDestination = target.transferDestination || parsed?.to || null;
  const nextTransferTruck = target.transferTruck || parsed?.truck || null;
  const nextNote =
    parsed || (target.transactionKind === "transfer_out" && nextTransferRef)
      ? buildTransferNote({
          ref: (parsed?.ref || nextTransferRef)!,
          to: parsed?.to || nextTransferDestination,
          truck: parsed?.truck || nextTransferTruck,
          memo: parsed?.memo || null,
          accountingStatus,
        })
      : applyLegacyAccountingStatusToNote(target.note, accountingStatus);

  await db
    .update(transactions)
    .set({
      note: nextNote,
      transferRef: nextTransferRef,
      transferDestination: nextTransferDestination,
      transferTruck: nextTransferTruck,
      transferAccountingStatus: accountingStatus,
    })
    .where(eq(transactions.id, id));

  await logAudit({
    userId: auth.user.id,
    username: auth.user.username,
    action: "transaction.accounting_settle",
    entity: "transaction",
    entityId: id,
    details: {
      transferRef: parsed?.ref || null,
      mode: parsed ? "structured_note" : "legacy_note_tag",
      previousAccountingStatus,
      accountingStatus,
    },
  }, db);

  return NextResponse.json({ id, accountingStatus, canToggleAccounting: true });
});
