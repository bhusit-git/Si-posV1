import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  bagLedger,
  customers,
  invoiceLines,
  invoices,
  productTypes,
  transactionItems,
  transactions,
} from "@/db/schema";
import { requireOfficeUp } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";
import {
  buildItemizedPreview,
  computeInvoiceDisplayStatus,
  inferBillKind,
  inferInvoiceLineType,
  parseIncludeKinds,
} from "@/lib/invoice-utils";
import { parseCustomerQuery } from "@/lib/filter-utils";
import {
  claimOrReplay,
  completeClaim,
  readIdempotencyKey,
  stableHash,
} from "@/lib/idempotency";
import { getPostHogClient } from "@/lib/posthog-server";
import { requireFactoryWriteContext } from "@/lib/factory-context";
import {
  buildAuthenticatedDistinctId,
  buildInvoiceDraftCreatedProperties,
  INVOICE_DRAFT_CREATED_EVENT,
} from "@/lib/posthog-events";
import { allowDuplicateDraftInvoices } from "@/lib/config/invoice-duplicates";

const FIXED_VAT_RATE = 0.07;

function parseSelectedTransactionIds(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const ids = input
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && Number.isInteger(v) && v > 0);
  return Array.from(new Set(ids));
}

function parseBoundedInt(
  raw: string | null,
  options: { defaultValue: number; min: number; max: number }
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return options.defaultValue;
  const rounded = Math.trunc(parsed);
  if (rounded < options.min) return options.min;
  if (rounded > options.max) return options.max;
  return rounded;
}

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  const auth = await requireOfficeUp();
  if (auth.error) return auth.error;

  const customerId = Number(request.nextUrl.searchParams.get("customerId") || 0);
  const q = (
    request.nextUrl.searchParams.get("q") ||
    request.nextUrl.searchParams.get("customerQuery") ||
    ""
  ).trim();
  const status = request.nextUrl.searchParams.get("status");
  const dateFrom = (request.nextUrl.searchParams.get("dateFrom") || "").trim();
  const dateTo = (request.nextUrl.searchParams.get("dateTo") || "").trim();
  const limit = parseBoundedInt(request.nextUrl.searchParams.get("limit"), {
    defaultValue: 50,
    min: 1,
    max: 200,
  });
  const offset = parseBoundedInt(request.nextUrl.searchParams.get("offset"), {
    defaultValue: 0,
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
  });

  const conditions = [];
  if (customerId > 0) conditions.push(eq(invoices.customerId, customerId));
  if (q) {
    const pattern = `%${q}%`;
    const parsedCustomer = parseCustomerQuery(q);
    const customerIdCondition =
      parsedCustomer.customerIds.length > 0
        ? sql`${invoices.customerId} IN (${sql.join(
            parsedCustomer.customerIds.map((id) => sql`${id}`),
            sql`, `
          )})`
        : sql`FALSE`;
    conditions.push(
      sql`(${invoices.invoiceNo} ILIKE ${pattern} OR ${customers.name} ILIKE ${pattern} OR ${customerIdCondition})`
    );
  }
  if (status === "draft" || status === "issued" || status === "paid" || status === "void") {
    conditions.push(eq(invoices.status, status));
  } else if (status === "partially_paid") {
    conditions.push(
      and(
        eq(invoices.status, "issued"),
        sql`${invoices.paidTotal} > 0`,
        sql`${invoices.outstandingTotal} > 0`
      )
    );
  }
  if (dateFrom && dateTo) {
    conditions.push(
      and(
        lte(invoices.periodStart, dateTo),
        gte(invoices.periodEnd, dateFrom)
      )
    );
  } else if (dateFrom) {
    conditions.push(gte(invoices.periodEnd, dateFrom));
  } else if (dateTo) {
    conditions.push(lte(invoices.periodStart, dateTo));
  }

  const db = await getDb();
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, countRows] = await Promise.all([
    db
      .select({
        id: invoices.id,
        invoiceNo: invoices.invoiceNo,
        customerId: invoices.customerId,
        customerName: customers.name,
        periodStart: invoices.periodStart,
        periodEnd: invoices.periodEnd,
        status: invoices.status,
        grandTotal: invoices.grandTotal,
        paidTotal: invoices.paidTotal,
        outstandingTotal: invoices.outstandingTotal,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        createdAt: invoices.createdAt,
        updatedAt: invoices.updatedAt,
      })
      .from(invoices)
      .innerJoin(customers, eq(invoices.customerId, customers.id))
      .where(whereClause)
      .orderBy(sql`${invoices.createdAt} DESC`)
      .limit(limit)
      .offset(offset),
    db
      .select({
        total: sql<number>`COUNT(*)::int`,
      })
      .from(invoices)
      .innerJoin(customers, eq(invoices.customerId, customers.id))
      .where(whereClause),
  ]);

  const total = Number(countRows[0]?.total || 0);
  const enrichedRows = rows.map((row) => ({
    ...row,
    displayStatus: computeInvoiceDisplayStatus(
      row.status,
      Number(row.paidTotal || 0),
      Number(row.outstandingTotal || 0)
    ),
  }));

  return NextResponse.json({
    rows: enrichedRows,
    meta: {
      total,
      limit,
      offset,
      hasMore: offset + enrichedRows.length < total,
    },
  });
});

