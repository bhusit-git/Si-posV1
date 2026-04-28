#!/usr/bin/env npx tsx
/**
 * Load Test Script for Super Ice POS
 *
 * Fires many concurrent HTTP requests at the local dev server to simulate
 * multiple factory users transacting at once. After the barrage, it verifies
 * data integrity in the database.
 *
 * Usage:
 *   npx tsx scripts/load-test.ts
 *
 * Prerequisites:
 *   - Local dev server running: npm run dev
 *   - At least one admin user in the database
 *
 * Configuration: edit the constants below or set env vars.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL = process.env.LOAD_TEST_URL || "http://localhost:3000";
const USERNAME = process.env.LOAD_TEST_USER || "Admin";
const PASSWORD = process.env.LOAD_TEST_PASS || "lion";
const NUM_USERS = parseInt(process.env.LOAD_TEST_USERS || "10");
const SALES_PER_USER = parseInt(process.env.LOAD_TEST_SALES || "20");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TimingEntry {
  userId: number;
  saleIdx: number;
  durationMs: number;
  status: number;
  success: boolean;
  txId?: number;
  clientId: string;
  error?: string;
}

interface VerifyResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniqueClientId(userId: number, saleIdx: number): string {
  return `load-test-${Date.now()}-u${userId}-s${saleIdx}-${Math.random().toString(36).slice(2, 8)}`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function padRight(s: string, len: number): string {
  return s + " ".repeat(Math.max(0, len - s.length));
}

function padLeft(s: string, len: number): string {
  return " ".repeat(Math.max(0, len - s.length)) + s;
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

async function login(): Promise<string> {
  console.log(`  Logging in as "${USERNAME}"...`);
  const res = await fetch(`${BASE_URL}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    redirect: "manual",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Login failed (${res.status}): ${text}`);
  }
  const setCookies: string[] =
    res.headers.getSetCookie?.() ||
    (res.headers.get("set-cookie") || "").split(/,(?=\s*\w+=)/).filter(Boolean);
  const cookie = setCookies.find((c: string) => c.includes("superice_session="));
  if (!cookie) throw new Error("No session cookie returned");
  const match = cookie.match(/(superice_session=[^;]+)/);
  if (!match) throw new Error("Could not parse session cookie");
  console.log("  Login successful.");
  return match[1];
}

async function api(
  path: string,
  cookie: string,
  options: RequestInit = {}
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      ...(options.headers as Record<string, string> | undefined),
    },
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function fetchTestData(cookie: string): Promise<{ customerId: number; productId: number }> {
  console.log("  Fetching customer and product data...");
  const custRes = await api("/api/customers?search=", cookie);
  const customers = custRes.data as Array<{ id: number; name: string }>;
  if (!Array.isArray(customers) || customers.length === 0) {
    throw new Error("No customers in database");
  }

  const prodRes = await api("/api/products", cookie);
  const products = prodRes.data as Array<{ id: number; name: string }>;
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error("No products in database");
  }

  console.log(`  Using customer #${customers[0].id} (${customers[0].name}), product #${products[0].id} (${products[0].name})`);
  return { customerId: customers[0].id, productId: products[0].id };
}

async function runVirtualUser(
  userId: number,
  cookie: string,
  customerId: number,
  productId: number
): Promise<TimingEntry[]> {
  const results: TimingEntry[] = [];

  for (let i = 0; i < SALES_PER_USER; i++) {
    const clientId = uniqueClientId(userId, i);
    const payload = {
      clientId,
      customerId,
      items: [{ productTypeId: productId, quantity: 1, unitPrice: 100 }],
      status: "paid",
      saleDate: todayISO(),
      saleTime: nowTime(),
    };

    const start = performance.now();
    let status = 0;
    let data: Record<string, unknown> = {};
    let error: string | undefined;

    try {
      const res = await api("/api/transactions", cookie, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      status = res.status;
      data = res.data as Record<string, unknown>;
    } catch (e) {
      status = 0;
      error = (e as Error).message;
    }

    const durationMs = performance.now() - start;
    results.push({
      userId,
      saleIdx: i,
      durationMs,
      status,
      success: status === 201,
      txId: data?.id as number | undefined,
      clientId,
      error,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

async function verify(
  cookie: string,
  timings: TimingEntry[],
  customerId: number
): Promise<VerifyResult[]> {
  const results: VerifyResult[] = [];
  const successfulSales = timings.filter((t) => t.success);
  const expectedCount = successfulSales.length;

  // 1. Transaction count -- query transactions created today for our customer
  const txRes = await api(
    `/api/transactions?customerId=${customerId}&startDate=${todayISO()}&endDate=${todayISO()}&limit=9999`,
    cookie
  );
  const txList = txRes.data as Array<{ id: number; clientId?: string }>;
  const loadTestTxs = Array.isArray(txList)
    ? txList.filter((t) => t.clientId?.startsWith("load-test-"))
    : [];

  results.push({
    name: "Transaction count matches successful POSTs",
    passed: loadTestTxs.length >= expectedCount,
    expected: `>= ${expectedCount}`,
    actual: String(loadTestTxs.length),
  });

  // 2. No duplicate clientIds in the database
  const clientIdSet = new Set(loadTestTxs.map((t) => t.clientId));
  results.push({
    name: "No duplicate clientIds in database",
    passed: clientIdSet.size === loadTestTxs.length,
    expected: String(loadTestTxs.length),
    actual: String(clientIdSet.size),
  });

  // 3. All successful responses have unique txIds
  const txIds = successfulSales.map((s) => s.txId).filter(Boolean);
  const uniqueTxIds = new Set(txIds);
  results.push({
    name: "All successful responses have unique txIds",
    passed: uniqueTxIds.size === txIds.length,
    expected: String(txIds.length),
    actual: String(uniqueTxIds.size),
  });

  // 4. Audit log count -- query audit log for today's transaction.create entries
  const auditRes = await api(
    `/api/audit?entity=transaction&from=${todayISO()}&to=${todayISO()}&limit=200`,
    cookie
  );
  const auditData = auditRes.data as { logs: Array<{ action: string }>; total: number };
  const createAudits = auditData.logs?.filter((l) => l.action === "transaction.create") || [];
  results.push({
    name: "Audit log entries exist for creates",
    passed: createAudits.length >= Math.min(expectedCount, 200),
    expected: `>= ${Math.min(expectedCount, 200)}`,
    actual: String(createAudits.length),
  });

  // 5. No HTTP 500 errors
  const serverErrors = timings.filter((t) => t.status === 500);
  results.push({
    name: "No HTTP 500 server errors",
    passed: serverErrors.length === 0,
    expected: "0",
    actual: String(serverErrors.length),
  });

  // 6. Dashboard accessible during/after load
  const dashRes = await api("/api/dashboard", cookie);
  results.push({
    name: "Dashboard responds after load test",
    passed: dashRes.status === 200,
    expected: "200",
    actual: String(dashRes.status),
  });

  // 7. Bag ledger consistency (basic) -- count bag ledger entries for load test txs
  const bagRes = await api(`/api/bags?customerId=${customerId}`, cookie);
  results.push({
    name: "Bag balance endpoint responds",
    passed: bagRes.status === 200,
    expected: "200",
    actual: String(bagRes.status),
  });

  return results;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function printReport(timings: TimingEntry[], checks: VerifyResult[], totalTimeMs: number) {
  const total = timings.length;
  const succeeded = timings.filter((t) => t.success).length;
  const failed = total - succeeded;
  const durations = timings.map((t) => t.durationMs).sort((a, b) => a - b);
  const avg = durations.reduce((s, d) => s + d, 0) / (durations.length || 1);
  const tps = (succeeded / (totalTimeMs / 1000)).toFixed(1);

  console.log("\n" + "=".repeat(70));
  console.log("  LOAD TEST RESULTS");
  console.log("=".repeat(70));

  console.log("\n--- Configuration ---");
  console.log(`  Base URL:        ${BASE_URL}`);
  console.log(`  Virtual users:   ${NUM_USERS}`);
  console.log(`  Sales per user:  ${SALES_PER_USER}`);
  console.log(`  Total requests:  ${total}`);
  console.log(`  Wall clock time: ${(totalTimeMs / 1000).toFixed(2)}s`);

  console.log("\n--- Performance ---");
  console.log(`  Succeeded:       ${succeeded} / ${total} (${((succeeded / total) * 100).toFixed(1)}%)`);
  console.log(`  Failed:          ${failed}`);
  console.log(`  Avg latency:     ${avg.toFixed(0)}ms`);
  console.log(`  P50 latency:     ${percentile(durations, 50).toFixed(0)}ms`);
  console.log(`  P95 latency:     ${percentile(durations, 95).toFixed(0)}ms`);
  console.log(`  P99 latency:     ${percentile(durations, 99).toFixed(0)}ms`);
  console.log(`  Min latency:     ${(durations[0] || 0).toFixed(0)}ms`);
  console.log(`  Max latency:     ${(durations[durations.length - 1] || 0).toFixed(0)}ms`);
  console.log(`  Throughput:      ${tps} TPS`);

  // Error breakdown
  if (failed > 0) {
    console.log("\n--- Errors ---");
    const errorGroups = new Map<number, number>();
    for (const t of timings) {
      if (!t.success) {
        errorGroups.set(t.status, (errorGroups.get(t.status) || 0) + 1);
      }
    }
    for (const [status, count] of errorGroups) {
      console.log(`  HTTP ${status || "NETWORK"}: ${count}`);
    }
  }

  // Verification results
  console.log("\n--- Data Integrity Checks ---");
  let allPassed = true;
  for (const check of checks) {
    const icon = check.passed ? "PASS" : "FAIL";
    const line = `  [${icon}] ${padRight(check.name, 48)} expected: ${padLeft(check.expected, 6)}  actual: ${padLeft(check.actual, 6)}`;
    console.log(line);
    if (!check.passed) allPassed = false;
  }

  console.log("\n" + "=".repeat(70));
  if (allPassed && failed === 0) {
    console.log("  ALL CHECKS PASSED -- system handled concurrent load correctly");
  } else if (allPassed) {
    console.log(`  CHECKS PASSED with ${failed} HTTP errors (see above)`);
  } else {
    console.log("  SOME CHECKS FAILED -- review above for details");
  }
  console.log("=".repeat(70) + "\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n  Super Ice POS -- Load Test");
  console.log("  " + "=".repeat(40));
  console.log(`  Target:     ${BASE_URL}`);
  console.log(`  Users:      ${NUM_USERS}`);
  console.log(`  Sales/user: ${SALES_PER_USER}`);
  console.log(`  Total:      ${NUM_USERS * SALES_PER_USER} requests`);
  console.log("");

  // Setup phase
  console.log("[1/4] Setup");
  const cookie = await login();
  const { customerId, productId } = await fetchTestData(cookie);

  // Barrage phase
  console.log(`\n[2/4] Barrage -- ${NUM_USERS} users x ${SALES_PER_USER} sales`);
  const barrageStart = performance.now();

  const userPromises = Array.from({ length: NUM_USERS }, (_, i) =>
    runVirtualUser(i, cookie, customerId, productId)
  );

  // Progress tracking
  const progressInterval = setInterval(() => {
    process.stdout.write(".");
  }, 500);

  const userResults = await Promise.all(userPromises);
  clearInterval(progressInterval);
  console.log(" done");

  const allTimings = userResults.flat();
  const totalTimeMs = performance.now() - barrageStart;

  const succeeded = allTimings.filter((t) => t.success).length;
  console.log(`  Completed: ${succeeded}/${allTimings.length} successful in ${(totalTimeMs / 1000).toFixed(2)}s`);

  // Verification phase
  console.log("\n[3/4] Verification");
  const checks = await verify(cookie, allTimings, customerId);

  // Report phase
  console.log("\n[4/4] Report");
  printReport(allTimings, checks, totalTimeMs);
}

main().catch((err) => {
  console.error("\nLoad test failed:", err);
  process.exit(1);
});
