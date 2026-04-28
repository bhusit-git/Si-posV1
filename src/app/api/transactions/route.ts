import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import {
  transactions,
  transactionItems,
  bagLedger,
  productTypes,
  customers,
  customerPrices,
  invoiceLines,
  invoices,
} from "@/db/schema";
import { eq, and, gte, lte, desc, ne, sql, ilike, inArray, or } from "drizzle-orm";
import { requireManagerUp, requireOfficeUp, requireAdmin } from "@/lib/api-auth";
import { logAudit, withBehaviorDetails, type BehaviorSource } from "@/lib/audit";
import { withErrorHandler } from "@/lib/api-utils";
import {
  createTransactionSchema,
  validateBody,
  voidTransactionSchema,
  payTransactionSchema,
  payAllTransactionSchema,
} from "@/lib/validations";
import type { TransactionWarning } from "@/lib/types";
import { getPostHogClient } from "@/lib/posthog-server";
import {
  buildSaleAnalyticsProperties,
  buildSaleAnalyticsSnapshotDistinctId,
  buildSaleAnalyticsSnapshotUuid,
  deriveLiveSaleAnalyticsMetrics,
  SALE_ANALYTICS_SNAPSHOT_EVENT,
} from "@/lib/sale-analytics";
import {
  allocateTransferRef,
  buildTransferNote,
  getTransferAccountingStatus,
  parseTransferNote,
  TRANSFER_REF_REGEX,
} from "@/lib/transfer-utils";
import { isActiveInvoiceCreditCustomer } from "@/lib/invoice-credit-rollout";
import { parseCustomerQuery, parseTransactionSearchQuery } from "@/lib/filter-utils";
import {
  detectInvoiceOverlapWarnings,
  evaluateTransactionDateTimePolicy,
} from "@/lib/transaction-backdate";
import { scanAndPersistAuditFindings } from "@/lib/fraud-detection";
import {
  buildBagLedgerWrites,
  reverseBagLedgerEntry,
  summarizeSaleBagFlow,
} from "@/lib/bag-flow";
import { reservePrintedBillNumber } from "@/lib/bill-counter";
import { withBillPresentation } from "@/lib/bill-number";
import { requireFactoryWriteContext } from "@/lib/factory-context";
import { recordPaymentEvent } from "@/lib/payment-events";
import { withSequenceRepairRetry } from "@/lib/sequence-repair";
import { extractPostgresError } from "@/lib/api-error-diagnostics";
import {
  buildAuthenticatedDistinctId,
  buildSalePaymentRecordedProperties,
  buildTransactionVoidedProperties,
  SALE_PAYMENT_RECORDED_EVENT,
} from "@/lib/posthog-events";
import { buildTransactionPrintSource } from "@/lib/transaction-print-source";
import {
  getFactorySalePricingAuditDetailKey,
  resolveEffectiveUnitPrice,
} from "@/lib/factory-profile";
import {
  applyFactorySalePricingPolicy,
  getFactorySalePricingPolicy,
} from "@/lib/sale-pricing-policy";

function getBangkokRecentWindow(): { yesterday: string; today: string } {
  const now = new Date();
  const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterday = yesterdayDate.toLocaleDateString("en-CA", {
    timeZone: "Asia/Bangkok",
  });
  return { yesterday, today };
}

function detectSaleSource(request: NextRequest): BehaviorSource {
  const source = request.headers.get("x-sync-source");
  return source === "offline-queue" ? "offline_sync" : "pos";
}

function parseQueueLagSeconds(queuedAtHeader: string | null): number | null {
  if (!queuedAtHeader) return null;
  const queuedAt = new Date(queuedAtHeader);
  const ms = Date.now() - queuedAt.getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 1000);
}

function presentTransaction<T extends { id: number; transactionKind?: string | null; printedBillNumber?: number | null; transferRef?: string | null }>(
  tx: T
) {
  return withBillPresentation(tx);
}

function isClientIdDuplicateError(error: unknown): boolean {
  const pg = extractPostgresError(error);
  if (pg?.code !== "23505") return false;

  const constraint = pg.constraint || "";
  const detail = pg.detail || "";
  return (
    constraint === "idx_transactions_client_id" ||
    constraint.includes("transactions_client_id") ||
    detail.includes("(client_id)=")
  );
}

function duplicateTransactionPayload(
  existing: typeof transactions.$inferSelect,
  options: {
    isBackdated: boolean;
    warnings: TransactionWarning[];
  }
) {
  const presentedExisting = presentTransaction(existing);
  return {
    id: existing.id,
    totalAmount: existing.totalAmount,
    status: existing.status,
    printedBillNumber: existing.printedBillNumber ?? null,
    billNumber: presentedExisting.billNumber,
    internalReference: presentedExisting.internalReference,
    duplicate: true,
    effectiveSaleDate: existing.saleDate,
    effectiveSaleTime: existing.saleTime,
    isBackdated: options.isBackdated,
    warnings: options.warnings,
  };
}

