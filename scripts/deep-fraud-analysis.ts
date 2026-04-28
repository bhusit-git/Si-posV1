#!/usr/bin/env npx tsx
/**
 * Deep Fraud Analysis — Returns, Loading/Over-delivery, and Inventory
 *
 * Focuses on:
 *  1. Return behaviour anomalies per customer
 *  2. Loading discrepancies (loaded_qty vs quantity)
 *  3. Production vs sales (inventory shrinkage)
 *  4. Employee–customer collusion signals
 *  5. Cash / credit manipulation
 *
 * Usage:
 *   npx tsx scripts/deep-fraud-analysis.ts
 *
 * Outputs:
 *   docs/forensics/deep-fraud-analysis-<timestamp>.json
 *   docs/forensics/deep-fraud-analysis-<timestamp>.csv
 */

import postgres from "postgres";
import * as fs from "fs";
import * as path from "path";

// ── Types ────────────────────────────────────────────────────────────────────

type Severity = "critical" | "high" | "medium" | "info";

type FraudFlag = {
  factory: string;
  category: string;
  severity: Severity;
  score: number;
  transactionId: number | null;
  user: string | null;
  customerId: number | null;
  customerName: string | null;
  amountImpact: number;
  reason: string;
  evidence: Record<string, unknown>;
};

type TxRow = {
  id: number;
  customer_id: number;
  customer_name: string;
  total_amount: number;
  paid: number;
  status: string;
  sale_date: string;
  sale_time: string;
  created_at: string;
  created_by: number | null;
  created_by_username: string | null;
  voided_by: number | null;
  voided_by_username: string | null;
  void_reason: string | null;
  note: string | null;
  fulfillment: string | null;
};

type ItemRow = {
  id: number;
  transaction_id: number;
  product_type_id: number;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  loaded_qty: number;
};

