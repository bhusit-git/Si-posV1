import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { getDb, getMainDb } from "@/db";
import { invoices, users } from "@/db/schema";
import { requireOfficeUp } from "@/lib/api-auth";
import { createInternalServerErrorResponse } from "@/lib/api-utils";
import { createRequestId } from "@/lib/error-logging";
import { computeInvoiceDisplayStatus } from "@/lib/invoice-utils";
import { getBagDisplayQuantities, summarizeBagLedgerEntries } from "@/lib/bag-flow";

export async function GET(
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

    const db = await getDb();
    const invoice = await db.query.invoices.findFirst({
      where: eq(invoices.id, invoiceId),
      with: {
        customer: true,
        lines: {
          with: {
            transaction: {
              with: {
                items: { with: { productType: true } },
                bagLedgerEntries: true,
              },
            },
          },
        },
        payments: true,
      },
    });

    if (!invoice) {
      return NextResponse.json({ error: "ไม่พบใบวางบิล" }, { status: 404 });
    }

    const customerRecord =
      invoice.customer && !Array.isArray(invoice.customer)
        ? {
            id: Number(invoice.customer.id),
            name: String(invoice.customer.name || ""),
            phone:
              invoice.customer.phone == null
                ? null
                : String(invoice.customer.phone),
          }
        : null;

    const sortedPayments = [...invoice.payments].sort((a, b) => {
      return new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime();
    });

    const paidAt =
      invoice.outstandingTotal <= 0 && sortedPayments.length > 0
        ? sortedPayments[sortedPayments.length - 1].paidAt
        : null;

    const displayStatus = computeInvoiceDisplayStatus(
      invoice.status,
      Number(invoice.paidTotal || 0),
      Number(invoice.outstandingTotal || 0)
    );

    const timeline: Array<{
      event: string;
      at: string;
      userId: number | null;
      detail?: string | null;
    }> = [];

    timeline.push({
      event: "generated",
      at: invoice.createdAt.toISOString(),
      userId: invoice.createdBy || null,
    });

    if (invoice.issueDate) {
      timeline.push({
        event: "sent",
        at: `${invoice.issueDate}T00:00:00.000Z`,
        userId: invoice.issuedBy || null,
      });
    }

    for (const payment of sortedPayments) {
      timeline.push({
        event: "payment",
        at: payment.paidAt.toISOString(),
        userId: payment.createdBy || null,
        detail: payment.note || null,
      });
    }

    if (invoice.status === "void") {
      timeline.push({
        event: "void",
        at: invoice.updatedAt.toISOString(),
        userId: invoice.voidedBy || null,
        detail: invoice.voidReason || null,
      });
    }

    const sortedTimeline = timeline.sort((a, b) => a.at.localeCompare(b.at));
    const userIds = Array.from(
      new Set(
        sortedTimeline
          .map((entry) => entry.userId)
          .filter((id): id is number => typeof id === "number" && Number.isInteger(id))
      )
    );
    const usernameById = new Map<number, string>();
    if (userIds.length > 0) {
      const mainDb = getMainDb();
      const userRows = await mainDb
        .select({
          id: users.id,
          username: users.username,
        })
        .from(users)
        .where(sql`${users.id} IN (${sql.join(userIds.map((uid) => sql`${uid}`), sql`, `)})`);
      for (const row of userRows) {
        usernameById.set(row.id, row.username);
      }
    }

    return NextResponse.json({
      invoice: {
        id: invoice.id,
        invoiceNo: invoice.invoiceNo,
        status: invoice.status,
        displayStatus,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
        vatEnabled: invoice.vatEnabled,
        vatRate: invoice.vatRate,
        subtotal: invoice.subtotal,
        vatAmount: invoice.vatAmount,
        grandTotal: invoice.grandTotal,
        paidTotal: invoice.paidTotal,
        outstandingTotal: invoice.outstandingTotal,
        notes: invoice.notes,
        voidReason: invoice.voidReason,
        generatedAt: invoice.createdAt,
        sentAt: invoice.issueDate,
        paidAt,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
      },
      customer: customerRecord,
      lines: invoice.lines.map((line) => {
        const bagSummary = summarizeBagLedgerEntries(
          line.transaction?.bagLedgerEntries ?? []
        );
        const bagDisplay = getBagDisplayQuantities(bagSummary);

        return {
          id: line.id,
          transactionId: line.transactionId,
          lineType: line.lineType,
          saleDate: line.saleDate,
          saleTime: line.saleTime,
          amount: line.amount,
          snapshot: line.snapshotJson,
          transactionStatus: line.transaction?.status || null,
          bagsOut: bagDisplay.bagsOut,
          bagsReturned: bagDisplay.bagsReturned,
          bagsBought: bagSummary.bagsBought,
          bagAdjustDelta: bagSummary.bagAdjustDelta,
        };
      }),
      payments: sortedPayments.map((payment) => ({
        id: payment.id,
        paidAt: payment.paidAt,
        amount: payment.amount,
        method: payment.method,
        note: payment.note,
        createdBy: payment.createdBy,
      })),
      timeline: sortedTimeline.map((entry) => ({
        ...entry,
        userName:
          typeof entry.userId === "number"
            ? usernameById.get(entry.userId) || null
            : null,
        isCurrentUser:
          typeof entry.userId === "number" ? entry.userId === auth.user.id : false,
      })),
    });
  } catch (error) {
    return createInternalServerErrorResponse({
      request,
      error,
      requestId,
      source: "invoices.detail",
      operation: "GET /api/invoices/[id]",
      context: { route: "GET /api/invoices/[id]" },
    });
  }
}
