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

import {
  runCleanupLegacyPricesAction,
  runMigratePricesAction,
  runRolloutProductTaxonomyAction,
  runSeedBillCounterAction,
} from "@/lib/migrate/actions-product";
import type { MigrateActionContext } from "@/lib/migrate/types";

type ProductRow = {
  id: number;
  name: string;
  name_en: string | null;
  has_bag: boolean;
  decreases_bag: boolean;
  is_active: boolean;
  sort_order: number;
  catalog_code: number | null;
  family: string | null;
  form: string | null;
  package_type: string | null;
  size_value: number | null;
  size_unit: string | null;
  size_label: string | null;
};

type BillCounterRow = {
  id: number;
  factory_key: string;
  next_number: number;
  updated_at: string;
  created_at: string;
};

type CustomerPriceRow = {
  customer_id: number;
  product_type_id: number;
  unit_price: number;
  bag_deposit: number;
};

type ReferenceRow = {
  product_type_id: number;
};

function createContext(
  url: string,
  action: MigrateActionContext["name"],
  body?: Record<string, unknown>
): MigrateActionContext {
  return {
    request: new NextRequest(url, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }),
    name: action,
    externalAction: url.includes("action=") ? new URL(url).searchParams.get("action") : null,
    factoryKey: "si",
    confirmation: null,
    dryRunRequested: false,
    startedAt: new Date("2026-04-12T00:00:00.000Z"),
    callerIp: "127.0.0.1",
  };
}

