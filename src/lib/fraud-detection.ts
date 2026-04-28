import type { DrizzleDB } from "@/db";
import { auditFindings, auditLog, transactionItems, transactions } from "@/db/schema";
import {
  and,
  asc,
  desc,
  gte,
  inArray,
  lte,
  or,
} from "drizzle-orm";
import {
  type AuditFindingCandidate,
  type AuditFindingCategory,
  type AuditFindingSeverity,
  buildFindingFingerprint,
} from "@/lib/audit-findings";

type TxStatus = "paid" | "unpaid" | "partial" | "voided";

export interface DetectionTxRow {
  id: number;
  customerId: number;
  totalAmount: number;
  paid: number;
  outstandingAmount: number;
  status: TxStatus;
  transactionKind: string;
  saleDate: string;
  saleTime: string;
  createdAt: Date;
  createdBy: number | null;
  voidedBy: number | null;
  voidReason: string | null;
}

export interface DetectionItemRow {
  transactionId: number;
  productTypeId: number;
  quantity: number;
  unitPrice: number;
}

export interface DetectionAuditRow {
  id: number;
  userId: number | null;
  username: string;
  action: string;
  entityId: number | null;
  details: Record<string, unknown> | null;
  createdAt: Date;
}

export interface DetectionDataset {
  transactions: DetectionTxRow[];
  items: DetectionItemRow[];
  audits: DetectionAuditRow[];
  targetTransactionIds: number[];
  targetCustomerIds: number[];
}

interface ScanOptions {
  startDate?: string;
  endDate?: string;
  transactionIds?: number[];
  customerIds?: number[];
  userIds?: number[];
}

interface ScanResult {
  findings: AuditFindingCandidate[];
  upsertedCount: number;
  targetTransactionCount: number;
  targetCustomerCount: number;
}

const HISTORY_LOOKBACK_DAYS = 90;
const MIN_HISTORY_SIZE = 3;
const ORDER_AMOUNT_ANOMALY_MULTIPLIER = 3.5;
const ORDER_AMOUNT_CRITICAL_MULTIPLIER = 5.5;
const ORDER_AMOUNT_MIN_DELTA = 500;
const ORDER_QUANTITY_ANOMALY_MULTIPLIER = 3;
const ORDER_QUANTITY_HIGH_MULTIPLIER = 4.5;
const ORDER_QUANTITY_MIN_DELTA = 10;
const PRICE_DEVIATION_PCT_THRESHOLD = 0.35;
const PRICE_DEVIATION_HIGH_PCT_THRESHOLD = 0.6;
const PRICE_DEVIATION_ABSOLUTE_THRESHOLD = 10;
const VOID_REASON_BLACKLIST = new Set([
  "",
  "-",
  "na",
  "n/a",
  "test",
  "void",
  "ยกเลิก",
  "ผิด",
  "ผิดพลาด",
  "ลูกค้ายกเลิก",
]);

