import { NextRequest, NextResponse } from "next/server";
import {
  transactions,
  transactionItems,
  bagLedger,
  productTypes,
  invoiceLines,
  invoices,
} from "@/db/schema";
import { eq, and, ne, lt, like, sql, asc } from "drizzle-orm";
import { requireManagerUp } from "@/lib/api-auth";
import { logAudit, withBehaviorDetails } from "@/lib/audit";
import { withErrorHandler } from "@/lib/api-utils";
import { createReturnSchema, validateBody } from "@/lib/validations";
import { getTransferAccountingStatus } from "@/lib/transfer-utils";
import { reservePrintedBillNumber } from "@/lib/bill-counter";
import { withBillPresentation } from "@/lib/bill-number";
import { requireFactoryWriteContext } from "@/lib/factory-context";
import { getPostHogClient } from "@/lib/posthog-server";
import {
  buildBagLedgerWrites,
  buildRefundBagAdjustNote,
  summarizeRefundBagFlow,
} from "@/lib/bag-flow";
import {
  buildAuthenticatedDistinctId,
  buildSaleReturnCompletedProperties,
  SALE_RETURN_COMPLETED_EVENT,
} from "@/lib/posthog-events";

function getBangkokDateTimeNow(): { saleDate: string; saleTime: string } {
  const now = new Date();
  return {
    saleDate: now.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }),
    saleTime: now.toLocaleTimeString("en-GB", {
      timeZone: "Asia/Bangkok",
      hour12: false,
    }),
  };
}

function classifyReturnReasonCode(
  hasOriginalBill: boolean,
  isInvoiceCreditBill: boolean,
  returnedItemQty: number,
  returnedBagQty: number
): string {
  if (hasOriginalBill && isInvoiceCreditBill) return "invoice_credit_reference";
  if (hasOriginalBill) return "bill_reference";
  if (returnedItemQty > 0 && returnedBagQty > 0) return "mixed_return";
  if (returnedItemQty > 0) return "product_only";
  if (returnedBagQty > 0) return "bag_only";
  return "unknown";
}

