import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  invoicePaymentAllocations,
  invoicePayments,
  invoices,
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
  buildInvoiceVoidedProperties,
  INVOICE_VOIDED_EVENT,
} from "@/lib/posthog-events";

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

    const body = await request.json().catch(() => ({}));
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    const idempotencyKey = readIdempotencyKey(request, body);
    const requestHash = idempotencyKey
      ? stableHash({
          invoiceId,
          reason,
          actorId: auth.user.id,
        })
      : null;
    if (!reason) {
      return NextResponse.json({ error: "void reason is required" }, { status: 400 });
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
          scope: "invoice.void",
          key: idempotencyKey,
          requestHash,
          createdBy: auth.user.id,
        });
        if (claim.kind === "conflict") {
          return { error: "idempotency_key_conflict", status: 409 as const };
        }
        if (claim.kind === "replay") {
          if (!claim.invoiceId) {
            return { error: "idempotency_key_incomplete", status: 409 as const };
          }
          const [replayInvoice] = await tx
            .select({
              id: invoices.id,
              status: invoices.status,
              voidReason: invoices.voidReason,
              paidTotal: invoices.paidTotal,
              outstandingTotal: invoices.outstandingTotal,
            })
            .from(invoices)
            .where(eq(invoices.id, claim.invoiceId))
            .limit(1);
          const [reversalPaymentStats] = await tx
            .select({
              total: sql<number>`COUNT(*)::int`,
              paidTotalBeforeReversal: sql<number>`COALESCE(SUM(CASE WHEN ${invoicePayments.amount} < 0 THEN -${invoicePayments.amount} ELSE 0 END), 0)`,
            })
            .from(invoicePayments)
            .where(
              and(
                eq(invoicePayments.invoiceId, claim.invoiceId),
                sql`${invoicePayments.amount} < 0`
              )
            )
            .limit(1);
          const [allocationStats] = await tx
            .select({
              total: sql<number>`COUNT(*)::int`,
            })
            .from(invoicePaymentAllocations)
            .innerJoin(
              invoicePayments,
              eq(invoicePaymentAllocations.invoicePaymentId, invoicePayments.id)
            )
            .where(
              and(
                eq(invoicePayments.invoiceId, claim.invoiceId),
                sql`${invoicePaymentAllocations.allocatedAmount} < 0`
              )
            )
            .limit(1);
          if (!replayInvoice) {
            return { error: "idempotency_key_incomplete", status: 409 as const };
          }
          return {
            replay: {
              ...replayInvoice,
              analytics: {
                paidTotalBeforeReversal: Number(
                  reversalPaymentStats?.paidTotalBeforeReversal || 0
                ),
                reversalPaymentCount: Number(reversalPaymentStats?.total || 0),
                allocationReversalCount: Number(allocationStats?.total || 0),
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
          paidTotal: invoices.paidTotal,
        })
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .limit(1);

      if (!invoice || invoice.status === "void") {
        return { error: "ไม่พบใบวางบิลหรือใบวางบิลถูก void แล้ว", status: 404 as const };
      }

      const originalPayments = await tx
        .select({
          id: invoicePayments.id,
          amount: invoicePayments.amount,
          method: invoicePayments.method,
          paidAt: invoicePayments.paidAt,
          note: invoicePayments.note,
        })
        .from(invoicePayments)
        .where(eq(invoicePayments.invoiceId, invoiceId))
        .orderBy(asc(invoicePayments.id));
      let reversalPaymentCount = 0;
      let allocationReversalCount = 0;

      for (const payment of originalPayments) {
        const paymentAmount = Number(payment.amount || 0);
        if (paymentAmount <= 0) continue;

        const reversalNote = `void reversal of payment #${payment.id}: ${reason}`;
        const [reversalPayment] = await tx
          .insert(invoicePayments)
          .values({
            invoiceId,
            paidAt: now,
            amount: -paymentAmount,
            method: payment.method,
            note: reversalNote,
            createdBy: auth.user.id,
            createdAt: now,
          })
          .returning({
            id: invoicePayments.id,
          });
        reversalPaymentCount += 1;

        const allocations = await tx
          .select({
            id: invoicePaymentAllocations.id,
            invoiceLineId: invoicePaymentAllocations.invoiceLineId,
            transactionId: invoicePaymentAllocations.transactionId,
            allocatedAmount: invoicePaymentAllocations.allocatedAmount,
          })
          .from(invoicePaymentAllocations)
          .where(eq(invoicePaymentAllocations.invoicePaymentId, payment.id))
          .orderBy(asc(invoicePaymentAllocations.id));

        let allocatedTotal = 0;
        for (const allocation of allocations) {
          const allocatedAmount = Number(allocation.allocatedAmount || 0);
          if (allocatedAmount <= 0) continue;
          allocatedTotal += allocatedAmount;

          await tx.insert(invoicePaymentAllocations).values({
            invoicePaymentId: reversalPayment.id,
            invoiceLineId: allocation.invoiceLineId,
            transactionId: allocation.transactionId,
            allocatedAmount: -allocatedAmount,
            createdAt: now,
          });
          allocationReversalCount += 1;

          const [txRow] = await tx
            .select({
              id: transactions.id,
              totalAmount: transactions.totalAmount,
              paid: transactions.paid,
            })
            .from(transactions)
            .where(eq(transactions.id, allocation.transactionId))
            .limit(1);

          if (txRow) {
            const currentPaid = Number(txRow.paid || 0);
            const newPaid = Math.max(0, currentPaid - allocatedAmount);
            const totalAmount = Number(txRow.totalAmount || 0);
            await tx
              .update(transactions)
              .set({
                paid: newPaid,
                outstandingAmount: Math.max(0, totalAmount - newPaid),
                status: nextTransactionStatus(totalAmount, newPaid),
              })
              .where(eq(transactions.id, txRow.id));
          }

          await recordPaymentEvent(tx, {
            transactionId: allocation.transactionId,
            invoiceId,
            invoicePaymentId: reversalPayment.id,
            eventDate,
            eventTime,
            amount: -allocatedAmount,
            method: payment.method,
            note: reversalNote,
            createdBy: auth.user.id,
            createdAt: now,
          });
        }

        const unallocated = paymentAmount - allocatedTotal;
        if (unallocated > 0) {
          await recordPaymentEvent(tx, {
            transactionId: null,
            invoiceId,
            invoicePaymentId: reversalPayment.id,
            eventDate,
            eventTime,
            amount: -unallocated,
            method: payment.method,
            note: `${reversalNote} (unallocated)`,
            createdBy: auth.user.id,
            createdAt: now,
          });
        }
      }

      const [updated] = await tx
        .update(invoices)
        .set({
          status: "void",
          voidReason: reason,
          voidedBy: auth.user.id,
          paidTotal: 0,
          outstandingTotal: 0,
          updatedAt: now,
        })
        .where(eq(invoices.id, invoiceId))
        .returning({
          id: invoices.id,
          status: invoices.status,
          voidReason: invoices.voidReason,
          paidTotal: invoices.paidTotal,
          outstandingTotal: invoices.outstandingTotal,
        });

      if (claimId) {
        await completeClaim(tx, claimId, { invoiceId: updated.id });
      }

      return {
        updated,
        analytics: {
          paidTotalBeforeReversal: Number(invoice.paidTotal || 0),
          reversalPaymentCount,
          allocationReversalCount,
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
        event: INVOICE_VOIDED_EVENT,
        properties: buildInvoiceVoidedProperties({
          actorUserId: auth.user.id,
          actorRole: auth.user.role,
          factoryKey,
          invoiceId,
          paidTotalBeforeReversal: Number(
            replayResult.analytics?.paidTotalBeforeReversal || 0
          ),
          reversalPaymentCount: Number(replayResult.analytics?.reversalPaymentCount || 0),
          allocationReversalCount: Number(
            replayResult.analytics?.allocationReversalCount || 0
          ),
          idempotentReplay: true,
        }),
      });
      return NextResponse.json(replayResult);
    }

    const updatedResult = "updated" in result ? result.updated : null;
    const analyticsResult = "analytics" in result ? result.analytics : null;
    if (!updatedResult || !analyticsResult) {
      return NextResponse.json({ error: "ไม่สามารถยกเลิกใบวางบิลได้" }, { status: 409 });
    }

    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: buildAuthenticatedDistinctId(auth.user.id),
      event: INVOICE_VOIDED_EVENT,
      properties: buildInvoiceVoidedProperties({
        actorUserId: auth.user.id,
        actorRole: auth.user.role,
        factoryKey,
        invoiceId,
        paidTotalBeforeReversal: Number(analyticsResult.paidTotalBeforeReversal || 0),
        reversalPaymentCount: analyticsResult.reversalPaymentCount,
        allocationReversalCount: analyticsResult.allocationReversalCount,
        idempotentReplay: false,
      }),
    });

    return NextResponse.json(updatedResult);
  } catch (error) {
    return createInternalServerErrorResponse({
      request,
      error,
      requestId,
      source: "invoices.void",
      operation: "POST /api/invoices/[id]/void",
      context: { route: "POST /api/invoices/[id]/void" },
    });
  }
}