type CreatedTransactionResult = {
  id: number;
  totalAmount: number;
  status: "paid" | "unpaid" | "partial";
  transactionType: "sale" | "transfer_out";
  transferRef: string | null;
  printedBillNumber: number | null;
  billNumber: string;
  internalReference: string;
  nextBillNumber: number;
  analyticsMetrics: ReturnType<typeof deriveLiveSaleAnalyticsMetrics>;
  effectiveSaleDate: string;
  effectiveSaleTime: string;
  isBackdated: boolean;
  warnings: TransactionWarning[];
};

async function refreshAuditFindingsSafe(
  db: Awaited<ReturnType<typeof getDb>>,
  options: { transactionIds?: number[]; userIds?: number[] }
) {
  if (!options.transactionIds || options.transactionIds.length === 0) return;
  try {
    await scanAndPersistAuditFindings(db, options);
  } catch (error) {
    console.warn("[audit] failed to refresh findings", error);
  }
}

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;
  const restrictedPastView =
    auth.user.role === "manager" || auth.user.role === "factory";
  const recentWindow = getBangkokRecentWindow();

  const db = await getDb();

  // Fast-path: fetch a single transaction by ID
  const idParam = request.nextUrl.searchParams.get("id");
  if (idParam) {
    const tx = await buildTransactionPrintSource(db, parseInt(idParam, 10));
    if (!tx) {
      return NextResponse.json({ error: "ไม่พบรายการ" }, { status: 404 });
    }
    if (
      restrictedPastView &&
      (tx.saleDate < recentWindow.yesterday || tx.saleDate > recentWindow.today)
    ) {
      return NextResponse.json(
        { error: "สิทธิ์ผู้จัดการดูได้เฉพาะวันนี้และเมื่อวาน" },
        { status: 403 }
      );
    }
    return NextResponse.json(tx);
  }

  const customerId = request.nextUrl.searchParams.get("customerId");
  const customerQuery = request.nextUrl.searchParams.get("customerQuery");
  const startDate = request.nextUrl.searchParams.get("startDate");
  const endDate = request.nextUrl.searchParams.get("endDate");
  const status = request.nextUrl.searchParams.get("status");
  const limitParam = request.nextUrl.searchParams.get("limit");
  const countOnly = request.nextUrl.searchParams.get("countOnly");
  const includeBagLedger =
    request.nextUrl.searchParams.get("includeBagLedger") === "1";

  const conditions = [];
  if (customerId) {
    conditions.push(eq(transactions.customerId, parseInt(customerId)));
  } else {
    const parsedSearch = parseTransactionSearchQuery(customerQuery);
    const parsedCustomerQuery = parsedSearch.customerQuery;

    if (
      parsedSearch.printedBillNumber !== null &&
      parsedCustomerQuery.customerId !== null
    ) {
      conditions.push(
        or(
          eq(transactions.printedBillNumber, parsedSearch.printedBillNumber),
          eq(transactions.customerId, parsedCustomerQuery.customerId)
        )
      );
    } else if (parsedCustomerQuery.customerIds.length > 0) {
      conditions.push(inArray(transactions.customerId, parsedCustomerQuery.customerIds));
    } else if (parsedCustomerQuery.customerNameQuery) {
      const matchedCustomers = await db
        .select({ id: customers.id })
        .from(customers)
        .where(ilike(customers.name, `%${parsedCustomerQuery.customerNameQuery}%`))
        .limit(300);

      if (matchedCustomers.length === 0) {
        return countOnly === "true"
          ? NextResponse.json({ count: 0 })
          : NextResponse.json([]);
      }

      conditions.push(
        sql`${transactions.customerId} IN (${sql.join(
          matchedCustomers.map((c) => sql`${c.id}`),
          sql`, `
        )})`
      );
    }
  }
  if (startDate) conditions.push(gte(transactions.saleDate, startDate));
  if (endDate) conditions.push(lte(transactions.saleDate, endDate));
  if (restrictedPastView) {
    conditions.push(gte(transactions.saleDate, recentWindow.yesterday));
    conditions.push(lte(transactions.saleDate, recentWindow.today));
  }
  if (status) conditions.push(eq(transactions.status, status as "paid" | "unpaid" | "partial" | "voided"));
  // By default exclude voided
  if (!status) conditions.push(ne(transactions.status, "voided"));

  // Count-only mode: return just the count (for "showing X of Y" indicators)
  if (countOnly === "true") {
    const [result] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(transactions)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    return NextResponse.json({ count: result.count });
  }

  // When a specific customer + date range is provided, return ALL matching rows.
  // When a date range is set (even without customer), also return all matching rows
  // to avoid silently truncating data and showing wrong summary totals.
  // Only apply a default limit when no date filter is set (bare browsing).
  const hasDateFilter = !!(startDate && endDate);
  const effectiveLimit = limitParam
    ? parseInt(limitParam)
    : hasDateFilter
      ? undefined  // no limit when date range is provided
      : 100;       // safety limit for bare browsing

  const results = await db.query.transactions.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    with: {
      customer: true,
      items: {
        with: { productType: true },
      },
      ...(includeBagLedger ? { bagLedgerEntries: true } : {}),
    },
    orderBy: [desc(transactions.saleDate), desc(transactions.saleTime)],
    ...(effectiveLimit !== undefined ? { limit: effectiveLimit } : {}),
  });

  return NextResponse.json(results.map((tx) => presentTransaction(tx)));
});

