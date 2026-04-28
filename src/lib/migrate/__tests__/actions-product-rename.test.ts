import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  postgresFactory: vi.fn(),
  getConfiguredFactoryConnection: vi.fn(),
}));

vi.mock("postgres", () => ({
  default: mocks.postgresFactory,
}));

vi.mock("@/lib/migrate/shared", () => ({
  FK_COL: "product_type_id",
  fetchFactoryProducts: vi.fn(),
  fetchFactoryProductsUnsafe: vi.fn(),
  fetchProductReferenceCounts: vi.fn(),
  getConfiguredFactoryConnection: mocks.getConfiguredFactoryConnection,
  getSupericeMigrateEnv: vi.fn(),
  normalizeProductRefCounts: (rows: Iterable<{ pid: unknown; cnt: unknown }>) =>
    Array.from(rows).map((row) => ({ pid: Number(row.pid), cnt: Number(row.cnt) })),
}));

import { runRenameLegacyProductsAction } from "@/lib/migrate/actions-product";
import type { MigrateActionContext } from "@/lib/migrate/types";

type ProductRow = {
  id: number;
  name: string;
  name_en: string | null;
  has_bag: boolean;
  decreases_bag: boolean;
  is_active: boolean;
  sort_order: number;
};

function createContext(url: string, method: "GET" | "POST", dryRunRequested: boolean): MigrateActionContext {
  return {
    request: new NextRequest(url, { method }),
    name: "rename-legacy-products",
    externalAction: "rename-legacy-products",
    factoryKey: "si",
    confirmation: null,
    dryRunRequested,
    startedAt: new Date("2026-04-09T00:00:00.000Z"),
    callerIp: "127.0.0.1",
  };
}

function createMockClient(initialRows: ProductRow[]) {
  const productRows = initialRows.map((row) => ({ ...row }));
  const referenceCounts: Record<string, number> = {
    transaction_items: 11,
    customer_prices: 6,
    bag_ledger: 4,
    production_logs: 2,
  };

  const runUnsafe = vi.fn(async (query: string, params?: ReadonlyArray<unknown>) => {
    if (query.includes("FROM product_types")) {
      return productRows
        .filter((row) => !params || !(params[0] instanceof Array) || params[0].includes(row.id))
        .sort((left, right) => left.id - right.id)
        .map((row) => ({ ...row }));
    }

    if (query.includes("SET name =")) {
      const [nextName, id] = params as [string, number];
      const target = productRows.find((row) => row.id === id);
      if (target) target.name = nextName;
      return { count: target ? 1 : 0 };
    }

    const tableMatch = query.match(/FROM\s+([a-z_]+)/i);
    const tableName = tableMatch?.[1] || "";
    return [
      {
        product_id: Number((params?.[0] as number[] | undefined)?.[0] ?? 91),
        count: referenceCounts[tableName] ?? 0,
      },
    ];
  });

  const client = {
    unsafe: runUnsafe,
    begin: vi.fn(async (callback: (tx: { unsafe: typeof runUnsafe }) => Promise<void>) => {
      await callback({ unsafe: runUnsafe });
    }),
    end: vi.fn(async () => undefined),
  };

  return { client, productRows, runUnsafe };
}

describe("rename legacy products action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConfiguredFactoryConnection.mockReturnValue({
      envVar: "DATABASE_URL_SI",
      url: "postgresql://localhost:5432/superice",
    });
  });

  it("returns a dry-run proposal without writing rows", async () => {
    const { client, runUnsafe } = createMockClient([
      { id: 91, name: "แพ็ค", name_en: "Pack", has_bag: false, decreases_bag: false, is_active: true, sort_order: 91 },
      { id: 92, name: "หลอดใหญ่", name_en: "Large Tube", has_bag: true, decreases_bag: false, is_active: true, sort_order: 92 },
      { id: 93, name: "เกล็ด", name_en: "Bare", has_bag: true, decreases_bag: false, is_active: true, sort_order: 93 },
      { id: 94, name: "หลอด 30", name_en: "Unit30", has_bag: true, decreases_bag: false, is_active: true, sort_order: 94 },
      { id: 95, name: "บด", name_en: "Crack", has_bag: true, decreases_bag: false, is_active: true, sort_order: 95 },
      { id: 96, name: "หลอดเล็ก", name_en: "UnitSmall", has_bag: true, decreases_bag: false, is_active: true, sort_order: 96 },
    ]);
    mocks.postgresFactory.mockReturnValue(client);

    const result = await runRenameLegacyProductsAction(
      createContext("http://localhost/api/migrate?action=rename-legacy-products&factory=si", "POST", true)
    );

    expect(result.status).toBeUndefined();
    expect(result.body.dryRun).toBe(true);
    expect(result.body.changesNeeded).toBe(true);
    expect(client.begin).not.toHaveBeenCalled();
    expect(runUnsafe).not.toHaveBeenCalledWith(expect.stringContaining("SET name ="), expect.anything());
  });

  it("applies the rename and verifies the final labels", async () => {
    const { client, productRows } = createMockClient([
      { id: 91, name: "แพ็ค", name_en: "Pack", has_bag: false, decreases_bag: false, is_active: true, sort_order: 91 },
      { id: 92, name: "หลอดใหญ่", name_en: "Large Tube", has_bag: true, decreases_bag: false, is_active: true, sort_order: 92 },
      { id: 93, name: "เกล็ด", name_en: "Bare", has_bag: true, decreases_bag: false, is_active: true, sort_order: 93 },
      { id: 94, name: "หลอด 30", name_en: "Unit30", has_bag: true, decreases_bag: false, is_active: true, sort_order: 94 },
      { id: 95, name: "บด", name_en: "Crack", has_bag: true, decreases_bag: false, is_active: true, sort_order: 95 },
      { id: 96, name: "หลอดเล็ก", name_en: "UnitSmall", has_bag: true, decreases_bag: false, is_active: true, sort_order: 96 },
    ]);
    mocks.postgresFactory.mockReturnValue(client);

    const result = await runRenameLegacyProductsAction(
      createContext("http://localhost/api/migrate?action=rename-legacy-products&factory=si", "POST", false)
    );

    expect(result.body.success).toBe(true);
    expect(result.body.changedCount).toBe(5);
    expect(client.begin).toHaveBeenCalledOnce();
    expect(productRows.map((row) => ({ id: row.id, name: row.name }))).toEqual([
      { id: 91, name: "ซอง" },
      { id: 92, name: "แพ็ค" },
      { id: 93, name: "หลอดใหญ่" },
      { id: 94, name: "หลอดดล็ก โม่" },
      { id: 95, name: "หลอดใหญ่ โม่" },
      { id: 96, name: "หลอดเล็ก" },
    ]);
  });
});
