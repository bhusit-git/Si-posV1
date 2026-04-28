import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const values = vi.fn();
  const insert = vi.fn(() => ({ values }));
  const execute = vi.fn();
  return {
    getMainDb: vi.fn(() => ({ execute, insert })),
    execute,
    insert,
    values,
  };
});

vi.mock("@/db", () => ({
  getMainDb: mocks.getMainDb,
}));

import { writeMigrateAuditEntry } from "@/lib/migrate/audit";
import type { MigrateActionDefinition, MigrateActionResult } from "@/lib/migrate/types";

const definition: MigrateActionDefinition = {
  name: "migrate-products",
  method: "POST",
  externalAction: "migrate-products",
  factoryScope: "single",
  dbTarget: "factory",
  mutationType: "additive",
  requiresConfirmation: false,
  supportsDryRun: true,
  dryRunMode: "query-opt-in",
  failureMode: "single-db-transactional",
  handler: vi.fn(async () => ({ body: {} })),
};

describe("migrate audit logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue([{ exists: 1 }]);
    mocks.values.mockResolvedValue(undefined);
  });

  it("writes a success audit row when the table exists", async () => {
    const startedAt = new Date("2026-04-04T10:00:00.000Z");
    const result: MigrateActionResult = {
      status: 200,
      body: { success: true },
      auditSummary: { changed: 3 },
    };

    await writeMigrateAuditEntry({
      definition,
      context: {
        request: {} as never,
        name: "migrate-products",
        externalAction: "migrate-products",
        factoryKey: "si",
        confirmation: null,
        dryRunRequested: true,
        startedAt,
        callerIp: "10.0.0.5",
      },
      result,
    });

    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        actionName: "migrate-products",
        factoryScope: "single",
        factoryKeys: ["si"],
        dbTarget: "factory",
        mutationType: "additive",
        dryRun: true,
        callerIp: "10.0.0.5",
        confirmationProvided: false,
        startedAt,
        success: true,
        summary: { changed: 3 },
      })
    );
  });

  it("writes a failure audit row", async () => {
    const startedAt = new Date("2026-04-04T10:00:00.000Z");
    const error = new Error("broken");

    await writeMigrateAuditEntry({
      definition,
      context: {
        request: {} as never,
        name: "migrate-products",
        externalAction: "migrate-products",
        factoryKey: "si",
        confirmation: "x",
        dryRunRequested: false,
        startedAt,
        callerIp: "10.0.0.5",
      },
      error,
    });

    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        errorMessage: "broken",
        confirmationProvided: true,
      })
    );
  });
});
