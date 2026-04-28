#!/usr/bin/env npx tsx
/**
 * Backdated fraud analysis for the past 12 months.
 *
 * Usage:
 *   source .env.local && npx tsx scripts/backdated-fraud-analysis.ts
 *
 * Outputs:
 *   docs/forensics/backdated-fraud-analysis-<timestamp>.md
 *   docs/forensics/backdated-fraud-analysis-<timestamp>.json
 *   docs/forensics/backdated-fraud-analysis-<timestamp>.csv
 */

import postgres from "postgres";
import * as fs from "fs";
import * as path from "path";

type Severity = "critical" | "high" | "medium";

type FraudFlag = {
  factory: string;
  category:
    | "void_abuse"
    | "refund_abuse"
    | "price_tamper"
    | "timestamp_backdating"
    | "payment_manipulation";
  severity: Severity;
  score: number;
  transactionId: number | null;
  user: string | null;
  customerId: number | null;
  amountImpact: number;
  reason: string;
  evidence: Record<string, unknown>;
};

type TxRow = {
  id: number;
  customer_id: number;
  total_amount: number;
  paid: number;
  status: "paid" | "unpaid" | "partial" | "voided";
  sale_date: string;
  sale_time: string;
  created_at: string;
  created_by: number | null;
  created_by_username: string | null;
  voided_by: number | null;
  voided_by_username: string | null;
  void_reason: string | null;
  note: string | null;
};

type ItemRow = {
  transaction_id: number;
  product_type_id: number;
  quantity: number;
  unit_price: number;
  subtotal: number;
};