export const POST = withErrorHandler(async function POST(request: NextRequest) {
  const auth = await requireOfficeUp();
  if (auth.error) return auth.error;
  const body = await request.json().catch(() => ({}));

  const customerId = Number(body?.customerId || 0);
  const periodStart = `${body?.periodStart || ""}`;
  const periodEnd = `${body?.periodEnd || ""}`;
  const includeKinds = parseIncludeKinds(
    Array.isArray(body?.includeKinds)
      ? body.includeKinds.join(",")
      : typeof body?.includeKinds === "string"
        ? body.includeKinds
        : null
  );
  const selectedTransactionIds = parseSelectedTransactionIds(body?.selectedTransactionIds);
  const vatEnabled = Boolean(body?.vatEnabled);
  const vatRate = FIXED_VAT_RATE;
  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
  const idempotencyKey = readIdempotencyKey(request, body);
  const includeKindsForHash = Array.from(includeKinds).sort();
  const selectedTransactionIdsForHash = [...selectedTransactionIds].sort((a, b) => a - b);
  const requestHash = idempotencyKey
    ? stableHash({
        customerId,
        periodStart,
        periodEnd,
        includeKinds: includeKindsForHash,
        selectedTransactionIds: selectedTransactionIdsForHash,
        vatEnabled,
        notes,
      })
    : null;
  const factoryContext = requireFactoryWriteContext(request, auth.user);
  if ("error" in factoryContext) return factoryContext.error;
  const { db, factoryKey } = factoryContext;
  const duplicateDraftsAllowed = allowDuplicateDraftInvoices();

  if (!Number.isFinite(customerId) || customerId <= 0) {
    return NextResponse.json({ error: "customerId is required" }, { status: 400 });
  }
  if (!periodStart || !periodEnd || periodStart > periodEnd) {
    return NextResponse.json({ error: "periodStart/periodEnd invalid" }, { status: 400 });
  }
  if (selectedTransactionIds.length === 0) {
    return NextResponse.json({ error: "selectedTransactionIds is required" }, { status: 400 });
  }

  const result = await db.transaction(async (tx) => {
    let claimId: number | null = null;
    if (idempotencyKey && requestHash) {
      const claim = await claimOrReplay(tx, {
        scope: "invoice.create",
        key: idempotencyKey,
        requestHash,
        createdBy: auth.user.id,
      });
      if (claim.kind === "conflict") {
        return {
          error: "idempotency_key_conflict",
          status: 409 as const,
        };
      }
      if (claim.kind === "replay") {
        if (!claim.invoiceId) {
          return {
            error: "idempotency_key_incomplete",
            status: 409 as const,
          };
        }
        const [existing] = await tx
          .select({
            id: invoices.id,
            status: invoices.status,
            createdAt: invoices.createdAt,
            subtotal: invoices.subtotal,
            vatAmount: invoices.vatAmount,
            grandTotal: invoices.grandTotal,
          })
          .from(invoices)
          .where(eq(invoices.id, claim.invoiceId))
          .limit(1);
        if (!existing) {
          return {
            error: "idempotency_key_incomplete",
            status: 409 as const,
          };
        }
        const lineCountRows = await tx
          .select({
            total: sql<number>`COUNT(*)::int`,
          })
          .from(invoiceLines)
          .where(eq(invoiceLines.invoiceId, existing.id));
        return {
          replay: {
            id: existing.id,
            status: existing.status,
            generatedAt: existing.createdAt,
            subtotal: existing.subtotal,
            vatAmount: existing.vatAmount,
            grandTotal: existing.grandTotal,
            rowCount: Number(lineCountRows[0]?.total || 0),
            idempotentReplay: true,
            idempotencyKey,
          },
        };
      }
      claimId = claim.claimId;
    }

    const customerRows = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1);
    if (customerRows.length === 0) {
      return { error: "ไม่พบลูกค้า", status: 404 as const };
    }

    const selectedIdsSql = sql.join(
      selectedTransactionIdsForHash.map((id) => sql`${id}`),
      sql`, `
    );

    const txRows = await tx
      .select({
        id: transactions.id,
        customerName: customers.name,
        saleDate: transactions.saleDate,
        saleTime: transactions.saleTime,
        pool: transactions.pool,
        row: transactions.row,
        col: transactions.col,
        status: transactions.status,
        totalAmount: transactions.totalAmount,
        paid: transactions.paid,
        transactionKind: transactions.transactionKind,
        note: transactions.note,
      })
      .from(transactions)
      .innerJoin(customers, eq(transactions.customerId, customers.id))
      .where(
        and(
          eq(transactions.customerId, customerId),
          gte(transactions.saleDate, periodStart),
          lte(transactions.saleDate, periodEnd),
          ne(transactions.status, "voided"),
          sql`${transactions.id} IN (${selectedIdsSql})`
        )
      );

    if (txRows.length !== selectedTransactionIdsForHash.length) {
      return {
        error: "Some selected transactions are missing, voided, or out of period.",
        status: 400 as const,
      };
    }

    for (const txRow of txRows) {
      const kind = inferBillKind(txRow);
      if (!includeKinds.has(kind)) {
        return {
          error: `transaction #${txRow.id} has kind '${kind}' which is excluded by includeKinds`,
          status: 400 as const,
        };
      }
    }

    const conflicts = await tx
      .select({
        transactionId: invoiceLines.transactionId,
        invoiceId: invoiceLines.invoiceId,
        invoiceStatus: invoices.status,
      })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
      .where(
        and(
          sql`${invoiceLines.transactionId} IN (${selectedIdsSql})`,
          ne(invoices.status, "void")
          ,
          ...(duplicateDraftsAllowed ? [ne(invoices.status, "draft")] : [])
        )
      );

    if (conflicts.length > 0) {
      return {
        error: "Some transactions already exist in an active invoice",
        status: 409 as const,
        conflicts,
      };
    }

    const [items, bagEntries, activeProductTypes] = await Promise.all([
      tx
        .select({
          transactionId: transactionItems.transactionId,
          productTypeId: transactionItems.productTypeId,
          quantity: transactionItems.quantity,
        })
        .from(transactionItems)
        .where(sql`${transactionItems.transactionId} IN (${selectedIdsSql})`),
        tx
          .select({
            transactionId: bagLedger.transactionId,
            type: bagLedger.type,
            quantity: bagLedger.quantity,
            note: bagLedger.note,
          })
        .from(bagLedger)
        .where(sql`${bagLedger.transactionId} IN (${selectedIdsSql})`),
      tx
        .select({
          id: productTypes.id,
          name: productTypes.name,
          sortOrder: productTypes.sortOrder,
        })
        .from(productTypes)
        .where(eq(productTypes.isActive, true)),
    ]);

    // Invoice preview/create is the place where `transfer_out` rows come back into
    // the commercial subtotal. They are excluded from normal sales KPIs, but if the
    // caller includes that kind we intentionally carry the real stored amount here.
    const preview = buildItemizedPreview({
      transactions: txRows,
      items,
      bagEntries,
      productColumns: activeProductTypes,
      includeKinds,
    });

    const subtotal = Number(preview.totals.totalSum || 0);
    const vatAmount = vatEnabled ? subtotal * FIXED_VAT_RATE : 0;
    const grandTotal = subtotal + vatAmount;
    const now = new Date();

    const [newInvoice] = await tx
      .insert(invoices)
      .values({
        customerId,
        periodStart,
        periodEnd,
        status: "draft",
        vatEnabled,
        vatRate,
        subtotal,
        vatAmount,
        grandTotal,
        paidTotal: 0,
        outstandingTotal: Math.max(0, grandTotal),
        notes: notes || null,
        createdBy: auth.user.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    for (const row of preview.rows) {
      await tx.insert(invoiceLines).values({
        invoiceId: newInvoice.id,
        transactionId: row.transactionId,
        lineType: inferInvoiceLineType(row.kind, row.sumTotal),
        saleDate: row.saleDate,
        saleTime: row.saleTime,
        amount: row.sumTotal,
        snapshotJson: row,
      });
    }

    if (claimId) {
      await completeClaim(tx, claimId, { invoiceId: newInvoice.id });
    }

    return {
      created: {
        id: newInvoice.id,
        status: newInvoice.status,
        generatedAt: newInvoice.createdAt,
        subtotal: newInvoice.subtotal,
        vatAmount: newInvoice.vatAmount,
        grandTotal: newInvoice.grandTotal,
        rowCount: preview.rows.length,
      },
    };
  });

  if ("error" in result) {
    const payload: Record<string, unknown> = { error: result.error };
    if ("conflicts" in result && Array.isArray(result.conflicts)) {
      payload.conflicts = result.conflicts;
    }
    return NextResponse.json(payload, { status: result.status });
  }
  const replayResult = "replay" in result ? result.replay : null;
  if (replayResult) {
    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: buildAuthenticatedDistinctId(auth.user.id),
      event: INVOICE_DRAFT_CREATED_EVENT,
      properties: buildInvoiceDraftCreatedProperties({
        actorUserId: auth.user.id,
        actorRole: auth.user.role,
        factoryKey,
        invoiceId: replayResult.id,
        customerId,
        periodStart,
        periodEnd,
        includeKinds: includeKindsForHash,
        lineCount: Number(replayResult.rowCount || 0),
        subtotal: Number(replayResult.subtotal || 0),
        vatEnabled,
        vatAmount: Number(replayResult.vatAmount || 0),
        grandTotal: Number(replayResult.grandTotal || 0),
        selectedTransactionCount: selectedTransactionIdsForHash.length,
        idempotentReplay: true,
      }),
    });
    return NextResponse.json(replayResult);
  }

  const createdResult = "created" in result ? result.created : null;
  if (!createdResult) {
    return NextResponse.json({ error: "ไม่สามารถสร้างใบวางบิลได้" }, { status: 409 });
  }

  const posthog = getPostHogClient();
  posthog.capture({
    distinctId: buildAuthenticatedDistinctId(auth.user.id),
    event: INVOICE_DRAFT_CREATED_EVENT,
    properties: buildInvoiceDraftCreatedProperties({
      actorUserId: auth.user.id,
      actorRole: auth.user.role,
      factoryKey,
      invoiceId: createdResult.id,
      customerId,
      periodStart,
      periodEnd,
      includeKinds: includeKindsForHash,
      lineCount: createdResult.rowCount,
      subtotal: Number(createdResult.subtotal || 0),
      vatEnabled,
      vatAmount: Number(createdResult.vatAmount || 0),
      grandTotal: Number(createdResult.grandTotal || 0),
      selectedTransactionCount: selectedTransactionIdsForHash.length,
      idempotentReplay: false,
    }),
  });

  return NextResponse.json(createdResult, { status: 201 });
});
