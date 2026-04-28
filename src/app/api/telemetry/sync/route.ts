import { NextRequest, NextResponse } from "next/server";
import { requireManagerUp } from "@/lib/api-auth";
import { logAudit, withBehaviorDetails } from "@/lib/audit";
import { withErrorHandler } from "@/lib/api-utils";

const ALLOWED_EVENTS = new Set([
  "queued",
  "sync_started",
  "sale_synced",
  "sale_failed",
  "sync_finished",
]);

function asString(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function asInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value !== "string") return null;
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) ? n : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asIsoTimestamp(value: unknown): string | null {
  const raw = asString(value, 50);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString();
}

export const POST = withErrorHandler(async function POST(request: NextRequest) {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "payload ไม่ถูกต้อง" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "payload ไม่ถูกต้อง" }, { status: 400 });
  }

  const event = asString((body as Record<string, unknown>).event, 40);
  if (!event || !ALLOWED_EVENTS.has(event)) {
    return NextResponse.json({ error: "event ไม่ถูกต้อง" }, { status: 400 });
  }

  const customerId = asInt((body as Record<string, unknown>).customerId);
  const transactionId = asInt((body as Record<string, unknown>).transactionId);
  const amount = asNumber((body as Record<string, unknown>).amount);
  const pendingCount = asInt((body as Record<string, unknown>).pendingCount);
  const successCount = asInt((body as Record<string, unknown>).successCount);
  const failedCount = asInt((body as Record<string, unknown>).failedCount);
  const clientId = asString((body as Record<string, unknown>).clientId, 80);
  const queuedAt = asIsoTimestamp((body as Record<string, unknown>).queuedAt);
  const errorMessage = asString((body as Record<string, unknown>).error, 300);

  const queueLagSeconds = queuedAt
    ? Math.max(0, Math.round((Date.now() - new Date(queuedAt).getTime()) / 1000))
    : null;

  const details: Record<string, unknown> = {
    event,
  };
  if (customerId !== null) details.customerId = customerId;
  if (transactionId !== null) details.transactionId = transactionId;
  if (amount !== null) details.amount = amount;
  if (pendingCount !== null) details.pendingCount = pendingCount;
  if (successCount !== null) details.successCount = successCount;
  if (failedCount !== null) details.failedCount = failedCount;
  if (clientId) details.clientId = clientId;
  if (queuedAt) details.queuedAt = queuedAt;
  if (queueLagSeconds !== null) details.queueLagSeconds = queueLagSeconds;
  if (errorMessage) details.error = errorMessage;

  await logAudit({
    userId: auth.user.id,
    username: auth.user.username,
    action: `sync.${event}`,
    entity: "sync",
    entityId: transactionId,
    details: withBehaviorDetails(details, {
      event: `sync.${event}`,
      source: "offline_sync",
      customerId,
      transactionId,
      amount: amount ?? undefined,
      reasonCode: errorMessage ? "error" : undefined,
      extra: queueLagSeconds !== null ? { queueLagSeconds } : undefined,
    }),
  });

  return NextResponse.json({ success: true });
});
