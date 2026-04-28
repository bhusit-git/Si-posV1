import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";
import {
  createCsvZipBackupDownloadResponse,
  type BackupScope,
} from "@/lib/backup-export";
import { asDiagnosticError } from "@/lib/diagnostic-error";
import { getPostHogClient } from "@/lib/posthog-server";
import { resolveActiveFactoryKey } from "@/lib/factory-key";
import {
  BACKUP_DOWNLOADED_EVENT,
  buildAuthenticatedDistinctId,
  buildBackupDownloadedProperties,
} from "@/lib/posthog-events";

function parseScope(request: NextRequest): BackupScope {
  const raw = request.nextUrl.searchParams.get("scope");
  if (raw === "transactions" || raw === "customers" || raw === "full") {
    return raw;
  }
  return "full";
}

function scopeLabel(scope: BackupScope): string {
  if (scope === "transactions") return "transactions";
  if (scope === "customers") return "customers";
  return "full";
}

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const scope = parseScope(request);
  const factoryKey = await resolveActiveFactoryKey(undefined, auth.user.factoryKey);
  const posthog = getPostHogClient();
  posthog.capture({
    distinctId: buildAuthenticatedDistinctId(auth.user.id),
    event: BACKUP_DOWNLOADED_EVENT,
    properties: buildBackupDownloadedProperties({
      actorUserId: auth.user.id,
      actorRole: auth.user.role,
      factoryKey,
      scope,
      format: "csv_zip",
    }),
  });
  try {
    return await createCsvZipBackupDownloadResponse({
      scope,
      version: "csv-export.v1",
      filenamePrefix: `superice-${scopeLabel(scope)}-csv-export`,
      actorUsername: auth.user.username,
    });
  } catch (error) {
    throw asDiagnosticError(error, {
      code: "FILE-EXPORT-1001",
      category: "file.export",
      source: "backup.route",
      operation: "download-csv-zip",
      title: "CSV export failed",
      hint: "การส่งออกไฟล์ CSV ล้มเหลว ให้ตรวจสอบ requestId และ log",
      retryable: false,
      safeContext: {
        scope,
        format: "csv_zip",
        factoryKey,
      },
    });
  }
}, {
  source: "backup.route",
  operation: "GET /api/backup/csv",
  context: (request) => ({
    scope: parseScope(request),
    format: "csv_zip",
  }),
});
