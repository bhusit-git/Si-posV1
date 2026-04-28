export type AuditFindingCategory =
  | "suspicious_cancellations"
  | "anomaly_orders"
  | "suspicious_payments"
  | "credit_partial_patterns";

export type AuditFindingSeverity = "medium" | "high" | "critical";

export type AuditFindingStatus = "open" | "reviewed" | "dismissed";

export interface AuditFindingRecord {
  id: number;
  fingerprint: string;
  ruleKey: string;
  category: AuditFindingCategory;
  severity: AuditFindingSeverity;
  riskScore: number;
  status: AuditFindingStatus;
  entity: string;
  entityId: number | null;
  userId: number | null;
  username: string | null;
  customerId: number | null;
  transactionId: number | null;
  title: string;
  reason: string;
  evidence: Record<string, unknown> | null;
  reviewNote: string | null;
  firstSeenAt: string | Date;
  lastSeenAt: string | Date;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface AuditFindingCandidate {
  fingerprint: string;
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
}

export const FINDING_CATEGORY_LABELS: Record<AuditFindingCategory, string> = {
  suspicious_cancellations: "ยกเลิกผิดปกติ",
  anomaly_orders: "ออเดอร์ผิดปกติ",
  suspicious_payments: "การชำระเงินผิดปกติ",
  credit_partial_patterns: "เครดิต/ชำระบางส่วนถี่",
};

export const FINDING_STATUS_LABELS: Record<AuditFindingStatus, string> = {
  open: "ยังไม่ตรวจ",
  reviewed: "ตรวจแล้ว",
  dismissed: "ปิดรายการ",
};

export const FINDING_RULE_LABELS: Record<string, string> = {
  void_frequency_high: "ยกเลิกถี่ผิดปกติ",
  void_reason_generic: "เหตุผลยกเลิกไม่น่าเชื่อถือ",
  void_amount_spike: "มูลค่ายกเลิกสูงกว่าปกติ",
  void_after_payment: "ยกเลิกหลังมีการรับชำระ",
  order_amount_anomaly: "ยอดขายต่างจากพฤติกรรมเดิม",
  order_quantity_anomaly: "จำนวนสินค้าต่างจากพฤติกรรมเดิม",
  order_price_deviation: "ราคาขายเบี่ยงจากประวัติเดิม",
  order_backdated_mismatch: "เวลาบันทึกย้อนหลังผิดปกติ",
  credit_pattern_shift: "หันไปขายเชื่อถี่ขึ้น",
  partial_payment_repeat: "มีการรับชำระหลายครั้งผิดปกติ",
  micro_payment_sequence: "มีการชำระย่อยหลายรอบ",
  outstanding_concentration: "ยอดค้างสะสมสูงผิดปกติ",
};

export const LEGACY_CREDIT_RULE_KEYS = [
  "credit_pattern_shift",
  "outstanding_concentration",
] as const;

export const DEFAULT_FRAUD_FINDING_CATEGORIES = [
  "suspicious_cancellations",
  "anomaly_orders",
  "suspicious_payments",
] as const satisfies readonly AuditFindingCategory[];

export const DEFAULT_FRAUD_FINDING_RULE_KEYS = Object.keys(FINDING_RULE_LABELS).filter(
  (ruleKey) =>
    !LEGACY_CREDIT_RULE_KEYS.includes(
      ruleKey as (typeof LEGACY_CREDIT_RULE_KEYS)[number]
    )
);

export function getFindingRuleLabel(ruleKey: string): string {
  return FINDING_RULE_LABELS[ruleKey] || ruleKey;
}

export function getFindingCategoryLabel(category: AuditFindingCategory): string {
  return FINDING_CATEGORY_LABELS[category];
}

export function getFindingStatusLabel(status: AuditFindingStatus): string {
  return FINDING_STATUS_LABELS[status];
}

export function getSeverityRank(severity: AuditFindingSeverity): number {
  if (severity === "critical") return 3;
  if (severity === "high") return 2;
  return 1;
}

export function isHighPrioritySeverity(
  severity: AuditFindingSeverity | string
): boolean {
  return severity === "high" || severity === "critical";
}

export function buildFindingFingerprint(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => (part === null || part === undefined || part === "" ? "-" : String(part)))
    .join(":");
}

export function toAuditFindingStatus(value: string | null | undefined): AuditFindingStatus {
  if (value === "reviewed" || value === "dismissed") return value;
  return "open";
}
