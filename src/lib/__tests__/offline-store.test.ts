import { beforeEach, describe, expect, it, vi } from "vitest";

const memoryStore = new Map<string, unknown>();

vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: unknown) => memoryStore.get(String(key))),
  set: vi.fn(async (key: unknown, value: unknown) => {
    memoryStore.set(String(key), value);
  }),
  del: vi.fn(async (key: unknown) => {
    memoryStore.delete(String(key));
  }),
  keys: vi.fn(async () => Array.from(memoryStore.keys())),
}));

import {
  cacheCustomerPriceMatrix,
  cacheCustomers,
  getCachedCustomerPrices,
  getCachedCustomers,
} from "@/lib/offline-store";

describe("offline-store", () => {
  beforeEach(() => {
    memoryStore.clear();
    vi.restoreAllMocks();
    document.cookie = "superice_factory=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  });

  it("merges searched customers into the existing offline customer cache", async () => {
    await cacheCustomers([
      { id: 1, name: "Alpha Ice", phone: "081", credit: false, bagBalance: 5 },
      { id: 2, name: "Beta Ice", phone: "082", credit: true, bagBalance: 8 },
    ]);

    await cacheCustomers([
      { id: 2, name: "Beta Ice Updated", phone: "082", credit: true, bagBalance: 9 },
    ]);

    const cached = await getCachedCustomers("");

    expect(cached).toHaveLength(2);
    expect(cached).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 1, name: "Alpha Ice", bagBalance: 5 }),
        expect.objectContaining({ id: 2, name: "Beta Ice Updated", bagBalance: 9 }),
      ])
    );
  });

  it("searches the merged offline customer cache by id and name", async () => {
    await cacheCustomers([
      { id: 11, name: "คลองเตย", phone: "0890001111", credit: false },
      { id: 12, name: "ลาดพร้าว", phone: "0890002222", credit: false },
    ]);
    await cacheCustomers([
      { id: 13, name: "สุขุมวิท", phone: "0890003333", credit: true },
    ]);

    expect(await getCachedCustomers("#13")).toEqual([
      expect.objectContaining({ id: 13, name: "สุขุมวิท" }),
    ]);
    expect(await getCachedCustomers("ลาด")).toEqual([
      expect.objectContaining({ id: 12, name: "ลาดพร้าว" }),
    ]);
  });

  it("supports comma-separated customer id lookup from the offline cache", async () => {
    await cacheCustomers([
      { id: 21, name: "Alpha Ice", phone: "0810001111", credit: false },
      { id: 22, name: "Beta Ice", phone: "0810002222", credit: false },
      { id: 23, name: "Gamma Ice", phone: "0810003333", credit: false },
    ]);

    expect(await getCachedCustomers("#21, 22, #21")).toEqual([
      expect.objectContaining({ id: 21, name: "Alpha Ice" }),
      expect.objectContaining({ id: 22, name: "Beta Ice" }),
    ]);
  });

  it("stores preloaded customer prices so offline selection can load any cached customer", async () => {
    await cacheCustomerPriceMatrix([
      {
        customerId: 101,
        prices: [
          { productTypeId: 1, unitPrice: 42, bagDeposit: 0 },
          { productTypeId: 2, unitPrice: 55, bagDeposit: 0 },
        ],
      },
      {
        customerId: 102,
        prices: [
          { productTypeId: 3, unitPrice: 60, bagDeposit: 0 },
        ],
      },
    ]);

    expect(await getCachedCustomerPrices(101)).toEqual([
      { productTypeId: 1, unitPrice: 42, bagDeposit: 0 },
      { productTypeId: 2, unitPrice: 55, bagDeposit: 0 },
    ]);
    expect(await getCachedCustomerPrices(102)).toEqual([
      { productTypeId: 3, unitPrice: 60, bagDeposit: 0 },
    ]);
  });

  it("keeps offline caches isolated by active factory", async () => {
    document.cookie = "superice_factory=si; path=/";
    await cacheCustomers([
      { id: 1, name: "SI Customer", phone: "081", credit: false },
    ]);

    document.cookie = "superice_factory=bearing; path=/";
    await cacheCustomers([
      { id: 2, name: "Bearing Customer", phone: "082", credit: false },
    ]);

    expect(await getCachedCustomers("")).toEqual([
      expect.objectContaining({ id: 2, name: "Bearing Customer" }),
    ]);

    document.cookie = "superice_factory=si; path=/";
    expect(await getCachedCustomers("")).toEqual([
      expect.objectContaining({ id: 1, name: "SI Customer" }),
    ]);
  });
});