type AuditRow = {
  id: number;
  user_id: number | null;
  username: string;
  action: string;
  entity: string;
  entity_id: number | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

const FACTORY_ENV: Array<{ key: string; envVar: string }> = [
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadDatabaseUrls(): Record<string, string> {
  const envFromFile = parseEnvFile(path.join(process.cwd(), ".env.local"));
  const getVar = (name: string): string | undefined =>
    process.env[name] || envFromFile[name];

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

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function parseOriginalBillFromNote(note: string | null): number | null {
  if (!note) return null;
  const m = note.match(/อ้างอิงบิล\s*#(\d+)/);
  if (!m) return null;
  return parseInt(m[1], 10);
}

function severityRank(s: Severity): number {
  if (s === "critical") return 3;
  if (s === "high") return 2;
  return 1;
}

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildWindow(): { startDate: string; endDate: string } {
  const now = new Date();
  const endDate = now.toISOString().slice(0, 10);
  const start = new Date(now);
  start.setUTCMonth(start.getUTCMonth() - 12);
  const startDate = start.toISOString().slice(0, 10);
  return { startDate, endDate };
}

async function fetchFactoryData(
  factory: string,
  dbUrl: string,
  startDate: string,
  endDate: string
): Promise<{ txRows: TxRow[]; itemRows: ItemRow[]; auditRows: AuditRow[] }> {
  const sql = postgres(dbUrl, { max: 4, connect_timeout: 15, idle_timeout: 20 });

  try {
    const txRows = await sql<TxRow[]>`
      SELECT
        t.id,
        t.customer_id,
        t.total_amount,
        t.paid,
        t.status,
        t.sale_date::text AS sale_date,
        t.sale_time::text AS sale_time,
        t.created_at::text AS created_at,
        t.created_by,
        u1.username AS created_by_username,
        t.voided_by,
        u2.username AS voided_by_username,
        t.void_reason,
        t.note
      FROM transactions t
      LEFT JOIN users u1 ON t.created_by = u1.id
      LEFT JOIN users u2 ON t.voided_by = u2.id
      WHERE t.sale_date >= ${startDate}::date
        AND t.sale_date <= ${endDate}::date
    `;

    const itemRows = await sql<ItemRow[]>`
      SELECT
        ti.transaction_id,
        ti.product_type_id,
        ti.quantity,
        ti.unit_price,
        ti.subtotal
      FROM transaction_items ti
      INNER JOIN transactions t ON t.id = ti.transaction_id
      WHERE t.sale_date >= ${startDate}::date
        AND t.sale_date <= ${endDate}::date
    `;

    const auditRows = await sql<AuditRow[]>`
      SELECT
        a.id,
        a.user_id,
        a.username,
        a.action,
        a.entity,
        a.entity_id,
        a.details,
        a.created_at::text AS created_at
      FROM audit_log a
      WHERE a.created_at >= ${startDate}::date
        AND a.created_at < (${endDate}::date + INTERVAL '1 day')
        AND (
          a.action LIKE 'transaction.%'
          OR a.action = 'return.create'
          OR a.action = 'price.change'
        )
    `;

    console.log(
      `[${factory}] loaded: tx=${txRows.length}, items=${itemRows.length}, audits=${auditRows.length}`
    );
    return { txRows, itemRows, auditRows };
  } finally {
    await sql.end();
  }
}

function detectFraudFlags(
  factory: string,
  txRows: TxRow[],
  itemRows: ItemRow[],
  auditRows: AuditRow[]
): FraudFlag[] {
  const flags: FraudFlag[] = [];
  const txById = new Map<number, TxRow>(txRows.map((t) => [t.id, t]));

  // ----- Void abuse -----
  const voided = txRows.filter((t) => t.status === "voided");
  const voidByUser = new Map<string, { count: number; amount: number }>();
  for (const t of voided) {
    const user = t.voided_by_username || t.created_by_username || "unknown";
    const prev = voidByUser.get(user) || { count: 0, amount: 0 };
    prev.count += 1;
    prev.amount += Math.abs(toNum(t.total_amount));
    voidByUser.set(user, prev);

    const reason = (t.void_reason || "").trim().toLowerCase();
    if (!reason || ["ยกเลิก", "ผิด", "test", "na", "-"].includes(reason)) {
      flags.push({
        factory,
        category: "void_abuse",
        severity: "high",
        score: 78,
        transactionId: t.id,
        user,
        customerId: t.customer_id,
        amountImpact: Math.abs(toNum(t.total_amount)),
        reason: "Voided transaction with blank/generic reason",
        evidence: {
          voidReason: t.void_reason,
          totalAmount: t.total_amount,
          saleDate: t.sale_date,
        },
      });
    }
  }
  for (const [user, agg] of voidByUser) {
    if (agg.count >= 8 || agg.amount >= 100000) {
      flags.push({
        factory,
        category: "void_abuse",
        severity: agg.count >= 15 ? "critical" : "high",
        score: agg.count >= 15 ? 92 : 84,
        transactionId: null,
        user,
        customerId: null,
        amountImpact: agg.amount,
        reason: `High void concentration by user (${agg.count} voids)`,
        evidence: { voidCount: agg.count, voidAmount: agg.amount },
      });
    }
  }

  // ----- Refund abuse -----
  const returns = txRows.filter((t) => toNum(t.total_amount) < 0 && t.status !== "voided");
  const sales = txRows.filter((t) => toNum(t.total_amount) > 0 && t.status !== "voided");

  const totalReturnAmount = returns.reduce((s, t) => s + Math.abs(toNum(t.total_amount)), 0);
  const totalSalesAmount = sales.reduce((s, t) => s + Math.abs(toNum(t.total_amount)), 0);
  const refundRatio = totalSalesAmount > 0 ? totalReturnAmount / totalSalesAmount : 0;

  if (refundRatio > 0.2) {
    flags.push({
      factory,
      category: "refund_abuse",
      severity: refundRatio > 0.35 ? "critical" : "high",
      score: refundRatio > 0.35 ? 93 : 82,
      transactionId: null,
      user: null,
      customerId: null,
      amountImpact: totalReturnAmount,
      reason: `Factory refund ratio is unusually high (${(refundRatio * 100).toFixed(1)}%)`,
      evidence: { refundRatio, totalReturnAmount, totalSalesAmount },
    });
  }

  const returnsByOriginal = new Map<number, TxRow[]>();
  for (const t of returns) {
    const originalBill = parseOriginalBillFromNote(t.note);
    if (!originalBill) continue;
    const arr = returnsByOriginal.get(originalBill) || [];
    arr.push(t);
    returnsByOriginal.set(originalBill, arr);
  }
  for (const [originalBill, arr] of returnsByOriginal) {
    if (arr.length >= 2) {
      const sum = arr.reduce((s, t) => s + Math.abs(toNum(t.total_amount)), 0);
      flags.push({
        factory,
        category: "refund_abuse",
        severity: arr.length >= 4 ? "high" : "medium",
        score: arr.length >= 4 ? 79 : 66,
        transactionId: arr[0].id,
        user: arr[0].created_by_username || "unknown",
        customerId: arr[0].customer_id,
        amountImpact: sum,
        reason: `Multiple returns referencing same original bill #${originalBill}`,
        evidence: {
          originalBill,
          returnCount: arr.length,
          returnTransactionIds: arr.map((t) => t.id),
          totalRefund: sum,
        },
      });
    }
  }

  // ----- Price tamper indicators -----
  type PriceKey = string;
  const baselinePriceMap = new Map<PriceKey, number[]>();
  for (const i of itemRows) {
    const tx = txById.get(i.transaction_id);
    if (!tx || tx.status === "voided") continue;
    if (toNum(i.quantity) <= 0) continue;
    const key = `${tx.customer_id}:${i.product_type_id}`;
    const arr = baselinePriceMap.get(key) || [];
    arr.push(toNum(i.unit_price));
    baselinePriceMap.set(key, arr);
  }
  const medianPriceMap = new Map<PriceKey, number>();
  for (const [k, prices] of baselinePriceMap) {
    if (prices.length >= 5) medianPriceMap.set(k, median(prices));
  }

  for (const i of itemRows) {
    const tx = txById.get(i.transaction_id);
    if (!tx || tx.status === "voided") continue;
    if (toNum(i.quantity) <= 0) continue;
    const key = `${tx.customer_id}:${i.product_type_id}`;
    const med = medianPriceMap.get(key);
    if (!med || med <= 0) continue;
    const ratio = toNum(i.unit_price) / med;
    if (ratio < 0.7) {
      flags.push({
        factory,
        category: "price_tamper",
        severity: ratio < 0.4 ? "critical" : "high",
        score: ratio < 0.4 ? 95 : 83,
        transactionId: tx.id,
        user: tx.created_by_username || "unknown",
        customerId: tx.customer_id,
        amountImpact: Math.max(0, (med - toNum(i.unit_price)) * toNum(i.quantity)),
        reason: "Unit price significantly below customer/product baseline",
        evidence: {
          productTypeId: i.product_type_id,
          baselineMedianPrice: med,
          observedUnitPrice: i.unit_price,
          ratioToMedian: ratio,
          quantity: i.quantity,
        },
      });
    }
  }

  // ----- Timestamp backdating indicators -----
  for (const t of txRows) {
    const createdAt = new Date(t.created_at);
    const saleAt = new Date(`${t.sale_date}T${t.sale_time}Z`);
    const diffMs = createdAt.getTime() - saleAt.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays >= 2) {
      flags.push({
        factory,
        category: "timestamp_backdating",
        severity: diffDays >= 7 ? "high" : "medium",
        score: diffDays >= 7 ? 80 : 68,
        transactionId: t.id,
        user: t.created_by_username || "unknown",
        customerId: t.customer_id,
        amountImpact: Math.abs(toNum(t.total_amount)),
        reason: "Transaction appears backdated compared to creation time",
        evidence: {
          saleDate: t.sale_date,
          saleTime: t.sale_time,
          createdAt: t.created_at,
          daysLag: Number(diffDays.toFixed(2)),
        },
      });
    }
  }

  // ----- Payment manipulation indicators -----
  const paymentAudits = auditRows.filter((a) => a.action === "transaction.payment");
  const paymentsByTx = new Map<number, number[]>();
  for (const a of paymentAudits) {
    if (!a.entity_id) continue;
    const amount = toNum((a.details || {}).amount);
    if (amount <= 0) continue;
    const arr = paymentsByTx.get(a.entity_id) || [];
    arr.push(amount);
    paymentsByTx.set(a.entity_id, arr);
  }

  for (const [txId, amounts] of paymentsByTx) {
    if (amounts.length < 3) continue;
    const tx = txById.get(txId);
    if (!tx) continue;
    const total = Math.abs(toNum(tx.total_amount));
    if (total <= 0) continue;
    const microCount = amounts.filter((a) => a / total < 0.05).length;
    if (microCount >= 3) {
      flags.push({
        factory,
        category: "payment_manipulation",
        severity: "medium",
        score: 64,
        transactionId: txId,
        user: tx.created_by_username || "unknown",
        customerId: tx.customer_id,
        amountImpact: total,
        reason: "Repeated micro-payments on a single transaction",
        evidence: {
          paymentEvents: amounts.length,
          microPaymentCount: microCount,
          totalAmount: total,
          payments: amounts,
        },
      });
    }
  }

  flags.sort((a, b) => {
    const sev = severityRank(b.severity) - severityRank(a.severity);
    if (sev !== 0) return sev;
    if (b.score !== a.score) return b.score - a.score;
    return b.amountImpact - a.amountImpact;
  });
  return flags;
}

function summarizeFactory(flags: FraudFlag[]) {
  const bySeverity = { critical: 0, high: 0, medium: 0 };
  const byCategory = new Map<string, number>();
  let totalImpact = 0;
  for (const f of flags) {
    bySeverity[f.severity] += 1;
    byCategory.set(f.category, (byCategory.get(f.category) || 0) + 1);
    totalImpact += f.amountImpact;
  }
  return { bySeverity, byCategory: Object.fromEntries(byCategory), totalImpact };
}

function writeOutputs(
  startDate: string,
  endDate: string,
  allFlags: FraudFlag[],
  perFactorySummary: Record<string, ReturnType<typeof summarizeFactory>>
) {
  const outDir = path.join(process.cwd(), "docs", "forensics");
  fs.mkdirSync(outDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = `backdated-fraud-analysis-${timestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const mdPath = path.join(outDir, `${baseName}.md`);
  const csvPath = path.join(outDir, `${baseName}.csv`);

  const jsonPayload = {
    generatedAt: new Date().toISOString(),
    window: { startDate, endDate },
    totalFlags: allFlags.length,
    perFactorySummary,
    flags: allFlags,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(jsonPayload, null, 2), "utf8");

  const csvHeader = [
    "factory",
    "category",
    "severity",
    "score",
    "transactionId",
    "user",
    "customerId",
    "amountImpact",
    "reason",
    "evidenceJson",
  ];
  const csvLines = [csvHeader.join(",")];
  for (const f of allFlags) {
    csvLines.push(
      [
        csvEscape(f.factory),
        csvEscape(f.category),
        csvEscape(f.severity),
        csvEscape(f.score),
        csvEscape(f.transactionId ?? ""),
        csvEscape(f.user ?? ""),
        csvEscape(f.customerId ?? ""),
        csvEscape(f.amountImpact.toFixed(2)),
        csvEscape(f.reason),
        csvEscape(JSON.stringify(f.evidence)),
      ].join(",")
    );
  }
  fs.writeFileSync(csvPath, csvLines.join("\n"), "utf8");

  const top20 = allFlags.slice(0, 20);
  const md: string[] = [];
  md.push("# Backdated Fraud Analysis Report");
  md.push("");
  md.push(`- Generated: ${new Date().toISOString()}`);
  md.push(`- Window: ${startDate} to ${endDate}`);
  md.push(`- Total flags: ${allFlags.length}`);
  md.push("");
  md.push("## Per-Factory Summary");
  md.push("");
  for (const [factory, s] of Object.entries(perFactorySummary)) {
    md.push(`### Factory: ${factory}`);
    md.push(
      `- Severity counts: critical=${s.bySeverity.critical}, high=${s.bySeverity.high}, medium=${s.bySeverity.medium}`
    );
    md.push(`- Estimated impact sum: ${s.totalImpact.toFixed(2)}`);
    md.push(`- Categories: \`${JSON.stringify(s.byCategory)}\``);
    md.push("");
  }
  md.push("## Top 20 Suspicious Cases");
  md.push("");
  top20.forEach((f, idx) => {
    md.push(
      `${idx + 1}. [${f.severity.toUpperCase()}|score=${f.score}] ${f.factory} - ${f.category} - tx=${f.transactionId ?? "n/a"} - user=${f.user ?? "n/a"} - impact=${f.amountImpact.toFixed(2)}`
    );
    md.push(`   - Reason: ${f.reason}`);
    md.push(`   - Evidence: \`${JSON.stringify(f.evidence)}\``);
  });
  md.push("");
  md.push("## Output Files");
  md.push("");
  md.push(`- JSON: \`${jsonPath}\``);
  md.push(`- CSV: \`${csvPath}\``);
  md.push(`- Markdown: \`${mdPath}\``);
  md.push("");
  fs.writeFileSync(mdPath, md.join("\n"), "utf8");

  return { jsonPath, csvPath, mdPath };
}

async function main() {
  const { startDate, endDate } = buildWindow();
  const dbUrls = loadDatabaseUrls();
  const factories = Object.keys(dbUrls);
  if (factories.length === 0) {
    console.error("No factory DB URLs found. Set DATABASE_URL_SI / DATABASE_URL_BEARING / DATABASE_URL_KTK.");
    process.exit(1);
  }

  console.log(`Analyzing ${factories.length} factory databases from ${startDate} to ${endDate}`);

  const allFlags: FraudFlag[] = [];
  const perFactorySummary: Record<string, ReturnType<typeof summarizeFactory>> = {};

  for (const factory of factories) {
    const { txRows, itemRows, auditRows } = await fetchFactoryData(
      factory,
      dbUrls[factory],
      startDate,
      endDate
    );
    const flags = detectFraudFlags(factory, txRows, itemRows, auditRows);
    allFlags.push(...flags);
    perFactorySummary[factory] = summarizeFactory(flags);
  }

  allFlags.sort((a, b) => {
    const sev = severityRank(b.severity) - severityRank(a.severity);
    if (sev !== 0) return sev;
    if (b.score !== a.score) return b.score - a.score;
    return b.amountImpact - a.amountImpact;
  });

  const out = writeOutputs(startDate, endDate, allFlags, perFactorySummary);
  console.log(`Done. Flags=${allFlags.length}`);
  console.log(`Report: ${out.mdPath}`);
  console.log(`Evidence JSON: ${out.jsonPath}`);
  console.log(`Evidence CSV: ${out.csvPath}`);
}

main().catch((err) => {
  console.error("Fraud analysis failed:", err);
  process.exit(1);
});

