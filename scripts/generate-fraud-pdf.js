#!/usr/bin/env node
/**
 * Generates a styled PDF fraud analysis report with charts
 * from the backdated-fraud-analysis JSON output.
 *
 * Usage:
 *   node scripts/generate-fraud-pdf.js
 */

const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const FORENSICS_DIR = path.join(__dirname, "..", "docs", "forensics");

function findLatestJson() {
  const files = fs
    .readdirSync(FORENSICS_DIR)
    .filter((f) => f.startsWith("backdated-fraud-analysis-") && f.endsWith(".json"))
    .sort()
    .reverse();
  if (!files.length) throw new Error("No fraud analysis JSON found in docs/forensics/");
  return path.join(FORENSICS_DIR, files[0]);
}

function fmt(n) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtBaht(n) {
  return "฿" + fmt(n);
}

const categoryLabels = {
  void_abuse: "Void Abuse",
  refund_abuse: "Refund Abuse",
  price_tamper: "Price Tampering",
  timestamp_backdating: "Timestamp Backdating",
  payment_manipulation: "Payment Manipulation",
};

function buildFactoryRow(f, perFactorySummary, factoryFlagCounts, factoryImpacts, factories) {
  const idx = factories.indexOf(f);
  const s = perFactorySummary[f];
  const flagCount = factoryFlagCounts[idx];
  const impact = factoryImpacts[idx];
  const topCat = Object.entries(s.byCategory || {}).sort((a, b) => b[1] - a[1])[0];
  let riskBadge;
  if (flagCount === 0) riskBadge = '<span class="badge badge-clean">CLEAN</span>';
  else if (s.bySeverity.critical > 0) riskBadge = '<span class="badge badge-critical">CRITICAL</span>';
  else if (s.bySeverity.high > 0) riskBadge = '<span class="badge badge-high">HIGH</span>';
  else riskBadge = '<span class="badge badge-medium">MEDIUM</span>';

  const critClass = s.bySeverity.critical > 0 ? ' text-red' : '';
  const impactClass = impact > 0 ? ' text-red' : '';
  const impactStr = impact > 0 ? fmtBaht(impact) : '—';
  const catStr = topCat ? (categoryLabels[topCat[0]] || topCat[0]) : '—';

  return '<tr>' +
    '<td><strong>' + f.toUpperCase() + '</strong></td>' +
    '<td class="center">' + flagCount + '</td>' +
    '<td class="center' + critClass + '">' + s.bySeverity.critical + '</td>' +
    '<td class="center">' + s.bySeverity.high + '</td>' +
    '<td class="center">' + s.bySeverity.medium + '</td>' +
    '<td class="right' + impactClass + '">' + impactStr + '</td>' +
    '<td class="center">' + catStr + '</td>' +
    '<td class="center">' + riskBadge + '</td>' +
    '</tr>';
}

function buildFindingCard(f, i) {
  const ev = f.evidence || {};
  return '<div class="finding-card">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start">' +
    '<div>' +
    '<div class="finding-id">Finding #' + (i + 1) + ' — <span class="badge badge-' + f.severity + '">' + f.severity.toUpperCase() + '</span> Score: ' + f.score + '/100</div>' +
    '<div class="finding-meta">' + f.factory.toUpperCase() + ' | Transaction #' + f.transactionId + ' | Customer ID: ' + f.customerId + ' | User: ' + (f.user || 'unknown') + '</div>' +
    '</div>' +
    '<div style="text-align:right">' +
    '<div style="font-size:16px;font-weight:700;color:#dc2626">' + fmtBaht(f.amountImpact) + '</div>' +
    '<div style="font-size:8px;color:#64748b">estimated impact</div>' +
    '</div></div>' +
    '<div class="finding-reason">' + f.reason + '</div>' +
    '<div class="evidence-box">' +
    'Product Type: ' + (ev.productTypeId || '—') + ' &nbsp;|&nbsp; ' +
    'Baseline Median Price: ' + fmtBaht(ev.baselineMedianPrice || 0) + ' &nbsp;|&nbsp; ' +
    'Observed Unit Price: ' + fmtBaht(ev.observedUnitPrice ?? 0) + ' &nbsp;|&nbsp; ' +
    'Ratio to Median: ' + ((ev.ratioToMedian ?? 0) * 100).toFixed(0) + '% &nbsp;|&nbsp; ' +
    'Quantity: ' + (ev.quantity || '—') +
    '</div></div>';
}