function addDays(isoDate: string, deltaDays: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function normalizeReason(reason: string | null | undefined): string {
  return (reason || "").trim().toLowerCase();
}

function isWeakVoidReason(reason: string | null | undefined): boolean {
  const normalized = normalizeReason(reason);
  return normalized.length < 6 || VOID_REASON_BLACKLIST.has(normalized);
}

function actorKey(row: { userId: number | null; username: string | null }): string {
  if (typeof row.userId === "number" && Number.isInteger(row.userId)) {
    return `user:${row.userId}`;
  }
  return `name:${row.username || "unknown"}`;
}

function buildSaleDateTime(saleDate: string, saleTime: string): Date {
  const safeTime = saleTime && saleTime.length >= 5 ? saleTime : "00:00:00";
  return new Date(`${saleDate}T${safeTime}+07:00`);
}

function getItemQuantity(items: DetectionItemRow[]): number {
  return items.reduce((sum, item) => sum + Math.abs(asNumber(item.quantity)), 0);
}

function sameOrEarlierTransaction(a: DetectionTxRow, b: DetectionTxRow): boolean {
  if (a.saleDate !== b.saleDate) return a.saleDate < b.saleDate;
  if (a.saleTime !== b.saleTime) return a.saleTime <= b.saleTime;
  return a.id < b.id;
}

function pushFinding(
  results: Map<string, AuditFindingCandidate>,
  finding: AuditFindingCandidate
): void {
  const existing = results.get(finding.fingerprint);
  if (!existing || finding.riskScore > existing.riskScore) {
    results.set(finding.fingerprint, finding);
  }
}

function buildFinding(params: {
  ruleKey: string;
  category: AuditFindingCategory;
  severity: AuditFindingSeverity;
  riskScore: number;
  entity: string;
  entityId: number | null;
  userId: number | null;
  username: string | null;
  customerId: number | null;
  transactionId: number | null;
  title: string;
  reason: string;
  evidence: Record<string, unknown>;
  eventAt: Date;
}): AuditFindingCandidate {
  return {
    fingerprint: buildFindingFingerprint([
      params.ruleKey,
      params.entity,
      params.entityId,
      params.userId,
      params.customerId,
      params.transactionId,
    ]),
    ...params,
    riskScore: clampScore(params.riskScore),
  };
}

function sortByCreatedAsc<T extends { createdAt: Date }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

function findLatestAuditForAction(
  audits: DetectionAuditRow[],
  action: string
): DetectionAuditRow | null {
  const matches = audits.filter((audit) => audit.action === action);
  if (matches.length === 0) return null;
  return matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
}

export function detectAuditFindingsFromData(dataset: DetectionDataset): AuditFindingCandidate[] {
  const targetTxIds = new Set(dataset.targetTransactionIds);
  const findings = new Map<string, AuditFindingCandidate>();

  const itemsByTxId = new Map<number, DetectionItemRow[]>();
  for (const item of dataset.items) {
    const rows = itemsByTxId.get(item.transactionId) || [];
    rows.push(item);
    itemsByTxId.set(item.transactionId, rows);
  }

  const auditsByTxId = new Map<number, DetectionAuditRow[]>();
  const voidAuditsByActor = new Map<string, DetectionAuditRow[]>();
  for (const audit of dataset.audits) {
    if (typeof audit.entityId === "number") {
      const rows = auditsByTxId.get(audit.entityId) || [];
      rows.push(audit);
      auditsByTxId.set(audit.entityId, rows);
    }
    if (audit.action === "transaction.void") {
      const key = actorKey(audit);
      const rows = voidAuditsByActor.get(key) || [];
      rows.push(audit);
      voidAuditsByActor.set(key, rows);
    }
  }
  for (const [key, rows] of voidAuditsByActor) {
    voidAuditsByActor.set(key, sortByCreatedAsc(rows));
  }

  const txByCustomer = new Map<number, DetectionTxRow[]>();
  for (const tx of dataset.transactions) {
    const rows = txByCustomer.get(tx.customerId) || [];
    rows.push(tx);
    txByCustomer.set(tx.customerId, rows);
  }
  for (const [customerId, rows] of txByCustomer) {
    txByCustomer.set(
      customerId,
      [...rows].sort((a, b) => {
        if (a.saleDate !== b.saleDate) return a.saleDate.localeCompare(b.saleDate);
        if (a.saleTime !== b.saleTime) return a.saleTime.localeCompare(b.saleTime);
        return a.id - b.id;
      })
    );
  }

  const targetTransactions = dataset.transactions.filter((tx) => targetTxIds.has(tx.id));

  for (const tx of targetTransactions) {
    const txAudits = auditsByTxId.get(tx.id) || [];
    const txItems = itemsByTxId.get(tx.id) || [];
    const createAudit = findLatestAuditForAction(txAudits, "transaction.create");
    const voidAudit = findLatestAuditForAction(txAudits, "transaction.void");
    const paymentAudits = txAudits.filter((audit) => audit.action === "transaction.payment");
    const historicalCustomerTx = (txByCustomer.get(tx.customerId) || []).filter(
      (row) => row.id !== tx.id && sameOrEarlierTransaction(row, tx)
    );
    const historicalCompletedTx = historicalCustomerTx.filter(
      (row) => row.status !== "voided" && row.transactionKind !== "return" && row.transactionKind !== "adjustment"
    );

    if (tx.status === "voided") {
      if (voidAudit) {
        const voidActorId = voidAudit.userId ?? tx.voidedBy ?? null;
        const voidActorName = voidAudit.username || null;
        const key = actorKey({ userId: voidActorId, username: voidActorName });
        const actorVoids = (voidAuditsByActor.get(key) || []).filter((audit) => {
          const ageMs = voidAudit.createdAt.getTime() - audit.createdAt.getTime();
          return ageMs >= 0 && ageMs <= 24 * 60 * 60 * 1000;
        });
        if (actorVoids.length >= 3) {
          pushFinding(
            findings,
            buildFinding({
              ruleKey: "void_frequency_high",
              category: "suspicious_cancellations",
              severity: actorVoids.length >= 5 ? "critical" : "high",
              riskScore: 68 + actorVoids.length * 6,
              entity: "transaction",
              entityId: tx.id,
              userId: voidActorId,
              username: voidActorName,
              customerId: tx.customerId,
              transactionId: tx.id,
              title: "ยกเลิกรายการถี่ผิดปกติ",
              reason: `ผู้ใช้คนเดียวกันยกเลิกรายการ ${actorVoids.length} ครั้งภายใน 24 ชั่วโมง`,
              evidence: {
                recentVoidCount: actorVoids.length,
                recentVoidTransactionIds: actorVoids
                  .map((audit) => audit.entityId)
                  .filter((value): value is number => typeof value === "number")
                  .slice(-5),
                totalAmount: tx.totalAmount,
              },
              eventAt: voidAudit.createdAt,
            })
          );
        }

        if (tx.paid > 0 || paymentAudits.length > 0) {
          pushFinding(
            findings,
            buildFinding({
              ruleKey: "void_after_payment",
              category: "suspicious_cancellations",
              severity: tx.paid >= tx.totalAmount ? "critical" : "high",
              riskScore: tx.paid >= tx.totalAmount ? 92 : 82,
              entity: "transaction",
              entityId: tx.id,
              userId: voidActorId,
              username: voidActorName,
              customerId: tx.customerId,
              transactionId: tx.id,
              title: "ยกเลิกหลังมีการรับชำระ",
              reason: "รายการนี้ถูกยกเลิกหลังมีการรับชำระหรือมีประวัติการชำระเงิน",
              evidence: {
                paidAmount: tx.paid,
                paymentAuditCount: paymentAudits.length,
                totalAmount: tx.totalAmount,
              },
              eventAt: voidAudit.createdAt,
            })
          );
        }
      }

      if (isWeakVoidReason(tx.voidReason)) {
        pushFinding(
          findings,
          buildFinding({
            ruleKey: "void_reason_generic",
            category: "suspicious_cancellations",
            severity: tx.paid > 0 ? "high" : "medium",
            riskScore: tx.paid > 0 ? 78 : 63,
            entity: "transaction",
            entityId: tx.id,
            userId: tx.voidedBy,
            username: voidAudit?.username || null,
            customerId: tx.customerId,
            transactionId: tx.id,
            title: "เหตุผลยกเลิกไม่น่าเชื่อถือ",
            reason: "เหตุผลยกเลิกสั้นหรือเป็นข้อความทั่วไปเกินไป",
            evidence: {
              voidReason: tx.voidReason,
              paidAmount: tx.paid,
              totalAmount: tx.totalAmount,
            },
            eventAt: voidAudit?.createdAt || tx.createdAt,
          })
        );
      }

      if (historicalCompletedTx.length >= MIN_HISTORY_SIZE) {
        const customerBaseline = median(historicalCompletedTx.map((row) => asNumber(row.totalAmount)));
        if (customerBaseline > 0 && tx.totalAmount >= customerBaseline * 2.5) {
          pushFinding(
            findings,
            buildFinding({
              ruleKey: "void_amount_spike",
              category: "suspicious_cancellations",
              severity: tx.totalAmount >= customerBaseline * 4 ? "critical" : "high",
              riskScore: tx.totalAmount >= customerBaseline * 4 ? 90 : 76,
              entity: "transaction",
              entityId: tx.id,
              userId: tx.voidedBy,
              username: voidAudit?.username || null,
              customerId: tx.customerId,
              transactionId: tx.id,
              title: "มูลค่ายกเลิกสูงกว่าปกติ",
              reason: `ยอดรายการที่ถูกยกเลิกสูงกว่าค่ากลางลูกค้ารายนี้ ${(
                tx.totalAmount / customerBaseline
              ).toFixed(1)} เท่า`,
              evidence: {
                totalAmount: tx.totalAmount,
                customerMedianAmount: customerBaseline,
              },
              eventAt: voidAudit?.createdAt || tx.createdAt,
            })
          );
        }
      }
    }

    if (tx.status !== "voided" && tx.transactionKind !== "return" && tx.transactionKind !== "adjustment") {
      if (historicalCompletedTx.length >= MIN_HISTORY_SIZE) {
        const currentQty = getItemQuantity(txItems);
        const priorAmounts = historicalCompletedTx.map((row) => asNumber(row.totalAmount));
        const priorQty = historicalCompletedTx.map((row) =>
          getItemQuantity(itemsByTxId.get(row.id) || [])
        );
        const amountMedian = median(priorAmounts);
        const qtyAverage = mean(priorQty);

        const amountDelta = tx.totalAmount - amountMedian;
        if (
          amountMedian > 0 &&
          tx.totalAmount >= amountMedian * ORDER_AMOUNT_ANOMALY_MULTIPLIER &&
          amountDelta >= ORDER_AMOUNT_MIN_DELTA
        ) {
          pushFinding(
            findings,
            buildFinding({
              ruleKey: "order_amount_anomaly",
              category: "anomaly_orders",
              severity:
                tx.totalAmount >= amountMedian * ORDER_AMOUNT_CRITICAL_MULTIPLIER
                  ? "critical"
                  : "high",
              riskScore:
                tx.totalAmount >= amountMedian * ORDER_AMOUNT_CRITICAL_MULTIPLIER
                  ? 89
                  : 73,
              entity: "transaction",
              entityId: tx.id,
              userId: createAudit?.userId ?? tx.createdBy,
              username: createAudit?.username || null,
              customerId: tx.customerId,
              transactionId: tx.id,
              title: "ยอดขายต่างจากพฤติกรรมเดิม",
              reason: `ยอดขายสูงกว่าค่ากลางเดิมของลูกค้ารายนี้ ${(
                tx.totalAmount / amountMedian
              ).toFixed(1)} เท่า`,
              evidence: {
                totalAmount: tx.totalAmount,
                customerMedianAmount: amountMedian,
                absoluteDelta: Number(amountDelta.toFixed(2)),
                historicalSampleSize: historicalCompletedTx.length,
              },
              eventAt: createAudit?.createdAt || tx.createdAt,
            })
          );
        }

        if (
          qtyAverage > 0 &&
          currentQty >= qtyAverage * ORDER_QUANTITY_ANOMALY_MULTIPLIER &&
          currentQty - qtyAverage >= ORDER_QUANTITY_MIN_DELTA
        ) {
          pushFinding(
            findings,
            buildFinding({
              ruleKey: "order_quantity_anomaly",
              category: "anomaly_orders",
              severity:
                currentQty >= qtyAverage * ORDER_QUANTITY_HIGH_MULTIPLIER ? "high" : "medium",
              riskScore:
                currentQty >= qtyAverage * ORDER_QUANTITY_HIGH_MULTIPLIER ? 78 : 62,
              entity: "transaction",
              entityId: tx.id,
              userId: createAudit?.userId ?? tx.createdBy,
              username: createAudit?.username || null,
              customerId: tx.customerId,
              transactionId: tx.id,
              title: "จำนวนสินค้าต่างจากพฤติกรรมเดิม",
              reason: `จำนวนรวมของรายการนี้สูงกว่าค่าเฉลี่ยเดิม ${(
                currentQty / qtyAverage
              ).toFixed(1)} เท่า`,
              evidence: {
                currentQuantity: currentQty,
                customerAverageQuantity: Number(qtyAverage.toFixed(2)),
                historicalSampleSize: historicalCompletedTx.length,
              },
              eventAt: createAudit?.createdAt || tx.createdAt,
            })
          );
        }
      }

      const worstPriceDeviation = txItems.reduce<{
        productTypeId: number;
        unitPrice: number;
        medianPrice: number;
        pctDiff: number;
      } | null>((worst, item) => {
        const historicalPrices = historicalCompletedTx
          .flatMap((row) => itemsByTxId.get(row.id) || [])
          .filter((historyItem) => historyItem.productTypeId === item.productTypeId)
          .map((historyItem) => asNumber(historyItem.unitPrice))
          .filter((price) => price > 0);
        if (historicalPrices.length < MIN_HISTORY_SIZE) return worst;

        const itemMedian = median(historicalPrices);
        if (itemMedian <= 0) return worst;

        const pctDiff = Math.abs(asNumber(item.unitPrice) - itemMedian) / itemMedian;
        if (
          pctDiff < PRICE_DEVIATION_PCT_THRESHOLD ||
          Math.abs(asNumber(item.unitPrice) - itemMedian) < PRICE_DEVIATION_ABSOLUTE_THRESHOLD
        ) {
          return worst;
        }

        if (!worst || pctDiff > worst.pctDiff) {
          return {
            productTypeId: item.productTypeId,
            unitPrice: asNumber(item.unitPrice),
            medianPrice: itemMedian,
            pctDiff,
          };
        }
        return worst;
      }, null);

      if (worstPriceDeviation) {
        pushFinding(
          findings,
          buildFinding({
            ruleKey: "order_price_deviation",
            category: "anomaly_orders",
            severity:
              worstPriceDeviation.pctDiff >= PRICE_DEVIATION_HIGH_PCT_THRESHOLD
                ? "high"
                : "medium",
            riskScore:
              worstPriceDeviation.pctDiff >= PRICE_DEVIATION_HIGH_PCT_THRESHOLD ? 80 : 66,
            entity: "transaction",
            entityId: tx.id,
            userId: createAudit?.userId ?? tx.createdBy,
            username: createAudit?.username || null,
            customerId: tx.customerId,
            transactionId: tx.id,
            title: "ราคาขายเบี่ยงจากประวัติเดิม",
            reason: `ราคาสินค้าบางรายการต่างจากค่ากลางเดิม ${Math.round(
              worstPriceDeviation.pctDiff * 100
            )}%`,
            evidence: {
              productTypeId: worstPriceDeviation.productTypeId,
              unitPrice: worstPriceDeviation.unitPrice,
              customerMedianPrice: worstPriceDeviation.medianPrice,
            },
            eventAt: createAudit?.createdAt || tx.createdAt,
          })
        );
      }

      const createdAt = tx.createdAt instanceof Date ? tx.createdAt : new Date(tx.createdAt);
      const saleAt = buildSaleDateTime(tx.saleDate, tx.saleTime);
      const gapHours = (createdAt.getTime() - saleAt.getTime()) / (1000 * 60 * 60);
      if (gapHours > 6) {
        pushFinding(
          findings,
          buildFinding({
            ruleKey: "order_backdated_mismatch",
            category: "anomaly_orders",
            severity: gapHours > 72 ? "critical" : gapHours > 24 ? "high" : "medium",
            riskScore: gapHours > 72 ? 94 : gapHours > 24 ? 81 : 61,
            entity: "transaction",
            entityId: tx.id,
            userId: createAudit?.userId ?? tx.createdBy,
            username: createAudit?.username || null,
            customerId: tx.customerId,
            transactionId: tx.id,
            title: "เวลาบันทึกย้อนหลังผิดปกติ",
            reason: `เวลาขายเร็วกว่าตอนบันทึกจริงประมาณ ${Math.round(gapHours)} ชั่วโมง`,
            evidence: {
              saleDate: tx.saleDate,
              saleTime: tx.saleTime,
              createdAt: createdAt.toISOString(),
              gapHours: Number(gapHours.toFixed(1)),
            },
            eventAt: createAudit?.createdAt || tx.createdAt,
          })
        );
      }

      if (paymentAudits.length >= 2) {
        pushFinding(
          findings,
          buildFinding({
            ruleKey: "partial_payment_repeat",
            category: "suspicious_payments",
            severity: paymentAudits.length >= 3 ? "high" : "medium",
            riskScore: paymentAudits.length >= 3 ? 76 : 61,
            entity: "transaction",
            entityId: tx.id,
            userId: paymentAudits[paymentAudits.length - 1]?.userId ?? null,
            username: paymentAudits[paymentAudits.length - 1]?.username || null,
            customerId: tx.customerId,
            transactionId: tx.id,
            title: "มีการรับชำระหลายครั้งผิดปกติ",
            reason: `รายการนี้มีประวัติรับชำระ ${paymentAudits.length} ครั้ง ซึ่งอาจสะท้อนการแบ่งชำระผิดปกติ`,
            evidence: {
              paymentCount: paymentAudits.length,
              totalAmount: tx.totalAmount,
              paidAmount: tx.paid,
              outstandingAmount: tx.outstandingAmount,
            },
            eventAt: paymentAudits[paymentAudits.length - 1]?.createdAt || tx.createdAt,
          })
        );
      }

      if (paymentAudits.length >= 3) {
        const smallPayments = paymentAudits.filter((audit) => {
          const amount = asNumber(audit.details?.amount);
          return amount > 0 && amount <= Math.max(50, tx.totalAmount * 0.25);
        });
        if (smallPayments.length >= 2) {
          pushFinding(
            findings,
            buildFinding({
              ruleKey: "micro_payment_sequence",
              category: "suspicious_payments",
              severity: smallPayments.length >= 3 ? "high" : "medium",
              riskScore: smallPayments.length >= 3 ? 81 : 67,
              entity: "transaction",
              entityId: tx.id,
              userId: smallPayments[smallPayments.length - 1]?.userId ?? null,
              username: smallPayments[smallPayments.length - 1]?.username || null,
              customerId: tx.customerId,
              transactionId: tx.id,
              title: "มีการชำระย่อยหลายรอบ",
              reason: `พบการชำระย่อย ${smallPayments.length} ครั้งเมื่อเทียบกับยอดรวมของบิล ซึ่งอาจใช้กลบการทุจริต`,
              evidence: {
                smallPaymentCount: smallPayments.length,
                paymentAuditCount: paymentAudits.length,
                totalAmount: tx.totalAmount,
              },
              eventAt: paymentAudits[paymentAudits.length - 1]?.createdAt || tx.createdAt,
            })
          );
        }
      }
    }
  }

  return Array.from(findings.values()).sort((a, b) => b.riskScore - a.riskScore);
}

async function fetchTargetTransactions(
  db: DrizzleDB,
  options: ScanOptions
): Promise<DetectionTxRow[]> {
  if (options.transactionIds && options.transactionIds.length > 0) {
    return db
      .select({
        id: transactions.id,
        customerId: transactions.customerId,
        totalAmount: transactions.totalAmount,
        paid: transactions.paid,
        outstandingAmount: transactions.outstandingAmount,
        status: transactions.status,
        transactionKind: transactions.transactionKind,
        saleDate: transactions.saleDate,
        saleTime: transactions.saleTime,
        createdAt: transactions.createdAt,
        createdBy: transactions.createdBy,
        voidedBy: transactions.voidedBy,
        voidReason: transactions.voidReason,
      })
      .from(transactions)
      .where(inArray(transactions.id, options.transactionIds));
  }

  if (!options.startDate || !options.endDate) return [];

  const conditions = [
    gte(transactions.saleDate, options.startDate),
    lte(transactions.saleDate, options.endDate),
  ];
  if (options.customerIds && options.customerIds.length > 0) {
    conditions.push(inArray(transactions.customerId, options.customerIds));
  }

  return db
    .select({
      id: transactions.id,
      customerId: transactions.customerId,
      totalAmount: transactions.totalAmount,
      paid: transactions.paid,
      outstandingAmount: transactions.outstandingAmount,
      status: transactions.status,
      transactionKind: transactions.transactionKind,
      saleDate: transactions.saleDate,
      saleTime: transactions.saleTime,
      createdAt: transactions.createdAt,
      createdBy: transactions.createdBy,
      voidedBy: transactions.voidedBy,
      voidReason: transactions.voidReason,
    })
    .from(transactions)
    .where(and(...conditions))
    .orderBy(asc(transactions.saleDate), asc(transactions.saleTime));
}

export async function scanAndPersistAuditFindings(
  db: DrizzleDB,
  options: ScanOptions
): Promise<ScanResult> {
  const targetTransactions = await fetchTargetTransactions(db, options);
  if (targetTransactions.length === 0) {
    return {
      findings: [],
      upsertedCount: 0,
      targetTransactionCount: 0,
      targetCustomerCount: 0,
    };
  }

  const targetTransactionIds = targetTransactions.map((row) => row.id);
  const targetCustomerIds = Array.from(new Set(targetTransactions.map((row) => row.customerId)));
  const targetUserIds = Array.from(
    new Set(
      [
        ...targetTransactions.map((row) => row.createdBy),
        ...targetTransactions.map((row) => row.voidedBy),
        ...(options.userIds || []),
      ].filter((value): value is number => typeof value === "number" && Number.isInteger(value))
    )
  );

  const minTargetDate = targetTransactions
    .map((row) => row.saleDate)
    .sort()[0];
  const maxTargetDate = targetTransactions
    .map((row) => row.saleDate)
    .sort()
    .slice(-1)[0];
  const historyStart = addDays(minTargetDate, -HISTORY_LOOKBACK_DAYS);
  const historyEnd = options.endDate || maxTargetDate;

  const historicalTransactions = await db
    .select({
      id: transactions.id,
      customerId: transactions.customerId,
      totalAmount: transactions.totalAmount,
      paid: transactions.paid,
      outstandingAmount: transactions.outstandingAmount,
      status: transactions.status,
      transactionKind: transactions.transactionKind,
      saleDate: transactions.saleDate,
      saleTime: transactions.saleTime,
      createdAt: transactions.createdAt,
      createdBy: transactions.createdBy,
      voidedBy: transactions.voidedBy,
      voidReason: transactions.voidReason,
    })
    .from(transactions)
    .where(
      and(
        inArray(transactions.customerId, targetCustomerIds),
        gte(transactions.saleDate, historyStart),
        lte(transactions.saleDate, historyEnd)
      )
    )
    .orderBy(asc(transactions.saleDate), asc(transactions.saleTime));

  const historicalTransactionIds = historicalTransactions.map((row) => row.id);
  const historicalItems =
    historicalTransactionIds.length > 0
      ? await db
          .select({
            transactionId: transactionItems.transactionId,
            productTypeId: transactionItems.productTypeId,
            quantity: transactionItems.quantity,
            unitPrice: transactionItems.unitPrice,
          })
          .from(transactionItems)
          .where(inArray(transactionItems.transactionId, historicalTransactionIds))
      : [];

  const auditConditions = [
    gte(auditLog.createdAt, new Date(`${historyStart}T00:00:00.000Z`)),
    lte(auditLog.createdAt, new Date(`${addDays(historyEnd, 1)}T00:00:00.000Z`)),
    inArray(auditLog.action, [
      "transaction.create",
      "transaction.payment",
      "transaction.void",
    ]),
  ];

  const historicalAudits =
    historicalTransactionIds.length > 0 || targetUserIds.length > 0
      ? await db
          .select({
            id: auditLog.id,
            userId: auditLog.userId,
            username: auditLog.username,
            action: auditLog.action,
            entityId: auditLog.entityId,
            details: auditLog.details,
            createdAt: auditLog.createdAt,
          })
          .from(auditLog)
          .where(
            and(
              ...auditConditions,
              historicalTransactionIds.length > 0 && targetUserIds.length > 0
                ? or(
                    inArray(auditLog.entityId, historicalTransactionIds),
                    inArray(auditLog.userId, targetUserIds)
                  )
                : historicalTransactionIds.length > 0
                  ? inArray(auditLog.entityId, historicalTransactionIds)
                  : inArray(auditLog.userId, targetUserIds)
            )
          )
          .orderBy(desc(auditLog.createdAt))
      : [];

  const typedAudits: DetectionAuditRow[] = historicalAudits.map((row) => ({
    ...row,
    details:
      row.details && typeof row.details === "object"
        ? (row.details as Record<string, unknown>)
        : null,
  }));

  const findings = detectAuditFindingsFromData({
    transactions: historicalTransactions,
    items: historicalItems,
    audits: typedAudits,
    targetTransactionIds,
    targetCustomerIds,
  });

  let upsertedCount = 0;
  for (const finding of findings) {
    await db
      .insert(auditFindings)
      .values({
        fingerprint: finding.fingerprint,
        ruleKey: finding.ruleKey,
        category: finding.category,
        severity: finding.severity,
        riskScore: finding.riskScore,
        status: "open",
        entity: finding.entity,
        entityId: finding.entityId,
        userId: finding.userId,
        username: finding.username,
        customerId: finding.customerId,
        transactionId: finding.transactionId,
        title: finding.title,
        reason: finding.reason,
        evidence: finding.evidence,
        firstSeenAt: finding.eventAt,
        lastSeenAt: finding.eventAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: auditFindings.fingerprint,
        set: {
          category: finding.category,
          severity: finding.severity,
          riskScore: finding.riskScore,
          status: "open",
          entity: finding.entity,
          entityId: finding.entityId,
          userId: finding.userId,
          username: finding.username,
          customerId: finding.customerId,
          transactionId: finding.transactionId,
          title: finding.title,
          reason: finding.reason,
          evidence: finding.evidence,
          lastSeenAt: finding.eventAt,
          updatedAt: new Date(),
        },
      });
    upsertedCount++;
  }

  return {
    findings,
    upsertedCount,
    targetTransactionCount: targetTransactionIds.length,
    targetCustomerCount: targetCustomerIds.length,
  };
}
