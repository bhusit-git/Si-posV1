import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  postgresFactory: vi.fn(),
  fetchFactoryProducts: vi.fn(),
  fetchFactoryProductsUnsafe: vi.fn(),
  fetchProductReferenceCounts: vi.fn(),
  getSupericeMigrateEnv: vi.fn(),
}));

vi.mock("postgres", () => ({
  default: mocks.postgresFactory,
}));

vi.mock("@/lib/migrate/shared", async () => {
  const actual = await vi.importActual<typeof import("@/lib/migrate/shared")>(
    "@/lib/migrate/shared"
  );
  return {
    ...actual,
    fetchFactoryProducts: mocks.fetchFactoryProducts,
    fetchFactoryProductsUnsafe: mocks.fetchFactoryProductsUnsafe,
    fetchProductReferenceCounts: mocks.fetchProductReferenceCounts,
    getSupericeMigrateEnv: mocks.getSupericeMigrateEnv,
  };
});

import { runSyncSiProductsToBearingAction } from "@/lib/migrate/actions-product";
import type { MigrateActionContext } from "@/lib/migrate/types";
import type { SyncableProduct } from "@/lib/product-sync";

function createContext(dryRunRequested: boolean): MigrateActionContext {
  return {
    request: new NextRequest(
      `http://localhost/api/migrate?action=sync-si-products-to-bearing${
        dryRunRequested ? "&dryRun=1" : ""
      }`,
      { method: "POST" }
    ),
    name: "sync-si-products-to-bearing",
    externalAction: "sync-si-products-to-bearing",
    factoryKey: null,
    confirmation: null,
    dryRunRequested,
    startedAt: new Date("2026-04-18T00:00:00.000Z"),
    callerIp: "127.0.0.1",
  };
}

function buildProduct(id: number, name: string): SyncableProduct {
  return {
    id,
    name,
    name_en: null,
    has_bag: false,
    decreases_bag: false,
    is_active: true,
    sort_order: id,
    catalog_code: null,
    family: null,
    form: null,
    package_type: null,
    size_value: null,
    size_unit: null,
    size_label: null,
  };
}

describe("sync SI products to Bearing action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSupericeMigrateEnv.mockReturnValue({
      getFactoryDatabaseUrl: (factoryKey: string) =>
        factoryKey === "si"
          ? "postgresql://localhost:5432/si"
          : factoryKey === "bearing"
            ? "postgresql://localhost:5432/bearing"
            : null,
    });
  });

  it("returns dry-run categories for hard deletes and deactivations", async () => {
    const sourceProducts = [buildProduct(1, "ซอง")];
    const targetProducts = [
      buildProduct(1, "ซอง"),
      buildProduct(55, "Bearing Referenced"),
      buildProduct(56, "Bearing Unreferenced"),
    ];

    const sourceClient = { end: vi.fn(async () => undefined) };
    const targetClient = { end: vi.fn(async () => undefined) };
    mocks.postgresFactory
      .mockReturnValueOnce(sourceClient)
      .mockReturnValueOnce(targetClient);
    mocks.fetchFactoryProducts
      .mockResolvedValueOnce(sourceProducts)
      .mockResolvedValueOnce(targetProducts);
    mocks.fetchProductReferenceCounts.mockResolvedValue({
      transaction_items: [{ product_id: 55, count: 3 }],
      customer_prices: [],
      bag_ledger: [],
      production_logs: [],
    });

    const result = await runSyncSiProductsToBearingAction(createContext(true));

    expect(result.status).toBeUndefined();
    expect(result.body.dryRun).toBe(true);
    expect(result.body.deletes).toMatchObject([{ id: 56 }]);
    expect(result.body.referencedDeletes).toMatchObject([
      { id: 55, totalReferences: 3 },
    ]);
    expect(result.body.deactivations).toMatchObject([{ id: 55 }]);
    expect(result.body.verification).toMatchObject({
      hardDeleteCount: 1,
      deactivationCount: 1,
    });
  });

  it("deactivates referenced extras and deletes only unreferenced extras on apply", async () => {
    const sourceProducts = [buildProduct(1, "ซอง")];
    const targetProducts = [
      buildProduct(1, "ซอง"),
      buildProduct(55, "Bearing Referenced"),
      buildProduct(56, "Bearing Unreferenced"),
    ];
    const finalProducts = [
      buildProduct(1, "ซอง"),
      { ...buildProduct(55, "Bearing Referenced"), is_active: false, sort_order: 1055 },
    ];

    const sourceClient = { end: vi.fn(async () => undefined) };
    const runUnsafe = vi.fn(async (query: string) => {
      if (query.includes("SELECT COALESCE(MAX(id), 0) + 1 AS next_val")) {
        return [{ next_val: 56 }];
      }
      if (query.includes("COUNT(*)::int AS cnt")) {
        return [{ cnt: 0 }];
      }
      return [];
    });
    const targetClient = {
      begin: vi.fn(async (callback: (tx: { unsafe: typeof runUnsafe }) => Promise<void>) => {
        await callback({ unsafe: runUnsafe });
      }),
      end: vi.fn(async () => undefined),
    };
    mocks.postgresFactory
      .mockReturnValueOnce(sourceClient)
      .mockReturnValueOnce(targetClient);
    mocks.fetchFactoryProducts
      .mockResolvedValueOnce(sourceProducts)
      .mockResolvedValueOnce(targetProducts);
    mocks.fetchProductReferenceCounts.mockResolvedValue({
      transaction_items: [{ product_id: 55, count: 3 }],
      customer_prices: [],
      bag_ledger: [],
      production_logs: [],
    });
    mocks.fetchFactoryProductsUnsafe.mockResolvedValue(finalProducts);

    const result = await runSyncSiProductsToBearingAction(createContext(false));

    expect(result.status).toBeUndefined();
    expect(result.body.success).toBe(true);
    expect(runUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM product_types WHERE id = ANY"),
      [[56]]
    );
    expect(runUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE product_types"),
      [[55]]
    );
    expect(result.body.verification).toMatchObject({
      managedCatalogMatchesExactly: true,
      hardDeletedIds: [56],
      deactivatedIds: [55],
      activeExtraIds: [],
    });
  });

  it("preserves legacy 91-96 exactly and excludes them from managed sync updates", async () => {
    const sourceProducts = [buildProduct(1, "ซอง"), buildProduct(91, "ซอง")];
    const targetProducts = [buildProduct(1, "ซอง"), buildProduct(91, "แพ็ค")];

    const sourceClient = { end: vi.fn(async () => undefined) };
    const targetClient = { end: vi.fn(async () => undefined) };
    mocks.postgresFactory
      .mockReturnValueOnce(sourceClient)
      .mockReturnValueOnce(targetClient);
    mocks.fetchFactoryProducts
      .mockResolvedValueOnce(sourceProducts)
      .mockResolvedValueOnce(targetProducts);
    mocks.fetchProductReferenceCounts.mockResolvedValue({
      transaction_items: [],
      customer_prices: [],
      bag_ledger: [],
      production_logs: [],
    });

    const result = await runSyncSiProductsToBearingAction(createContext(true));
    const body = result.body as {
      plan: {
        updates: Array<{ id: number }>;
        sourceCount: number;
        targetCount: number;
      };
      log: string[];
    };

    expect(result.status).toBeUndefined();
    expect(body.plan.updates.map((entry) => entry.id)).toEqual([]);
    expect(body.plan.sourceCount).toBe(1);
    expect(body.plan.targetCount).toBe(1);
    expect(body.log).toContain("Preserved Bearing legacy IDs: 91, 92, 93, 94, 95, 96");
  });
});
