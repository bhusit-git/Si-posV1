import { NextRequest, NextResponse } from "next/server";
import { asc, eq, sql } from "drizzle-orm";
import {
  invoiceLines,
  invoicePaymentAllocations,
  invoicePayments,
  invoices,
  paymentEvents,
  transactions,
} from "@/db/schema";
import { requireOfficeUp } from "@/lib/api-auth";
import {
  claimOrReplay,
  completeClaim,
  readIdempotencyKey,
  stableHash,
} from "@/lib/idempotency";
import { createInternalServerErrorResponse } from "@/lib/api-utils";
import { createRequestId } from "@/lib/error-logging";
import { nowTimeISO, todayISO } from "@/lib/thai-utils";
import { getPostHogClient } from "@/lib/posthog-server";
import { requireFactoryWriteContext } from "@/lib/factory-context";
import { recordPaymentEvent } from "@/lib/payment-events";
import {
  buildAuthenticatedDistinctId,
  buildInvoicePaymentRecordedProperties,
  INVOICE_PAYMENT_RECORDED_EVENT,
} from "@/lib/posthog-events";

type PaymentMethod = "cash" | "bank_transfer" | "cheque" | "other";

function isPaymentMethod(value: unknown): value is PaymentMethod {
  return value === "cash" || value === "bank_transfer" || value === "cheque" || value === "other";
}

