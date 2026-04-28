#!/usr/bin/env node
/**
 * Generates a styled PDF from the deep-fraud-analysis JSON.
 * Usage: node scripts/generate-deep-fraud-pdf.js
 */

const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const FORENSICS_DIR = path.join(__dirname, "..", "docs", "forensics");

function findLatestJson() {
  const files = fs.readdirSync(FORENSICS_DIR)
    .filter((f) => f.startsWith("deep-fraud-analysis-") && f.endsWith(".json"))
    .sort().reverse();
  if (!files.length) throw new Error("No deep-fraud-analysis JSON found");
  return path.join(FORENSICS_DIR, files[0]);
}

function fmt(n) { return Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 }); }
function fmtB(n) { return "\u0E3F" + fmt(n); }
function fmtM(n) { return "\u0E3F" + (n / 1e6).toFixed(2) + "M"; }
function pct(n) { return (n * 100).toFixed(1) + "%"; }

function buildHTML(data) {
  const { generatedAt, window: win, totalFlags, perFactorySummary: pfs, flags } = data;
  const genDate = new Date(generatedAt).toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });
  const factories = Object.keys(pfs);

  // Aggregate stats
  const totalImpact = flags.reduce((s, f) => s + f.amountImpact, 0);
  const criticalCount = flags.filter((f) => f.severity === "critical").length;
  const highCount = flags.filter((f) => f.severity === "high").length;
  const mediumCount = flags.filter((f) => f.severity === "medium").length;

  // Ghost returns
  const ghostFlags = flags.filter((f) => f.category === "ghost_return");
  const ghostByFactory = {};
  for (const f of ghostFlags) {
    if (!ghostByFactory[f.factory]) ghostByFactory[f.factory] = { count: 0, impact: 0, topCustomers: {} };
    ghostByFactory[f.factory].count++;
    ghostByFactory[f.factory].impact += f.amountImpact;
    const cn = f.customerName || "unknown";
    if (!ghostByFactory[f.factory].topCustomers[cn]) ghostByFactory[f.factory].topCustomers[cn] = { count: 0, impact: 0 };
    ghostByFactory[f.factory].topCustomers[cn].count++;
    ghostByFactory[f.factory].topCustomers[cn].impact += f.amountImpact;
  }

  // Cash shortfall
  const shortfallFlags = flags.filter((f) => f.category === "cash_shortfall");
  const shortfallByFactory = {};
  for (const f of shortfallFlags) {
    if (!shortfallByFactory[f.factory]) shortfallByFactory[f.factory] = { count: 0, impact: 0 };
    shortfallByFactory[f.factory].count++;
    shortfallByFactory[f.factory].impact += f.amountImpact;
  }

  // Credit abuse
  const creditFlags = flags.filter((f) => f.category === "credit_abuse").sort((a, b) => b.amountImpact - a.amountImpact);

  // Category counts per factory for chart
  const allCategories = ["ghost_return", "cash_shortfall", "quantity_spike", "same_day_return", "credit_abuse", "return_abuse_ratio", "return_employee_concentration", "return_exceeds_sale", "overload", "inventory_shrinkage", "employee_customer_lock"];
  const catLabels = {
    ghost_return: "Ghost Returns", cash_shortfall: "Cash Shortfall", quantity_spike: "Qty Spikes",
    same_day_return: "Same-Day Returns", credit_abuse: "Credit Abuse", return_abuse_ratio: "Return Ratio",
    return_employee_concentration: "Emp. Return Conc.", return_exceeds_sale: "Return > Sale",
    overload: "Over-Loading", inventory_shrinkage: "Inventory Shrinkage", employee_customer_lock: "Emp-Cust Lock"
  };

  const catCountsByFactory = {};
  for (const f of factories) {
    catCountsByFactory[f] = {};
    for (const c of allCategories) catCountsByFactory[f][c] = 0;
    const facFlags = flags.filter((fl) => fl.factory === f);
    for (const fl of facFlags) {
      if (catCountsByFactory[f][fl.category] !== undefined) catCountsByFactory[f][fl.category]++;
    }
  }

  // Top ghost return customers across all factories
  const ghostCustMap = {};
  for (const f of ghostFlags) {
    const key = f.factory + "|" + (f.customerName || "?");
    if (!ghostCustMap[key]) ghostCustMap[key] = { factory: f.factory, name: f.customerName, count: 0, impact: 0 };
    ghostCustMap[key].count++;
    ghostCustMap[key].impact += f.amountImpact;
  }
  const topGhostCustomers = Object.values(ghostCustMap).sort((a, b) => b.impact - a.impact).slice(0, 15);

  // Return stats per factory
  const returnStats = {};
  for (const [f, s] of Object.entries(pfs)) {
    const st = s.stats;
    returnStats[f] = { returns: st.totalReturns, sales: st.totalSales, ratio: st.factoryReturnRatio, returnAmt: st.totalReturnAmount, salesAmt: st.totalSalesAmount };
  }

  // Top return customers per factory
  const topReturnCusts = {};
  for (const [f, s] of Object.entries(pfs)) {
    topReturnCusts[f] = (s.stats.topReturnCustomers || []).slice(0, 10);
  }

  // Build factory rows for comparison table
  let factoryTableRows = "";
  for (const f of factories) {
    const s = pfs[f];
    const st = s.stats;
    factoryTableRows += "<tr>" +
      "<td><strong>" + f.toUpperCase() + "</strong></td>" +
      '<td class="center">' + s.totalFlags + "</td>" +
      '<td class="center text-red">' + s.bySeverity.critical + "</td>" +
      '<td class="center">' + s.bySeverity.high + "</td>" +
      '<td class="center">' + s.bySeverity.medium + "</td>" +
      '<td class="right text-red">' + fmtB(s.totalImpact) + "</td>" +
      '<td class="center">' + st.totalReturns + "</td>" +
      '<td class="center">' + pct(st.factoryReturnRatio) + "</td>" +
      '<td class="center text-red">0%</td>' +
      "</tr>";
  }

  // Build ghost return customer rows
  let ghostCustRows = "";
  for (const c of topGhostCustomers) {
    ghostCustRows += "<tr><td>" + c.factory.toUpperCase() + "</td><td>" + c.name + "</td>" +
      '<td class="center">' + c.count + '</td><td class="right text-red">' + fmtB(c.impact) + '</td><td class="right">' + fmtB(Math.round(c.impact / c.count)) + "</td></tr>";
  }

  // Build credit abuse rows
  let creditRows = "";
  for (const c of creditFlags.slice(0, 15)) {
    const ev = c.evidence || {};
    creditRows += "<tr><td>" + c.factory.toUpperCase() + "</td><td>" + c.customerName + "</td>" +
      '<td class="right text-red">' + fmtB(c.amountImpact) + "</td>" +
      '<td class="right">' + fmtB(ev.totalSales || 0) + "</td>" +
      '<td class="right">' + pct(ev.collectionPct || 0) + "</td>" +
      '<td class="center">' + (ev.txCount || 0) + "</td></tr>";
  }

  // Top return customers by factory
  let returnCustTables = "";
  for (const f of factories) {
    const custs = topReturnCusts[f] || [];
    if (!custs.length) continue;
    let rows = "";
    for (const c of custs) {
      if (c.returnCount === 0) continue;
      const ratioClass = c.returnRatio > 0.15 ? ' class="text-red"' : '';
      rows += "<tr><td>" + c.name + "</td>" +
        '<td class="center">' + c.returnCount + "</td>" +
        '<td class="right">' + fmtB(c.returnAmt) + "</td>" +
        '<td class="right">' + fmtB(c.salesAmt) + "</td>" +
        "<td" + ratioClass + ' class="right">' + pct(c.returnRatio) + "</td></tr>";
    }
    if (!rows) continue;
    returnCustTables += '<div class="card"><div class="card-header">' + f.toUpperCase() + ' — Top Return Customers</div>' +
      "<table><tr><th>Customer</th><th>Returns</th><th>Return Amt</th><th>Sales Amt</th><th>Ratio</th></tr>" +
      rows + "</table></div>";
  }

  // Chart data
  const chartFactoryLabels = JSON.stringify(factories.map((f) => f.toUpperCase()));
  const ghostCounts = JSON.stringify(factories.map((f) => (ghostByFactory[f] || {}).count || 0));
  const ghostImpacts = JSON.stringify(factories.map((f) => (ghostByFactory[f] || {}).impact || 0));
  const shortfallCounts = JSON.stringify(factories.map((f) => (shortfallByFactory[f] || {}).count || 0));
  const shortfallImpacts = JSON.stringify(factories.map((f) => (shortfallByFactory[f] || {}).impact || 0));
  const returnAmts = JSON.stringify(factories.map((f) => returnStats[f]?.returnAmt || 0));

  const usedCats = allCategories.filter((c) => flags.some((f) => f.category === c));
  const catChartLabels = JSON.stringify(usedCats.map((c) => catLabels[c] || c));
  const catChartData = JSON.stringify(usedCats.map((c) => flags.filter((f) => f.category === c).length));

  const sevChartData = JSON.stringify([criticalCount, highCount, mediumCount]);

  // Top ghost customers chart
  const topGhostNames = JSON.stringify(topGhostCustomers.slice(0, 10).map((c) => c.name?.substring(0, 15) || "?"));
  const topGhostAmounts = JSON.stringify(topGhostCustomers.slice(0, 10).map((c) => c.impact));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>SuperIce — Deep Fraud Analysis Report</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', 'Sarabun', Arial, sans-serif; font-size: 9.5px; color: #1e293b; line-height: 1.45; background: #fff; }
  .page { page-break-after: always; padding: 6px 0; }
  .page:last-child { page-break-after: avoid; }
  h1 { font-size: 22px; color: #0f172a; border-bottom: 3px solid #dc2626; padding-bottom: 5px; margin-bottom: 8px; }
  h2 { font-size: 14px; color: #1e40af; margin: 14px 0 6px 0; border-left: 4px solid #2563eb; padding-left: 8px; }
  h3 { font-size: 12px; color: #334155; margin: 10px 0 4px 0; }
  .subtitle { font-size: 10px; color: #64748b; margin-bottom: 10px; }
  .conf { display: inline-block; background: #fef2f2; color: #dc2626; font-weight: 700; font-size: 8px; padding: 2px 6px; border-radius: 3px; border: 1px solid #fecaca; margin-left: 6px; letter-spacing: 1px; }
  .kpi-row { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; }
  .kpi { flex: 1; min-width: 80px; background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; text-align: center; }
  .kpi .val { font-size: 18px; font-weight: 700; }
  .kpi .lbl { font-size: 8px; color: #64748b; text-transform: uppercase; letter-spacing: 0.4px; margin-top: 2px; }
  .kpi.red .val { color: #dc2626; }
  .kpi.orange .val { color: #ea580c; }
  .kpi.green .val { color: #16a34a; }
  .kpi.blue .val { color: #2563eb; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
  .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; margin-bottom: 8px; }
  .card-header { font-size: 11px; font-weight: 700; margin-bottom: 6px; }
  .card-header.red { color: #dc2626; }
  table { width: 100%; border-collapse: collapse; font-size: 8.5px; margin: 4px 0; }
  th { background: #1e293b; color: #fff; padding: 4px 6px; text-align: left; font-weight: 600; font-size: 8px; }
  td { padding: 3px 6px; border-bottom: 1px solid #e2e8f0; }
  tr:nth-child(even) { background: #f8fafc; }
  .right { text-align: right; }
  .center { text-align: center; }
  .text-red { color: #dc2626; font-weight: 600; }
  .chart-container { width: 100%; height: 180px; margin: 6px 0; position: relative; }
  .chart-container.tall { height: 220px; }
  .analysis { background: #eff6ff; border-left: 4px solid #2563eb; padding: 8px 10px; margin: 8px 0; font-size: 9px; line-height: 1.5; border-radius: 0 4px 4px 0; }
  .analysis strong { color: #1e40af; }
  .analysis.risk-critical { background: #fef2f2; border-color: #dc2626; }
  .analysis.risk-critical strong { color: #991b1b; }
  .analysis.risk-high { background: #fff7ed; border-color: #ea580c; }
  .analysis.risk-low { background: #f0fdf4; border-color: #16a34a; }
  .analysis.risk-low strong { color: #166534; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 10px; font-size: 7.5px; font-weight: 600; }
  .badge-critical { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
  .badge-high { background: #fff7ed; color: #ea580c; border: 1px solid #fed7aa; }
  .badge-medium { background: #fefce8; color: #ca8a04; border: 1px solid #fde68a; }
  .badge-clean { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
  .footer { text-align: center; font-size: 7px; color: #94a3b8; margin-top: 8px; padding-top: 6px; border-top: 1px solid #e2e8f0; }
  .rec { background: #fff; border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px 8px; margin: 4px 0; font-size: 9px; }
  .rec .num { display: inline-block; width: 18px; height: 18px; background: #dc2626; color: #fff; border-radius: 50%; text-align: center; line-height: 18px; font-size: 9px; font-weight: 700; margin-right: 6px; }
  .rec.p-high .num { background: #dc2626; }
  .rec.p-med .num { background: #ea580c; }
  .rec.p-low .num { background: #2563eb; }
  .gap-card { background: #fef2f2; border: 2px solid #dc2626; border-radius: 8px; padding: 12px; text-align: center; }
  .gap-card .gap-val { font-size: 32px; font-weight: 900; color: #dc2626; }
  .gap-card .gap-lbl { font-size: 10px; color: #991b1b; margin-top: 4px; }
</style>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
</head>
<body>

<!-- PAGE 1: EXECUTIVE SUMMARY -->
<div class="page">
  <h1>Deep Fraud &amp; Risk Analysis <span class="conf">CONFIDENTIAL</span></h1>
  <div class="subtitle">SuperIce Group | Analysis Period: ${win.startDate} to ${win.endDate} | Generated: ${genDate}</div>

  <h2>Executive Summary</h2>
  <div class="kpi-row">
    <div class="kpi red"><div class="val">${fmt(totalFlags)}</div><div class="lbl">Total Flags</div></div>
    <div class="kpi red"><div class="val">${fmtM(totalImpact)}</div><div class="lbl">Total Impact</div></div>
    <div class="kpi red"><div class="val">${criticalCount}</div><div class="lbl">Critical</div></div>
    <div class="kpi orange"><div class="val">${fmt(highCount)}</div><div class="lbl">High</div></div>
    <div class="kpi blue"><div class="val">${fmt(mediumCount)}</div><div class="lbl">Medium</div></div>
    <div class="kpi green"><div class="val">${factories.length}</div><div class="lbl">Factories</div></div>
  </div>

  <div class="analysis risk-critical">
    <strong>CRITICAL SYSTEM GAPS DISCOVERED:</strong><br>
    <strong>1. ZERO Loading Tracking:</strong> Across all 3 factories, 0 out of ${fmt(flags.length > 0 ? Object.values(pfs).reduce((s, p) => s + (p.stats.totalSalesItems || 0), 0) : 0)} line items have loading quantities recorded. There is <strong>no mechanism to detect employees loading extra product onto trucks</strong>. The loaded_qty field exists in the database but is never populated.<br>
    <strong>2. ZERO Production Logs:</strong> No production data was found in any factory. Without production-vs-sales comparison, <strong>inventory shrinkage is undetectable</strong>.<br>
    <strong>3. 96.7% Ghost Returns:</strong> ${fmt(ghostFlags.length)} of ${fmt(Object.values(pfs).reduce((s, p) => s + (p.stats.totalReturns || 0), 0))} returns (${fmtB(ghostFlags.reduce((s, f) => s + f.amountImpact, 0))}) have no reference to an original bill — making it impossible to verify they correspond to real sales.
  </div>

  <h2>Factory Comparison</h2>
  <table>
    <tr><th>Factory</th><th class="center">Flags</th><th class="center">Critical</th><th class="center">High</th><th class="center">Medium</th><th class="right">Impact</th><th class="center">Returns</th><th class="center">Return %</th><th class="center">Load Track</th></tr>
    ${factoryTableRows}
  </table>

  <div class="grid2">
    <div class="card">
      <div class="card-header">Flags by Category (All Factories)</div>
      <div class="chart-container"><canvas id="chartCats"></canvas></div>
    </div>
    <div class="card">
      <div class="card-header">Severity Distribution</div>
      <div class="chart-container"><canvas id="chartSev"></canvas></div>
    </div>
  </div>

  <div class="footer">SuperIce Group — Confidential Deep Fraud Analysis | Page 1 of 6</div>
</div>

<!-- PAGE 2: LOADING GAP + GHOST RETURNS -->
<div class="page">
  <h2>Critical Gap: Loading / Delivery Tracking</h2>
  <div class="grid3">
    <div class="gap-card"><div class="gap-val">0%</div><div class="gap-lbl">SI Loading Coverage<br>${fmt(pfs.si?.stats?.totalSalesItems || 0)} items untracked</div></div>
    <div class="gap-card"><div class="gap-val">0%</div><div class="gap-lbl">Bearing Loading Coverage<br>${fmt(pfs.bearing?.stats?.totalSalesItems || 0)} items untracked</div></div>
    <div class="gap-card"><div class="gap-val">0%</div><div class="gap-lbl">KTK Loading Coverage<br>${fmt(pfs.ktk?.stats?.totalSalesItems || 0)} items untracked</div></div>
  </div>
  <div class="analysis risk-critical">
    <strong>Over-Loading Fraud Vector:</strong> When employees are bribed to load extra product, the only evidence would be a discrepancy between the <strong>billed quantity</strong> (transaction_items.quantity) and the <strong>loaded quantity</strong> (transaction_items.loaded_qty). Currently loaded_qty is NEVER recorded, creating a complete blind spot. Additionally, with zero production logs, there is no way to reconcile total production against total shipments. An employee could load 20 bags but the bill says 15 — there is zero detection capability for this today. This is your <strong>highest-risk unmonitored fraud vector</strong>.
  </div>

  <h2>Ghost Returns — Returns Without Original Bill</h2>
  <div class="kpi-row">
    <div class="kpi red"><div class="val">${fmt(ghostFlags.length)}</div><div class="lbl">Ghost Returns</div></div>
    <div class="kpi red"><div class="val">${fmtB(ghostFlags.reduce((s, f) => s + f.amountImpact, 0))}</div><div class="lbl">Total Exposure</div></div>
    <div class="kpi orange"><div class="val">${pct(ghostFlags.length / Math.max(1, Object.values(pfs).reduce((s, p) => s + (p.stats.totalReturns || 0), 0)))}</div><div class="lbl">% of All Returns</div></div>
  </div>

  <div class="grid2">
    <div class="card">
      <div class="card-header">Ghost Returns by Factory</div>
      <div class="chart-container"><canvas id="chartGhostFactory"></canvas></div>
    </div>
    <div class="card">
      <div class="card-header">Top Ghost Return Customers</div>
      <div class="chart-container"><canvas id="chartGhostCust"></canvas></div>
    </div>
  </div>

  <h3>Top 15 Ghost Return Customers</h3>
  <table>
    <tr><th>Factory</th><th>Customer</th><th class="center">Count</th><th class="right">Total Amount</th><th class="right">Avg per Return</th></tr>
    ${ghostCustRows}
  </table>

  <div class="analysis risk-high">
    <strong>Ghost Return Risk:</strong> A "ghost return" is a refund transaction with product items but no reference to which original sale it came from. This means (a) the return cannot be validated against the original sale quantities or prices, (b) the same products could be "returned" multiple times, and (c) completely fabricated returns could be entered. KTK has the most ghost returns (579) followed by Bearing (544) and SI (417). The top offender is ตลาดนางรำ (Bearing) with 14 ghost returns worth ${fmtB(79225)}.
  </div>

  <div class="footer">SuperIce Group — Confidential Deep Fraud Analysis | Page 2 of 6</div>
</div>

<!-- PAGE 3: RETURN BEHAVIOUR DEEP DIVE -->
<div class="page">
  <h2>Return Behaviour Analysis</h2>

  <div class="grid3">
    ${factories.map((f) => {
      const rs = returnStats[f];
      return '<div class="card"><div class="card-header">' + f.toUpperCase() + '</div>' +
        '<table><tr><th>Metric</th><th>Value</th></tr>' +
        '<tr><td>Total Returns</td><td>' + (rs?.returns || 0) + '</td></tr>' +
        '<tr><td>Total Sales</td><td>' + fmt(rs?.sales || 0) + '</td></tr>' +
        '<tr><td>Return Ratio</td><td>' + pct(rs?.ratio || 0) + '</td></tr>' +
        '<tr><td>Return Amount</td><td>' + fmtB(rs?.returnAmt || 0) + '</td></tr>' +
        '<tr><td>Sales Amount</td><td>' + fmtB(rs?.salesAmt || 0) + '</td></tr>' +
        '</table></div>';
    }).join("")}
  </div>

  <div class="chart-container tall"><canvas id="chartReturnRatio"></canvas></div>

  <h3>Top Return Customers by Factory</h3>
  <div class="grid3">${returnCustTables}</div>

  <div class="analysis">
    <strong>Return Pattern Insights:</strong> Overall return ratios are low (SI 0.88%, Bearing 1.23%, KTK 1.47%), but individual customer anomalies exist. At KTK, customers "สุภาพ ไอซ์" and "สุภาพ 3" have 100% return ratios — they returned everything they purchased. "จ่อย (1)" at KTK has a 35.9% return ratio representing ${fmtB(36988)} in returns. These outliers warrant individual investigation. The same-day return pattern (buy and return on the same date) occurs ${fmt(flags.filter((f) => f.category === "same_day_return").length)} times across all factories.
  </div>

  <div class="footer">SuperIce Group — Confidential Deep Fraud Analysis | Page 3 of 6</div>
</div>

<!-- PAGE 4: CASH SHORTFALL + CREDIT ABUSE -->
<div class="page">
  <h2>Cash Shortfall — "Paid" Status with Missing Money</h2>

  <div class="kpi-row">
    <div class="kpi red"><div class="val">${fmt(shortfallFlags.length)}</div><div class="lbl">Shortfall Transactions</div></div>
    <div class="kpi red"><div class="val">${fmtM(shortfallFlags.reduce((s, f) => s + f.amountImpact, 0))}</div><div class="lbl">Total Shortfall</div></div>
    <div class="kpi orange"><div class="val">${fmt((shortfallByFactory.si || {}).count || 0)}</div><div class="lbl">SI Shortfalls</div></div>
    <div class="kpi blue"><div class="val">${fmt((shortfallByFactory.ktk || {}).count || 0)}</div><div class="lbl">KTK Shortfalls</div></div>
  </div>

  <div class="grid2">
    <div class="card">
      <div class="card-header">Cash Shortfall by Factory</div>
      <div class="chart-container"><canvas id="chartShortfall"></canvas></div>
    </div>
    <div class="card">
      <div class="card-header">Shortfall Impact by Factory</div>
      <div class="chart-container"><canvas id="chartShortfallAmt"></canvas></div>
    </div>
  </div>

  <div class="analysis risk-critical">
    <strong>Cash Shortfall Analysis:</strong> ${fmt(shortfallFlags.length)} transactions are marked "paid" but the paid amount is less than the total amount — a combined shortfall of ${fmtM(shortfallFlags.reduce((s, f) => s + f.amountImpact, 0))}. SI dominates with ${fmt((shortfallByFactory.si || {}).count || 0)} shortfalls worth ${fmtM((shortfallByFactory.si || {}).impact || 0)}. <strong>Note:</strong> This may reflect how credit/AR is recorded in the system (status="paid" may mean "delivered" not "cash received"). However, any transaction marked "paid" where paid &lt; totalAmount is a reconciliation risk — it could mask cash skimming where an employee collects full payment but records a lower amount.
  </div>

  <h2>Credit Abuse — Growing Unpaid Balances</h2>
  <table>
    <tr><th>Factory</th><th>Customer</th><th class="right">Outstanding</th><th class="right">Total Sales</th><th class="right">Collection %</th><th class="center">Transactions</th></tr>
    ${creditRows}
  </table>

  <div class="analysis risk-critical">
    <strong>Credit Risk Concentration:</strong> ${creditFlags.length} customers carry dangerously high outstanding balances. The top 5 alone owe ${fmtM(creditFlags.slice(0, 5).reduce((s, f) => s + f.amountImpact, 0))}. Several have <strong>negative collection rates</strong> — meaning they are receiving more product on credit than they are repaying. This could indicate (a) legitimate AR/credit operations, (b) employees "selling" to fake or colluding customers, or (c) a deliberate scheme to extract product without payment. Each case needs individual investigation.
  </div>

  <div class="footer">SuperIce Group — Confidential Deep Fraud Analysis | Page 4 of 6</div>
</div>

<!-- PAGE 5: QUANTITY SPIKES + EMPLOYEE PATTERNS -->
<div class="page">
  <h2>Quantity Spikes — Anomalous Order Sizes</h2>
  <div class="kpi-row">
    <div class="kpi orange"><div class="val">${fmt(flags.filter((f) => f.category === "quantity_spike").length)}</div><div class="lbl">Qty Spike Flags</div></div>
    <div class="kpi orange"><div class="val">${fmtB(flags.filter((f) => f.category === "quantity_spike").reduce((s, f) => s + f.amountImpact, 0))}</div><div class="lbl">Excess Value</div></div>
  </div>

  <div class="analysis">
    <strong>Quantity Spike Detection:</strong> ${fmt(flags.filter((f) => f.category === "quantity_spike").length)} line items had quantities 3.5+ standard deviations above the customer's historical average for that product. While some may be legitimate bulk orders, these are the transactions most likely to conceal extra product being loaded. Without loading verification, a spike of 2x the normal quantity could mean the customer ordered more OR that an employee manually inflated the quantity to justify loading extra product that was paid for "off the books."
  </div>

  <h3>Top 10 Quantity Spikes by Value</h3>
  <table>
    <tr><th>Factory</th><th>Customer</th><th>Product</th><th class="right">Qty</th><th class="right">Avg Qty</th><th class="right">Z-Score</th><th class="right">Excess Value</th><th>Date</th></tr>
    ${flags.filter((f) => f.category === "quantity_spike").sort((a, b) => b.amountImpact - a.amountImpact).slice(0, 10).map((f) => {
      const ev = f.evidence || {};
      return "<tr><td>" + f.factory.toUpperCase() + "</td><td>" + (f.customerName || "") + "</td><td>" + (ev.productName || "") + "</td>" +
        '<td class="right">' + fmt(ev.quantity || 0) + '</td><td class="right">' + (ev.customerMean || 0).toFixed(1) + '</td><td class="right">' + (ev.zScore || 0).toFixed(1) + '</td><td class="right text-red">' + fmtB(f.amountImpact) + "</td><td>" + (ev.saleDate || "") + "</td></tr>";
    }).join("")}
  </table>

  <h2>Employee–Customer Lock Patterns</h2>
  <div class="analysis">
    <strong>Collusion Signal:</strong> ${fmt(flags.filter((f) => f.category === "employee_customer_lock").length)} employee–customer pairs were flagged where one employee handles &gt;85% of a specific customer's transactions. While this may simply reflect route assignments, it creates opportunity for collusion. If the same employee always serves a customer, they can establish arrangements to over-load, under-bill, or process ghost returns without oversight.
  </div>

  ${flags.filter((f) => f.category === "employee_customer_lock").length > 0 ?
    '<table><tr><th>Factory</th><th>Employee</th><th>Customer</th><th class="center">% of Cust Txns</th><th class="right">Total Value</th></tr>' +
    flags.filter((f) => f.category === "employee_customer_lock").sort((a, b) => b.amountImpact - a.amountImpact).slice(0, 10).map((f) => {
      const ev = f.evidence || {};
      return "<tr><td>" + f.factory.toUpperCase() + "</td><td>" + (f.user || "") + "</td><td>" + (f.customerName || "") + '</td><td class="center">' + pct(ev.pairPct || 0) + '</td><td class="right">' + fmtB(f.amountImpact) + "</td></tr>";
    }).join("") + "</table>"
  : '<div class="analysis risk-low"><strong>No employee-customer lock patterns</strong> detected above the threshold (85% of a customer\'s transactions handled by one employee with 50+ transactions).</div>'}

  <div class="footer">SuperIce Group — Confidential Deep Fraud Analysis | Page 5 of 6</div>
</div>

<!-- PAGE 6: RECOMMENDATIONS -->
<div class="page">
  <h2>Prioritized Recommendations</h2>

  <div class="grid2">
    <div class="card" style="border-left:4px solid #dc2626">
      <div class="card-header" style="color:#dc2626">URGENT — Implement Within 7 Days</div>
      <div class="rec p-high"><span class="num">1</span><strong>Enable Loading Tracking:</strong> Require loaded_qty to be recorded for every transaction line item before a truck departs. Add a "loading confirmation" step in the POS workflow. Compare loaded_qty vs quantity and alert on any discrepancy.</div>
      <div class="rec p-high"><span class="num">2</span><strong>Require Original Bill for Returns:</strong> The system already has this validation in the API (implemented in this dev branch), but ${pct(ghostFlags.length / Math.max(1, Object.values(pfs).reduce((s, p) => s + (p.stats.totalReturns || 0), 0)))} of historic returns lack it. Enforce it at both the UI and API level.</div>
      <div class="rec p-high"><span class="num">3</span><strong>Start Production Logging:</strong> Record daily production quantities per product type. This enables production-vs-sales reconciliation to detect shrinkage.</div>
    </div>
    <div class="card" style="border-left:4px solid #ea580c">
      <div class="card-header" style="color:#ea580c">HIGH — Implement Within 30 Days</div>
      <div class="rec p-med"><span class="num">4</span><strong>Dual-person Loading Verification:</strong> Require a second employee (supervisor or office) to verify and sign off on loaded quantities. This breaks the single-person fraud vector.</div>
      <div class="rec p-med"><span class="num">5</span><strong>Investigate Ghost Returns:</strong> Review the top 20 ghost return customers. Cross-reference return dates with delivery logs. Interview employees who processed the returns.</div>
      <div class="rec p-med"><span class="num">6</span><strong>Fix Cash Shortfall Status Logic:</strong> Clarify whether "paid" means "cash received" or "delivered." If the latter, add a separate "cash_received" status. Every transaction marked "paid" should have paid = total_amount.</div>
    </div>
  </div>
  <div class="grid2" style="margin-top:8px">
    <div class="card" style="border-left:4px solid #2563eb">
      <div class="card-header" style="color:#2563eb">MEDIUM — Implement Within 60 Days</div>
      <div class="rec p-low"><span class="num">7</span><strong>Automated Quantity Spike Alerts:</strong> When an order qty exceeds 2x the customer's 30-day average, require manager approval before the transaction can be finalized.</div>
      <div class="rec p-low"><span class="num">8</span><strong>Employee Rotation for Key Accounts:</strong> Rotate which employee handles top-10 customers quarterly. This disrupts established collusion patterns.</div>
      <div class="rec p-low"><span class="num">9</span><strong>Monthly Fraud Scan:</strong> Schedule this analysis to run monthly. Track trends in ghost returns, quantity spikes, and loading discrepancies over time.</div>
    </div>
    <div class="card" style="border-left:4px solid #16a34a">
      <div class="card-header" style="color:#16a34a">STRATEGIC — Ongoing</div>
      <div class="rec p-low"><span class="num">10</span><strong>Physical Inventory Counts:</strong> Conduct weekly spot-check counts at each factory. Compare physical stock against (production - sales + returns). Any persistent deficit signals theft.</div>
      <div class="rec p-low"><span class="num">11</span><strong>CCTV at Loading Bay:</strong> Install cameras at the loading area of each factory. Time-stamp footage can be correlated with transaction timestamps to verify loaded quantities.</div>
      <div class="rec p-low"><span class="num">12</span><strong>Customer Receipt Confirmation:</strong> Send SMS/LINE receipts to customers after delivery. If a customer receives 20 bags but the receipt says 15, the customer themselves become a verification point.</div>
    </div>
  </div>

  <h2>Summary Risk Heatmap</h2>
  <table>
    <tr><th>Risk</th><th>SI</th><th>Bearing</th><th>KTK</th><th>Status</th></tr>
    <tr><td>Loading Tracking</td><td class="center text-red">0%</td><td class="center text-red">0%</td><td class="center text-red">0%</td><td><span class="badge badge-critical">BLIND</span></td></tr>
    <tr><td>Production Logging</td><td class="center text-red">0</td><td class="center text-red">0</td><td class="center text-red">0</td><td><span class="badge badge-critical">BLIND</span></td></tr>
    <tr><td>Ghost Returns</td><td class="center">${(ghostByFactory.si || {}).count || 0}</td><td class="center">${(ghostByFactory.bearing || {}).count || 0}</td><td class="center">${(ghostByFactory.ktk || {}).count || 0}</td><td><span class="badge badge-high">HIGH</span></td></tr>
    <tr><td>Cash Shortfalls</td><td class="center">${(shortfallByFactory.si || {}).count || 0}</td><td class="center">${(shortfallByFactory.bearing || {}).count || 0}</td><td class="center">${(shortfallByFactory.ktk || {}).count || 0}</td><td><span class="badge badge-high">HIGH</span></td></tr>
    <tr><td>Credit Abuse</td><td class="center text-red">${creditFlags.filter((f) => f.factory === "si").length}</td><td class="center">0</td><td class="center">${creditFlags.filter((f) => f.factory === "ktk").length}</td><td><span class="badge badge-critical">CRITICAL</span></td></tr>
    <tr><td>Qty Spikes</td><td class="center">${(catCountsByFactory.si || {}).quantity_spike || 0}</td><td class="center">${(catCountsByFactory.bearing || {}).quantity_spike || 0}</td><td class="center">${(catCountsByFactory.ktk || {}).quantity_spike || 0}</td><td><span class="badge badge-medium">MEDIUM</span></td></tr>
    <tr><td>Return Ratio</td><td class="center">${pct(returnStats.si?.ratio || 0)}</td><td class="center">${pct(returnStats.bearing?.ratio || 0)}</td><td class="center">${pct(returnStats.ktk?.ratio || 0)}</td><td><span class="badge badge-clean">LOW</span></td></tr>
  </table>

  <div class="footer">SuperIce Group — Confidential Deep Fraud Analysis | Page 6 of 6 | Generated from POS database forensics</div>
</div>

<!-- CHARTS -->
<script>
Chart.defaults.font.size = 8;
Chart.defaults.font.family = "'Helvetica Neue','Sarabun',sans-serif";
Chart.defaults.animation = false;

var B = String.fromCharCode(0x0E3F);

new Chart(document.getElementById('chartCats'), {
  type: 'bar',
  data: { labels: ${catChartLabels}, datasets: [{ data: ${catChartData}, backgroundColor: ['#dc2626','#ea580c','#f59e0b','#2563eb','#7c3aed','#16a34a','#64748b','#be185d','#0d9488','#6366f1','#475569'], borderRadius: 4 }] },
  options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false }, title: { display: true, text: 'Flag Count by Category', font: { size: 10 } } }, scales: { x: { beginAtZero: true }, y: { ticks: { font: { size: 7 } } } } }
});

new Chart(document.getElementById('chartSev'), {
  type: 'doughnut',
  data: { labels: ['Critical','High','Medium'], datasets: [{ data: ${sevChartData}, backgroundColor: ['#dc2626','#ea580c','#ca8a04'], borderWidth: 2, borderColor: '#fff' }] },
  options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 8 } } }, title: { display: true, text: 'Severity Distribution', font: { size: 10 } } }, cutout: '55%' }
});

new Chart(document.getElementById('chartGhostFactory'), {
  type: 'bar',
  data: { labels: ${chartFactoryLabels}, datasets: [
    { label: 'Count', data: ${ghostCounts}, backgroundColor: '#dc2626', borderRadius: 4, yAxisID: 'y' },
    { label: 'Amount', data: ${ghostImpacts}, backgroundColor: '#2563eb', borderRadius: 4, yAxisID: 'y1' }
  ]},
  options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 7 } } }, title: { display: true, text: 'Ghost Returns by Factory', font: { size: 10 } } }, scales: { y: { beginAtZero: true, position: 'left', title: { display: true, text: 'Count', font: { size: 7 } } }, y1: { beginAtZero: true, position: 'right', grid: { display: false }, title: { display: true, text: 'Amount', font: { size: 7 } }, ticks: { callback: function(v) { return B + (v/1000).toFixed(0) + 'K'; } } }, x: { grid: { display: false } } } }
});

new Chart(document.getElementById('chartGhostCust'), {
  type: 'bar',
  data: { labels: ${topGhostNames}, datasets: [{ data: ${topGhostAmounts}, backgroundColor: '#dc2626', borderRadius: 3 }] },
  options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false }, title: { display: true, text: 'Top Ghost Return Customers (Amount)', font: { size: 10 } } }, scales: { x: { beginAtZero: true, ticks: { callback: function(v) { return B + (v/1000).toFixed(0) + 'K'; } } }, y: { ticks: { font: { size: 6 } } } } }
});

new Chart(document.getElementById('chartReturnRatio'), {
  type: 'bar',
  data: { labels: ${chartFactoryLabels}, datasets: [
    { label: 'Return Amount', data: ${returnAmts}, backgroundColor: '#dc2626', borderRadius: 4 },
    { label: 'Sales Amount (÷100)', data: ${JSON.stringify(factories.map((f) => (returnStats[f]?.salesAmt || 0) / 100))}, backgroundColor: 'rgba(37,99,235,0.2)', borderColor: '#2563eb', borderWidth: 1, borderRadius: 4 }
  ]},
  options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 7 } } }, title: { display: true, text: 'Return Amount vs Sales Amount (\u00F7100 for scale)', font: { size: 10 } } }, scales: { y: { beginAtZero: true, ticks: { callback: function(v) { return B + (v/1000).toFixed(0) + 'K'; } } }, x: { grid: { display: false } } } }
});

new Chart(document.getElementById('chartShortfall'), {
  type: 'bar',
  data: { labels: ${chartFactoryLabels}, datasets: [{ data: ${shortfallCounts}, backgroundColor: ['#dc2626','#16a34a','#ea580c'], borderRadius: 4, maxBarThickness: 60 }] },
  options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, title: { display: true, text: 'Cash Shortfall Count by Factory', font: { size: 10 } } }, scales: { y: { beginAtZero: true }, x: { grid: { display: false } } } }
});

new Chart(document.getElementById('chartShortfallAmt'), {
  type: 'bar',
  data: { labels: ${chartFactoryLabels}, datasets: [{ data: ${shortfallImpacts}, backgroundColor: ['#dc2626','#16a34a','#ea580c'], borderRadius: 4, maxBarThickness: 60 }] },
  options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, title: { display: true, text: 'Cash Shortfall Amount by Factory', font: { size: 10 } } }, scales: { y: { beginAtZero: true, ticks: { callback: function(v) { return B + (v/1e6).toFixed(1) + 'M'; } } }, x: { grid: { display: false } } } }
});
</script>
</body>
</html>`;
}

async function main() {
  const jsonPath = findLatestJson();
  console.log("Reading:", jsonPath);
  const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

  const html = buildHTML(data);
  const baseName = path.basename(jsonPath, ".json");
  const htmlPath = path.join(FORENSICS_DIR, baseName + "-report.html");
  const pdfPath = path.join(FORENSICS_DIR, baseName + "-report.pdf");

  fs.writeFileSync(htmlPath, html, "utf-8");
  console.log("HTML:", htmlPath);

  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 });

  await page.waitForFunction(
    () => typeof Chart !== "undefined" && Chart.instances && Object.keys(Chart.instances).length >= 7,
    { timeout: 15000 }
  );
  await new Promise((r) => setTimeout(r, 2000));

  await page.pdf({
    path: pdfPath, format: "A4", printBackground: true,
    margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
  });
  console.log("PDF:", pdfPath);
  await browser.close();
}

main().catch((err) => { console.error("Failed:", err); process.exit(1); });