function createMockClient(
  initialProducts: ProductRow[] = [],
  initialBillCounters: BillCounterRow[] = [],
  options?: {
    customerPrices?: CustomerPriceRow[];
    transactionItems?: ReferenceRow[];
    bagLedger?: ReferenceRow[];
    productionLogs?: ReferenceRow[];
  }
) {
  const productRows = initialProducts.map((row) => ({ ...row }));
  const billCounters = initialBillCounters.map((row) => ({ ...row }));
  const customerPrices = (options?.customerPrices ?? []).map((row) => ({ ...row }));
  const transactionItems = (options?.transactionItems ?? []).map((row) => ({ ...row }));
  const bagLedger = (options?.bagLedger ?? []).map((row) => ({ ...row }));
  const productionLogs = (options?.productionLogs ?? []).map((row) => ({ ...row }));

  function upsertCustomerPrice(nextRow: CustomerPriceRow) {
    const existing = customerPrices.find(
      (row) =>
        row.customer_id === nextRow.customer_id &&
        row.product_type_id === nextRow.product_type_id
    );
    if (existing) {
      existing.unit_price = nextRow.unit_price;
      existing.bag_deposit = nextRow.bag_deposit;
      return;
    }
    customerPrices.push(nextRow);
  }

  const runUnsafe = vi.fn(async (query: string, params?: ReadonlyArray<unknown>) => {
    const normalized = query.replace(/\s+/g, " ").trim();

    if (normalized.startsWith("ALTER TABLE product_types ADD COLUMN IF NOT EXISTS")) {
      return [];
    }

    if (normalized.startsWith("CREATE UNIQUE INDEX IF NOT EXISTS idx_product_types_catalog_code")) {
      return [];
    }

    if (normalized.startsWith("INSERT INTO product_types")) {
      const [
        id,
        name,
        nameEn,
        hasBag,
        decreasesBag,
        isActive,
        sortOrder,
        catalogCode,
        family,
        form,
        packageType,
        sizeValue,
        sizeUnit,
        sizeLabel,
      ] = params as [
        number,
        string,
        string | null,
        boolean,
        boolean,
        boolean,
        number,
        number | null,
        string | null,
        string | null,
        string | null,
        number | null,
        string | null,
        string | null,
      ];

      const existing = productRows.find((row) => row.id === id);
      const nextRow: ProductRow = {
        id,
        name,
        name_en: nameEn,
        has_bag: hasBag,
        decreases_bag: decreasesBag,
        is_active: isActive,
        sort_order: sortOrder,
        catalog_code: catalogCode,
        family,
        form,
        package_type: packageType,
        size_value: sizeValue,
        size_unit: sizeUnit,
        size_label: sizeLabel,
      };

      if (existing) Object.assign(existing, nextRow);
      else productRows.push(nextRow);
      return { count: 1 };
    }

    if (
      normalized.startsWith("INSERT INTO customer_prices (customer_id, product_type_id, unit_price, bag_deposit) SELECT id, 41, 10, 0 FROM customers")
    ) {
      return { count: 0 };
    }

    if (
      normalized.startsWith("INSERT INTO customer_prices (customer_id, product_type_id, unit_price, bag_deposit)")
    ) {
      const [nextId, legacyId] = params as [number, number];
      const sourceRows = customerPrices.filter((row) => row.product_type_id === legacyId);
      const filteredRows = normalized.includes("cp.unit_price > 0")
        ? sourceRows.filter((row) => row.unit_price > 0)
        : sourceRows;
      for (const row of filteredRows) {
        upsertCustomerPrice({
          customer_id: row.customer_id,
          product_type_id: nextId,
          unit_price: row.unit_price,
          bag_deposit: row.bag_deposit,
        });
      }
      return { count: filteredRows.length };
    }

    if (
      normalized.startsWith("UPDATE transaction_items SET product_type_id = $1 WHERE product_type_id = $2") ||
      normalized.startsWith("UPDATE bag_ledger SET product_type_id = $1 WHERE product_type_id = $2") ||
      normalized.startsWith("UPDATE production_logs SET product_type_id = $1 WHERE product_type_id = $2")
    ) {
      const [nextId, legacyId] = params as [number, number];
      const rows = normalized.startsWith("UPDATE transaction_items")
        ? transactionItems
        : normalized.startsWith("UPDATE bag_ledger")
          ? bagLedger
          : productionLogs;
      let count = 0;
      for (const row of rows) {
        if (row.product_type_id === legacyId) {
          row.product_type_id = nextId;
          count += 1;
        }
      }
      return { count };
    }

    if (normalized.startsWith("DELETE FROM customer_prices WHERE product_type_id = $1")) {
      const [legacyId] = params as [number];
      let count = 0;
      for (let index = customerPrices.length - 1; index >= 0; index -= 1) {
        if (customerPrices[index].product_type_id === legacyId) {
          customerPrices.splice(index, 1);
          count += 1;
        }
      }
      return { count };
    }

    if (
      normalized.startsWith("UPDATE product_types SET is_active = false, sort_order = GREATEST(COALESCE(sort_order, 0), 900 + id), catalog_code = NULL WHERE id = $1")
    ) {
      const [id] = params as [number];
      const existing = productRows.find((row) => row.id === id);
      if (!existing) return { count: 0 };
      existing.is_active = false;
      existing.sort_order = Math.max(existing.sort_order ?? 0, 900 + existing.id);
      existing.catalog_code = null;
      return { count: 1 };
    }

    if (
      normalized.startsWith("UPDATE product_types SET is_active = false, sort_order = 900 + id WHERE id BETWEEN 91 AND 96")
    ) {
      let count = 0;
      for (const row of productRows) {
        if (row.id >= 91 && row.id <= 96) {
          row.is_active = false;
          row.sort_order = 900 + row.id;
          count += 1;
        }
      }
      return { count };
    }

    if (normalized.startsWith("UPDATE product_types SET catalog_code = $1 WHERE id = $2")) {
      const [catalogCode, id] = params as [number, number];
      const existing = productRows.find((row) => row.id === id);
      if (existing) {
        existing.catalog_code = catalogCode;
        return { count: 1 };
      }
      return { count: 0 };
    }

    if (normalized.startsWith("UPDATE product_types p SET is_active = false, sort_order = COALESCE(sort_order, 900) + 1000")) {
      const [canonicalIds, canonicalNames] = params as [number[], string[]];
      const canonicalNameSet = new Set(canonicalNames);
      let count = 0;
      for (const row of productRows) {
        if (!canonicalIds.includes(row.id) && canonicalNameSet.has(row.name)) {
          row.is_active = false;
          row.sort_order = (row.sort_order ?? 900) + 1000;
          count += 1;
        }
      }
      return { count };
    }

    if (normalized.startsWith("SELECT product_type_id as pid, COUNT(*)::int as cnt FROM customer_prices WHERE product_type_id = ANY(")) {
      const [legacyIds] = params as [number[]];
      return legacyIds
        .map((id) => ({
          pid: id,
          cnt: customerPrices.filter((row) => row.product_type_id === id).length,
        }))
        .filter((row) => row.cnt > 0)
        .sort((left, right) => left.pid - right.pid);
    }

    if (normalized.startsWith("DELETE FROM customer_prices WHERE product_type_id = ANY(")) {
      const [legacyIds] = params as [number[]];
      const legacyIdSet = new Set(legacyIds);
      let count = 0;
      for (let index = customerPrices.length - 1; index >= 0; index -= 1) {
        if (legacyIdSet.has(customerPrices[index].product_type_id)) {
          customerPrices.splice(index, 1);
          count += 1;
        }
      }
      return { count };
    }

    if (normalized.startsWith("SELECT COUNT(*)::int as cnt FROM customer_prices")) {
      return [{ cnt: customerPrices.length }];
    }

    if (normalized.startsWith("SELECT")) {
      if (normalized.includes("FROM customer_prices WHERE product_type_id IN (1,4,5,6,7,9,19)")) {
        return [{
          new_prices: customerPrices.filter((row) => [1, 4, 5, 6, 7, 9, 19].includes(row.product_type_id) && row.unit_price > 0).length,
          legacy_prices: customerPrices.filter((row) => [91, 92, 93, 94, 95, 96, 98].includes(row.product_type_id) && row.unit_price > 0).length,
          p41_prices: customerPrices.filter((row) => row.product_type_id === 41 && row.unit_price === 10).length,
        }];
      }
    }

    if (normalized.includes("COUNT(*)::int AS canonical_row_count")) {
      const [canonicalIds] = params as [number[]];
      const canonicalRows = productRows.filter((row) => canonicalIds.includes(row.id));
      return [
        {
          canonical_row_count: canonicalRows.length,
          catalog_code_populated_count: canonicalRows.filter((row) => row.catalog_code != null).length,
          family_populated_count: canonicalRows.filter((row) => row.family != null).length,
          package_type_populated_count: canonicalRows.filter((row) => row.package_type != null).length,
          size_label_populated_count: canonicalRows.filter((row) => row.size_label != null).length,
        },
      ];
    }

    if (normalized.includes("legacy_rows_active_count")) {
      return [
        {
          legacy_rows_active_count: productRows.filter(
            (row) => row.id >= 91 && row.id <= 96 && row.is_active
          ).length,
        },
      ];
    }

    if (normalized.startsWith("SELECT name, array_agg(id ORDER BY id) AS ids, COUNT(*)::int AS count FROM product_types")) {
      const groups = new Map<string, number[]>();
      for (const row of productRows.filter((product) => product.is_active)) {
        const ids = groups.get(row.name) || [];
        ids.push(row.id);
        groups.set(row.name, ids);
      }

      return Array.from(groups.entries())
        .filter(([, ids]) => ids.length > 1)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, ids]) => ({
          name,
          ids: ids.sort((a, b) => a - b),
          count: ids.length,
        }));
    }

    if (normalized.startsWith("CREATE TABLE IF NOT EXISTS bill_counters")) {
      return [];
    }

    if (normalized.startsWith("CREATE UNIQUE INDEX IF NOT EXISTS idx_bill_counters_factory")) {
      return [];
    }

    if (normalized.startsWith("INSERT INTO bill_counters")) {
      const [factoryKey, nextNumber] = params as [string, number];
      const existing = billCounters.find((row) => row.factory_key === factoryKey);
      const now = "2026-04-12T12:00:00.000Z";
      if (existing) {
        existing.next_number = nextNumber;
        existing.updated_at = now;
        return [existing];
      }

      const nextRow: BillCounterRow = {
        id: billCounters.length + 1,
        factory_key: factoryKey,
        next_number: nextNumber,
        created_at: now,
        updated_at: now,
      };
      billCounters.push(nextRow);
      return [nextRow];
    }

    if (normalized.startsWith("SELECT COUNT(*)::int AS cnt FROM bill_counters WHERE factory_key = $1")) {
      const [factoryKey] = params as [string];
      return [{ cnt: billCounters.filter((row) => row.factory_key === factoryKey).length }];
    }

    throw new Error(`Unhandled query in test mock: ${normalized}`);
  });

  type MockSqlTag = ((strings: TemplateStringsArray, ...values: ReadonlyArray<unknown>) => Promise<unknown>) & {
    unsafe: typeof runUnsafe;
    begin: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };

  const sqlTag = (async (
    strings: TemplateStringsArray,
    ...values: ReadonlyArray<unknown>
  ) => {
    let query = strings[0] ?? "";
    for (let index = 0; index < values.length; index += 1) {
      query += `$${index + 1}${strings[index + 1] ?? ""}`;
    }
    return runUnsafe(query, values);
  }) as unknown as MockSqlTag;

  sqlTag.unsafe = runUnsafe;
  sqlTag.begin = vi.fn(async (callback: (tx: { unsafe: typeof runUnsafe }) => Promise<unknown>) =>
    callback({ unsafe: runUnsafe })
  );
  sqlTag.end = vi.fn(async () => undefined);

  return {
    client: sqlTag,
    productRows,
    billCounters,
    customerPrices,
    transactionItems,
    bagLedger,
    productionLogs,
  };
}

