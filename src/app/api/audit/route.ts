import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { auditLog } from "@/db/schema";
import { desc, eq, gte, lte, and, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const limit = Math.min(parseInt(request.nextUrl.searchParams.get("limit") || "50"), 200);
  const offset = parseInt(request.nextUrl.searchParams.get("offset") || "0");
  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  const entity = request.nextUrl.searchParams.get("entity");
  const userId = request.nextUrl.searchParams.get("userId");

  const conditions = [];
  if (from) conditions.push(gte(auditLog.createdAt, new Date(from)));
  if (to) conditions.push(lte(auditLog.createdAt, new Date(to + "T23:59:59Z")));
  if (entity) conditions.push(eq(auditLog.entity, entity));
  if (userId) conditions.push(eq(auditLog.userId, parseInt(userId)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const db = await getDb();
  const [logs, [countResult]] = await Promise.all([
    db
      .select({
        id: auditLog.id,
        userId: auditLog.userId,
        username: auditLog.username,
        action: auditLog.action,
        entity: auditLog.entity,
        entityId: auditLog.entityId,
        details: auditLog.details,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(auditLog)
      .where(where),
  ]);

  return NextResponse.json({
    logs,
    total: countResult?.count || 0,
    limit,
    offset,
  });
});
