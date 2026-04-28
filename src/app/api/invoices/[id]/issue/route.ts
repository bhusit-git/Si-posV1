import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne, sql } from "drizzle-orm";
import { invoiceLines, invoices } from "@/db/schema";
import { requireOfficeUp } from "@/lib/api-auth";
import {
  claimOrReplay,
  completeClaim,
  readIdempotencyKey,
  stableHash,
} from "@/lib/idempotency";
import { createInternalServerErrorResponse } from "@/lib/api-utils";
import { createRequestId } from "@/lib/error-logging";
import { getInvoiceStartSeq } from "@/lib/invoice-issue";
import { todayISO } from "@/lib/thai-utils";
import { getPostHogClient } from "@/lib/posthog-server";
import { requireFactoryWriteContext } from "@/lib/factory-context";
import {
  buildAuthenticatedDistinctId,
  buildInvoiceIssuedProperties,
  INVOICE_ISSUED_EVENT,
} from "@/lib/posthog-events";
import { allowDuplicateInvoiceIssueOverride } from "@/lib/config/invoice-duplicates";

function addDaysISO(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatInvoiceNo(factoryKey: string, year: number, seq: number): string {
  return `INV-${factoryKey.toUpperCase()}-${year}-${String(seq).padStart(5, "0")}`;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
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
    const dueDateInput = typeof body?.dueDate === "string" ? body.dueDate : null;
    const allowDuplicateActiveInvoice =
      allowDuplicateInvoiceIssueOverride() &&
      body?.allowDuplicateActiveInvoice === true;
    const idempotencyKey = readIdempotencyKey(request, body);
    const requestHash = idempotencyKey
      ? stableHash({
          invoiceId,
          dueDateInput,
          allowDuplicateActiveInvoice,
          actorId: auth.user.id,
        })
      : null;

    const issueDate = todayISO();
    if (dueDateInput && !isIsoDate(dueDateInput)) {
      return NextResponse.json({ error: "invalid dueDate format" }, { status: 400 });
    }
    if (dueDateInput && dueDateInput < issueDate) {
      return NextResponse.json({ error: "dueDate must be on or after issueDate" }, { status: 400 });
    }
    const dueDate = dueDateInput || addDaysISO(issueDate, 7);
    const year = Number(issueDate.slice(0, 4));
    const factoryContext = requireFactoryWriteContext(request, auth.user);
    if ("error" in factoryContext) return factoryContext.error;
    const { db, factoryKey } = factoryContext;
    const initialSeq = getInvoiceStartSeq(factoryKey, year);
    const initialNextNumber = initialSeq + 1;

    const result = await db.transaction(async (tx) => {
      let claimId: number | null = null;
      if (idempotencyKey && requestHash) {
        const claim = await claimOrReplay(tx, {
          scope: "invoice.issue",
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
          const [existingReplay] = await tx
            .select({
              id: invoices.id,
              invoiceNo: invoices.invoiceNo,
              status: invoices.status,
              issueDate: invoices.issueDate,
              dueDate: invoices.dueDate,
            })
            .from(invoices)
            .where(eq(invoices.id, claim.invoiceId))
            .limit(1);
          if (!existingReplay) {
            return { error: "idempotency_key_incomplete", status: 409 as const };
          }
          return {
            replay: {
              ...existingReplay,
              idempotentReplay: true,
              idempotencyKey,
            },
          };
        }
        claimId = claim.claimId;
      }

      const [existing] = await tx
        .select({
          id: invoices.id,
          status: invoices.status,
          invoiceNo: invoices.invoiceNo,
        })
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .limit(1);

      if (!existing) {
        return { error: "ไม่พบใบวางบิล", status: 404 as const };
      }
      if (existing.status !== "draft") {
        return { error: "ออกใบวางบิลได้เฉพาะสถานะ draft", status: 400 as const };
      }

      const lineRows = await tx
        .select({
          transactionId: invoiceLines.transactionId,
        })
        .from(invoiceLines)
        .where(eq(invoiceLines.invoiceId, invoiceId));

      if (lineRows.length > 0) {
        const selectedIdsSql = sql.join(
          lineRows.map((row) => sql`${row.transactionId}`),
          sql`, `
        );
        const conflicts = await tx
          .select({
            transactionId: invoiceLines.transactionId,
            invoiceId: invoiceLines.invoiceId,
            invoiceStatus: invoices.status,
            invoiceNo: invoices.invoiceNo,
          })
          .from(invoiceLines)
          .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
          .where(
            and(
              sql`${invoiceLines.transactionId} IN (${selectedIdsSql})`,
              ne(invoiceLines.invoiceId, invoiceId),
              ne(invoices.status, "draft"),
              ne(invoices.status, "void")
            )
          );

        if (conflicts.length > 0 && !allowDuplicateActiveInvoice) {
          return {
            error: "Some transactions already exist in an active invoice",
            status: 409 as const,
            conflicts,
          };
        }
      }

      const counterRows = await tx.execute(
        sql`
          INSERT INTO invoice_counters (factory_key, year, next_number, updated_at, created_at)
          VALUES (${factoryKey}, ${year}, ${initialNextNumber}, NOW(), NOW())
          ON CONFLICT (factory_key, year)
          DO UPDATE SET
            next_number = CASE
              WHEN invoice_counters.next_number < ${initialNextNumber}
                THEN ${initialNextNumber}
              ELSE invoice_counters.next_number + 1
            END,
            updated_at = NOW()
          RETURNING next_number - 1 AS seq
        `
      );

      const seq = Number(
        (counterRows as unknown as Array<{ seq: number }>)[0]?.seq || initialSeq
      );
      const invoiceNo = formatInvoiceNo(factoryKey, year, seq);
      const [updated] = await tx
        .update(invoices)
        .set({
          status: "issued",
          invoiceNo,
          issueDate,
          dueDate,
          issuedBy: auth.user.id,
          updatedAt: new Date(),
        })
        .where(and(eq(invoices.id, invoiceId), eq(invoices.status, "draft")))
        .returning({
          id: invoices.id,
          invoiceNo: invoices.invoiceNo,
          status: invoices.status,
          issueDate: invoices.issueDate,
          dueDate: invoices.dueDate,
        });

      if (!updated) {
        return { error: "ไม่สามารถออกใบวางบิลได้", status: 409 as const };
      }

      if (claimId) {
        await completeClaim(tx, claimId, { invoiceId: updated.id });
      }

      return { updated, idempotentReplay: false };
    });

    if ("error" in result) {
      return NextResponse.json(
        {
          error: result.error,
          ...("conflicts" in result ? { conflicts: result.conflicts } : {}),
        },
        { status: result.status }
      );
    }
    const replayResult = "replay" in result ? result.replay : null;
    if (replayResult) {
      const posthog = getPostHogClient();
      posthog.capture({
        distinctId: buildAuthenticatedDistinctId(auth.user.id),
        event: INVOICE_ISSUED_EVENT,
        properties: buildInvoiceIssuedProperties({
          actorUserId: auth.user.id,
          actorRole: auth.user.role,
          factoryKey,
          invoiceId: replayResult.id,
          invoiceNo: replayResult.invoiceNo,
          issueDate: replayResult.issueDate,
          dueDate: replayResult.dueDate,
          idempotentReplay: true,
        }),
      });
      return NextResponse.json(replayResult);
    }

    const updatedResult = "updated" in result ? result.updated : null;
    if (!updatedResult) {
      return NextResponse.json({ error: "ไม่สามารถออกใบวางบิลได้" }, { status: 409 });
    }

    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: buildAuthenticatedDistinctId(auth.user.id),
      event: INVOICE_ISSUED_EVENT,
      properties: buildInvoiceIssuedProperties({
        actorUserId: auth.user.id,
        actorRole: auth.user.role,
        factoryKey,
        invoiceId: updatedResult.id,
        invoiceNo: updatedResult.invoiceNo,
        issueDate: updatedResult.issueDate,
        dueDate: updatedResult.dueDate,
        idempotentReplay: false,
      }),
    });

    return NextResponse.json(updatedResult);
  } catch (error) {
    return createInternalServerErrorResponse({
      request,
      error,
      requestId,
      source: "invoices.issue",
      operation: "POST /api/invoices/[id]/issue",
      context: { route: "POST /api/invoices/[id]/issue" },
    });
  }
}
