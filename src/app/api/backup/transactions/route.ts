import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";
import { createJsonBackupDownloadResponse } from "@/lib/backup-export";
import { asDiagnosticError } from "@/lib/diagnostic-error";
import { getPostHogClient } from "@/lib/posthog-server";
import { resolveActiveFactoryKey } from "@/lib/factory-key";
import {
  BACKUP_DOWNLOADED_EVENT,
  buildAuthenticatedDistinctId,
  buildBackupDownloadedProperties,
} from "@/lib/posthog-events";

export const GET = withErrorHandler(async function GET(_request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const factoryKey = await resolveActiveFactoryKey(undefined, auth.user.factoryKey);
  const posthog = getPostHogClient();
  posthog.capture({
    distinctId: buildAuthenticatedDistinctId(auth.user.id),
    event: BACKUP_DOWNLOADED_EVENT,
    properties: buildBackupDownloadedProperties({
      actorUserId: auth.user.id,
      actorRole: auth.user.role,
      factoryKey,
      scope: "transactions",
      format: "json",
    }),
  });
  try {
    return await createJsonBackupDownloadResponse({
      scope: "transactions",
      version: "transactions-backup.v1",
      filenamePrefix: "superice-transactions-backup",
      actorUsername: auth.user.username,
    });
  } catch (error) {
    throw asDiagnosticError(error, {
      code: "BACKUP-IO-1001",
      category: "backup.io",
      source: "backup.route",
      operation: "download-transactions-json",
      title: "Backup export failed",
      hint: "การส่งออกข้อมูลรายการขายล้มเหลว ให้ตรวจสอบ requestId และ log",
      retryable: false,
      safeContext: {
        scope: "transactions",
        format: "json",
        factoryKey,
      },
    });
  }
}, {
  source: "backup.route",
  operation: "GET /api/backup/transactions",
  context: {
    scope: "transactions",
    format: "json",
  },
});
