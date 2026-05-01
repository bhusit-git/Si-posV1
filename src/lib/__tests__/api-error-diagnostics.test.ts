import { describe, expect, it } from "vitest";
import {
  buildApiErrorDescription,
  classifyApiError,
  parseApiErrorResponse,
} from "@/lib/api-error-diagnostics";
import { DiagnosticError } from "@/lib/diagnostic-error";

describe("api error diagnostics", () => {
  it("prefers typed diagnostic errors over generic fallback parsing", () => {
    const error = new DiagnosticError("backup failed", {
      code: "BACKUP-IO-1001",
      category: "backup.io",
      source: "backup.export",
      operation: "csv-zip",
      title: "Backup export failed",
      hint: "ตรวจสอบไฟล์ส่งออก",
      retryable: false,
      safeContext: {
        scope: "full",
      },
    });

    expect(classifyApiError(error)).toEqual(
      expect.objectContaining({
        code: "BACKUP-IO-1001",
        category: "backup.io",
        source: "backup.export",
        operation: "csv-zip",
        title: "Backup export failed",
        hint: "ตรวจสอบไฟล์ส่งออก",
      })
    );
  });

  it("classifies postgres timeout errors separately", () => {
    const error = Object.assign(
      new Error("canceling statement due to statement timeout"),
      { code: "57014" }
    );

    expect(classifyApiError(error)).toEqual(
      expect.objectContaining({
        code: "DB-TIMEOUT-1001",
        category: "database.timeout",
        source: "database.query",
        operation: "execute",
      })
    );
  });

  it("classifies auth and config messages with distinct categories", () => {
    expect(classifyApiError(new Error("Unauthorized"))).toEqual(
      expect.objectContaining({
        code: "AUTH-SESSION-1001",
        category: "auth.session",
      })
    );

    expect(classifyApiError(new Error("DISPLAY_API_KEY is not configured in production"))).toEqual(
      expect.objectContaining({
        code: "SRV-CONFIG-1001",
        category: "server.config",
      })
    );
  });

  it("parses and formats the expanded diagnostic envelope", () => {
    const payload = parseApiErrorResponse({
      error: "เกิดข้อผิดพลาดภายในระบบ",
      requestId: "req_123",
      debugMessage: 'relation "supply_requests" does not exist',
      diagnostic: {
        code: "FILE-EXPORT-1001",
        category: "file.export",
        source: "reports.export",
        operation: "build-daily-xlsx",
        title: "Report export failed",
        hint: "ดู requestId ใน log",
        retryable: false,
      },
    });

    expect(payload).toEqual(
      expect.objectContaining({
        requestId: "req_123",
        diagnostic: expect.objectContaining({
          source: "reports.export",
          operation: "build-daily-xlsx",
        }),
      })
    );

    expect(buildApiErrorDescription(payload, "fallback")).toContain("FILE-EXPORT-1001");
    expect(buildApiErrorDescription(payload, "fallback")).toContain("reports.export");
    expect(buildApiErrorDescription(payload, "fallback")).toContain("req_123");
    expect(buildApiErrorDescription(payload, "fallback")).toContain(
      'relation "supply_requests" does not exist'
    );
  });
});