export const POST = withErrorHandler(async function POST(request: NextRequest) {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;
  const body = await request.json();
  const saleSource = detectSaleSource(request);
  const queueLagSeconds = parseQueueLagSeconds(request.headers.get("x-queued-at"));

  const validated = validateBody(createTransactionSchema, body);
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const {
    customerId,
    items,
    paid,
    status: txStatus,
    pool,
    row,
    col,
    bagReturns,
    newPrices,
    fulfillment,
    clientId,
    transactionType,
    transferRef,
    transferDestination,
    transferTruck,
    saleDate: requestedSaleDate,
    saleTime: requestedSaleTime,
    backdateReason,
    note,
    billNumber: requestedBillNumber,
  } =
    validated.data;

  const factoryContext = requireFactoryWriteContext(request, auth.user);
  if ("error" in factoryContext) return factoryContext.error;

  const { db, factoryKey } = factoryContext;
  const policy = evaluateTransactionDateTimePolicy({
    saleDate: requestedSaleDate,
    saleTime: requestedSaleTime,
    role: auth.user.role,
  });
  if (!policy.ok) {
    return NextResponse.json({ error: policy.error.error }, { status: policy.error.status });
  }
  const {
    effectiveSaleDate: saleDate,
    effectiveSaleTime: saleTime,
    isBackdated,
    backdateMinutes,
  } = policy.data;
  const normalizedBackdateReason =
    typeof backdateReason === "string" && backdateReason.trim()
      ? backdateReason.trim()
      : null;
  const warnings: TransactionWarning[] = await detectInvoiceOverlapWarnings(
    db,
    customerId,
    saleDate
  );
  const warningCodes = warnings.map((w) => w.code);
  // `transfer_out` means "invoice later / customer print hides price", not "zero-value".
  // We still persist the real totals on `transactions` and `transaction_items`, and
  // downstream reporting decides whether to exclude or include this row.
  // TODO(next-version): split invoice-later accounting/reporting intent from
  // `transactionKind` so migrated legacy rows do not rely on this overloaded meaning.
  const normalizedType = transactionType === "transfer_out" ? "transfer_out" : "sale";
  let finalTransferRef: string | null = null;
  const requestedBagReturnQty = (bagReturns || []).reduce(
    (sum, entry) => sum + Math.max(0, entry.quantity || 0),
    0
  );

  if (normalizedType === "transfer_out") {
    const customer = await db.query.customers.findFirst({
      where: eq(customers.id, customerId),
      columns: { id: true, name: true, transferCustomer: true },
    });
    if (!customer) {
      return NextResponse.json({ error: "ไม่พบลูกค้า" }, { status: 404 });
    }
    if (!isActiveInvoiceCreditCustomer(customer)) {
      return NextResponse.json(
        { error: "ลูกค้านี้ไม่มีสถานะเครดิต" },
        { status: 400 }
      );
    }

    const requestedRef = transferRef?.trim().toUpperCase() || null;
    if (requestedRef && !TRANSFER_REF_REGEX.test(requestedRef)) {
      return NextResponse.json(
        { error: "รหัสโอนไม่ถูกต้อง" },
        { status: 400 }
      );
    }

    const saleYmd = saleDate.replace(/-/g, "");
    const existingTransferRows = await db
      .select({
        transferRef: transactions.transferRef,
        note: transactions.note,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.saleDate, saleDate),
          ne(transactions.status, "voided"),
          sql`(
            ${transactions.transactionKind} = 'transfer_out'
            OR ${transactions.note} LIKE ${`XFER|ref=XFER-${saleYmd}-%`}
          )`
        )
      );
    const existingRefs: string[] = [];
    for (const row of existingTransferRows) {
      if (row.transferRef && TRANSFER_REF_REGEX.test(row.transferRef)) {
        existingRefs.push(row.transferRef);
        continue;
      }
      const parsed = parseTransferNote(row.note);
      if (parsed?.ref && TRANSFER_REF_REGEX.test(parsed.ref)) {
        existingRefs.push(parsed.ref);
      }
    }

    finalTransferRef = allocateTransferRef(saleDate, existingRefs, requestedRef);
    if (!finalTransferRef) {
      return NextResponse.json(
        { error: "ไม่สามารถออกรหัสโอนได้ (เลขเต็มช่วงแล้ว)" },
        { status: 409 }
      );
    }
  }

  if (requestedBagReturnQty > 0) {
    const canonicalBagProduct = await db.query.productTypes.findFirst({
      where: eq(productTypes.hasBag, true),
      columns: { id: true },
    });
    if (!canonicalBagProduct) {
      return NextResponse.json(
        { error: "ไม่พบประเภทสินค้าที่รองรับการคืนถุง" },
        { status: 400 }
      );
    }
  }

  // Idempotency: if clientId is provided, check for duplicate
  if (clientId && typeof clientId === "string") {
    const existing = await db.query.transactions.findFirst({
      where: eq(transactions.clientId, clientId),
    });
    if (existing) {
      return NextResponse.json(
        duplicateTransactionPayload(existing, { isBackdated, warnings }),
        { status: 200 }
      );
    }
  }

  const allProductTypes = await db.select().from(productTypes);
  const productTypeById = new Map(allProductTypes.map((productType) => [productType.id, productType]));
  const normalizedItems = items.map((item) => {
    const productType = productTypeById.get(item.productTypeId);
    const unitPrice = resolveEffectiveUnitPrice({
      factoryKey,
      customerId,
      productTypeId: item.productTypeId,
      productCatalogCode: productType?.catalogCode ?? null,
      quantity: item.quantity || 0,
      baseUnitPrice: item.unitPrice || 0,
    });
    return {
      ...item,
      productCatalogCode: productType?.catalogCode ?? null,
      unitPrice,
    };
  });

  const productTypeIds = Array.from(
    new Set(items.filter((item) => (item.quantity || 0) > 0).map((item) => item.productTypeId))
  );
  const priceRows =
    productTypeIds.length > 0
      ? await db
          .select({
            productTypeId: customerPrices.productTypeId,
            unitPrice: customerPrices.unitPrice,
          })
          .from(customerPrices)
          .where(
            and(
              eq(customerPrices.customerId, customerId),
              inArray(customerPrices.productTypeId, productTypeIds)
            )
          )
      : [];
  const baseUnitPriceByProductTypeId = new Map(
    priceRows.map((row) => [row.productTypeId, Number(row.unitPrice || 0)])
  );
  const pricingEvaluation = applyFactorySalePricingPolicy({
    factoryKey,
    customerId,
    items: normalizedItems,
    baseUnitPriceByProductTypeId,
  });
  const salePricingPolicy = getFactorySalePricingPolicy(factoryKey);
  const salePricingAuditDetailKey = getFactorySalePricingAuditDetailKey(factoryKey);
  const pricedItems = pricingEvaluation.items;
  const pricingAuditCustomer =
    pricingEvaluation.applied && salePricingAuditDetailKey
      ? await db.query.customers.findFirst({
          where: eq(customers.id, customerId),
          columns: { id: true, name: true },
        })
      : null;

  // Calculate total
  let totalAmount = 0;
  for (const item of pricedItems) {
    totalAmount += (item.quantity || 0) * (item.unitPrice || 0);
  }

  // Determine status
  let finalStatus: "paid" | "unpaid" | "partial" = "paid";
  let finalPaid = totalAmount;
  if (normalizedType === "transfer_out") {
    // `transfer_out` is settled at the transaction layer so it does not show up as
    // short-term customer credit (`ค้าง`). Any receivable for these rows is tracked
    // later through the invoice workflow, not `transactions.paid/outstandingAmount`.
    finalStatus = "paid";
    finalPaid = totalAmount;
  } else {
    if (txStatus === "unpaid") {
      finalStatus = "unpaid";
      finalPaid = 0;
    } else if (txStatus === "partial") {
      finalStatus = "partial";
      finalPaid = paid || 0;
    } else if (paid !== undefined && paid !== -1) {
      finalPaid = paid;
      if (finalPaid <= 0) finalStatus = "unpaid";
      else if (finalPaid < totalAmount) finalStatus = "partial";
      else finalStatus = "paid";
    }
  }
  const trimmedRef = finalTransferRef || transferRef?.trim() || null;
  const finalNote = normalizedType === "transfer_out" && trimmedRef
    ? buildTransferNote({
        ref: trimmedRef,
        to: transferDestination || null,
        truck: transferTruck || null,
        memo: note || null,
      })
    : note || null;
  const outstandingAmount = Math.max(0, totalAmount - finalPaid);

  // Wrap all inserts in a single transaction for atomicity
  let result: CreatedTransactionResult;
  try {
    result = await withSequenceRepairRetry(db, () =>
      db.transaction(async (tx) => {
      const { printedBillNumber, nextBillNumber } = await reservePrintedBillNumber(
        tx,
        factoryKey,
        requestedBillNumber
      );
      // Insert transaction
      const [txResult] = await tx
        .insert(transactions)
        .values({
          customerId,
          totalAmount,
          paid: finalPaid,
          outstandingAmount,
          status: finalStatus,
          transactionKind: normalizedType,
          pool: pool || null,
          row: row || null,
          col: col || null,
          saleDate,
          saleTime,
          note: finalNote,
          printedBillNumber,
          transferRef: normalizedType === "transfer_out" ? trimmedRef : null,
          transferDestination:
            normalizedType === "transfer_out" ? transferDestination || null : null,
          transferTruck: normalizedType === "transfer_out" ? transferTruck || null : null,
          transferAccountingStatus:
            normalizedType === "transfer_out"
              ? getTransferAccountingStatus(finalNote)
              : null,
          sourceSystem: "app_pos",
          fulfillment: fulfillment || null,
          clientId: clientId || null,
          createdBy: auth.user.id,
          createdAt: new Date(),
        })
        .returning();

      const txId = txResult.id;

      const ptMap = productTypeById;
      const canonicalBagPt = allProductTypes.find((p) => p.hasBag);

      const saleBagSummary = summarizeSaleBagFlow({
        items: pricedItems.map((item) => ({
          quantity: item.quantity,
          productType: ptMap.get(item.productTypeId)
            ? {
                hasBag: ptMap.get(item.productTypeId)?.hasBag,
                decreasesBag: ptMap.get(item.productTypeId)?.decreasesBag,
              }
            : null,
        })),
        manualBagReturnQty: requestedBagReturnQty,
      });

      // Insert transaction items
      for (const item of pricedItems) {
        if ((item.quantity || 0) === 0) continue;
        await tx.insert(transactionItems).values({
          transactionId: txId,
          productTypeId: item.productTypeId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          subtotal: item.quantity * item.unitPrice,
        });
      }

      if (canonicalBagPt) {
        const bagWrites = buildBagLedgerWrites(saleBagSummary);
        for (const write of bagWrites) {
          await tx.insert(bagLedger).values({
            customerId,
            productTypeId: canonicalBagPt.id,
            type: write.type,
            quantity: write.quantity,
            transactionId: txId,
            note: write.note,
            createdBy: auth.user.id,
            createdAt: new Date(),
          });
        }
      }

      const itemQuantity = pricedItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
      const totalBagsReturn = saleBagSummary.bagsReturned;
      const salePricingAuditDetails =
        pricingEvaluation.applied && salePricingAuditDetailKey && salePricingPolicy
        ? {
            policy: salePricingPolicy.policyKey,
            description: pricingEvaluation.description,
            transactionId: txId,
            printedBillNumber,
            billNumber: withBillPresentation({
              id: txId,
              transactionKind: normalizedType,
              printedBillNumber,
              transferRef: trimmedRef,
            }).billNumber,
            customerId,
            customerName: pricingAuditCustomer?.name ?? null,
            saleDate,
            saleTime,
            originalSubtotal: pricingEvaluation.baseSubtotal,
            finalSubtotal: pricingEvaluation.effectiveSubtotal,
            discountAmount: pricingEvaluation.discountAmount,
            adjustedProductTypeIds: pricingEvaluation.adjustedProductTypeIds,
            lines: pricingEvaluation.items
              .filter((item) => item.pricingAdjusted)
              .map((item) => ({
                productTypeId: item.productTypeId,
                productCatalogCode: item.productCatalogCode ?? null,
                quantity: item.quantity,
                originalUnitPrice: item.pricingBaseUnitPrice,
                finalUnitPrice: item.unitPrice,
                originalSubtotal: (item.quantity || 0) * item.pricingBaseUnitPrice,
                finalSubtotal: item.subtotal,
                discountAmount:
                  (item.quantity || 0) * item.pricingBaseUnitPrice - item.subtotal,
              })),
          }
        : null;
      const createDetails = {
        ...(isBackdated
          ? { auditSummary: "backdated transaction", backdatedTransaction: true }
          : {}),
        ...(salePricingAuditDetails && salePricingAuditDetailKey
          ? { [salePricingAuditDetailKey]: salePricingAuditDetails }
          : {}),
        customerId,
        totalAmount,
        status: finalStatus,
        itemCount: pricedItems.length,
        itemQuantity,
        totalBagsOut: saleBagSummary.bagsOut,
        totalBagsReturn,
        totalBagsDecrease: saleBagSummary.bagsBought,
        source: saleSource,
        queueLagSeconds,
        attemptedInlinePriceChanges: Array.isArray(newPrices) ? newPrices.length : 0,
        transactionType: normalizedType,
        transferRef: trimmedRef,
        printedBillNumber,
        nextBillNumber,
        transferDestination: transferDestination || null,
        requestedSaleDate,
        requestedSaleTime,
        effectiveSaleDate: saleDate,
        effectiveSaleTime: saleTime,
        isBackdated,
        backdateMinutes,
        backdateReason: normalizedBackdateReason,
        warningCodes,
      };
      // Audit log
      await logAudit({
        userId: auth.user.id,
        username: auth.user.username,
        action: "transaction.create",
        entity: "transaction",
        entityId: txId,
        details: withBehaviorDetails(createDetails, {
          event: "sale.created",
          source: saleSource,
          customerId,
          transactionId: txId,
          amount: totalAmount,
          quantity: itemQuantity,
          tags:
            normalizedType === "transfer_out"
              ? isBackdated
                ? ["transfer_out", "backdated"]
                : ["transfer_out"]
              : finalStatus === "paid"
                ? isBackdated
                  ? ["paid", "backdated"]
                  : ["paid"]
                : isBackdated
                  ? ["credit", "backdated"]
                  : ["credit"],
          extra: {
            ...(queueLagSeconds !== null ? { queueLagSeconds } : {}),
            requestedSaleDate,
            requestedSaleTime,
            effectiveSaleDate: saleDate,
            effectiveSaleTime: saleTime,
            isBackdated,
            backdateMinutes,
            backdateReason: normalizedBackdateReason,
            warningCodes,
          },
        }),
      }, tx);

      return {
        id: txId,
        totalAmount,
        status: finalStatus,
        transactionType: normalizedType,
        transferRef: trimmedRef,
        printedBillNumber,
        billNumber: withBillPresentation({
          id: txId,
          transactionKind: normalizedType,
          printedBillNumber,
          transferRef: trimmedRef,
        }).billNumber,
        internalReference: withBillPresentation({
          id: txId,
          transactionKind: normalizedType,
          printedBillNumber,
          transferRef: trimmedRef,
        }).internalReference,
        nextBillNumber,
        analyticsMetrics: deriveLiveSaleAnalyticsMetrics({
          items: pricedItems,
          saleBagSummary,
        }),
        effectiveSaleDate: saleDate,
        effectiveSaleTime: saleTime,
        isBackdated,
        warnings,
      };
      })
    );
  } catch (error) {
    if (clientId && typeof clientId === "string" && isClientIdDuplicateError(error)) {
      const existing = await db.query.transactions.findFirst({
        where: eq(transactions.clientId, clientId),
      });
      if (existing) {
        return NextResponse.json(
          duplicateTransactionPayload(existing, { isBackdated, warnings }),
          { status: 200 }
        );
      }
    }
    throw error;
  }

  await refreshAuditFindingsSafe(db, {
    transactionIds: [result.id],
    userIds: [auth.user.id],
  });

  try {
    const posthog = getPostHogClient();
    const analyticsProperties = buildSaleAnalyticsProperties({
      transactionId: result.id,
      customerId,
      totalAmount: result.totalAmount,
      paidAmount: finalPaid,
      outstandingAmount,
      paymentStatus: result.status,
      transactionType: result.transactionType,
      transferRef: result.transferRef,
      factoryKey,
      metrics: result.analyticsMetrics,
      printedBillNumber: result.printedBillNumber,
      billNumber: result.billNumber,
      internalReference: result.internalReference,
      saleDate: result.effectiveSaleDate,
      saleTime: result.effectiveSaleTime,
      isBackdated: result.isBackdated,
      warningCount: result.warnings.length,
      sourceSystem: "app_pos",
      actorUserId: auth.user.id,
      actorRole: auth.user.role,
      eventOrigin: "server",
      eventSource: "server",
    });
    posthog.capture({
      distinctId: buildAuthenticatedDistinctId(auth.user.id),
      event: "sale_completed",
      properties: analyticsProperties,
    });
    posthog.capture({
      distinctId: buildSaleAnalyticsSnapshotDistinctId(factoryKey, customerId),
      event: SALE_ANALYTICS_SNAPSHOT_EVENT,
      properties: analyticsProperties,
      uuid: buildSaleAnalyticsSnapshotUuid(factoryKey, result.id),
    });
  } catch (error) {
    console.warn("[analytics] failed to capture sale_completed", error);
  }

  return NextResponse.json(result, { status: 201 });
});

