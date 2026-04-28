import { sql } from "drizzle-orm";
import { getMainDb } from "@/db";
import { migrateAuditLog } from "@/lib/shared/schema";
import type { MigrateActionContext, MigrateActionDefinition, MigrateActionResult } from "./types";
import { getFactoryKeysForAudit } from "./shared";

async function migrateAuditTableExists(): Promise<boolean> {
  const db = getMainDb();
  const rows = await db.execute(
    sql`SELECT 1 FROM information_schema.tables WHERE table_name = 'migrate_audit_log'`
  );
  return Array.from(rows).length > 0;
}

export async function writeMigrateAuditEntry(params: {
  definition: MigrateActionDefinition;
  context: MigrateActionContext;
  result?: MigrateActionResult;
  error?: unknown;
}) {
  try {
    if (!(await migrateAuditTableExists())) return;

    const db = getMainDb();
    const completedAt = new Date();
    const errorMessage = params.error instanceof Error ? params.error.message : params.error == null ? null : String(params.error);

    await db.insert(migrateAuditLog).values({
      actionName: params.definition.externalAction || params.definition.name,
      factoryScope: params.definition.factoryScope,
      factoryKeys: getFactoryKeysForAudit(params.definition, params.context),
      dbTarget: params.definition.dbTarget,
      mutationType: params.definition.mutationType,
      dryRun: params.context.dryRunRequested,
      callerIp: params.context.callerIp,
      actorIdentifier: null,
      confirmationProvided: Boolean(params.context.confirmation),
      startedAt: params.context.startedAt,
      completedAt,
      success: !params.error && (!params.result?.status || params.result.status < 400),
      summary: params.result?.auditSummary ?? null,
      errorMessage,
    });
  } catch {
    // Audit logging is best-effort in Phase 1 so it cannot break existing migrate flows.
  }
}