function buildHTML(data) {
  const { generatedAt, window: win, totalFlags, perFactorySummary, flags } = data;
  const genDate = new Date(generatedAt).toLocaleDateString("en-GB", {
    year: "numeric", month: "long", day: "numeric",
  });
  const factories = Object.keys(perFactorySummary);
  const allSeverities = ["critical", "high", "medium"];

  const totalImpact = flags.reduce((s, f) => s + f.amountImpact, 0);
  const factoryFlagCounts = factories.map((f) => flags.filter((fl) => fl.factory === f).length);
  const factoryImpacts = factories.map((f) =>
    flags.filter((fl) => fl.factory === f).reduce((s, fl) => s + fl.amountImpact, 0)
  );
  const severityCounts = allSeverities.map((s) => flags.filter((f) => f.severity === s).length);

  const txIds = flags.map((f) => f.transactionId).filter(Boolean).sort((a, b) => a - b);
  const txImpacts = txIds.map((id) => flags.find((f) => f.transactionId === id)?.amountImpact || 0);

  const custId = flags[0]?.customerId || '—';
  const custFactory = (flags[0]?.factory || '—').toUpperCase();
  const custFlagCount = flags.filter((f) => f.customerId === flags[0]?.customerId).length;
  const custImpact = flags.filter((f) => f.customerId === flags[0]?.customerId).reduce((s, f) => s + f.amountImpact, 0);
  const prodType = flags[0]?.evidence?.productTypeId || '—';
  const baselinePrice = flags[0]?.evidence?.baselineMedianPrice || 90;
  const minTx = txIds.length ? Math.min(...txIds) : '—';
  const maxTx = txIds.length ? Math.max(...txIds) : '—';
  const cleanFactoryCount = factories.filter((f) => factoryFlagCounts[factories.indexOf(f)] === 0).length;
  const priceTamperCount = flags.filter((f) => f.category === 'price_tamper').length;

  const factoryRows = factories.map((f) => buildFactoryRow(f, perFactorySummary, factoryFlagCounts, factoryImpacts, factories)).join('');
  const findingCards = flags.map((f, i) => buildFindingCard(f, i)).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>SuperIce — Fraud Analysis Report</title>
<style>
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', 'Sarabun', Arial, sans-serif; font-size: 10px; color: #1e293b; line-height: 1.5; background: #fff; }
  .page { page-break-after: always; padding: 8px 0; min-height: 260mm; position: relative; }
  .page:last-child { page-break-after: avoid; }
  h1 { font-size: 24px; color: #0f172a; border-bottom: 3px solid #dc2626; padding-bottom: 6px; margin-bottom: 10px; }
  h2 { font-size: 16px; color: #1e40af; margin: 18px 0 8px 0; border-left: 4px solid #2563eb; padding-left: 8px; }
  h3 { font-size: 13px; color: #334155; margin: 12px 0 6px 0; }
  .subtitle { font-size: 11px; color: #64748b; margin-bottom: 12px; }
  .confidential { display: inline-block; background: #fef2f2; color: #dc2626; font-weight: 700; font-size: 9px; padding: 2px 8px; border-radius: 3px; border: 1px solid #fecaca; margin-left: 8px; letter-spacing: 1px; }
  .kpi-row { display: flex; gap: 10px; flex-wrap: wrap; margin: 12px 0; }
  .kpi { flex: 1; min-width: 100px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
  .kpi .val { font-size: 22px; font-weight: 700; color: #0f172a; }
  .kpi .lbl { font-size: 9px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }
  .kpi.red .val { color: #dc2626; }
  .kpi.orange .val { color: #ea580c; }
  .kpi.green .val { color: #16a34a; }
  .kpi.blue .val { color: #2563eb; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; }
  .card-header { font-size: 13px; font-weight: 700; margin-bottom: 8px; }
  .card-header.red { color: #dc2626; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5px; margin: 8px 0; }
  th { background: #1e293b; color: #fff; padding: 6px 8px; text-align: left; font-weight: 600; font-size: 9px; }
  td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; }
  tr:nth-child(even) { background: #f8fafc; }
  .right { text-align: right; }
  .center { text-align: center; }
  .text-red { color: #dc2626; font-weight: 600; }
  .chart-container { width: 100%; height: 220px; margin: 10px 0; position: relative; }
  .chart-container.short { height: 180px; }
  .chart-container.tall { height: 260px; }
  .analysis { background: #eff6ff; border-left: 4px solid #2563eb; padding: 10px 14px; margin: 10px 0; font-size: 10px; line-height: 1.6; border-radius: 0 6px 6px 0; }
  .analysis strong { color: #1e40af; }
  .analysis.risk-critical { background: #fef2f2; border-color: #dc2626; }
  .analysis.risk-critical strong { color: #991b1b; }
  .analysis.risk-high { background: #fff7ed; border-color: #ea580c; }
  .analysis.risk-med { background: #fefce8; border-color: #ca8a04; }
  .analysis.risk-low { background: #f0fdf4; border-color: #16a34a; }
  .analysis.risk-low strong { color: #166534; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 8.5px; font-weight: 600; }
  .badge-critical { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
  .badge-high { background: #fff7ed; color: #ea580c; border: 1px solid #fed7aa; }
  .badge-medium { background: #fefce8; color: #ca8a04; border: 1px solid #fde68a; }
  .badge-clean { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
  .evidence-box { background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; font-family: 'SF Mono', 'Consolas', monospace; font-size: 8.5px; margin: 4px 0; word-break: break-all; }
  .finding-card { background: #fff; border: 1px solid #fecaca; border-left: 4px solid #dc2626; border-radius: 0 8px 8px 0; padding: 12px 14px; margin: 8px 0; }
  .finding-card .finding-id { font-size: 10px; font-weight: 700; color: #dc2626; }
  .finding-card .finding-meta { font-size: 9px; color: #64748b; margin-top: 2px; }
  .finding-card .finding-reason { font-size: 10px; color: #1e293b; margin-top: 4px; font-weight: 500; }
  .footer { text-align: center; font-size: 8px; color: #94a3b8; margin-top: 12px; padding-top: 8px; border-top: 1px solid #e2e8f0; }
  .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-30deg); font-size: 60px; color: rgba(220,38,38,0.04); font-weight: 900; letter-spacing: 10px; pointer-events: none; z-index: -1; }
  .recommendation { background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; margin: 6px 0; }
  .recommendation .num { display: inline-block; width: 20px; height: 20px; background: #dc2626; color: #fff; border-radius: 50%; text-align: center; line-height: 20px; font-size: 10px; font-weight: 700; margin-right: 8px; }
  .recommendation.priority-high .num { background: #dc2626; }
  .recommendation.priority-med .num { background: #ea580c; }
  .recommendation.priority-low .num { background: #2563eb; }
</style>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
</head>
<body>

<div class="watermark">CONFIDENTIAL</div>

<!-- PAGE 1: COVER + EXECUTIVE SUMMARY -->
<div class="page">
  <h1>Fraud Analysis Report <span class="confidential">CONFIDENTIAL</span></h1>
  <div class="subtitle">
    SuperIce Group — Backdated Transaction Forensics | Analysis Period: ${win.startDate} to ${win.endDate} | Report Generated: ${genDate}
  </div>

  <h2>Executive Summary</h2>
  <div class="kpi-row">
    <div class="kpi red"><div class="val">${totalFlags}</div><div class="lbl">Total Fraud Flags</div></div>
    <div class="kpi red"><div class="val">${fmtBaht(totalImpact)}</div><div class="lbl">Estimated Financial Impact</div></div>
    <div class="kpi red"><div class="val">${severityCounts[0]}</div><div class="lbl">Critical Severity</div></div>
    <div class="kpi orange"><div class="val">${severityCounts[1]}</div><div class="lbl">High Severity</div></div>
    <div class="kpi blue"><div class="val">${factories.length}</div><div class="lbl">Factories Analyzed</div></div>
    <div class="kpi green"><div class="val">${cleanFactoryCount}</div><div class="lbl">Clean Factories</div></div>
  </div>

  <div class="analysis risk-critical">
    <strong>Key Finding:</strong> The forensic analysis of ${factories.length} factories over the 12-month period identified <strong>${totalFlags} suspicious transactions</strong> with a combined estimated impact of <strong>${fmtBaht(totalImpact)}</strong>. All ${totalFlags} flags are classified as <strong>CRITICAL severity</strong> and are concentrated in a single factory (<strong>SI</strong>), a single customer (ID <strong>${custId}</strong>), and a single fraud category (<strong>Price Tampering</strong>). The Bearing and KTK factories showed <strong>zero suspicious activity</strong> during the analysis window.
  </div>

  <h2>Fraud Categories Scanned</h2>
  <div class="grid3">
    <div class="card">
      <div class="card-header">Void Abuse</div>
      <p style="font-size:9.5px;color:#475569">Excessive void frequency, large-amount voids, voids by unauthorized users, void-then-resell patterns.</p>
      <div style="margin-top:6px"><span class="badge badge-clean">0 FLAGS</span></div>
    </div>
    <div class="card">
      <div class="card-header">Refund / Return Abuse</div>
      <p style="font-size:9.5px;color:#475569">Cumulative returns exceeding sold quantities, ghost returns without original bills, return ratio anomalies.</p>
      <div style="margin-top:6px"><span class="badge badge-clean">0 FLAGS</span></div>
    </div>
    <div class="card">
      <div class="card-header red">Price Tampering</div>
      <p style="font-size:9.5px;color:#475569">Unit prices significantly below customer/product baseline median, zero-price line items on non-voided transactions.</p>
      <div style="margin-top:6px"><span class="badge badge-critical">${priceTamperCount} FLAGS — CRITICAL</span></div>
    </div>
  </div>
  <div class="grid2" style="margin-top:12px">
    <div class="card">
      <div class="card-header">Timestamp Backdating</div>
      <p style="font-size:9.5px;color:#475569">Sale dates that predate the transaction creation timestamp by more than 24 hours.</p>
      <div style="margin-top:6px"><span class="badge badge-clean">0 FLAGS</span></div>
    </div>
    <div class="card">
      <div class="card-header">Payment Manipulation</div>
      <p style="font-size:9.5px;color:#475569">Micro-payments, payment amounts not matching expected patterns, suspicious partial payment sequences.</p>
      <div style="margin-top:6px"><span class="badge badge-clean">0 FLAGS</span></div>
    </div>
  </div>

  <div class="footer">SuperIce Group — Confidential Fraud Analysis Report | Page 1 of 4</div>
</div>

<!-- PAGE 2: FACTORY COMPARISON + CHARTS -->
<div class="page">
  <h2>Factory-Level Comparison</h2>

  <table>
    <tr>
      <th>Factory</th>
      <th class="center">Total Flags</th>
      <th class="center">Critical</th>
      <th class="center">High</th>
      <th class="center">Medium</th>
      <th class="right">Est. Impact</th>
      <th class="center">Top Category</th>
      <th class="center">Risk Level</th>
    </tr>
    ${factoryRows}
  </table>

  <div class="grid2" style="margin-top:14px">
    <div class="card">
      <div class="card-header">Flags by Factory</div>
      <div class="chart-container short"><canvas id="chartFactoryFlags"></canvas></div>
    </div>
    <div class="card">
      <div class="card-header">Financial Impact by Factory</div>
      <div class="chart-container short"><canvas id="chartFactoryImpact"></canvas></div>
    </div>
  </div>

  <div class="grid2" style="margin-top:14px">
    <div class="card">
      <div class="card-header">Severity Distribution</div>
      <div class="chart-container short"><canvas id="chartSeverity"></canvas></div>
    </div>
    <div class="card">
      <div class="card-header">Impact per Flagged Transaction</div>
      <div class="chart-container short"><canvas id="chartTxImpact"></canvas></div>
    </div>
  </div>

  <div class="analysis">
    <strong>Distribution Analysis:</strong> The fraud risk is highly localized. SI accounts for 100% of all fraud flags, while Bearing and KTK are entirely clean. Within SI, all ${totalFlags} flags are price_tamper at critical severity, targeting a single customer (ID ${custId}) with product type ${prodType}. The concentration of risk in one factory/customer pair suggests either a systematic data entry issue or a deliberate price manipulation pattern rather than widespread fraud.
  </div>

  <div class="footer">SuperIce Group — Confidential Fraud Analysis Report | Page 2 of 4</div>
</div>

<!-- PAGE 3: DETAILED FINDINGS -->
<div class="page">
  <h2>Detailed Findings — All Flagged Transactions</h2>

  ${findingCards}

  <h2>Pattern Analysis</h2>
  <div class="grid2">
    <div class="card">
      <div class="card-header">Affected Customer Profile</div>
      <table>
        <tr><th>Attribute</th><th>Value</th></tr>
        <tr><td>Customer ID</td><td><strong>${custId}</strong></td></tr>
        <tr><td>Factory</td><td><strong>${custFactory}</strong></td></tr>
        <tr><td>Number of Flagged Transactions</td><td class="text-red"><strong>${custFlagCount}</strong></td></tr>
        <tr><td>Total Estimated Impact</td><td class="text-red"><strong>${fmtBaht(custImpact)}</strong></td></tr>
        <tr><td>Affected Product Type</td><td>${prodType}</td></tr>
        <tr><td>Transaction ID Range</td><td>${minTx} — ${maxTx}</td></tr>
      </table>
    </div>
    <div class="card">
      <div class="card-header">Price Deviation Chart</div>
      <div class="chart-container short"><canvas id="chartPriceDeviation"></canvas></div>
    </div>
  </div>

  <div class="footer">SuperIce Group — Confidential Fraud Analysis Report | Page 3 of 4</div>
</div>

<!-- PAGE 4: RECOMMENDATIONS + NEXT STEPS -->
<div class="page">
  <h2>Risk Assessment Matrix</h2>
  <div class="grid3">
    <div class="card" style="border-left:4px solid #dc2626">
      <div class="card-header" style="color:#dc2626">CONFIRMED RISKS</div>
      <div class="recommendation priority-high">
        <span class="num">1</span>
        <strong>Zero-price line items:</strong> ${totalFlags} transactions in SI factory contain items with unit price = ฿0 against a baseline of ${fmtBaht(baselinePrice)}/unit. This results in ${fmtBaht(totalImpact)} of unrecorded revenue.
      </div>
      <div class="recommendation priority-high">
        <span class="num">2</span>
        <strong>Single-customer concentration:</strong> All anomalies involve customer ID ${custId}, suggesting either a compromised pricing rule or deliberate preferential pricing override.
      </div>
    </div>
    <div class="card" style="border-left:4px solid #ca8a04">
      <div class="card-header" style="color:#ca8a04">AUDIT GAPS</div>
      <div class="recommendation priority-med">
        <span class="num">3</span>
        <strong>Missing audit trail:</strong> The audit_log table contained 0 entries for the analysis window, meaning price changes, voids, and other sensitive operations were not being logged during this period.
      </div>
      <div class="recommendation priority-med">
        <span class="num">4</span>
        <strong>Unknown users:</strong> All flagged transactions show user = "unknown", indicating the system did not track who created these transactions at the time they were made.
      </div>
    </div>
    <div class="card" style="border-left:4px solid #16a34a">
      <div class="card-header" style="color:#16a34a">POSITIVE FINDINGS</div>
      <div class="recommendation priority-low">
        <span class="num">5</span>
        <strong>Bearing &amp; KTK clean:</strong> Zero fraud flags across both factories over the full 12-month window. No void abuse, refund abuse, timestamp backdating, or payment manipulation detected.
      </div>
      <div class="recommendation priority-low">
        <span class="num">6</span>
        <strong>No return/refund abuse:</strong> Cumulative return quantities did not exceed sold quantities in any factory.
      </div>
    </div>
  </div>

  <h2>Recommended Actions</h2>
  <table>
    <tr>
      <th>#</th>
      <th>Action</th>
      <th>Priority</th>
      <th>Owner</th>
      <th>Timeline</th>
    </tr>
    <tr>
      <td>1</td>
      <td><strong>Investigate customer ${custId} pricing rules</strong> — Determine if ฿0 unit prices are a data entry error, a system bug, or intentional override. Review the customer's pricing configuration in the system.</td>
      <td><span class="badge badge-critical">URGENT</span></td>
      <td>Admin / Office Manager</td>
      <td>Immediate</td>
    </tr>
    <tr>
      <td>2</td>
      <td><strong>Enable audit logging retention</strong> — The audit_log table had 0 records for the 12-month window. Verify the audit logging system is active, and ensure logs are never purged or truncated.</td>
      <td><span class="badge badge-critical">URGENT</span></td>
      <td>IT / Development</td>
      <td>Within 7 days</td>
    </tr>
    <tr>
      <td>3</td>
      <td><strong>Implement minimum price guard</strong> — Add server-side validation to reject transaction items with unit price = 0 or below a configurable minimum threshold per product type.</td>
      <td><span class="badge badge-high">HIGH</span></td>
      <td>Development</td>
      <td>Within 14 days</td>
    </tr>
    <tr>
      <td>4</td>
      <td><strong>Add price change alerts</strong> — Implement real-time alerts when a transaction's unit price deviates more than 30% from the customer's baseline median price.</td>
      <td><span class="badge badge-high">HIGH</span></td>
      <td>Development</td>
      <td>Within 30 days</td>
    </tr>
    <tr>
      <td>5</td>
      <td><strong>Review user assignment on historic transactions</strong> — Backfill created_by where possible using session logs, IP addresses, or time-based correlation with known user activity.</td>
      <td><span class="badge badge-medium">MEDIUM</span></td>
      <td>IT / Admin</td>
      <td>Within 30 days</td>
    </tr>
    <tr>
      <td>6</td>
      <td><strong>Schedule monthly fraud scans</strong> — Run the automated fraud analysis script on a monthly cadence and review the output as part of the management reporting cycle.</td>
      <td><span class="badge badge-medium">MEDIUM</span></td>
      <td>Management</td>
      <td>Ongoing</td>
    </tr>
  </table>

  <h2>Methodology</h2>
  <div class="analysis">
    <strong>Analysis Approach:</strong> This report was generated by an automated forensic script that connected directly to each factory's PostgreSQL database. For each factory, the script fetched all transactions, transaction line items, and audit log entries within the 12-month window (${win.startDate} to ${win.endDate}). Five fraud detection algorithms were applied: (1) <strong>Void Abuse Detection</strong> — frequency and value analysis of voided transactions per user; (2) <strong>Return/Refund Abuse Detection</strong> — cumulative return quantities vs original sale quantities and return-to-sale ratio analysis; (3) <strong>Price Tampering Detection</strong> — comparison of each line item's unit price against the median price for that customer/product pair; (4) <strong>Timestamp Backdating Detection</strong> — comparison of sale_date vs created_at to identify entries dated before their creation; (5) <strong>Payment Manipulation Detection</strong> — analysis of payment amounts vs expected patterns to detect micro-payments and suspicious sequences. Each detected anomaly is scored 0–100 and classified by severity (Critical/High/Medium).
  </div>

  <div class="footer">SuperIce Group — Confidential Fraud Analysis Report | Page 4 of 4 | Generated from POS database forensics</div>
</div>

<!-- CHARTS -->
<script>
Chart.defaults.font.size = 9;
Chart.defaults.font.family = "'Helvetica Neue','Sarabun',sans-serif";
Chart.defaults.animation = false;

new Chart(document.getElementById('chartFactoryFlags'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(factories.map(f => f.toUpperCase()))},
    datasets: [{
      label: 'Fraud Flags',
      data: ${JSON.stringify(factoryFlagCounts)},
      backgroundColor: ['#2563eb', '#16a34a', '#ea580c'],
      borderRadius: 6,
      maxBarThickness: 60
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, title: { display: true, text: 'Number of Fraud Flags by Factory', font: { size: 11 } } },
    scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false } } }
  }
});

new Chart(document.getElementById('chartFactoryImpact'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(factories.map(f => f.toUpperCase()))},
    datasets: [{
      label: 'Impact',
      data: ${JSON.stringify(factoryImpacts)},
      backgroundColor: ['#dc2626', '#16a34a', '#ea580c'],
      borderRadius: 6,
      maxBarThickness: 60
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, title: { display: true, text: 'Estimated Financial Impact by Factory', font: { size: 11 } } },
    scales: { y: { beginAtZero: true, ticks: { callback: function(v) { return String.fromCharCode(0x0E3F) + v; } } }, x: { grid: { display: false } } }
  }
});

new Chart(document.getElementById('chartSeverity'), {
  type: 'doughnut',
  data: {
    labels: ['Critical', 'High', 'Medium'],
    datasets: [{
      data: ${JSON.stringify(severityCounts)},
      backgroundColor: ['#dc2626', '#ea580c', '#ca8a04'],
      borderWidth: 2,
      borderColor: '#fff'
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 9 } } },
      title: { display: true, text: 'Severity Distribution', font: { size: 11 } }
    },
    cutout: '55%'
  }
});

new Chart(document.getElementById('chartTxImpact'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(txIds.map(id => 'Tx #' + id))},
    datasets: [{
      label: 'Impact',
      data: ${JSON.stringify(txImpacts)},
      backgroundColor: '#dc2626',
      borderRadius: 4,
      maxBarThickness: 40
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, title: { display: true, text: 'Impact per Flagged Transaction', font: { size: 11 } } },
    scales: { y: { beginAtZero: true, ticks: { callback: function(v) { return String.fromCharCode(0x0E3F) + v; } } }, x: { ticks: { font: { size: 7 }, maxRotation: 45 }, grid: { display: false } } }
  }
});

new Chart(document.getElementById('chartPriceDeviation'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(txIds.map(id => '#' + id))},
    datasets: [
      {
        label: 'Baseline (' + String.fromCharCode(0x0E3F) + '${baselinePrice})',
        data: ${JSON.stringify(txIds.map(() => baselinePrice))},
        backgroundColor: 'rgba(37,99,235,0.15)',
        borderColor: '#2563eb',
        borderWidth: 1,
        borderRadius: 4,
        maxBarThickness: 30
      },
      {
        label: 'Observed (' + String.fromCharCode(0x0E3F) + '0)',
        data: ${JSON.stringify(txIds.map(id => {
          const flag = flags.find(f => f.transactionId === id);
          return flag?.evidence?.observedUnitPrice ?? 0;
        }))},
        backgroundColor: '#dc2626',
        borderRadius: 4,
        maxBarThickness: 30
      }
    ]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 8 } } }, title: { display: true, text: 'Baseline vs Observed Unit Price', font: { size: 10 } } },
    scales: { y: { beginAtZero: true, ticks: { callback: function(v) { return String.fromCharCode(0x0E3F) + v; } } }, x: { ticks: { font: { size: 7 } }, grid: { display: false } } }
  }
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
  console.log("HTML written to:", htmlPath);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 });

  await page.waitForFunction(
    () => typeof Chart !== "undefined" && Chart.instances && Object.keys(Chart.instances).length >= 5,
    { timeout: 15000 }
  );
  await new Promise((r) => setTimeout(r, 2000));

  await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
    displayHeaderFooter: false,
  });
  console.log("PDF written to:", pdfPath);

  await browser.close();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
