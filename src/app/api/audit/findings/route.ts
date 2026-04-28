import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { auditFindings } from "@/db/schema";
import {
  and,
  desc,
  eq,
  gte,
  lte,
  notInArray,
  sql,
} from "drizzle-orm";
import { requireAdmin } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";
import { scanAndPersistAuditFindings } from "@/lib/fraud-detection";
import {
  isHighPrioritySeverity,
  LEGACY_CREDIT_RULE_KEYS,
} from "@/lib/audit-findings";

const ALLOWED_STATUSES = new Set(["open", "reviewed", "dismissed"]);

function parsePositiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const limit = Math.min(parsePositiveInt(request.nextUrl.searchParams.get("limit")) || 50, 200);
  const offset = Math.max(0, parsePositiveInt(request.nextUrl.searchParams.get("offset")) || 0);
  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  const severity = request.nextUrl.searchParams.get("severity");
  const status = request.nextUrl.searchParams.get("status");
  const ruleKey = request.nextUrl.searchParams.get("ruleKey");
  const category = request.nextUrl.searchParams.get("category");
  const userId = parsePositiveInt(request.nextUrl.searchParams.get("userId"));
  const customerId = parsePositiveInt(request.nextUrl.searchParams.get("customerId"));
  const transactionId = parsePositiveInt(request.nextUrl.searchParams.get("transactionId"));
  const includeLegacyCredit = request.nextUrl.searchParams.get("includeLegacyCredit") === "1";

  const conditions = [];
  if (from) conditions.push(gte(auditFindings.lastSeenAt, new Date(`${from}T00:00:00.000Z`)));
  if (to) conditions.push(lte(auditFindings.lastSeenAt, new Date(`${to}T23:59:59.999Z`)));
  if (severity && severity !== "all") conditions.push(eq(auditFindings.severity, severity));
  if (status && status !== "all" && ALLOWED_STATUSES.has(status)) {
    conditions.push(eq(auditFindings.status, status));
  }
  if (ruleKey && ruleKey !== "all") conditions.push(eq(auditFindings.ruleKey, ruleKey));
  if (category && category !== "all") conditions.push(eq(auditFindings.category, category));
  if (userId) conditions.push(eq(auditFindings.userId, userId));
  if (customerId) conditions.push(eq(auditFindings.customerId, customerId));
  if (transactionId) conditions.push(eq(auditFindings.transactionId, transactionId));
  if (!includeLegacyCredit) {
    conditions.push(notInArray(auditFindings.ruleKey, [...LEGACY_CREDIT_RULE_KEYS]));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const db = await getDb();

  const [rows, [countRow], groupedSummary] = await Promise.all([
    db
      .select({
        id: auditFindings.id,
        fingerprint: auditFindings.fingerprint,
        ruleKey: auditFindings.ruleKey,
        category: auditFindings.category,
        severity: auditFindings.severity,
        riskScore: auditFindings.riskScore,
        status: auditFindings.status,
        entity: auditFindings.entity,
        entityId: auditFindings.entityId,
        userId: auditFindings.userId,
        username: auditFindings.username,
        customerId: auditFindings.customerId,
        transactionId: auditFindings.transactionId,
        title: auditFindings.title,
        reason: auditFindings.reason,
        evidence: auditFindings.evidence,
        reviewNote: auditFindings.reviewNote,
        firstSeenAt: auditFindings.firstSeenAt,
        lastSeenAt: auditFindings.lastSeenAt,
        createdAt: auditFindings.createdAt,
        updatedAt: auditFindings.updatedAt,
      })
      .from(auditFindings)
      .where(where)
      .orderBy(desc(auditFindings.lastSeenAt), desc(auditFindings.riskScore))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(auditFindings)
      .where(where),
    db
      .select({
        category: auditFindings.category,
        severity: auditFindings.severity,
        status: auditFindings.status,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(auditFindings)
      .where(where)
      .groupBy(auditFindings.category, auditFindings.severity, auditFindings.status),
  ]);

  const summary = {
    suspiciousCancellations: 0,
    anomalyOrders: 0,
    suspiciousPayments: 0,
    unresolvedCriticalHigh: 0,
    openCount: 0,
  };

  for (const row of groupedSummary) {
    const count = Number(row.count || 0);
    if (row.category === "suspicious_cancellations") {
      summary.suspiciousCancellations += count;
    }
    if (row.category === "anomaly_orders") {
      summary.anomalyOrders += count;
    }
    if (row.category === "suspicious_payments") {
      summary.suspiciousPayments += count;
    }
    if (row.status === "open") {
      summary.openCount += count;
      if (isHighPrioritySeverity(row.severity)) {
        summary.unresolvedCriticalHigh += count;
      }
    }
  }

  return NextResponse.json({
    findings: rows,
    total: countRow?.count || 0,
    limit,
    offset,
    summary,
  });
});

export const POST = withErrorHandler(async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const startDate =
    typeof body.startDate === "string" && body.startDate.trim() ? body.startDate.trim() : null;
  const endDate =
    typeof body.endDate === "string" && body.endDate.trim() ? body.endDate.trim() : null;
  const transactionId =
    typeof body.transactionId === "number" && Number.isInteger(body.transactionId) && body.transactionId > 0
      ? body.transactionId
      : null;
  const customerId =
    typeof body.customerId === "number" && Number.isInteger(body.customerId) && body.customerId > 0
      ? body.customerId
      : null;

  if (!transactionId && (!startDate || !endDate)) {
    return NextResponse.json(
      { error: "ต้องระบุ transactionId หรือช่วงวันที่สำหรับสแกน" },
      { status: 400 }
    );
  }

  const db = await getDb();
  const result = await scanAndPersistAuditFindings(db, {
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    transactionIds: transactionId ? [transactionId] : undefined,
    customerIds: customerId ? [customerId] : undefined,
    userIds: [auth.user.id],
  });

  return NextResponse.json({
    success: true,
    ...result,
  });
});