describe("rollout migrate actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConfiguredFactoryConnection.mockReturnValue({
      envVar: "DATABASE_URL_SI",
      url: "postgresql://localhost:5432/superice",
    });
  });

  it("backfills canonical product taxonomy and stays re-runnable", async () => {
    const { client, customerPrices, productRows, transactionItems } = createMockClient(
      [
        {
          id: 1,
          name: "ซอง",
          name_en: "Block",
          has_bag: true,
          decreases_bag: false,
          is_active: true,
          sort_order: 1,
          catalog_code: null,
          family: null,
          form: null,
          package_type: null,
          size_value: null,
          size_unit: null,
          size_label: null,
        },
        {
          id: 21,
          name: "แพ็ค 10",
          name_en: "Pack 10",
          has_bag: true,
          decreases_bag: false,
          is_active: true,
          sort_order: 15,
          catalog_code: 205,
          family: "small_tube",
          form: "standard",
          package_type: "returnable_bag",
          size_value: 10,
          size_unit: "kg",
          size_label: "10 กก.",
        },
        {
          id: 91,
          name: "ซอง",
          name_en: "Legacy Block",
          has_bag: true,
          decreases_bag: false,
          is_active: true,
          sort_order: 91,
          catalog_code: null,
          family: null,
          form: null,
          package_type: null,
          size_value: null,
          size_unit: null,
          size_label: null,
        },
        {
          id: 98,
          name: "ซอง (ครึ่ง)",
          name_en: "Half-Block duplicate",
          has_bag: false,
          decreases_bag: false,
          is_active: true,
          sort_order: 98,
          catalog_code: null,
          family: null,
          form: null,
          package_type: null,
          size_value: null,
          size_unit: null,
          size_label: null,
        },
      ],
      [],
      {
        customerPrices: [
          { customer_id: 1, product_type_id: 21, unit_price: 55, bag_deposit: 0 },
        ],
        transactionItems: [{ product_type_id: 21 }],
      }
    );
    mocks.postgresFactory.mockReturnValue(client);

    const first = await runRolloutProductTaxonomyAction(
      createContext(
        "http://localhost/api/migrate?action=rollout-product-taxonomy&factory=si",
        "rollout-product-taxonomy"
      )
    );
    const second = await runRolloutProductTaxonomyAction(
      createContext(
        "http://localhost/api/migrate?action=rollout-product-taxonomy&factory=si",
        "rollout-product-taxonomy"
      )
    );
    const firstVerification = first.body.verification as Record<string, unknown>;
    const secondVerification = second.body.verification as Record<string, unknown>;

    expect(first.body.success).toBe(true);
    expect(firstVerification).toMatchObject({
      canonicalRowCount: 22,
      catalogCodePopulatedCount: 22,
      familyPopulatedCount: 22,
      packageTypePopulatedCount: 22,
      sizeLabelPopulatedCount: 21,
      legacyRowsActiveCount: 0,
    });
    expect(firstVerification.duplicateActiveNames).toEqual([]);
    expect(secondVerification).toMatchObject({
      canonicalRowCount: 22,
      catalogCodePopulatedCount: 22,
      familyPopulatedCount: 22,
      packageTypePopulatedCount: 22,
      sizeLabelPopulatedCount: 21,
      legacyRowsActiveCount: 0,
    });
    expect(productRows.filter((row) => row.id >= 1 && row.id <= 23)).toHaveLength(23);
    expect(productRows.find((row) => row.id === 1)?.family).toBe("block");
    expect(productRows.find((row) => row.id === 20)?.size_label).toBe("30 กก.");
    expect(productRows.find((row) => row.id === 8)?.catalog_code).toBe(205);
    expect(productRows.find((row) => row.id === 21)?.is_active).toBe(false);
    expect(productRows.find((row) => row.id === 21)?.catalog_code).toBe(null);
    expect(productRows.find((row) => row.id === 22)?.catalog_code).toBe(107);
    expect(productRows.find((row) => row.id === 23)?.catalog_code).toBe(307);
    expect(productRows.find((row) => row.id === 91)?.is_active).toBe(false);
    expect(productRows.find((row) => row.id === 98)?.is_active).toBe(false);
    expect(customerPrices).toEqual([
      { customer_id: 1, product_type_id: 8, unit_price: 55, bag_deposit: 0 },
    ]);
    expect(transactionItems).toEqual([{ product_type_id: 8 }]);
  });

  it("copies 98 prices to product 19 and cleans stale price rows", async () => {
    const { client, customerPrices } = createMockClient([], [], {
      customerPrices: [
        { customer_id: 1, product_type_id: 91, unit_price: 11, bag_deposit: 0 },
        { customer_id: 1, product_type_id: 98, unit_price: 22, bag_deposit: 0 },
        { customer_id: 2, product_type_id: 21, unit_price: 33, bag_deposit: 0 },
      ],
    });
    mocks.postgresFactory.mockReturnValue(client);

    const migrateResult = await runMigratePricesAction(
      createContext(
        "http://localhost/api/migrate?action=migrate-prices&factory=si",
        "migrate-prices"
      )
    );

    expect(migrateResult.body.success).toBe(true);
    expect(customerPrices).toEqual(
      expect.arrayContaining([
        { customer_id: 1, product_type_id: 1, unit_price: 11, bag_deposit: 0 },
        { customer_id: 1, product_type_id: 19, unit_price: 22, bag_deposit: 0 },
      ])
    );

    const cleanupResult = await runCleanupLegacyPricesAction(
      createContext(
        "http://localhost/api/migrate?action=cleanup-legacy-prices&factory=si",
        "cleanup-legacy-prices"
      )
    );

    expect(cleanupResult.body.success).toBe(true);
    expect(customerPrices).toEqual([
      { customer_id: 1, product_type_id: 1, unit_price: 11, bag_deposit: 0 },
      { customer_id: 1, product_type_id: 19, unit_price: 22, bag_deposit: 0 },
    ]);
  });

  it("rejects missing or invalid explicit bill-counter values", async () => {
    const { client } = createMockClient();
    mocks.postgresFactory.mockReturnValue(client);

    const result = await runSeedBillCounterAction(
      createContext(
        "http://localhost/api/migrate?action=seed-bill-counter&factory=si",
        "seed-bill-counter",
        {}
      )
    );

    expect(result.status).toBe(400);
    expect(result.body.error).toContain("nextNumber");
    expect(mocks.postgresFactory).not.toHaveBeenCalled();
  });

  it("upserts the requested bill-counter value for the target factory", async () => {
    const { client, billCounters } = createMockClient([], [
      {
        id: 4,
        factory_key: "si",
        next_number: 1200,
        created_at: "2026-04-11T12:00:00.000Z",
        updated_at: "2026-04-11T12:00:00.000Z",
      },
    ]);
    mocks.postgresFactory.mockReturnValue(client);

    const result = await runSeedBillCounterAction(
      createContext(
        "http://localhost/api/migrate?action=seed-bill-counter&factory=si",
        "seed-bill-counter",
        { nextNumber: 1234 }
      )
    );

    expect(result.body.success).toBe(true);
    expect(result.body.billCounter).toMatchObject({
      factoryKey: "si",
      nextNumber: 1234,
      rowCountForFactory: 1,
    });
    expect(billCounters).toHaveLength(1);
    expect(billCounters[0].next_number).toBe(1234);
  });
});
