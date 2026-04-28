import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import { classifyApiError } from "@/lib/api-error-diagnostics";
import { createRequestId, logApiError } from "@/lib/error-logging";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const db = await getDb();
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    const dbLatency = Date.now() - start;

    return NextResponse.json(
      {
        status: "ok",
        timestamp: new Date().toISOString(),
        db: { connected: true, latencyMs: dbLatency },
      },
      { status: 200 }
    );
  } catch (error) {
    const requestId = createRequestId();
    const diagnostic = classifyApiError(error, {
      source: "health.route",
      operation: "db-ping",
    });
    logApiError({
      request,
      error,
      requestId,
      diagnostic,
      context: {
        route: "GET /api/health",
      },
      fallbackSource: "health.route",
      fallbackOperation: "db-ping",
    });
    return NextResponse.json(
      {
        status: "error",
        timestamp: new Date().toISOString(),
        requestId,
        diagnostic,
        db: { connected: false },
      },
      {
        status: 503,
        headers: {
          "x-request-id": requestId,
        },
      }
    );
  }
}
