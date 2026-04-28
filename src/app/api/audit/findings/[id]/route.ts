import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditFindings } from "@/db/schema";
import { requireAdmin } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";

const ALLOWED_STATUSES = new Set(["open", "reviewed", "dismissed"]);

export const PATCH = withErrorHandler(async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

    const { id } = await context.params;
    const findingId = Number.parseInt(id, 10);
    if (!Number.isFinite(findingId) || findingId <= 0) {
      return NextResponse.json({ error: "ID finding ไม่ถูกต้อง" }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const status =
      typeof body.status === "string" && ALLOWED_STATUSES.has(body.status.trim())
        ? body.status.trim()
        : null;
    const reviewNote =
      typeof body.reviewNote === "string" && body.reviewNote.trim()
        ? body.reviewNote.trim()
        : null;

    if (!status) {
      return NextResponse.json({ error: "ต้องระบุสถานะ" }, { status: 400 });
    }

    const db = await getDb();
    const [updated] = await db
      .update(auditFindings)
      .set({
        status,
        reviewNote,
        updatedAt: new Date(),
      })
      .where(eq(auditFindings.id, findingId))
      .returning({
        id: auditFindings.id,
        status: auditFindings.status,
        reviewNote: auditFindings.reviewNote,
        updatedAt: auditFindings.updatedAt,
      });

    if (!updated) {
      return NextResponse.json({ error: "ไม่พบ finding" }, { status: 404 });
    }

  return NextResponse.json({
    success: true,
    finding: updated,
  });
}, {
  source: "audit.findings",
  operation: "PATCH /api/audit/findings/[id]",
  context: async (_request, context) => {
    const params = await context.params;
    return { findingId: params.id };
  },
});
