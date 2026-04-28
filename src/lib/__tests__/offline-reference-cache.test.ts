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
  __resetOfflineReferenceCacheWarmForTests,
  ensureOfflineReferenceCacheWarm,
  refreshOfflineReferenceCache,
} from "@/lib/offline-reference-cache";
import {
  getCachedCustomerPrices,
  getCachedCustomers,
  getCachedProducts,
} from "@/lib/offline-store";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("refreshOfflineReferenceCache", () => {
  beforeEach(() => {
    memoryStore.clear();
    vi.restoreAllMocks();
    __resetOfflineReferenceCacheWarmForTests();
  });

  it("refreshes products, customers, and customer prices after login", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      if (input === "/api/products") {
        return jsonResponse([
          { id: 1, name: "A", nameEn: null, hasBag: false, decreasesBag: false, isActive: true, sortOrder: 1, catalogCode: 200 },
          { id: 3, name: "C", nameEn: null, hasBag: false, decreasesBag: false, isActive: true, sortOrder: 3, catalogCode: null },
          { id: 2, name: "B", nameEn: null, hasBag: true, decreasesBag: false, isActive: false, sortOrder: 2, catalogCode: 12 },
          { id: 4, name: "D", nameEn: null, hasBag: false, decreasesBag: false, isActive: true, sortOrder: 99, catalogCode: 12 },
        ]);
      }
      if (input === "/api/customers?search=") {
        return jsonResponse([
          { id: 11, name: "คลองเตย", phone: "0811111111", credit: false, transferCustomer: false },
          { id: 12, name: "สุขุมวิท", phone: "0822222222", credit: true, transferCustomer: true },
        ]);
      }
      if (input === "/api/customers/prices?search=") {
        return jsonResponse({
          matrix: [
            { customerId: 11, prices: { "1": 55, "2": "20" } },
            { customerId: 12, prices: { "1": 60 } },
          ],
        });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await refreshOfflineReferenceCache();

    expect(await getCachedProducts()).toEqual([
      expect.objectContaining({ id: 4, isActive: true }),
      expect.objectContaining({ id: 1, isActive: true }),
      expect.objectContaining({ id: 3, isActive: true }),
    ]);
    expect(await getCachedCustomers("")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 11, name: "คลองเตย" }),
        expect.objectContaining({ id: 12, name: "สุขุมวิท" }),
      ])
    );
    expect(await getCachedCustomerPrices(11)).toEqual([
      { productTypeId: 1, unitPrice: 55, bagDeposit: 0 },
      { productTypeId: 2, unitPrice: 20, bagDeposit: 0 },
    ]);
  });

  it("shares one in-flight warm promise across concurrent callers", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      if (input === "/api/products") {
        return jsonResponse([
          { id: 1, name: "A", nameEn: null, hasBag: false, decreasesBag: false, isActive: true, sortOrder: 1 },
        ]);
      }
      if (input === "/api/customers?search=") {
        return jsonResponse([
          { id: 11, name: "คลองเตย", phone: "0811111111", credit: false, transferCustomer: false },
        ]);
      }
      if (input === "/api/customers/prices?search=") {
        return jsonResponse({
          matrix: [
            { customerId: 11, prices: { "1": 55 } },
          ],
        });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([
      ensureOfflineReferenceCacheWarm(),
      ensureOfflineReferenceCacheWarm(),
    ]);

    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
