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
  getPendingCount,
  getPendingSales,
  queueSale,
  removeQueuedSale,
  syncAll,
} from "@/lib/sync-engine";

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function urlOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input && typeof input === "object" && "url" in input) {
    return String((input as { url: unknown }).url);
  }
  return String(input);
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function telemetryPayloads(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls
    .filter(([input]) => urlOf(input) === "/api/telemetry/sync")
    .map(([, init]) => {
      const raw = (init as RequestInit | undefined)?.body;
      return typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : {};
    });
}

describe("sync-engine", () => {
  beforeEach(() => {
    memoryStore.clear();
    vi.restoreAllMocks();
  });

  it("queueSale stores pending entry and emits queued telemetry", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    const queued = await queueSale({
      payload: { customerId: 7, items: [{ productTypeId: 1, quantity: 1 }] },
      customerName: "ACME",
      total: 450,
    });
    await flushAsync();

    expect(queued.clientId).toBeTruthy();
    expect(await getPendingCount()).toBe(1);

    const events = telemetryPayloads(fetchMock);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: "queued",
      customerId: 7,
      amount: 450,
      pendingCount: 1,
    });
    expect(typeof events[0].queuedAt).toBe("string");
  });

  it("queueSale parses customerId from string payload", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    await queueSale({
      payload: { customerId: "42" },
      customerName: "String ID",
      total: 100,
    });
    await flushAsync();

    const events = telemetryPayloads(fetchMock);
    expect(events[0]?.customerId).toBe(42);
  });

  it("syncAll returns zeroes when queue is empty", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncAll();

    expect(result).toEqual({
      success: 0,
      failed: 0,
      pending: 0,
      errors: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not sync queued sales without an active online session", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = urlOf(input);
      if (url === "/api/auth") {
        return jsonResponse({ error: "ไม่ได้เข้าสู่ระบบ" }, 401);
      }
      if (url === "/api/telemetry/sync") {
        return jsonResponse({ success: true });
      }
      return jsonResponse({ id: 500 }, 201);
    });
    vi.stubGlobal("fetch", fetchMock);

    await queueSale({
      payload: { customerId: 77, items: [{ productTypeId: 1, quantity: 1 }] },
      customerName: "Needs Login",
      total: 250,
    });

    fetchMock.mockClear();
    const result = await syncAll();

    expect(result).toEqual({
      success: 0,
      failed: 0,
      pending: 1,
      errors: ["กรุณาเข้าสู่ระบบออนไลน์ก่อนซิงก์รายการออฟไลน์"],
    });
    expect(await getPendingCount()).toBe(1);
    expect(fetchMock.mock.calls.filter(([input]) => urlOf(input) === "/api/transactions")).toHaveLength(0);
  });

  it("syncAll sends required offline headers and clears synced entries", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = urlOf(input);
      if (url === "/api/auth") {
        return jsonResponse({ id: 1, username: "tester", role: "admin" });
      }
      if (url === "/api/transactions") {
        return jsonResponse({ id: 901 }, 201);
      }
      return jsonResponse({ success: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const queued = await queueSale({
      payload: { customerId: 11, items: [{ productTypeId: 2, quantity: 2 }] },
      customerName: "Sync OK",
      total: 900,
    });

    fetchMock.mockClear();
    const result = await syncAll();
    await flushAsync();

    expect(result.success).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.pending).toBe(0);
    expect(await getPendingCount()).toBe(0);

    const txCall = fetchMock.mock.calls.find(([input]) => urlOf(input) === "/api/transactions");
    expect(txCall).toBeDefined();
    const txInit = (txCall as unknown[] | undefined)?.[1] as RequestInit | undefined;
    const txHeaders = (txInit?.headers ??
      {}) as Record<string, string>;
    expect(txHeaders["x-sync-source"]).toBe("offline-queue");
    expect(txHeaders["x-queued-at"]).toBe(queued.queuedAt);

    const events = telemetryPayloads(fetchMock).map((e) => e.event);
    expect(events).toContain("sync_started");
    expect(events).toContain("sale_synced");
    expect(events).toContain("sync_finished");
  });

  it("preserves queued billNumber when syncing offline sales", async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = urlOf(input);
      if (url === "/api/auth") {
        return jsonResponse({ id: 1, username: "tester", role: "admin" });
      }
      if (url === "/api/transactions") {
        const raw = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        expect(raw.billNumber).toBe(4321);
        return jsonResponse({ id: 902, printedBillNumber: 4321 }, 201);
      }
      return jsonResponse({ success: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    await queueSale({
      payload: { customerId: 12, billNumber: 4321, items: [{ productTypeId: 2, quantity: 1 }] },
      customerName: "Has Bill Number",
      total: 300,
    });

    const result = await syncAll();

    expect(result.success).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("keeps queued sales pending when the active sync factory does not match", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = urlOf(input);
      if (url === "/api/auth") {
        return jsonResponse({
          id: 1,
          username: "tester",
          role: "admin",
          factoryKey: "bearing",
        });
      }
      return jsonResponse({ success: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    await queueSale({
      payload: { customerId: 88, items: [{ productTypeId: 1, quantity: 1 }] },
      customerName: "Wrong Factory",
      total: 100,
      factoryKey: "si",
    });

    const result = await syncAll();

    expect(result.success).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.pending).toBe(1);
    expect(result.errors[0]).toContain("อยู่โรงงาน si");
    expect(await getPendingCount()).toBe(1);
    expect(fetchMock.mock.calls.filter(([input]) => urlOf(input) === "/api/transactions")).toHaveLength(0);
  });

  it("continues to next sale on server 4xx and keeps failed one pending", async () => {
    let txCallIndex = 0;
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = urlOf(input);
      if (url === "/api/auth") {
        return jsonResponse({ id: 1, username: "tester", role: "admin" });
      }
      if (url === "/api/transactions") {
        txCallIndex++;
        if (txCallIndex === 1) {
          return jsonResponse({ error: "ราคาขายไม่ถูกต้อง" }, 400);
        }
        return jsonResponse({ id: 777 }, 201);
      }
      return jsonResponse({ success: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    await queueSale({
      payload: { customerId: 1, items: [{ productTypeId: 1, quantity: 1 }] },
      customerName: "Fail First",
      total: 100,
    });
    await queueSale({
      payload: { customerId: 2, items: [{ productTypeId: 1, quantity: 1 }] },
      customerName: "Then Success",
      total: 200,
    });

    fetchMock.mockClear();
    const result = await syncAll();
    await flushAsync();

    expect(result.success).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.pending).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Fail First");
    expect(result.errors[0]).toContain("ราคาขายไม่ถูกต้อง");
    expect(await getPendingCount()).toBe(1);

    const events = telemetryPayloads(fetchMock).map((e) => e.event);
    expect(events).toContain("sale_failed");
    expect(events).toContain("sale_synced");
    expect(events).toContain("sync_finished");
  });

  it("stops processing after network failure to avoid hammering server", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = urlOf(input);
      if (url === "/api/auth") {
        return jsonResponse({ id: 1, username: "tester", role: "admin" });
      }
      if (url === "/api/transactions") {
        throw new Error("network down");
      }
      return jsonResponse({ success: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    await queueSale({
      payload: { customerId: 100 },
      customerName: "First Network Fail",
      total: 500,
    });
    await queueSale({
      payload: { customerId: 200 },
      customerName: "Should Not Attempt",
      total: 600,
    });

    fetchMock.mockClear();
    const result = await syncAll();
    await flushAsync();

    expect(result.success).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.pending).toBe(2);
    expect(result.errors[0]).toContain("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์");
    expect(await getPendingCount()).toBe(2);

    const txCalls = fetchMock.mock.calls.filter(([input]) => urlOf(input) === "/api/transactions");
    expect(txCalls).toHaveLength(1);

    const finishEvent = telemetryPayloads(fetchMock).find((e) => e.event === "sync_finished");
    expect(finishEvent).toMatchObject({ successCount: 0, failedCount: 1, pendingCount: 2 });
  });

  it("removeQueuedSale deletes only selected entry", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    const a = await queueSale({
      payload: { customerId: 1 },
      customerName: "A",
      total: 1,
    });
    await queueSale({
      payload: { customerId: 2 },
      customerName: "B",
      total: 2,
    });

    await removeQueuedSale(a.clientId);

    const pending = await getPendingSales();
    expect(pending).toHaveLength(1);
    expect(pending[0].customerName).toBe("B");
  });
});
