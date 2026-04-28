import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { customers } from "@/db/schema";
import { requireAdmin } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";
import {
  transactionPrecheckSchema,
  validateBody,
} from "@/lib/validations";
import {
  detectInvoiceOverlapWarnings,
  evaluateTransactionDateTimePolicy,
} from "@/lib/transaction-backdate";

export const POST = withErrorHandler(async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await request.json();
  const validated = validateBody(transactionPrecheckSchema, body);
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const {
    customerId,
    saleDate: requestedSaleDate,
    saleTime: requestedSaleTime,
    backdateReason,
  } = validated.data;

  const policy = evaluateTransactionDateTimePolicy({
    saleDate: requestedSaleDate,
    saleTime: requestedSaleTime,
    role: auth.user.role,
  });
  if (!policy.ok) {
    return NextResponse.json({ error: policy.error.error }, { status: policy.error.status });
  }

  const db = await getDb();
  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, customerId),
    columns: { id: true },
  });
  if (!customer) {
    return NextResponse.json({ error: "ไม่พบลูกค้า" }, { status: 404 });
  }

  const warnings = await detectInvoiceOverlapWarnings(
    db,
    customerId,
    policy.data.effectiveSaleDate
  );

  return NextResponse.json({
    allowed: true,
    effectiveSaleDate: policy.data.effectiveSaleDate,
    effectiveSaleTime: policy.data.effectiveSaleTime,
    isBackdated: policy.data.isBackdated,
    backdateMinutes: policy.data.backdateMinutes,
    backdateReason: backdateReason?.trim() || null,
    warnings,
  });
});