export const PUT = withErrorHandler(async function PUT(request: NextRequest) {
  const body = await request.json();
  const { id, action } = body;

  // PAY ALL action -- batch pay all outstanding for a customer in one DB transaction
  if (action === "payAll") {
    const validated = validateBody(payAllTransactionSchema, body);
    if ("error" in validated) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    const auth = await requireOfficeUp();
    if (auth.error) return auth.error;
    const factoryContext = requireFactoryWriteContext(request, auth.user);
    if ("error" in factoryContext) return factoryContext.error;
    const { db } = factoryContext;

    const { customerId } = validated.data;

    const result = await db.transaction(async (dbTx) => {
      // Find all unpaid/partial transactions for this customer
      const unpaidTx = await dbTx
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.customerId, customerId),
            ne(transactions.status, "voided"),
            ne(transactions.status, "paid"),
            ne(transactions.transactionKind, "transfer_out")
          )
        );

      let paidCount = 0;
      let totalPaidAmount = 0;
      const updatedTransactionIds: number[] = [];
      for (const tx of unpaidTx) {
        const outstanding = tx.totalAmount - (tx.paid || 0);
        if (outstanding > 0) {
          await dbTx
              .update(transactions)
              .set({ paid: tx.totalAmount, outstandingAmount: 0, status: "paid" })
              .where(eq(transactions.id, tx.id));
          await recordPaymentEvent(dbTx, {
            transactionId: tx.id,
            amount: outstanding,
            method: "cash",
            note: "payAll",
            createdBy: auth.user.id,
          });
          await logAudit({
            userId: auth.user.id,
            username: auth.user.username,
            action: "transaction.payment",
            entity: "transaction",
            entityId: tx.id,
            details: withBehaviorDetails({
              amount: outstanding,
              previousPaid: tx.paid || 0,
              newPaid: tx.totalAmount,
              newStatus: "paid",
              totalAmount: tx.totalAmount,
              source: "payAll",
              customerId,
            }, {
              event: "sale.payment",
              source: "backoffice",
              customerId,
              transactionId: tx.id,
              amount: outstanding,
              tags: ["pay_all"],
            }),
          }, dbTx);
          paidCount++;
          totalPaidAmount += outstanding;
          updatedTransactionIds.push(tx.id);
        }
      }

      await logAudit({
        userId: auth.user.id,
        username: auth.user.username,
        action: "transaction.payAll",
        entity: "transaction",
        entityId: null,
        details: withBehaviorDetails(
          { customerId, paidCount, totalPaidAmount },
          {
            event: "sale.payment_batch",
            source: "backoffice",
            customerId,
            amount: totalPaidAmount,
            quantity: paidCount,
            tags: ["pay_all"],
          }
        ),
      }, dbTx);

      return { paidCount, totalTransactions: unpaidTx.length, updatedTransactionIds };
    });

    await refreshAuditFindingsSafe(db, {
      transactionIds: result.updatedTransactionIds,
      userIds: [auth.user.id],
    });

    return NextResponse.json({ success: true, ...result });
  }

  // All other actions require a transaction ID
  if (!id) {
    return NextResponse.json({ error: "ต้องระบุ ID รายการ" }, { status: 400 });
  }
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "ID รายการไม่ถูกต้อง" }, { status: 400 });
  }

  // VOID action -- ADMIN ONLY, requires reason
  if (action === "void") {
    const validated = validateBody(voidTransactionSchema, body);
    if ("error" in validated) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    const auth = await requireAdmin();
    if (auth.error) return auth.error;
    const factoryContext = requireFactoryWriteContext(request, auth.user);
    if ("error" in factoryContext) return factoryContext.error;
    const { db, factoryKey } = factoryContext;

    const { reason } = validated.data;

    const result = await db.transaction(async (dbTx) => {
      const [tx] = await dbTx
        .update(transactions)
        .set({
          status: "voided",
          outstandingAmount: 0,
          voidedBy: auth.user.id,
          voidReason: reason.trim(),
        })
        .where(and(eq(transactions.id, id), ne(transactions.status, "voided")))
        .returning();

      if (!tx) {
        const [existing] = await dbTx
          .select({ id: transactions.id })
          .from(transactions)
          .where(eq(transactions.id, id))
          .limit(1);

        if (!existing) {
          return { error: "ไม่พบรายการ", status: 404 as const };
        }
        return { error: "รายการนี้ถูกยกเลิกแล้ว", status: 400 as const };
      }

      // Reverse bag ledger entries for this transaction
      const bagEntries = await dbTx
        .select()
        .from(bagLedger)
        .where(eq(bagLedger.transactionId, id));

      for (const entry of bagEntries) {
        const reversal = reverseBagLedgerEntry(entry);
        await dbTx.insert(bagLedger).values({
          customerId: entry.customerId,
          productTypeId: entry.productTypeId,
          type: reversal.type,
          quantity: reversal.quantity,
          transactionId: id,
          note: `ยกเลิกบิล #${id}`,
          createdBy: auth.user.id,
          createdAt: new Date(),
        });
      }

      await logAudit({
        userId: auth.user.id,
        username: auth.user.username,
        action: "transaction.void",
        entity: "transaction",
        entityId: id,
        details: withBehaviorDetails(
          {
            reason: reason.trim(),
            totalAmount: tx.totalAmount,
            customerId: tx.customerId,
            bagEntriesReversed: bagEntries.length,
          },
          {
            event: "sale.voided",
            source: "backoffice",
            customerId: tx.customerId,
            transactionId: id,
            amount: tx.totalAmount,
            reasonCode: "manual_void",
          }
        ),
      }, dbTx);

      return { tx, bagEntriesReversed: bagEntries.length };
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    await refreshAuditFindingsSafe(db, {
      transactionIds: [id],
      userIds: [auth.user.id],
    });

    // Track transaction voided event
    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: buildAuthenticatedDistinctId(auth.user.id),
      event: "transaction_voided",
      properties: buildTransactionVoidedProperties({
        actorUserId: auth.user.id,
        actorRole: auth.user.role,
        factoryKey,
        transactionId: id,
        customerId: result.tx.customerId,
        totalAmount: result.tx.totalAmount,
        voidedByUserId: auth.user.id,
      }),
    });

    return NextResponse.json({ success: true, status: "voided" });
  }

  // PAYMENT action -- office and above
  if (action === "payment") {
    const validated = validateBody(payTransactionSchema, body);
    if ("error" in validated) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    const auth = await requireOfficeUp();
    if (auth.error) return auth.error;
    const factoryContext = requireFactoryWriteContext(request, auth.user);
    if ("error" in factoryContext) return factoryContext.error;
    const { db, factoryKey } = factoryContext;

    const { amount } = validated.data;

    const result = await db.transaction(async (dbTx) => {
      const tx = await dbTx.query.transactions.findFirst({
        where: eq(transactions.id, id),
      });
      if (!tx) {
        return { error: "ไม่พบรายการ", status: 404 as const };
      }

      if (tx.status === "voided") {
        return {
          error: "ไม่สามารถชำระเงินรายการที่ยกเลิกแล้ว",
          status: 400 as const,
        };
      }
      if (tx.transactionKind === "transfer_out") {
        return {
          error: "บิลเครดิตไม่สามารถรับชำระเงินได้",
          status: 400 as const,
        };
      }

      const [activeInvoice] = await dbTx
        .select({
          invoiceId: invoices.id,
          invoiceStatus: invoices.status,
        })
        .from(invoiceLines)
        .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
        .where(and(eq(invoiceLines.transactionId, id), ne(invoices.status, "void")))
        .limit(1);

      if (activeInvoice) {
        return {
          error: "รายการนี้อยู่ในใบวางบิล กรุณาปรับชำระผ่านใบวางบิล",
          status: 409 as const,
        };
      }

      const previousPaid = tx.paid || 0;
      const unclampedPaid = previousPaid + amount;
      const newPaid = Math.max(0, Math.min(tx.totalAmount, unclampedPaid));
      let newStatus: "paid" | "unpaid" | "partial" = "partial";
      if (newPaid >= tx.totalAmount) newStatus = "paid";
      else if (newPaid <= 0) newStatus = "unpaid";
      const newOutstandingAmount = Math.max(0, tx.totalAmount - newPaid);
      const appliedAmount = newPaid - previousPaid;
      const paymentDirection =
        amount < 0 ? "reverse" : newPaid >= tx.totalAmount ? "settle_full" : "manual_payment";
      const paymentModeChange =
        amount < 0 && newPaid <= 0
          ? {
              auditActionLabel: "เปลี่ยนเป็นเครดิตระยะสั้น",
              auditSummary: "เปลี่ยนสถานะการชำระ: เงินสด -> เครดิตระยะสั้น",
            }
          : amount > 0 && previousPaid <= 0 && newPaid >= tx.totalAmount
            ? {
                auditActionLabel: "เปลี่ยนเป็นเงินสด",
                auditSummary: "เปลี่ยนสถานะการชำระ: เครดิตระยะสั้น -> เงินสด",
              }
            : amount > 0 && newPaid >= tx.totalAmount
              ? {
                  auditActionLabel: "ชำระครบ",
                  auditSummary: "บันทึกชำระเงินจนชำระครบ",
                }
              : {
                  auditActionLabel: "บันทึกชำระเงิน",
                  auditSummary: "บันทึกชำระเงินบางส่วน",
                };

      await dbTx
        .update(transactions)
        .set({ paid: newPaid, outstandingAmount: newOutstandingAmount, status: newStatus })
        .where(eq(transactions.id, id));

      if (appliedAmount !== 0) {
        await recordPaymentEvent(dbTx, {
          transactionId: id,
          amount: appliedAmount,
          method: "cash",
          note: paymentModeChange.auditSummary,
          createdBy: auth.user.id,
        });
      }

      await logAudit({
        userId: auth.user.id,
        username: auth.user.username,
        action: "transaction.payment",
        entity: "transaction",
        entityId: id,
        details: withBehaviorDetails(
          {
            auditActionLabel: paymentModeChange.auditActionLabel,
            auditSummary: paymentModeChange.auditSummary,
            amount,
            appliedAmount,
            previousPaid,
            newPaid,
            newStatus,
            totalAmount: tx.totalAmount,
            customerId: tx.customerId,
            paymentDirection,
            backToCredit: amount < 0,
          },
          {
            event: "sale.payment",
            source: "backoffice",
            customerId: tx.customerId,
            transactionId: id,
            amount: appliedAmount,
            tags: ["manual_payment"],
          }
        ),
      }, dbTx);

      return {
        tx,
        previousPaid,
        newPaid,
        newStatus,
        newOutstandingAmount,
        appliedAmount,
        paymentDirection,
      };
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    await refreshAuditFindingsSafe(db, {
      transactionIds: [id],
      userIds: [auth.user.id],
    });

    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: buildAuthenticatedDistinctId(auth.user.id),
      event: SALE_PAYMENT_RECORDED_EVENT,
      properties: buildSalePaymentRecordedProperties({
        actorUserId: auth.user.id,
        actorRole: auth.user.role,
        factoryKey,
        transactionId: id,
        customerId: result.tx.customerId,
        paymentAmount: amount,
        previousPaid: result.previousPaid,
        newPaid: result.newPaid,
        newStatus: result.newStatus,
        outstandingAfterPayment: result.newOutstandingAmount,
        paymentDirection: result.paymentDirection,
        backToCredit: amount < 0,
      }),
    });

    return NextResponse.json({ success: true, paid: result.newPaid, status: result.newStatus });
  }

  return NextResponse.json({ error: "ไม่รู้จัก action" }, { status: 400 });
});
