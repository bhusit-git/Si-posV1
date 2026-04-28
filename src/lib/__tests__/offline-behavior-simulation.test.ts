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

import { refreshOfflineReferenceCache } from "@/lib/offline-reference-cache";
import {
  getCachedCustomerPrices,
  getCachedCustomers,
  getCachedProducts,
} from "@/lib/offline-store";
import { getPendingCount, queueSale, syncAll } from "@/lib/sync-engine";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeReferenceFetch(dataset: {
  products: unknown[];
  customers: unknown[];
  matrix: unknown[];
}) {
  return vi.fn(async (input: unknown) => {
    if (input === "/api/products") {
      return jsonResponse(dataset.products);
    }
    if (input === "/api/customers?search=") {
      return jsonResponse(dataset.customers);
    }
    if (input === "/api/customers/prices?search=") {
      return jsonResponse({ matrix: dataset.matrix });
    }
    throw new Error(`Unexpected fetch: ${String(input)}`);
  });
}

function setFactoryCookie(factoryKey: string) {
  document.cookie = `superice_factory=${factoryKey}; path=/`;
}

describe("offline behavior simulation", () => {
  beforeEach(() => {
    memoryStore.clear();
    vi.restoreAllMocks();
    window.localStorage.clear();
    document.cookie = "superice_factory=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  });

  it("keeps cached sale data through logout/browser restart and resumes sync only after a valid online session", async () => {
    setFactoryCookie("si");
    const initialReferenceFetch = makeReferenceFetch({
      products: [
        { id: 1, name: "Pack", nameEn: null, hasBag: false, decreasesBag: false, isActive: true, sortOrder: 1 },
      ],
      customers: [
        { id: 101, name: "Customer A", phone: "0811111111", credit: false, transferCustomer: false, bagBalance: 12 },
      ],
      matrix: [
        { customerId: 101, prices: { "1": 55 } },
      ],
    });
    vi.stubGlobal("fetch", initialReferenceFetch);

    await refreshOfflineReferenceCache();

    expect(await getCachedProducts()).toEqual([
      expect.objectContaining({ id: 1, name: "Pack" }),
    ]);
    expect(await getCachedCustomers("Customer")).toEqual([
      expect.objectContaining({ id: 101, name: "Customer A", bagBalance: 12 }),
    ]);
    expect(await getCachedCustomerPrices(101)).toEqual([
      { productTypeId: 1, unitPrice: 55, bagDeposit: 0 },
    ]);

    // Simulate a saved offline sale before logout.
    const telemetryOnlyFetch = vi.fn(async (input: unknown) => {
      if (input === "/api/telemetry/sync") {
        return jsonResponse({ success: true });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal("fetch", telemetryOnlyFetch);

    await queueSale({
      payload: { customerId: 101, items: [{ productTypeId: 1, quantity: 2, unitPrice: 55 }] },
      customerName: "Customer A",
      total: 110,
    });
    expect(await getPendingCount()).toBe(1);

    // Simulate logout + later browser reopen: no cache clear happened, but session is gone.
    const loggedOutFetch = vi.fn(async (input: unknown) => {
      if (input === "/api/auth") {
        return jsonResponse({ error: "ไม่ได้เข้าสู่ระบบ" }, 401);
      }
      if (input === "/api/telemetry/sync") {
        return jsonResponse({ success: true });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal("fetch", loggedOutFetch);

    const blockedSync = await syncAll();

    expect(blockedSync).toEqual({
      success: 0,
      failed: 0,
      pending: 1,
      errors: ["กรุณาเข้าสู่ระบบออนไลน์ก่อนซิงก์รายการออฟไลน์"],
    });
    expect(await getPendingCount()).toBe(1);
    expect(await getCachedCustomers("#101")).toEqual([
      expect.objectContaining({ id: 101, name: "Customer A" }),
    ]);
    expect(await getCachedCustomerPrices(101)).toEqual([
      { productTypeId: 1, unitPrice: 55, bagDeposit: 0 },
    ]);

    // Simulate next successful online login/session and sync retry.
    const resumedSessionFetch = vi.fn(async (input: unknown) => {
      if (input === "/api/auth") {
        return jsonResponse({ id: 1, username: "admin", role: "admin" });
      }
      if (input === "/api/transactions") {
        return jsonResponse({ id: 999 }, 201);
      }
      if (input === "/api/telemetry/sync") {
        return jsonResponse({ success: true });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal("fetch", resumedSessionFetch);

    const resumedSync = await syncAll();

    expect(resumedSync.success).toBe(1);
    expect(resumedSync.pending).toBe(0);
    expect(await getPendingCount()).toBe(0);
  });

  it("refreshes cached reference data on re-login and replaces outdated customer prices", async () => {
    setFactoryCookie("si");
    vi.stubGlobal(
      "fetch",
      makeReferenceFetch({
        products: [
          { id: 1, name: "Pack", nameEn: null, hasBag: false, decreasesBag: false, isActive: true, sortOrder: 1 },
        ],
        customers: [
          { id: 201, name: "Old Name", phone: "081", credit: false, transferCustomer: false },
        ],
        matrix: [
          { customerId: 201, prices: { "1": 40 } },
        ],
      })
    );

    await refreshOfflineReferenceCache();

    vi.stubGlobal(
      "fetch",
      makeReferenceFetch({
        products: [
          { id: 1, name: "Pack", nameEn: null, hasBag: false, decreasesBag: false, isActive: true, sortOrder: 1 },
          { id: 2, name: "Tube", nameEn: null, hasBag: true, decreasesBag: false, isActive: true, sortOrder: 2 },
        ],
        customers: [
          { id: 201, name: "New Name", phone: "082", credit: true, transferCustomer: false },
          { id: 202, name: "Second Customer", phone: "083", credit: false, transferCustomer: true },
        ],
        matrix: [
          { customerId: 201, prices: { "1": 52, "2": 18 } },
          { customerId: 202, prices: { "2": 25 } },
        ],
      })
    );

    await refreshOfflineReferenceCache();

    expect(await getCachedCustomers("")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 201, name: "New Name", phone: "082", credit: true }),
        expect.objectContaining({ id: 202, name: "Second Customer" }),
      ])
    );
    expect(await getCachedCustomerPrices(201)).toEqual([
      { productTypeId: 1, unitPrice: 52, bagDeposit: 0 },
      { productTypeId: 2, unitPrice: 18, bagDeposit: 0 },
    ]);
  });

  it("keeps each factory offline cache separate across login/logout cycles on the same browser", async () => {
    setFactoryCookie("si");
    vi.stubGlobal(
      "fetch",
      makeReferenceFetch({
        products: [
          { id: 1, name: "SI Pack", nameEn: null, hasBag: false, decreasesBag: false, isActive: true, sortOrder: 1 },
        ],
        customers: [
          { id: 301, name: "SI Customer", phone: "081", credit: false, transferCustomer: false },
        ],
        matrix: [
          { customerId: 301, prices: { "1": 50 } },
        ],
      })
    );
    await refreshOfflineReferenceCache();

    setFactoryCookie("bearing");
    vi.stubGlobal(
      "fetch",
      makeReferenceFetch({
        products: [
          { id: 7, name: "Bearing Tube", nameEn: null, hasBag: true, decreasesBag: false, isActive: true, sortOrder: 1 },
        ],
        customers: [
          { id: 401, name: "Bearing Customer", phone: "082", credit: true, transferCustomer: false },
        ],
        matrix: [
          { customerId: 401, prices: { "7": 88 } },
        ],
      })
    );
    await refreshOfflineReferenceCache();

    expect(await getCachedCustomers("")).toEqual([
      expect.objectContaining({ id: 401, name: "Bearing Customer" }),
    ]);
    expect(await getCachedCustomerPrices(401)).toEqual([
      { productTypeId: 7, unitPrice: 88, bagDeposit: 0 },
    ]);

    setFactoryCookie("si");
    expect(await getCachedCustomers("")).toEqual([
      expect.objectContaining({ id: 301, name: "SI Customer" }),
    ]);
    expect(await getCachedCustomerPrices(301)).toEqual([
      { productTypeId: 1, unitPrice: 50, bagDeposit: 0 },
    ]);
  });
});
