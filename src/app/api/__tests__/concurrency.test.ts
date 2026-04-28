import { describe, it, expect, beforeAll } from "vitest";

/**
 * Concurrency & multi-user integration tests.
 *
 * These tests make REAL HTTP requests to the running local dev server
 * and exercise the actual database under concurrent load.
 *
 * Prerequisites:
 *   1. Local dev server running:  npm run dev
 *   2. Local PostgreSQL with schema applied
 *   3. At least one admin user in the database
 *
 * Run with:
 *   INTEGRATION=1 TEST_USER=Admin TEST_PASS=lion npm test -- concurrency
 *
 * Skipped by default in normal `npm test` runs.
 */

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const TEST_USER = process.env.TEST_USER || "Admin";
const TEST_PASS = process.env.TEST_PASS || "lion";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let sessionCookie = "";

async function login(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: TEST_USER, password: TEST_PASS }),
    redirect: "manual",
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  // Extract session cookie -- try getSetCookie first, then fall back to raw header
  const setCookies: string[] =
    res.headers.getSetCookie?.() ||
    (res.headers.get("set-cookie") || "").split(/,(?=\s*\w+=)/).filter(Boolean);
  const cookie = setCookies.find((c) => c.includes("superice_session="));
  if (!cookie) throw new Error("No session cookie returned from login. Headers: " + JSON.stringify([...res.headers.entries()]));
  // Return just the "superice_session=<token>" part
  const match = cookie.match(/(superice_session=[^;]+)/);
  if (!match) throw new Error("Could not parse session cookie from: " + cookie);
  return match[1];
}

async function api(
  path: string,
  options: RequestInit = {}
): Promise<{ status: number; data: Record<string, unknown> }> {
  return apiTyped<Record<string, unknown>>(path, options);
}

async function apiTyped<T>(
  path: string,
  options: RequestInit = {}
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Cookie: sessionCookie,
      ...(options.headers as Record<string, string> | undefined),
    },
  });
  const data = (await res.json()) as T;
  return { status: res.status, data };
}

