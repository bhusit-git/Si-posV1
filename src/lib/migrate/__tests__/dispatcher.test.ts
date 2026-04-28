import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  writeMigrateAuditEntry: vi.fn(),
}));

vi.mock("@/db", () => ({
  getDb: () => ({ execute: async () => [] }),
  getMainDb: () => ({ execute: async () => [] }),
}));

vi.mock("@/lib/migrate/audit", () => ({
  writeMigrateAuditEntry: mocks.writeMigrateAuditEntry,
}));

import { dispatchMigrateAction } from "@/lib/migrate/dispatcher";
import * as registry from "@/lib/migrate/registry";
import type { MigrateActionDefinition } from "@/lib/migrate/types";

function makeDefinition(
  overrides: Partial<MigrateActionDefinition> = {}
): MigrateActionDefinition {
  return {
    name: "status",
    method: "GET",
    externalAction: null,
    factoryScope: "none",
    dbTarget: "main",
    mutationType: "read-only",
    requiresConfirmation: false,
    supportsDryRun: false,
    dryRunMode: "disabled",
    failureMode: "single-db-transactional",
    handler: vi.fn(async () => ({ body: { ok: true } })),
    ...overrides,
  };
}

describe("migrate dispatcher", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("returns 400 for unknown actions", async () => {
    const req = new NextRequest("http://localhost/api/migrate?action=unknown");
    const res = await dispatchMigrateAction(req, "127.0.0.1");
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain("Unknown action");
    expect(mocks.writeMigrateAuditEntry).not.toHaveBeenCalled();
  });

  it("rejects missing factory on single-factory actions before handler execution", async () => {
    const handler = vi.fn(async () => ({ body: { ok: true } }));
    vi.spyOn(registry, "findMigrateAction").mockReturnValue(
      makeDefinition({
        name: "check-products",
        method: "GET",
        externalAction: "check-products",
        factoryScope: "single",
        dbTarget: "factory",
        handler,
      })
    );

    const req = new NextRequest("http://localhost/api/migrate?action=check-products");
    const res = await dispatchMigrateAction(req, "127.0.0.1");
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("Missing ?factory= parameter");
    expect(handler).not.toHaveBeenCalled();
    expect(mocks.writeMigrateAuditEntry).not.toHaveBeenCalled();
  });

  it("rejects destructive apply actions without confirmation", async () => {
    const handler = vi.fn(async () => ({ body: { ok: true } }));
    vi.spyOn(registry, "findMigrateAction").mockReturnValue(
      makeDefinition({
        name: "wipe-factory-data",
        method: "POST",
        externalAction: "wipe-factory-data",
        factoryScope: "single",
        dbTarget: "factory",
        mutationType: "destructive",
        requiresConfirmation: "WIPE_FACTORY_DATA",
        handler,
      })
    );

    const req = new NextRequest(
      "http://localhost/api/migrate?action=wipe-factory-data&factory=si",
      { method: "POST" }
    );
    const res = await dispatchMigrateAction(req, "127.0.0.1");
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("Missing or invalid ?confirm=WIPE_FACTORY_DATA");
    expect(handler).not.toHaveBeenCalled();
    expect(mocks.writeMigrateAuditEntry).not.toHaveBeenCalled();
  });

  it("calls the handler and writes a success audit entry", async () => {
    const handler = vi.fn(async () => ({
      status: 201,
      body: { ok: true },
      auditSummary: { changed: 2 },
    }));
    const definition = makeDefinition({
      name: "default-migration",
      method: "POST",
      externalAction: null,
      mutationType: "additive",
      handler,
    });
    vi.spyOn(registry, "findMigrateAction").mockReturnValue(definition);

    const req = new NextRequest("http://localhost/api/migrate", { method: "POST" });
    const res = await dispatchMigrateAction(req, "10.0.0.5");
    const body = (await res.json()) as { ok: boolean };

    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
    expect(mocks.writeMigrateAuditEntry).toHaveBeenCalledWith({
      definition,
      context: expect.objectContaining({
        name: "default-migration",
        callerIp: "10.0.0.5",
      }),
      result: expect.objectContaining({
        status: 201,
        auditSummary: { changed: 2 },
      }),
    });
  });

  it("writes a failure audit entry when the handler throws", async () => {
    const error = new Error("boom");
    const handler = vi.fn(async () => {
      throw error;
    });
    const definition = makeDefinition({
      name: "default-migration",
      method: "POST",
      externalAction: null,
      mutationType: "additive",
      handler,
    });
    vi.spyOn(registry, "findMigrateAction").mockReturnValue(definition);

    const req = new NextRequest("http://localhost/api/migrate", { method: "POST" });
    const res = await dispatchMigrateAction(req, "10.0.0.5");
    const body = (await res.json()) as {
      error: string;
      requestId?: string;
      diagnostic?: { source?: string; operation?: string };
    };

    expect(res.status).toBe(500);
    expect(body.error).toBe("เกิดข้อผิดพลาดภายในระบบ");
    expect(body.requestId).toBeTruthy();
    expect(res.headers.get("x-request-id")).toBe(body.requestId);
    expect(body.diagnostic).toEqual(
      expect.objectContaining({
        source: "migrate.dispatcher",
        operation: "default-migration",
      })
    );
    expect(mocks.writeMigrateAuditEntry).toHaveBeenCalledWith({
      definition,
      context: expect.objectContaining({
        name: "default-migration",
        callerIp: "10.0.0.5",
      }),
      error,
    });
  });

  it("standardizes 500 handler results into the shared diagnostic envelope", async () => {
    const handler = vi.fn(async () => ({
      status: 500,
      body: { error: "raw migration failure", log: ["step 1"] },
    }));
    vi.spyOn(registry, "findMigrateAction").mockReturnValue(
      makeDefinition({
        name: "default-migration",
        method: "POST",
        externalAction: null,
        mutationType: "additive",
        handler,
      })
    );

    const req = new NextRequest("http://localhost/api/migrate", { method: "POST" });
    const res = await dispatchMigrateAction(req, "10.0.0.5");
    const body = (await res.json()) as {
      error: string;
      requestId?: string;
      diagnostic?: { source?: string; operation?: string };
      log?: unknown;
    };

    expect(res.status).toBe(500);
    expect(body.error).toBe("เกิดข้อผิดพลาดภายในระบบ");
    expect(body.requestId).toBeTruthy();
    expect(body.log).toBeUndefined();
    expect(body.diagnostic).toEqual(
      expect.objectContaining({
        source: "migrate.dispatcher",
        operation: "default-migration",
      })
    );
  });
});
