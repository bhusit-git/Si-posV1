import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({
  getDb: () => ({ execute: async () => [] }),
  getMainDb: () => ({ execute: async () => [] }),
}));

import { MIGRATE_ACTIONS } from "@/lib/migrate/registry";

describe("migrate action registry", () => {
  it("declares topology and safety metadata for every action", () => {
    for (const action of MIGRATE_ACTIONS) {
      expect(action.name).toBeTruthy();
      expect(action.method === "GET" || action.method === "POST").toBe(true);
      expect(["none", "single", "multiple", "all"]).toContain(action.factoryScope);
      expect(["main", "factory", "both"]).toContain(action.dbTarget);
      expect(["read-only", "additive", "destructive"]).toContain(action.mutationType);
      expect(["disabled", "query-opt-in", "query-opt-out"]).toContain(action.dryRunMode);
      expect([
        "single-db-transactional",
        "multi-step-best-effort",
        "irreversible",
      ]).toContain(action.failureMode);
      expect(typeof action.handler).toBe("function");
    }
  });

  it("uses unique method/action dispatch keys", () => {
    const keys = MIGRATE_ACTIONS.map((action) => `${action.method}:${action.externalAction ?? "__default__"}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("marks known destructive confirmation flows explicitly", () => {
    const byName = new Map(MIGRATE_ACTIONS.map((action) => [action.name, action]));

    expect(byName.get("wipe-factory-data")?.requiresConfirmation).toBe("WIPE_FACTORY_DATA");
    expect(byName.get("wipe-transactions-data")?.requiresConfirmation).toBe(
      "WIPE_TRANSACTIONS_DATA"
    );
    expect(byName.get("wipe-transactions-window")?.requiresConfirmation).toBe(
      "WIPE_TRANSACTIONS_WINDOW"
    );
    expect(byName.get("cleanup-legacy-items-window")?.requiresConfirmation).toBe(
      "CLEANUP_LEGACY_ITEMS_WINDOW"
    );
  });
});
