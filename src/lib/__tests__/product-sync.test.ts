import { describe, expect, it } from "vitest";

import {
  buildProductSyncPlan,
  classifyProductSyncPlan,
  normalizeSyncableProducts,
  type SyncableProduct,
} from "@/lib/product-sync";

describe("product sync helpers", () => {
  it("normalizes SQL-style rows into syncable products", () => {
    const rows = normalizeSyncableProducts([
      {
        id: "8",
        name: "แพ็ค 10",
        name_en: "Pack 10",
        has_bag: "t",
        decreases_bag: "f",
        is_active: true,
        sort_order: "8",
        catalog_code: "205",
        family: "small_tube",
        form: "standard",
        package_type: "returnable_bag",
        size_value: "10",
        size_unit: "kg",
        size_label: "10 กก.",
      },
    ]);

    expect(rows).toEqual<SyncableProduct[]>([
      {
        id: 8,
        name: "แพ็ค 10",
        name_en: "Pack 10",
        has_bag: true,
        decreases_bag: false,
        is_active: true,
        sort_order: 8,
        catalog_code: 205,
        family: "small_tube",
        form: "standard",
        package_type: "returnable_bag",
        size_value: 10,
        size_unit: "kg",
        size_label: "10 กก.",
      },
    ]);
  });

  it("detects inserts, updates, and deletes by product ID", () => {
    const source: SyncableProduct[] = [
      {
        id: 1,
        name: "ซอง",
        name_en: "Block",
        has_bag: false,
        decreases_bag: false,
        is_active: true,
        sort_order: 0,
        catalog_code: 101,
        family: "block",
        form: "standard",
        package_type: "loose",
        size_value: 160,
        size_unit: "piece",
        size_label: "160 ก้อน",
      },
      {
        id: 97,
        name: "ซื้อกระสอบ ไม่ติดตาม",
        name_en: null,
        has_bag: false,
        decreases_bag: false,
        is_active: true,
        sort_order: 40,
        catalog_code: null,
        family: null,
        form: null,
        package_type: null,
        size_value: null,
        size_unit: null,
        size_label: null,
      },
    ];
    const target: SyncableProduct[] = [
      {
        id: 1,
        name: "ซอง",
        name_en: "Block",
        has_bag: true,
        decreases_bag: false,
        is_active: true,
        sort_order: 1,
        catalog_code: 102,
        family: "block",
        form: "crushed",
        package_type: "clear_bag",
        size_value: 13,
        size_unit: "kg",
        size_label: "13 กก.",
      },
      {
        id: 56,
        name: "ไอซ์เบิร์ก 1.1",
        name_en: null,
        has_bag: false,
        decreases_bag: false,
        is_active: true,
        sort_order: 56,
        catalog_code: 916,
        family: null,
        form: null,
        package_type: null,
        size_value: null,
        size_unit: null,
        size_label: null,
      },
    ];

    const plan = buildProductSyncPlan(source, target);

    expect(plan.matchesExactly).toBe(false);
    expect(plan.inserts.map((entry) => entry.id)).toEqual([97]);
    expect(plan.updates.map((entry) => entry.id)).toEqual([1]);
    expect(plan.deletes.map((entry) => entry.id)).toEqual([56]);
    expect(plan.updates[0]?.changes).toEqual([
      { field: "has_bag", source: false, target: true },
      { field: "sort_order", source: 0, target: 1 },
      { field: "catalog_code", source: 101, target: 102 },
      { field: "form", source: "standard", target: "crushed" },
      { field: "package_type", source: "loose", target: "clear_bag" },
      { field: "size_value", source: 160, target: 13 },
      { field: "size_unit", source: "piece", target: "kg" },
      { field: "size_label", source: "160 ก้อน", target: "13 กก." },
    ]);
  });

  it("classifies referenced deletes as deactivations and leaves unreferenced deletes as hard deletes", () => {
    const source: SyncableProduct[] = [
      {
        id: 1,
        name: "ซอง",
        name_en: "Block",
        has_bag: false,
        decreases_bag: false,
        is_active: true,
        sort_order: 1,
        catalog_code: 101,
        family: "block",
        form: "standard",
        package_type: "loose",
        size_value: 160,
        size_unit: "piece",
        size_label: "160 ก้อน",
      },
    ];
    const target: SyncableProduct[] = [
      {
        id: 1,
        name: "ซอง",
        name_en: "Block",
        has_bag: false,
        decreases_bag: false,
        is_active: true,
        sort_order: 1,
        catalog_code: 101,
        family: "block",
        form: "standard",
        package_type: "loose",
        size_value: 160,
        size_unit: "piece",
        size_label: "160 ก้อน",
      },
      {
        id: 55,
        name: "Bearing Extra A",
        name_en: null,
        has_bag: false,
        decreases_bag: false,
        is_active: true,
        sort_order: 55,
        catalog_code: null,
        family: null,
        form: null,
        package_type: null,
        size_value: null,
        size_unit: null,
        size_label: null,
      },
      {
        id: 56,
        name: "Bearing Extra B",
        name_en: null,
        has_bag: false,
        decreases_bag: false,
        is_active: true,
        sort_order: 56,
        catalog_code: null,
        family: null,
        form: null,
        package_type: null,
        size_value: null,
        size_unit: null,
        size_label: null,
      },
    ];

    const plan = buildProductSyncPlan(source, target);
    const classified = classifyProductSyncPlan(plan, {
      transaction_items: [{ product_id: 55, count: 4 }],
      customer_prices: [],
      bag_ledger: [],
      production_logs: [],
    });

    expect(classified.deletes.map((entry) => entry.id)).toEqual([56]);
    expect(classified.referencedDeletes).toMatchObject([
      {
        id: 55,
        totalReferences: 4,
        references: [{ tableName: "transaction_items", count: 4 }],
      },
    ]);
    expect(classified.deactivations.map((entry) => entry.id)).toEqual([55]);
  });
});
