import { getDb, type DrizzleDB } from "@/db";
import { auditLog } from "@/db/schema";
import { extractPostgresError } from "@/lib/api-error-diagnostics";
import { logDiagnosticEvent } from "@/lib/error-logging";

export type AuditDetails = Record<string, unknown>;

export interface AuditParams {
  userId: number | null;
  username: string;
  action: string;
  entity: string;
  entityId: number | null;
  details?: AuditDetails;
}

export type BehaviorSource = "pos" | "backoffice" | "offline_sync" | "system";

export interface BehaviorContext {
  event: string;
  source: BehaviorSource;
  customerId?: number | null;
  transactionId?: number | null;
  amount?: number;
  quantity?: number;
  reasonCode?: string | null;
  tags?: string[];
  extra?: AuditDetails;
}

export const CUSTOMER_BEHAVIOR_SCHEMA = "customer_behavior.v1";
type AuditWriteTarget = Pick<DrizzleDB, "insert">;

export function withBehaviorDetails(
  details: AuditDetails | undefined,
  behavior: BehaviorContext
): AuditDetails {
  const behaviorPayload: AuditDetails = {
    schema: CUSTOMER_BEHAVIOR_SCHEMA,
    event: behavior.event,
    source: behavior.source,
    customerId: behavior.customerId ?? null,
    transactionId: behavior.transactionId ?? null,
  };

  if (typeof behavior.amount === "number") {
    behaviorPayload.amount = behavior.amount;
  }
  if (typeof behavior.quantity === "number") {
    behaviorPayload.quantity = behavior.quantity;
  }
  if (behavior.reasonCode) {
    behaviorPayload.reasonCode = behavior.reasonCode;
  }
  if (behavior.tags && behavior.tags.length > 0) {
    behaviorPayload.tags = behavior.tags;
  }
  if (behavior.extra) {
    Object.assign(behaviorPayload, behavior.extra);
  }

  return {
    ...(details || {}),
    behavior: behaviorPayload,
  };
}

interface DbErrorLike {
  code?: string;
  constraint_name?: string;
}

function isAuditUserForeignKeyError(error: unknown): error is DbErrorLike {
  if (!error || typeof error !== "object") return false;
  const maybe = error as DbErrorLike;
  if (maybe.code !== "23503") return false;
  return (maybe.constraint_name || "").includes("audit_log_user_id");
}

function isAuditSchemaUnavailableError(error: unknown): boolean {
  const pg = extractPostgresError(error);
  if (pg?.code === "42P01") return true;
  if (pg?.code === "42703" && pg.table === "audit_log") return true;

  let current: unknown = error;
  let depth = 0;
  while (current && depth < 6) {
    const message = current instanceof Error ? current.message : String(current ?? "");
    if (message.includes("relation") && message.includes("audit_log") && message.includes("does not exist")) {
      return true;
    }
    if (message.includes("column") && message.includes("audit_log") && message.includes("does not exist")) {
      return true;
    }

    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause?: unknown }).cause
        : null;
    depth += 1;
  }

  return false;
}

function warnAuditSkipped(error: unknown, action: string, entity: string) {
  logDiagnosticEvent({
    level: "warn",
    message: "Skipped audit log write because audit schema is unavailable",
    error,
    source: "audit",
    operation: "logAudit",
    context: { action, entity },
  });
}

/**
 * Write an entry to the audit_log table.
 * Accepts an optional Drizzle transaction to run inside an existing DB transaction.
 */
export async function logAudit(
  params: AuditParams,
  tx?: AuditWriteTarget
): Promise<void> {
  const target = tx || (await getDb());
  const baseValues = {
    username: params.username,
    action: params.action,
    entity: params.entity,
    entityId: params.entityId,
    details: params.details || {},
    createdAt: new Date(),
  };

  try {
    await target.insert(auditLog).values({
      ...baseValues,
      userId: params.userId,
    });
  } catch (error) {
    if (isAuditSchemaUnavailableError(error)) {
      warnAuditSkipped(error, params.action, params.entity);
      return;
    }
    if (!isAuditUserForeignKeyError(error) || params.userId == null) {
      throw error;
    }
    try {
      await target.insert(auditLog).values({
        ...baseValues,
        userId: null,
        details: {
          ...(params.details || {}),
          auditUserFallback: {
            originalUserId: params.userId,
            reason: "audit_log_user_fk_missing",
          },
        },
      });
    } catch (fallbackError) {
      if (isAuditSchemaUnavailableError(fallbackError)) {
        warnAuditSkipped(fallbackError, params.action, params.entity);
        return;
      }
      throw fallbackError;
    }
  }
}