function nextTransactionStatus(
  totalAmount: number,
  paid: number
): "paid" | "unpaid" | "partial" {
  if (paid >= totalAmount) return "paid";
  if (paid <= 0) return "unpaid";
  return "partial";
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = createRequestId();
  try {
    const auth = await requireOfficeUp();
    if (auth.error) return auth.error;

    const { id } = await context.params;
    const invoiceId = Number(id);
    if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
      return NextResponse.json({ error: "invalid invoice id" }, { status: 400 });
    }

    const body = await request.json();
    const amount = Number(body?.amount || 0);
    const method = body?.method;
    const note = typeof body?.note === "string" ? body.note.trim() : "";
    const idempotencyKey = readIdempotencyKey(request, body);
    const requestHash = idempotencyKey
      ? stableHash({
          invoiceId,
          amount,
          method,
          note,
          actorId: auth.user.id,
        })
      : null;
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "amount must be > 0" }, { status: 400 });
    }
    if (!isPaymentMethod(method)) {
      return NextResponse.json({ error: "invalid payment method" }, { status: 400 });
    }

    const factoryContext = requireFactoryWriteContext(request, auth.user);
    if ("error" in factoryContext) return factoryContext.error;
    const { db, factoryKey } = factoryContext;
    const now = new Date();
    const eventDate = todayISO();
    const eventTime = nowTimeISO();

    const result = await db.transaction(async (tx) => {
      let claimId: number | null = null;
      if (idempotencyKey && requestHash) {
        const claim = await claimOrReplay(tx, {
          scope: "invoice.pay",
          key: idempotencyKey,
          requestHash,
          createdBy: auth.user.id,
        });
        if (claim.kind === "conflict") {
          return { error: "idempotency_key_conflict", status: 409 as const };
        }
        if (claim.kind === "replay") {
          if (!claim.invoiceId || !claim.invoicePaymentId) {
            return { error: "idempotency_key_incomplete", status: 409 as const };
          }
          const [replayPayment] = await tx
            .select({
              id: invoicePayments.id,
              paidAt: invoicePayments.paidAt,
              amount: invoicePayments.amount,
              method: invoicePayments.method,
            })
            .from(invoicePayments)
            .where(eq(invoicePayments.id, claim.invoicePaymentId))
            .limit(1);
          const [allocationStats] = await tx
            .select({
              total: sql<number>`COUNT(*)::int`,
            })
            .from(invoicePaymentAllocations)
            .where(eq(invoicePaymentAllocations.invoicePaymentId, claim.invoicePaymentId))
            .limit(1);
          const [unallocatedStats] = await tx
            .select({
              total: sql<number>`COALESCE(SUM(CASE WHEN ${paymentEvents.transactionId} IS NULL THEN ${paymentEvents.amount} ELSE 0 END), 0)`,
            })
            .from(paymentEvents)
            .where(eq(paymentEvents.invoicePaymentId, claim.invoicePaymentId))
            .limit(1);
          const [replayInvoice] = await tx
            .select({
              id: invoices.id,
              status: invoices.status,
              paidTotal: invoices.paidTotal,
              outstandingTotal: invoices.outstandingTotal,
            })
            .from(invoices)
            .where(eq(invoices.id, claim.invoiceId))
            .limit(1);
          if (!replayPayment || !replayInvoice) {
            return { error: "idempotency_key_incomplete", status: 409 as const };
          }
          return {
            replay: {
              paymentId: replayPayment.id,
              paidAt: replayPayment.paidAt,
              amount: Number(replayPayment.amount || 0),
              method: replayPayment.method,
              invoice: replayInvoice,
              analytics: {
                allocationCount: Number(allocationStats?.total || 0),
                unallocatedAmount: Number(unallocatedStats?.total || 0),
              },
              idempotentReplay: true,
              idempotencyKey,
            },
          };
        }
        claimId = claim.claimId;
      }

      const [invoice] = await tx
        .select({
          id: invoices.id,
          status: invoices.status,
          grandTotal: invoices.grandTotal,
          paidTotal: invoices.paidTotal,
          outstandingTotal: invoices.outstandingTotal,
        })
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .limit(1)
        .for("update", { of: invoices });

      if (!invoice) {
        return { error: "ไม่พบใบวางบิล", status: 404 as const };
      }
      if (invoice.status === "void") {
        return { error: "ไม่สามารถชำระใบวางบิลที่ void ได้", status: 400 as const };
      }
      if (invoice.status === "draft") {
        return { error: "กรุณาออกใบวางบิลก่อนรับชำระ", status: 400 as const };
      }

      const outstanding = Number(invoice.outstandingTotal || 0);
      if (amount > outstanding + 0.000001) {
        return { error: "จำนวนรับชำระเกินยอดคงค้าง", status: 400 as const };
      }

      const [payment] = await tx
        .insert(invoicePayments)
        .values({
          invoiceId,
          paidAt: now,
          amount,
          method,
          note: note || null,
          createdBy: auth.user.id,
          createdAt: now,
        })
        .returning({
          id: invoicePayments.id,
          paidAt: invoicePayments.paidAt,
        });

      const lineRows = await tx
        .select({
          lineId: invoiceLines.id,
          transactionId: invoiceLines.transactionId,
          saleDate: invoiceLines.saleDate,
          saleTime: invoiceLines.saleTime,
          txTotalAmount: transactions.totalAmount,
          txPaid: transactions.paid,
          txKind: transactions.transactionKind,
          txStatus: transactions.status,
        })
        .from(invoiceLines)
        .innerJoin(transactions, eq(invoiceLines.transactionId, transactions.id))
        .where(eq(invoiceLines.invoiceId, invoiceId))
        .orderBy(asc(invoiceLines.saleDate), asc(invoiceLines.saleTime), asc(invoiceLines.id))
        .for("update", { of: transactions });

      let remaining = amount;
      let allocationCount = 0;
      for (const row of lineRows) {
        if (remaining <= 0) break;
        if (row.txStatus === "voided") continue;
        if (row.txKind === "transfer_out") continue;

        const currentPaid = Number(row.txPaid || 0);
        const txOutstanding = Math.max(0, Number(row.txTotalAmount || 0) - currentPaid);
        if (txOutstanding <= 0) continue;

        const allocatedAmount = Math.min(remaining, txOutstanding);
        const newPaid = currentPaid + allocatedAmount;
        const newStatus = nextTransactionStatus(Number(row.txTotalAmount || 0), newPaid);

        await tx.insert(invoicePaymentAllocations).values({
          invoicePaymentId: payment.id,
          invoiceLineId: row.lineId,
          transactionId: row.transactionId,
          allocatedAmount,
          createdAt: now,
        });
        allocationCount += 1;

        await tx
          .update(transactions)
          .set({
            paid: newPaid,
            outstandingAmount: Math.max(0, Number(row.txTotalAmount || 0) - newPaid),
            status: newStatus,
          })
          .where(eq(transactions.id, row.transactionId));

        await recordPaymentEvent(tx, {
          transactionId: row.transactionId,
          invoiceId,
          invoicePaymentId: payment.id,
          eventDate,
          eventTime,
          amount: allocatedAmount,
          method,
          note: note || null,
          createdBy: auth.user.id,
          createdAt: now,
        });

        remaining -= allocatedAmount;
      }

      if (remaining > 0) {
        await recordPaymentEvent(tx, {
          transactionId: null,
          invoiceId,
          invoicePaymentId: payment.id,
          eventDate,
          eventTime,
          amount: remaining,
          method,
          note: note ? `${note} (unallocated)` : "unallocated",
          createdBy: auth.user.id,
          createdAt: now,
        });
      }

      const newPaidTotal = Number(invoice.paidTotal || 0) + amount;
      const newOutstanding = Math.max(0, Number(invoice.grandTotal || 0) - newPaidTotal);
      const newStatus = newOutstanding <= 0 ? "paid" : "issued";

      const [updatedInvoice] = await tx
        .update(invoices)
        .set({
          paidTotal: newPaidTotal,
          outstandingTotal: newOutstanding,
          status: newStatus,
          updatedAt: now,
        })
        .where(eq(invoices.id, invoiceId))
        .returning({
          id: invoices.id,
          status: invoices.status,
          paidTotal: invoices.paidTotal,
          outstandingTotal: invoices.outstandingTotal,
        });

      if (claimId) {
        await completeClaim(tx, claimId, {
          invoiceId,
          invoicePaymentId: payment.id,
        });
      }

      return {
        paymentId: payment.id,
        paidAt: payment.paidAt,
        invoice: updatedInvoice,
        analytics: {
          allocationCount,
          unallocatedAmount: Math.max(0, remaining),
        },
      };
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const replayResult = "replay" in result ? result.replay : null;
    if (replayResult) {
      const posthog = getPostHogClient();
      posthog.capture({
        distinctId: buildAuthenticatedDistinctId(auth.user.id),
        event: INVOICE_PAYMENT_RECORDED_EVENT,
        properties: buildInvoicePaymentRecordedProperties({
          actorUserId: auth.user.id,
          actorRole: auth.user.role,
          factoryKey,
          invoiceId,
          paymentId: replayResult.paymentId,
          amount: Number(replayResult.amount || amount),
          method:
            typeof replayResult.method === "string" && replayResult.method.length > 0
              ? replayResult.method
              : method,
          paidTotalAfter: Number(replayResult.invoice.paidTotal || 0),
          outstandingAfter: Number(replayResult.invoice.outstandingTotal || 0),
          invoiceStatusAfter: replayResult.invoice.status,
          allocationCount: Number(replayResult.analytics?.allocationCount || 0),
          unallocatedAmount: Number(replayResult.analytics?.unallocatedAmount || 0),
          idempotentReplay: true,
        }),
      });
      return NextResponse.json(replayResult);
    }

    const paymentResult = "paymentId" in result ? result : null;
    if (
      !paymentResult ||
      paymentResult.paymentId == null ||
      !paymentResult.invoice ||
      !paymentResult.analytics
    ) {
      return NextResponse.json({ error: "ไม่สามารถบันทึกการชำระเงินได้" }, { status: 409 });
    }

    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: buildAuthenticatedDistinctId(auth.user.id),
      event: INVOICE_PAYMENT_RECORDED_EVENT,
      properties: buildInvoicePaymentRecordedProperties({
        actorUserId: auth.user.id,
        actorRole: auth.user.role,
        factoryKey,
        invoiceId,
        paymentId: paymentResult.paymentId,
        amount,
        method,
        paidTotalAfter: Number(paymentResult.invoice.paidTotal || 0),
        outstandingAfter: Number(paymentResult.invoice.outstandingTotal || 0),
        invoiceStatusAfter: paymentResult.invoice.status,
        allocationCount: paymentResult.analytics.allocationCount,
        unallocatedAmount: paymentResult.analytics.unallocatedAmount,
        idempotentReplay: false,
      }),
    });

    return NextResponse.json({
      paymentId: paymentResult.paymentId,
      paidAt: paymentResult.paidAt,
      invoice: paymentResult.invoice,
    });
  } catch (error) {
    return createInternalServerErrorResponse({
      request,
      error,
      requestId,
      source: "invoices.pay",
      operation: "POST /api/invoices/[id]/pay",
      context: { route: "POST /api/invoices/[id]/pay" },
    });
  }
}