type ProductionRow = {
  id: number;
  product_type_id: number;
  product_name: string;
  quantity: number;
  created_by: number | null;
  created_by_username: string | null;
  created_at: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const FACTORY_ENV = [
  { key: "si", envVar: "DATABASE_URL_SI" },
  { key: "bearing", envVar: "DATABASE_URL_BEARING" },
  { key: "ktk", envVar: "DATABASE_URL_KTK" },
];

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const text = fs.readFileSync(filePath, "utf8");
  const out: Record<string, string> = {};
  for (const lineRaw of text.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

function loadDatabaseUrls(): Record<string, string> {
  const envFromFile = parseEnvFile(path.join(process.cwd(), ".env.local"));
  const getVar = (name: string) => process.env[name] || envFromFile[name];
  const urls: Record<string, string> = {};
  for (const f of FACTORY_ENV) {
    const url = getVar(f.envVar);
    if (url) urls[f.key] = url;
  }
  return urls;
}

function toNum(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length);
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

function parseOriginalBill(note: string | null): number | null {
  if (!note) return null;
  const m = note.match(/อ้างอิงบิล\s*#(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function severityRank(s: Severity): number {
  if (s === "critical") return 4;
  if (s === "high") return 3;
  if (s === "medium") return 2;
  return 1;
}

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildWindow(): { startDate: string; endDate: string } {
  const now = new Date();
  const endDate = now.toISOString().slice(0, 10);
  const start = new Date(now);
  start.setUTCMonth(start.getUTCMonth() - 12);
  return { startDate: start.toISOString().slice(0, 10), endDate };
}

// ── Data Fetching ────────────────────────────────────────────────────────────

async function fetchData(factory: string, dbUrl: string, startDate: string, endDate: string) {
  const sql = postgres(dbUrl, { max: 4, connect_timeout: 15, idle_timeout: 20 });
  try {
    const txRows = await sql<TxRow[]>`
      SELECT t.id, t.customer_id, c.name AS customer_name,
             t.total_amount, t.paid, t.status,
             t.sale_date::text AS sale_date, t.sale_time::text AS sale_time,
             t.created_at::text AS created_at, t.created_by,
             u1.username AS created_by_username,
             t.voided_by, u2.username AS voided_by_username,
             t.void_reason, t.note, t.fulfillment
      FROM transactions t
      LEFT JOIN customers c ON c.id = t.customer_id
      LEFT JOIN users u1 ON t.created_by = u1.id
      LEFT JOIN users u2 ON t.voided_by = u2.id
      WHERE t.sale_date >= ${startDate}::date AND t.sale_date <= ${endDate}::date
    `;

    const itemRows = await sql<ItemRow[]>`
      SELECT ti.id, ti.transaction_id, ti.product_type_id,
             pt.name AS product_name,
             ti.quantity, ti.unit_price, ti.subtotal, ti.loaded_qty
      FROM transaction_items ti
      INNER JOIN transactions t ON t.id = ti.transaction_id
      LEFT JOIN product_types pt ON pt.id = ti.product_type_id
      WHERE t.sale_date >= ${startDate}::date AND t.sale_date <= ${endDate}::date
    `;

    const productionRows = await sql<ProductionRow[]>`
      SELECT pl.id, pl.product_type_id, pt.name AS product_name,
             pl.quantity, pl.created_by,
             u.username AS created_by_username,
             pl.created_at::text AS created_at
      FROM production_logs pl
      LEFT JOIN product_types pt ON pt.id = pl.product_type_id
      LEFT JOIN users u ON pl.created_by = u.id
      WHERE pl.created_at >= ${startDate}::date
        AND pl.created_at < (${endDate}::date + INTERVAL '1 day')
    `;

    console.log(`[${factory}] tx=${txRows.length}, items=${itemRows.length}, production=${productionRows.length}`);
    return { txRows, itemRows, productionRows };
  } finally {
    await sql.end();
  }
}

// ── Fraud Detection ──────────────────────────────────────────────────────────

function analyzeFactory(
  factory: string,
  txRows: TxRow[],
  itemRows: ItemRow[],
  productionRows: ProductionRow[]
): { flags: FraudFlag[]; stats: Record<string, unknown> } {
  const flags: FraudFlag[] = [];
  const txById = new Map(txRows.map((t) => [t.id, t]));
  const itemsByTx = new Map<number, ItemRow[]>();
  for (const i of itemRows) {
    const arr = itemsByTx.get(i.transaction_id) || [];
    arr.push(i);
    itemsByTx.set(i.transaction_id, arr);
  }

  const activeTx = txRows.filter((t) => t.status !== "voided");
  const sales = activeTx.filter((t) => toNum(t.total_amount) > 0);
  const returns = activeTx.filter((t) => toNum(t.total_amount) < 0);
  const totalSalesAmt = sales.reduce((s, t) => s + toNum(t.total_amount), 0);
  const totalReturnAmt = returns.reduce((s, t) => s + Math.abs(toNum(t.total_amount)), 0);

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. RETURN BEHAVIOUR DEEP DIVE
  // ═══════════════════════════════════════════════════════════════════════════

  // 1a. Per-customer return ratios
  const custSales = new Map<number, { name: string; salesAmt: number; salesCount: number; returnAmt: number; returnCount: number; items: ItemRow[] }>();
  for (const t of sales) {
    const c = custSales.get(t.customer_id) || { name: t.customer_name, salesAmt: 0, salesCount: 0, returnAmt: 0, returnCount: 0, items: [] };
    c.salesAmt += toNum(t.total_amount);
    c.salesCount += 1;
    const txItems = itemsByTx.get(t.id) || [];
    c.items.push(...txItems);
    custSales.set(t.customer_id, c);
  }
  for (const t of returns) {
    const c = custSales.get(t.customer_id) || { name: t.customer_name, salesAmt: 0, salesCount: 0, returnAmt: 0, returnCount: 0, items: [] };
    c.returnAmt += Math.abs(toNum(t.total_amount));
    c.returnCount += 1;
    custSales.set(t.customer_id, c);
  }

  const custReturnRatios: Array<{ custId: number; name: string; ratio: number; returnAmt: number; salesAmt: number; returnCount: number; salesCount: number }> = [];
  for (const [custId, c] of custSales) {
    if (c.salesAmt < 1000) continue; // skip trivial accounts
    const ratio = c.salesAmt > 0 ? c.returnAmt / c.salesAmt : 0;
    custReturnRatios.push({ custId, name: c.name, ratio, returnAmt: c.returnAmt, salesAmt: c.salesAmt, returnCount: c.returnCount, salesCount: c.salesCount });
  }
  custReturnRatios.sort((a, b) => b.ratio - a.ratio);

  const avgReturnRatio = totalSalesAmt > 0 ? totalReturnAmt / totalSalesAmt : 0;
  for (const cr of custReturnRatios) {
    if (cr.ratio > 0.15 && cr.returnCount >= 3) {
      const sev: Severity = cr.ratio > 0.4 ? "critical" : cr.ratio > 0.25 ? "high" : "medium";
      const score = cr.ratio > 0.4 ? 92 : cr.ratio > 0.25 ? 80 : 68;
      flags.push({
        factory, category: "return_abuse_ratio", severity: sev, score,
        transactionId: null, user: null,
        customerId: cr.custId, customerName: cr.name,
        amountImpact: cr.returnAmt,
        reason: `Customer return ratio ${(cr.ratio * 100).toFixed(1)}% is ${(cr.ratio / Math.max(avgReturnRatio, 0.001)).toFixed(1)}x the factory average (${(avgReturnRatio * 100).toFixed(1)}%)`,
        evidence: { returnRatio: cr.ratio, factoryAvgRatio: avgReturnRatio, returnAmt: cr.returnAmt, salesAmt: cr.salesAmt, returnCount: cr.returnCount, salesCount: cr.salesCount },
      });
    }
  }

  // 1b. Ghost returns (no original bill reference)
  for (const t of returns) {
    const origBill = parseOriginalBill(t.note);
    const returnItems = itemsByTx.get(t.id) || [];
    const hasProductItems = returnItems.some((i) => toNum(i.quantity) !== 0);
    if (!origBill && hasProductItems && Math.abs(toNum(t.total_amount)) > 0) {
      flags.push({
        factory, category: "ghost_return", severity: "high", score: 82,
        transactionId: t.id, user: t.created_by_username || "unknown",
        customerId: t.customer_id, customerName: t.customer_name,
        amountImpact: Math.abs(toNum(t.total_amount)),
        reason: "Product return with no reference to original bill — possible ghost return",
        evidence: { totalAmount: t.total_amount, saleDate: t.sale_date, note: t.note, itemCount: returnItems.length },
      });
    }
  }

  // 1c. Same-day returns (buy and return same day)
  const salesByDateCust = new Map<string, TxRow[]>();
  for (const t of sales) {
    const key = `${t.sale_date}:${t.customer_id}`;
    const arr = salesByDateCust.get(key) || [];
    arr.push(t);
    salesByDateCust.set(key, arr);
  }
  for (const t of returns) {
    const key = `${t.sale_date}:${t.customer_id}`;
    const sameDaySales = salesByDateCust.get(key) || [];
    if (sameDaySales.length > 0 && Math.abs(toNum(t.total_amount)) > 500) {
      flags.push({
        factory, category: "same_day_return", severity: "medium", score: 60,
        transactionId: t.id, user: t.created_by_username || "unknown",
        customerId: t.customer_id, customerName: t.customer_name,
        amountImpact: Math.abs(toNum(t.total_amount)),
        reason: `Return on same day as sale (${t.sale_date}) — verify this is legitimate`,
        evidence: { returnAmount: t.total_amount, saleDate: t.sale_date, sameDaySaleCount: sameDaySales.length, sameDaySaleIds: sameDaySales.map((s) => s.id).slice(0, 5) },
      });
    }
  }

  // 1d. Returns by employee (who processes the most returns?)
  const returnsByEmployee = new Map<string, { count: number; totalAmt: number; customerIds: Set<number> }>();
  for (const t of returns) {
    const user = t.created_by_username || "unknown";
    const prev = returnsByEmployee.get(user) || { count: 0, totalAmt: 0, customerIds: new Set() };
    prev.count += 1;
    prev.totalAmt += Math.abs(toNum(t.total_amount));
    prev.customerIds.add(t.customer_id);
    returnsByEmployee.set(user, prev);
  }
  for (const [user, data] of returnsByEmployee) {
    if (data.count >= 10 && returns.length > 0) {
      const pctOfAllReturns = data.count / returns.length;
      if (pctOfAllReturns > 0.5) {
        flags.push({
          factory, category: "return_employee_concentration", severity: "high", score: 78,
          transactionId: null, user,
          customerId: null, customerName: null,
          amountImpact: data.totalAmt,
          reason: `Employee processes ${(pctOfAllReturns * 100).toFixed(0)}% of all returns (${data.count}/${returns.length})`,
          evidence: { returnCount: data.count, totalReturns: returns.length, pctOfAll: pctOfAllReturns, totalAmt: data.totalAmt, uniqueCustomers: data.customerIds.size },
        });
      }
    }
  }

  // 1e. Return quantity exceeding original sale (cumulative check)
  const returnsByOrigBill = new Map<number, TxRow[]>();
  for (const t of returns) {
    const origId = parseOriginalBill(t.note);
    if (!origId) continue;
    const arr = returnsByOrigBill.get(origId) || [];
    arr.push(t);
    returnsByOrigBill.set(origId, arr);
  }
  for (const [origId, retTxs] of returnsByOrigBill) {
    const origTx = txById.get(origId);
    if (!origTx) continue;
    const origItems = itemsByTx.get(origId) || [];
    const origQtyByProduct = new Map<number, number>();
    for (const i of origItems) origQtyByProduct.set(i.product_type_id, (origQtyByProduct.get(i.product_type_id) || 0) + Math.abs(toNum(i.quantity)));

    const returnQtyByProduct = new Map<number, number>();
    for (const rt of retTxs) {
      const retItems = itemsByTx.get(rt.id) || [];
      for (const i of retItems) returnQtyByProduct.set(i.product_type_id, (returnQtyByProduct.get(i.product_type_id) || 0) + Math.abs(toNum(i.quantity)));
    }

    for (const [prodId, returnedQty] of returnQtyByProduct) {
      const soldQty = origQtyByProduct.get(prodId) || 0;
      if (returnedQty > soldQty && soldQty > 0) {
        flags.push({
          factory, category: "return_exceeds_sale", severity: "critical", score: 95,
          transactionId: origId, user: retTxs[0].created_by_username || "unknown",
          customerId: origTx.customer_id, customerName: origTx.customer_name,
          amountImpact: (returnedQty - soldQty) * (origItems.find((i) => i.product_type_id === prodId)?.unit_price || 0),
          reason: `Cumulative return qty (${returnedQty}) exceeds original sale qty (${soldQty}) for product ${prodId}`,
          evidence: { originalBill: origId, productTypeId: prodId, soldQty, returnedQty, returnTxIds: retTxs.map((t) => t.id) },
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. LOADING / OVER-DELIVERY DETECTION
  // ═══════════════════════════════════════════════════════════════════════════

  // 2a. loaded_qty > quantity (over-loading)
  let overloadCount = 0;
  let overloadTotalQty = 0;
  for (const i of itemRows) {
    const tx = txById.get(i.transaction_id);
    if (!tx || tx.status === "voided") continue;
    const qty = toNum(i.quantity);
    const loaded = toNum(i.loaded_qty);
    if (qty <= 0) continue;
    if (loaded > qty) {
      overloadCount++;
      const excess = loaded - qty;
      overloadTotalQty += excess;
      const unitPrice = toNum(i.unit_price);
      flags.push({
        factory, category: "overload", severity: excess >= 5 ? "critical" : "high", score: excess >= 5 ? 94 : 82,
        transactionId: tx.id, user: tx.created_by_username || "unknown",
        customerId: tx.customer_id, customerName: tx.customer_name,
        amountImpact: excess * unitPrice,
        reason: `Loaded ${loaded} but billed only ${qty} (excess: ${excess}) — ${i.product_name}`,
        evidence: { productTypeId: i.product_type_id, productName: i.product_name, billedQty: qty, loadedQty: loaded, excessQty: excess, unitPrice, saleDate: tx.sale_date },
      });
    }
  }

  // 2b. Loading tracking coverage — what % of items have loaded_qty tracked?
  const salesItems = itemRows.filter((i) => {
    const tx = txById.get(i.transaction_id);
    return tx && tx.status !== "voided" && toNum(i.quantity) > 0;
  });
  const loadedTracked = salesItems.filter((i) => toNum(i.loaded_qty) > 0).length;
  const loadTrackingPct = salesItems.length > 0 ? loadedTracked / salesItems.length : 0;

  // 2c. Quantity anomalies per customer/product (statistical outliers)
  const custProdQty = new Map<string, number[]>();
  for (const i of salesItems) {
    const tx = txById.get(i.transaction_id)!;
    const key = `${tx.customer_id}:${i.product_type_id}`;
    const arr = custProdQty.get(key) || [];
    arr.push(toNum(i.quantity));
    custProdQty.set(key, arr);
  }

  for (const i of salesItems) {
    const tx = txById.get(i.transaction_id)!;
    const key = `${tx.customer_id}:${i.product_type_id}`;
    const history = custProdQty.get(key) || [];
    if (history.length < 10) continue;
    const qty = toNum(i.quantity);
    const m = mean(history);
    const sd = stddev(history);
    if (sd <= 0) continue;
    const zScore = (qty - m) / sd;
    if (zScore >= 3.5 && qty >= m * 2 && qty >= 5) {
      flags.push({
        factory, category: "quantity_spike", severity: zScore >= 5 ? "high" : "medium", score: zScore >= 5 ? 79 : 65,
        transactionId: tx.id, user: tx.created_by_username || "unknown",
        customerId: tx.customer_id, customerName: tx.customer_name,
        amountImpact: (qty - m) * toNum(i.unit_price),
        reason: `Order qty ${qty} is ${zScore.toFixed(1)} std devs above customer avg (${m.toFixed(1)}) for ${i.product_name}`,
        evidence: { productTypeId: i.product_type_id, productName: i.product_name, quantity: qty, customerMean: m, customerStdDev: sd, zScore, saleDate: tx.sale_date, p95: percentile(history, 95) },
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. PRODUCTION vs SALES (INVENTORY SHRINKAGE)
  // ═══════════════════════════════════════════════════════════════════════════

  const prodByProduct = new Map<number, { name: string; produced: number }>();
  for (const p of productionRows) {
    const prev = prodByProduct.get(p.product_type_id) || { name: p.product_name, produced: 0 };
    prev.produced += toNum(p.quantity);
    prodByProduct.set(p.product_type_id, prev);
  }

  const soldByProduct = new Map<number, { name: string; sold: number }>();
  for (const i of salesItems) {
    const prev = soldByProduct.get(i.product_type_id) || { name: i.product_name, sold: 0 };
    prev.sold += toNum(i.quantity);
    soldByProduct.set(i.product_type_id, prev);
  }

  const returnedByProduct = new Map<number, number>();
  for (const t of returns) {
    const retItems = itemsByTx.get(t.id) || [];
    for (const i of retItems) {
      returnedByProduct.set(i.product_type_id, (returnedByProduct.get(i.product_type_id) || 0) + Math.abs(toNum(i.quantity)));
    }
  }

  const inventoryGaps: Array<{ productId: number; name: string; produced: number; sold: number; returned: number; netSold: number; gap: number; gapPct: number }> = [];
  for (const [prodId, prodData] of prodByProduct) {
    const sold = soldByProduct.get(prodId)?.sold || 0;
    const returned = returnedByProduct.get(prodId) || 0;
    const netSold = sold - returned;
    const gap = prodData.produced - netSold;
    const gapPct = prodData.produced > 0 ? gap / prodData.produced : 0;
    inventoryGaps.push({ productId: prodId, name: prodData.name, produced: prodData.produced, sold, returned, netSold, gap, gapPct });
  }

  for (const ig of inventoryGaps) {
    if (ig.produced > 100 && ig.gap < 0) {
      const shrinkagePct = Math.abs(ig.gapPct);
      if (shrinkagePct > 0.05) {
        flags.push({
          factory, category: "inventory_shrinkage", severity: shrinkagePct > 0.15 ? "critical" : shrinkagePct > 0.08 ? "high" : "medium",
          score: shrinkagePct > 0.15 ? 90 : shrinkagePct > 0.08 ? 78 : 65,
          transactionId: null, user: null,
          customerId: null, customerName: null,
          amountImpact: 0,
          reason: `${ig.name}: sold ${ig.netSold.toFixed(0)} but only produced ${ig.produced.toFixed(0)} — deficit of ${Math.abs(ig.gap).toFixed(0)} units (${(shrinkagePct * 100).toFixed(1)}%)`,
          evidence: { productTypeId: ig.productId, productName: ig.name, produced: ig.produced, sold: ig.sold, returned: ig.returned, netSold: ig.netSold, gap: ig.gap, gapPct: ig.gapPct },
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. EMPLOYEE–CUSTOMER COLLUSION SIGNALS
  // ═══════════════════════════════════════════════════════════════════════════

  // Identify employee–customer pairs where an employee handles a disproportionate
  // share of a single customer's transactions
  const empCustPairs = new Map<string, { employee: string; custId: number; custName: string; count: number; totalAmt: number }>();
  for (const t of sales) {
    const emp = t.created_by_username || "unknown";
    if (emp === "unknown") continue;
    const key = `${emp}:${t.customer_id}`;
    const prev = empCustPairs.get(key) || { employee: emp, custId: t.customer_id, custName: t.customer_name, count: 0, totalAmt: 0 };
    prev.count += 1;
    prev.totalAmt += toNum(t.total_amount);
    empCustPairs.set(key, prev);
  }

  const custTotalTx = new Map<number, number>();
  for (const t of sales) {
    custTotalTx.set(t.customer_id, (custTotalTx.get(t.customer_id) || 0) + 1);
  }

  for (const [, pair] of empCustPairs) {
    const custTotal = custTotalTx.get(pair.custId) || 0;
    if (custTotal < 20) continue;
    const pairPct = pair.count / custTotal;
    if (pairPct > 0.85 && pair.count >= 50) {
      flags.push({
        factory, category: "employee_customer_lock", severity: "medium", score: 62,
        transactionId: null, user: pair.employee,
        customerId: pair.custId, customerName: pair.custName,
        amountImpact: pair.totalAmt,
        reason: `Employee "${pair.employee}" handles ${(pairPct * 100).toFixed(0)}% (${pair.count}/${custTotal}) of this customer's transactions — potential collusion signal`,
        evidence: { employee: pair.employee, pairCount: pair.count, custTotalTx: custTotal, pairPct, totalAmt: pair.totalAmt },
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. CASH / CREDIT MANIPULATION
  // ═══════════════════════════════════════════════════════════════════════════

  // 5a. Transactions marked "paid" but paid < totalAmount (underpayment)
  for (const t of activeTx) {
    if (t.status !== "paid") continue;
    const total = toNum(t.total_amount);
    const paid = toNum(t.paid);
    if (total <= 0) continue;
    const shortfall = total - paid;
    if (shortfall > 10 && shortfall / total > 0.1) {
      flags.push({
        factory, category: "cash_shortfall", severity: shortfall > 1000 ? "high" : "medium", score: shortfall > 1000 ? 76 : 62,
        transactionId: t.id, user: t.created_by_username || "unknown",
        customerId: t.customer_id, customerName: t.customer_name,
        amountImpact: shortfall,
        reason: `Marked "paid" but short by ${shortfall.toFixed(0)} (${((shortfall / total) * 100).toFixed(0)}%)`,
        evidence: { totalAmount: total, paidAmount: paid, shortfall, shortfallPct: shortfall / total, saleDate: t.sale_date },
      });
    }
  }

  // 5b. Customers with persistent growing balances (credit abuse)
  const custBalance = new Map<number, { name: string; totalSales: number; totalPaid: number; txCount: number }>();
  for (const t of activeTx) {
    const prev = custBalance.get(t.customer_id) || { name: t.customer_name, totalSales: 0, totalPaid: 0, txCount: 0 };
    prev.totalSales += toNum(t.total_amount);
    prev.totalPaid += toNum(t.paid);
    prev.txCount += 1;
    custBalance.set(t.customer_id, prev);
  }

  for (const [custId, bal] of custBalance) {
    const outstanding = bal.totalSales - bal.totalPaid;
    const collPct = bal.totalSales > 0 ? bal.totalPaid / bal.totalSales : 1;
    if (outstanding > 50000 && collPct < 0.3 && bal.txCount >= 20) {
      flags.push({
        factory, category: "credit_abuse", severity: outstanding > 500000 ? "critical" : "high", score: outstanding > 500000 ? 88 : 74,
        transactionId: null, user: null,
        customerId: custId, customerName: bal.name,
        amountImpact: outstanding,
        reason: `Outstanding balance ${outstanding.toFixed(0)} with only ${(collPct * 100).toFixed(1)}% collected over ${bal.txCount} transactions`,
        evidence: { totalSales: bal.totalSales, totalPaid: bal.totalPaid, outstanding, collectionPct: collPct, txCount: bal.txCount },
      });
    }
  }

  // Sort all flags
  flags.sort((a, b) => {
    const sev = severityRank(b.severity) - severityRank(a.severity);
    if (sev !== 0) return sev;
    if (b.score !== a.score) return b.score - a.score;
    return b.amountImpact - a.amountImpact;
  });

  // Compile stats
  const stats = {
    totalTransactions: txRows.length,
    totalSales: sales.length,
    totalReturns: returns.length,
    totalSalesAmount: totalSalesAmt,
    totalReturnAmount: totalReturnAmt,
    factoryReturnRatio: avgReturnRatio,
    loadTrackingCoverage: loadTrackingPct,
    loadedItemsTracked: loadedTracked,
    totalSalesItems: salesItems.length,
    overloadCount,
    overloadTotalExcessQty: overloadTotalQty,
    productionLogEntries: productionRows.length,
    inventoryGaps: inventoryGaps.filter((g) => g.produced > 0),
    topReturnCustomers: custReturnRatios.slice(0, 20).map((cr) => ({
      customerId: cr.custId,
      name: cr.name,
      returnRatio: cr.ratio,
      returnAmt: cr.returnAmt,
      salesAmt: cr.salesAmt,
      returnCount: cr.returnCount,
      salesCount: cr.salesCount,
    })),
  };

  return { flags, stats };
}

// ── Output ───────────────────────────────────────────────────────────────────

function writeOutputs(
  startDate: string,
  endDate: string,
  allFlags: FraudFlag[],
  perFactory: Record<string, { flags: FraudFlag[]; stats: Record<string, unknown> }>
) {
  const outDir = path.join(process.cwd(), "docs", "forensics");
  fs.mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = `deep-fraud-analysis-${ts}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const csvPath = path.join(outDir, `${baseName}.csv`);

  const perFactorySummary: Record<string, unknown> = {};
  for (const [f, data] of Object.entries(perFactory)) {
    const bySeverity = { critical: 0, high: 0, medium: 0, info: 0 };
    const byCategory = new Map<string, number>();
    let totalImpact = 0;
    for (const fl of data.flags) {
      bySeverity[fl.severity] += 1;
      byCategory.set(fl.category, (byCategory.get(fl.category) || 0) + 1);
      totalImpact += fl.amountImpact;
    }
    perFactorySummary[f] = { bySeverity, byCategory: Object.fromEntries(byCategory), totalImpact, totalFlags: data.flags.length, stats: data.stats };
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    window: { startDate, endDate },
    totalFlags: allFlags.length,
    perFactorySummary,
    flags: allFlags,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");

  const csvHeader = ["factory", "category", "severity", "score", "transactionId", "user", "customerId", "customerName", "amountImpact", "reason", "evidenceJson"];
  const csvLines = [csvHeader.join(",")];
  for (const f of allFlags) {
    csvLines.push([
      csvEscape(f.factory), csvEscape(f.category), csvEscape(f.severity), csvEscape(f.score),
      csvEscape(f.transactionId ?? ""), csvEscape(f.user ?? ""), csvEscape(f.customerId ?? ""),
      csvEscape(f.customerName ?? ""), csvEscape(f.amountImpact.toFixed(2)), csvEscape(f.reason),
      csvEscape(JSON.stringify(f.evidence)),
    ].join(","));
  }
  fs.writeFileSync(csvPath, csvLines.join("\n"), "utf8");

  return { jsonPath, csvPath };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { startDate, endDate } = buildWindow();
  const dbUrls = loadDatabaseUrls();
  const factories = Object.keys(dbUrls);
  if (!factories.length) {
    console.error("No factory DB URLs found. Set DATABASE_URL_SI / _BEARING / _KTK.");
    process.exit(1);
  }

  console.log(`Deep fraud analysis: ${factories.length} factories, ${startDate} to ${endDate}\n`);

  const allFlags: FraudFlag[] = [];
  const perFactory: Record<string, { flags: FraudFlag[]; stats: Record<string, unknown> }> = {};

  for (const factory of factories) {
    const { txRows, itemRows, productionRows } = await fetchData(factory, dbUrls[factory], startDate, endDate);
    const result = analyzeFactory(factory, txRows, itemRows, productionRows);
    allFlags.push(...result.flags);
    perFactory[factory] = result;

    console.log(`\n[${factory}] === STATS ===`);
    const s = result.stats as Record<string, unknown>;
    console.log(`  Transactions: ${s.totalSales} sales, ${s.totalReturns} returns`);
    console.log(`  Return ratio: ${((s.factoryReturnRatio as number) * 100).toFixed(2)}%`);
    console.log(`  Loading tracking: ${((s.loadTrackingCoverage as number) * 100).toFixed(1)}% of items have loaded_qty`);
    console.log(`  Over-loads found: ${s.overloadCount}`);
    console.log(`  Production log entries: ${s.productionLogEntries}`);
    console.log(`  Fraud flags: ${result.flags.length}`);
  }

  allFlags.sort((a, b) => {
    const sev = severityRank(b.severity) - severityRank(a.severity);
    if (sev !== 0) return sev;
    if (b.score !== a.score) return b.score - a.score;
    return b.amountImpact - a.amountImpact;
  });

  const out = writeOutputs(startDate, endDate, allFlags, perFactory);

  console.log(`\n════════════════════════════════════════`);
  console.log(`Total flags across all factories: ${allFlags.length}`);
  console.log(`  Critical: ${allFlags.filter((f) => f.severity === "critical").length}`);
  console.log(`  High:     ${allFlags.filter((f) => f.severity === "high").length}`);
  console.log(`  Medium:   ${allFlags.filter((f) => f.severity === "medium").length}`);
  console.log(`\nJSON: ${out.jsonPath}`);
  console.log(`CSV:  ${out.csvPath}`);
}

main().catch((err) => {
  console.error("Deep fraud analysis failed:", err);
  process.exit(1);
});