export const POST = withErrorHandler(async function POST(request: NextRequest) {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;
  const body = await request.json();
  const validated = validateBody(createReturnSchema, body);
  if ("error" in validated) {
    console.error("[returns] Validation failed:", validated.error);
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const { customerId, items, bagReturns, note, originalBill, billNumber: requestedBillNumber } = validated.data;
  const { saleDate, saleTime } = getBangkokDateTimeNow();

  console.log("[returns] Incoming:", {
    customerId,
    itemCount: Array.isArray(items) ? items.length : "not-array",
    bagReturnCount: Array.isArray(bagReturns) ? bagReturns.length : 0,
    saleDate,
    saleTime,
    originalBill,
    hasNote: !!note,
  });

  const factoryContext = requireFactoryWriteContext(request, auth.user);
  if ("error" in factoryContext) return factoryContext.error;
  const { db, factoryKey } = factoryContext;
  let originalBillKind: string | null = null;
  let isOriginalInvoiceCreditBill = false;

  const hasProductItems = Array.isArray(items) && items.some((i) => (i.quantity || 0) > 0);

  // Product refunds must reference a source bill.
  if (hasProductItems && !originalBill) {
    return NextResponse.json(
      { error: "การคืนสินค้าต้องอ้างอิงบิลเดิม" },
      { status: 400 }
    );
  }

  // Validate return quantities against original bill when provided
  if (originalBill) {
    const parsedBillId = originalBill;
    const originalTx = await db.query.transactions.findFirst({
      where: eq(transactions.id, parsedBillId),
      with: { items: true },
    });

    if (!originalTx) {
      console.error("[returns] Original bill not found:", parsedBillId);
      return NextResponse.json(
        { error: `ไม่พบบิลต้นฉบับ #${parsedBillId}` },
        { status: 400 }
      );
    }

    if (originalTx.customerId !== customerId) {
      return NextResponse.json(
        { error: "บิลต้นฉบับไม่ตรงกับลูกค้าที่เลือก" },
        { status: 400 }
      );
    }

    originalBillKind = originalTx.transactionKind || null;
    isOriginalInvoiceCreditBill = originalTx.transactionKind === "transfer_out";

    if (isOriginalInvoiceCreditBill) {
      const accountingStatus =
        originalTx.transferAccountingStatus || getTransferAccountingStatus(originalTx.note);
      if (accountingStatus === "closed") {
        return NextResponse.json(
          { error: "บิลเครดิตนี้ปิดยอดแล้ว ต้องเปิดยอดก่อนจึงจะคืนได้" },
          { status: 400 }
        );
      }

      const [activeInvoiceLink] = await db
        .select({
          invoiceId: invoiceLines.invoiceId,
          invoiceStatus: invoices.status,
        })
        .from(invoiceLines)
        .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
        .where(
          and(
            eq(invoiceLines.transactionId, parsedBillId),
            ne(invoices.status, "void")
          )
        )
        .limit(1);

      if (activeInvoiceLink) {
        return NextResponse.json(
          { error: "บิลเครดิตนี้อยู่ในใบวางบิลแล้ว กรุณาจัดการใบวางบิลก่อนคืนสินค้า" },
          { status: 400 }
        );
      }
    }

    const previousReturnRows = await db
      .select({
        productTypeId: transactionItems.productTypeId,
        returnedQty: sql<number>`COALESCE(SUM(ABS(${transactionItems.quantity})), 0)`,
      })
      .from(transactionItems)
      .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
      .where(
        and(
          eq(transactions.customerId, customerId),
          ne(transactions.status, "voided"),
          lt(transactionItems.quantity, 0),
          like(transactions.note, `%อ้างอิงบิล #${parsedBillId}%`)
        )
      )
      .groupBy(transactionItems.productTypeId);
    const previouslyReturnedMap = new Map<number, number>(
      previousReturnRows.map((r) => [r.productTypeId, Number(r.returnedQty || 0)])
    );

    if (originalTx && items && Array.isArray(items)) {
      for (const returnItem of items) {
        if (!returnItem.quantity || returnItem.quantity <= 0) continue;
        const origItem = originalTx.items.find(
          (i: { productTypeId: number; quantity: number; unitPrice: number }) =>
            i.productTypeId === returnItem.productTypeId
        );
        const soldQty = origItem ? Math.abs(origItem.quantity) : 0;
        const alreadyReturnedQty = previouslyReturnedMap.get(returnItem.productTypeId) || 0;
        const remainingQty = Math.max(0, soldQty - alreadyReturnedQty);
        if (returnItem.quantity > remainingQty) {
          console.error("[returns] Quantity exceeds original:", {
            productTypeId: returnItem.productTypeId,
            returnQty: returnItem.quantity,
            soldQty,
            alreadyReturnedQty,
            remainingQty,
            billId: parsedBillId,
          });
          return NextResponse.json(
            {
              error: `จำนวนคืนสินค้า (${returnItem.quantity}) เกินจำนวนที่คืนได้ (${remainingQty})`,
            },
            { status: 400 }
          );
        }

        if (origItem) {
          const unitPriceDiff = Math.abs((returnItem.unitPrice || 0) - (origItem.unitPrice || 0));
          if (unitPriceDiff > 0.000001) {
            return NextResponse.json(
              { error: "ราคาคืนต้องตรงกับราคาบิลต้นฉบับ" },
              { status: 400 }
            );
          }
        }
      }
    }
  }

  // items: [{ productTypeId, quantity, unitPrice }] — returned products (refund)
  // bagReturns: [{ productTypeId, quantity }] — returned bags

  let totalRefund = 0;
  for (const item of items || []) {
    totalRefund += (item.quantity || 0) * (item.unitPrice || 0);
  }
  const totalReturnedItemQty = (items || []).reduce(
    (sum, item) => sum + Math.max(0, item.quantity || 0),
    0
  );
  const totalBagReturnQty = (bagReturns || []).reduce(
    (sum, ret) => sum + Math.max(0, ret.quantity || 0),
    0
  );
  const returnReasonCode = classifyReturnReasonCode(
    Boolean(originalBill),
    isOriginalInvoiceCreditBill,
    totalReturnedItemQty,
    totalBagReturnQty
  );

  const returnNote = originalBill
    ? `คืนสินค้า อ้างอิงบิล #${originalBill}${note ? " - " + note : ""}`
    : note || "คืนสินค้า";

  // Wrap everything in a transaction for atomicity
  const result = await db.transaction(async (tx) => {
    const { printedBillNumber, nextBillNumber } = await reservePrintedBillNumber(
      tx,
      factoryKey,
      requestedBillNumber
    );

    let remainingRefundToApply = Math.max(0, totalRefund);
    const refundAllocations: Array<{
      transactionId: number;
      appliedAmount: number;
      previousPaid: number;
      newPaid: number;
      newStatus: "paid" | "unpaid" | "partial";
    }> = [];

    if (remainingRefundToApply > 0 && !isOriginalInvoiceCreditBill) {
      const outstandingRows = await tx
        .select({
          id: transactions.id,
          totalAmount: transactions.totalAmount,
          paid: transactions.paid,
          status: transactions.status,
          saleDate: transactions.saleDate,
          saleTime: transactions.saleTime,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.customerId, customerId),
            ne(transactions.status, "voided"),
            ne(transactions.transactionKind, "transfer_out"),
            sql`${transactions.totalAmount} > 0`,
            sql`(${transactions.totalAmount} - ${transactions.paid}) > 0`
          )
        )
        .orderBy(asc(transactions.saleDate), asc(transactions.saleTime), asc(transactions.id));

      const prioritizedRows = [
        ...(originalBill
          ? outstandingRows.filter((row) => row.id === originalBill)
          : []),
        ...outstandingRows.filter((row) => row.id !== originalBill),
      ];

      for (const row of prioritizedRows) {
        if (remainingRefundToApply <= 0) break;

        const previousPaid = Number(row.paid || 0);
        const outstanding = Math.max(0, Number(row.totalAmount) - previousPaid);
        if (outstanding <= 0) continue;

        const appliedAmount = Math.min(outstanding, remainingRefundToApply);
        const newPaid = previousPaid + appliedAmount;
        let newStatus: "paid" | "unpaid" | "partial" = "partial";
        if (newPaid >= Number(row.totalAmount)) newStatus = "paid";
        else if (newPaid <= 0) newStatus = "unpaid";

        await tx
          .update(transactions)
          .set({
            paid: newPaid,
            outstandingAmount: Math.max(0, Number(row.totalAmount) - newPaid),
            status: newStatus,
          })
          .where(eq(transactions.id, row.id));

        refundAllocations.push({
          transactionId: row.id,
          appliedAmount,
          previousPaid,
          newPaid,
          newStatus,
        });

        remainingRefundToApply -= appliedAmount;
      }
    }

    // Create a return transaction (negative total)
    const [txResult] = await tx
      .insert(transactions)
      .values({
        customerId,
        totalAmount: -totalRefund,
        paid: -totalRefund,
        outstandingAmount: 0,
        status: "paid",
        transactionKind: "return",
        originalTransactionId: originalBill || null,
        pool: null,
        row: null,
        col: null,
        saleDate,
        saleTime,
        note: returnNote,
        printedBillNumber,
        sourceSystem: "app_pos",
        createdBy: auth.user.id,
        createdAt: new Date(),
      })
      .returning();

    const txId = txResult.id;

    const allPts = await tx.select().from(productTypes);
    const ptMap = new Map(allPts.map((p) => [p.id, p]));
    const canonicalBagPt = allPts.find((p) => p.hasBag);
    const refundBagSummary = summarizeRefundBagFlow({
      items: (items || []).map((item) => ({
        quantity: item.quantity,
        productType: ptMap.get(item.productTypeId)
          ? {
              hasBag: ptMap.get(item.productTypeId)?.hasBag,
              decreasesBag: ptMap.get(item.productTypeId)?.decreasesBag,
            }
          : null,
      })),
      manualBagReturnQty: totalBagReturnQty,
    });

    // Insert returned product items (negative quantities for returns)
    for (const item of items || []) {
      if ((item.quantity || 0) === 0) continue;
      await tx.insert(transactionItems).values({
        transactionId: txId,
        productTypeId: item.productTypeId,
        quantity: -item.quantity,
        unitPrice: item.unitPrice,
        subtotal: -(item.quantity * item.unitPrice),
      });
    }

    if (canonicalBagPt) {
      const bagWrites = buildBagLedgerWrites(refundBagSummary, {
        adjustNote: buildRefundBagAdjustNote(originalBill),
        manualReturnNote: returnNote,
      });
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

    // Audit log
    await logAudit({
      userId: auth.user.id,
      username: auth.user.username,
      action: "return.create",
      entity: "transaction",
      entityId: txId,
      details: withBehaviorDetails(
        {
          customerId,
          totalRefund,
          itemCount: (items || []).length,
          totalReturnedItemQty,
          totalBagsReversedFromReturnedItems: Math.max(0, -refundBagSummary.bagAdjustDelta),
          totalBagsReinstatedFromBuyBagsRefund: Math.max(0, refundBagSummary.bagAdjustDelta),
          totalBagReturnQty,
          originalBill: originalBill || null,
          originalBillKind,
          printedBillNumber,
          nextBillNumber,
          invoiceCreditReturn: isOriginalInvoiceCreditBill,
          refundAppliedToOutstanding: totalRefund - remainingRefundToApply,
          unappliedRefundCredit: remainingRefundToApply,
          allocationCount: refundAllocations.length,
          allocations: refundAllocations,
        },
        {
          event: "sale.returned",
          source: "backoffice",
          customerId,
          transactionId: txId,
          amount: totalRefund,
          quantity: totalReturnedItemQty,
          reasonCode: returnReasonCode,
          extra: totalBagReturnQty > 0 ? { totalBagReturnQty } : undefined,
        }
      ),
    }, tx);

    for (const allocation of refundAllocations) {
      await logAudit({
        userId: auth.user.id,
        username: auth.user.username,
        action: "transaction.return_apply",
        entity: "transaction",
        entityId: allocation.transactionId,
        details: withBehaviorDetails(
          {
            returnTransactionId: txId,
            originalBill: originalBill || null,
            amount: allocation.appliedAmount,
            previousPaid: allocation.previousPaid,
            newPaid: allocation.newPaid,
            newStatus: allocation.newStatus,
            unappliedRefundCredit: remainingRefundToApply,
          },
          {
            event: "sale.return_applied",
            source: "backoffice",
            customerId,
            transactionId: allocation.transactionId,
            amount: allocation.appliedAmount,
            tags: originalBill && allocation.transactionId === originalBill
              ? ["original_bill"]
              : ["oldest_outstanding"],
          }
        ),
      }, tx);
    }

    const presentation = withBillPresentation({
      id: txId,
      transactionKind: "return",
      printedBillNumber,
      transferRef: null,
    });

    return {
      id: txId,
      totalRefund,
      printedBillNumber,
      billNumber: presentation.billNumber,
      internalReference: presentation.internalReference,
      nextBillNumber,
      analytics: {
        returnTransactionId: txId,
        totalRefund,
        returnedItemQty: totalReturnedItemQty,
        returnedItemLines: (items || []).filter((item) => Math.max(0, item.quantity || 0) > 0)
          .length,
        bagsReversedFromItems: Math.max(0, -refundBagSummary.bagAdjustDelta),
        bagsReturnedManual: totalBagReturnQty,
        refundAppliedToOutstanding: totalRefund - remainingRefundToApply,
        unappliedRefundCredit: remainingRefundToApply,
        originalBillId: originalBill || null,
        originalBillKind,
        invoiceCreditReturn: isOriginalInvoiceCreditBill,
        allocationCount: refundAllocations.length,
        printedBillNumber,
        billNumber: presentation.billNumber,
      },
    };
  });

  const { analytics, ...responsePayload } = result;
  const posthog = getPostHogClient();
  posthog.capture({
    distinctId: buildAuthenticatedDistinctId(auth.user.id),
    event: SALE_RETURN_COMPLETED_EVENT,
    properties: buildSaleReturnCompletedProperties({
      actorUserId: auth.user.id,
      actorRole: auth.user.role,
      factoryKey,
      customerId,
      ...analytics,
    }),
  });

  return NextResponse.json(responsePayload, { status: 201 });
});
