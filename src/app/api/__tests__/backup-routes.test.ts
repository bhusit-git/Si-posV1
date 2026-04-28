import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createJsonBackupDownloadResponse: vi.fn(),
  createCsvZipBackupDownloadResponse: vi.fn(),
  resolveActiveFactoryKey: vi.fn(),
  getPostHogClient: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireAdmin: mocks.requireAdmin,
}));

vi.mock("@/lib/backup-export", () => ({
  createJsonBackupDownloadResponse: mocks.createJsonBackupDownloadResponse,
  createCsvZipBackupDownloadResponse: mocks.createCsvZipBackupDownloadResponse,
}));

vi.mock("@/lib/posthog-server", () => ({
  getPostHogClient: mocks.getPostHogClient,
}));

vi.mock("@/lib/factory-key", () => ({
  resolveActiveFactoryKey: mocks.resolveActiveFactoryKey,
}));

import { GET as getBackup } from "@/app/api/backup/route";
import { GET as getBackupCustomers } from "@/app/api/backup/customers/route";
import { GET as getBackupTransactions } from "@/app/api/backup/transactions/route";
import { GET as getBackupCsv } from "@/app/api/backup/csv/route";

describe("backup routes", () => {
  const backupRequest = new NextRequest("http://localhost/api/backup");
  const backupTransactionsRequest = new NextRequest("http://localhost/api/backup/transactions");
  const backupCustomersRequest = new NextRequest("http://localhost/api/backup/customers");

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({
      user: { id: 1, username: "admin", role: "admin", factoryKey: null },
    });
    mocks.createJsonBackupDownloadResponse.mockResolvedValue(
      new NextResponse("json-ok", {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": 'attachment; filename="backup.json"',
        },
      })
    );
    mocks.createCsvZipBackupDownloadResponse.mockResolvedValue(
      new NextResponse("zip-ok", {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": 'attachment; filename="backup.zip"',
        },
      })
    );
    mocks.resolveActiveFactoryKey.mockResolvedValue("si");
    mocks.getPostHogClient.mockReturnValue({ capture: mocks.capture });
  });

  it("GET /api/backup uses full JSON scope", async () => {
    const res = await getBackup(backupRequest);

    expect(res.status).toBe(200);
    expect(mocks.createJsonBackupDownloadResponse).toHaveBeenCalledWith({
      scope: "full",
      version: "2.0",
      filenamePrefix: "superice-backup",
      actorUsername: "admin",
    });
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "user:1",
        event: "backup.downloaded",
        properties: expect.objectContaining({
          schema_version: 2,
          app: "superice-pos",
          event_origin: "server",
          factory_key: "si",
          actor_user_id: 1,
          actor_role: "admin",
          scope: "full",
          format: "json",
        }),
      })
    );
  });

  it("GET /api/backup/transactions uses transactions JSON scope", async () => {
    const res = await getBackupTransactions(backupTransactionsRequest);

    expect(res.status).toBe(200);
    expect(mocks.createJsonBackupDownloadResponse).toHaveBeenCalledWith({
      scope: "transactions",
      version: "transactions-backup.v1",
      filenamePrefix: "superice-transactions-backup",
      actorUsername: "admin",
    });
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "backup.downloaded",
        properties: expect.objectContaining({
          scope: "transactions",
          format: "json",
        }),
      })
    );
  });

  it("GET /api/backup/customers uses customers JSON scope", async () => {
    const res = await getBackupCustomers(backupCustomersRequest);

    expect(res.status).toBe(200);
    expect(mocks.createJsonBackupDownloadResponse).toHaveBeenCalledWith({
      scope: "customers",
      version: "customers-metadata-backup.v1",
      filenamePrefix: "superice-customers-metadata",
      actorUsername: "admin",
    });
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "backup.downloaded",
        properties: expect.objectContaining({
          scope: "customers",
          format: "json",
        }),
      })
    );
  });

  it("GET /api/backup/csv parses scope and returns zip", async () => {
    const req = new NextRequest("http://localhost/api/backup/csv?scope=transactions");
    const res = await getBackupCsv(req);

    expect(res.status).toBe(200);
    expect(mocks.createCsvZipBackupDownloadResponse).toHaveBeenCalledWith({
      scope: "transactions",
      version: "csv-export.v1",
      filenamePrefix: "superice-transactions-csv-export",
      actorUsername: "admin",
    });
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "backup.downloaded",
        properties: expect.objectContaining({
          scope: "transactions",
          format: "csv_zip",
        }),
      })
    );
  });

  it("GET /api/backup/csv falls back to full scope when query is invalid", async () => {
    const req = new NextRequest("http://localhost/api/backup/csv?scope=invalid");
    await getBackupCsv(req);

    expect(mocks.createCsvZipBackupDownloadResponse).toHaveBeenCalledWith({
      scope: "full",
      version: "csv-export.v1",
      filenamePrefix: "superice-full-csv-export",
      actorUsername: "admin",
    });
  });

  it("returns auth response when requireAdmin fails", async () => {
    mocks.requireAdmin.mockResolvedValueOnce({
      error: NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 }),
    });

    const res = await getBackupTransactions(backupTransactionsRequest);
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe("ไม่ได้เข้าสู่ระบบ");
    expect(mocks.createJsonBackupDownloadResponse).not.toHaveBeenCalled();
  });

  it("returns a structured 500 payload when CSV export throws", async () => {
    mocks.createCsvZipBackupDownloadResponse.mockRejectedValueOnce(new Error("boom"));

    const req = new NextRequest("http://localhost/api/backup/csv?scope=customers");
    const res = await getBackupCsv(req);
    const body = (await res.json()) as {
      error: string;
      requestId?: string;
      diagnostic?: { code?: string; category?: string; source?: string; operation?: string };
    };

    expect(res.status).toBe(500);
    expect(body.error).toBe("เกิดข้อผิดพลาดภายในระบบ");
    expect(body.requestId).toBeTruthy();
    expect(res.headers.get("x-request-id")).toBe(body.requestId);
    expect(body.diagnostic).toEqual(
      expect.objectContaining({
        code: "FILE-EXPORT-1001",
        category: "file.export",
        source: "backup.route",
        operation: "download-csv-zip",
      })
    );
  });
});