function uniqueClientId(prefix: string): string {
  return `test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

// Fetch a valid customer and product for test payloads
let testCustomerId: number;
let testProductId: number;

async function fetchTestEntities() {
  const custRes = await apiTyped<Array<{ id: number }>>("/api/customers?search=");
  const customers = custRes.data;
  if (!Array.isArray(customers) || customers.length === 0) {
    throw new Error("No customers in database -- cannot run integration tests");
  }
  testCustomerId = customers[0].id;

  const prodRes = await apiTyped<Array<{ id: number }>>("/api/products");
  const products = prodRes.data;
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error("No products in database -- cannot run integration tests");
  }
  testProductId = products[0].id;
}

function makeSalePayload(overrides: Record<string, unknown> = {}) {
  return {
    customerId: testCustomerId,
    items: [{ productTypeId: testProductId, quantity: 1, unitPrice: 100 }],
    status: "paid",
    saleDate: todayISO(),
    saleTime: nowTime(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite -- skipped unless INTEGRATION env var is set
// ---------------------------------------------------------------------------

const RUN = !!process.env.INTEGRATION;

describe.skipIf(!RUN)("Concurrency Integration Tests", () => {
  beforeAll(async () => {
    sessionCookie = await login();
    await fetchTestEntities();
  }, 30_000);

  // =========================================================================
  // Scenario 1: Parallel sales by different users
  // =========================================================================
  it("Scenario 1: 5 parallel sales all succeed with unique data", async () => {
    const clientIds = Array.from({ length: 5 }, (_, i) => uniqueClientId(`s1-${i}`));
    const promises = clientIds.map((cid) =>
      api("/api/transactions", {
        method: "POST",
        body: JSON.stringify(makeSalePayload({ clientId: cid })),
      })
    );

    const results = await Promise.all(promises);

    // All should succeed with 201
    for (const r of results) {
      expect(r.status).toBe(201);
      expect(r.data.id).toBeDefined();
      expect(r.data.totalAmount).toBe(100);
    }

    // All transaction IDs should be unique
    const ids = results.map((r) => r.data.id);
    expect(new Set(ids).size).toBe(5);
  }, 30_000);

  // =========================================================================
  // Scenario 2: Idempotent duplicate prevention
  // =========================================================================
  it("Scenario 2: same clientId sent 3 times in parallel -- only 1 transaction created", async () => {
    const sharedClientId = uniqueClientId("s2-idem");
    const payload = makeSalePayload({ clientId: sharedClientId });

    const promises = Array.from({ length: 3 }, () =>
      api("/api/transactions", {
        method: "POST",
        body: JSON.stringify(payload),
      })
    );

    const results = await Promise.all(promises);

    // Acceptable outcomes per request:
    //   201 = created the transaction
    //   200 = duplicate replay, either from the pre-check or unique-index recovery
    for (const r of results) {
      expect([201, 200]).toContain(r.status);
    }

    const successResults = results.filter((r) => r.status === 201 || r.status === 200);
    expect(successResults.length).toBe(3);

    // All successful responses should reference the same transaction
    const successIds = successResults.map((r) => r.data.id).filter(Boolean);
    if (successIds.length > 1) {
      const uniqueIds = new Set(successIds);
      expect(uniqueIds.size).toBe(1);
    }

    // Verify only 1 transaction exists in DB for this clientId
    const checkRes = await apiTyped<Array<{ clientId?: string }>>(
      `/api/transactions?customerId=${testCustomerId}&startDate=${todayISO()}&endDate=${todayISO()}&limit=9999`
    );
    const txList = checkRes.data.filter(
      (t) => t.clientId === sharedClientId
    );
    expect(txList.length).toBe(1);
  }, 30_000);

  // =========================================================================
  // Scenario 3: Concurrent void + payment race
  // =========================================================================
  it("Scenario 3: void and payment on same transaction -- one wins, no crash", async () => {
    // First create a transaction to operate on
    const cid = uniqueClientId("s3-race");
    const createRes = await api("/api/transactions", {
      method: "POST",
      body: JSON.stringify(makeSalePayload({ clientId: cid, status: "unpaid" })),
    });
    expect(createRes.status).toBe(201);
    const txId = createRes.data.id as number;

    // Fire void and payment simultaneously
    const [voidRes, payRes] = await Promise.all([
      api("/api/transactions", {
        method: "PUT",
        body: JSON.stringify({ id: txId, action: "void", reason: "Concurrency test void" }),
      }),
      api("/api/transactions", {
        method: "PUT",
        body: JSON.stringify({ id: txId, action: "payment", amount: 100 }),
      }),
    ]);

    // Neither should return 500 (no crashes)
    expect(voidRes.status).not.toBe(500);
    expect(payRes.status).not.toBe(500);

    // Verify the transaction ends up in a consistent state
    const checkRes = await api(`/api/transactions?id=${txId}`);
    expect(checkRes.status).toBe(200);
    const finalStatus = (checkRes.data as Record<string, unknown>).status;

    // It should be either "voided" or "paid"/"partial" -- not corrupted
    expect(["voided", "paid", "partial", "unpaid"]).toContain(finalStatus);
  }, 30_000);

  // =========================================================================
  // Scenario 4: Concurrent payments on different transactions for same customer
  // =========================================================================
  it("Scenario 4: 3 concurrent payments on 3 different unpaid transactions", async () => {
    // Create 3 unpaid transactions
    const createPromises = Array.from({ length: 3 }, (_, i) =>
      api("/api/transactions", {
        method: "POST",
        body: JSON.stringify(
          makeSalePayload({
            clientId: uniqueClientId(`s4-pay-${i}`),
            status: "unpaid",
          })
        ),
      })
    );
    const created = await Promise.all(createPromises);
    for (const c of created) {
      expect(c.status).toBe(201);
    }
    const txIds = created.map((c) => c.data.id as number);

    // Fire 3 payment requests in parallel
    const payPromises = txIds.map((txId) =>
      api("/api/transactions", {
        method: "PUT",
        body: JSON.stringify({ id: txId, action: "payment", amount: 100 }),
      })
    );
    const payResults = await Promise.all(payPromises);

    // All 3 should succeed
    for (const r of payResults) {
      expect(r.status).toBe(200);
      expect(r.data.success).toBe(true);
      expect(r.data.status).toBe("paid");
      expect(r.data.paid).toBe(100);
    }

    // Verify each transaction is independently paid
    for (const txId of txIds) {
      const check = await api(`/api/transactions?id=${txId}`);
      expect(check.status).toBe(200);
      expect((check.data as Record<string, unknown>).status).toBe("paid");
    }
  }, 30_000);

  // =========================================================================
  // Scenario 5: Parallel sales + dashboard read (no deadlock)
  // =========================================================================
  it("Scenario 5: 3 sales + 1 dashboard read in parallel -- no deadlock", async () => {
    const salePromises = Array.from({ length: 3 }, (_, i) =>
      api("/api/transactions", {
        method: "POST",
        body: JSON.stringify(
          makeSalePayload({ clientId: uniqueClientId(`s5-dash-${i}`) })
        ),
      })
    );

    const dashboardPromise = api("/api/dashboard");

    const [s1, s2, s3, dashRes] = await Promise.all([
      ...salePromises,
      dashboardPromise,
    ]);

    // All sales should succeed
    expect(s1.status).toBe(201);
    expect(s2.status).toBe(201);
    expect(s3.status).toBe(201);

    // Dashboard should return OK (not deadlocked)
    expect(dashRes.status).toBe(200);
    expect(dashRes.data).toBeDefined();
  }, 30_000);

  // =========================================================================
  // Scenario 6: Audit log completeness
  // =========================================================================
  it("Scenario 6: audit log has entries for all test mutations", async () => {
    // Fetch recent audit logs
    const today = todayISO();
    const auditRes = await api(
      `/api/audit?entity=transaction&from=${today}&to=${today}&limit=200`
    );
    expect(auditRes.status).toBe(200);

    const logs = (auditRes.data as { logs: Array<{ action: string; username: string }> }).logs;
    expect(Array.isArray(logs)).toBe(true);

    // We should have audit entries from our tests
    const createEntries = logs.filter((l) => l.action === "transaction.create");
    const voidEntries = logs.filter((l) => l.action === "transaction.void");
    const payEntries = logs.filter((l) => l.action === "transaction.payment");

    // Scenario 1: 5 creates, Scenario 3: 1 create, Scenario 4: 3 creates, Scenario 5: 3 creates
    // Plus scenario 2 creates at least 1 = at least 13 create entries
    expect(createEntries.length).toBeGreaterThanOrEqual(13);

    // All audit entries should have our test username
    for (const entry of [...createEntries, ...voidEntries, ...payEntries]) {
      expect(entry.username).toBe(TEST_USER);
    }
  }, 30_000);
});
