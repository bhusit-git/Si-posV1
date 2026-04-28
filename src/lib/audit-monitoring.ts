export interface AuditFindingSummary {
  suspiciousCancellations: number;
  anomalyOrders: number;
  suspiciousPayments: number;
  unresolvedCriticalHigh: number;
  openCount: number;
}

export interface AuditSummaryCard {
  key: string;
  title: string;
  value: number;
  description: string;
  tone: "danger" | "warning" | "neutral";
}

export function buildAuditSummaryCards(summary: AuditFindingSummary): AuditSummaryCard[] {
  return [
    {
      key: "suspiciousCancellations",
      title: "ยกเลิกผิดปกติ",
      value: summary.suspiciousCancellations,
      description: "ติดตาม void/cancel ที่ดูเสี่ยง",
      tone: summary.suspiciousCancellations > 0 ? "danger" : "neutral",
    },
    {
      key: "anomalyOrders",
      title: "ออเดอร์ผิดปกติ",
      value: summary.anomalyOrders,
      description: "ยอด จำนวน หรือราคาที่เบี่ยงจากประวัติ",
      tone: summary.anomalyOrders > 0 ? "warning" : "neutral",
    },
    {
      key: "suspiciousPayments",
      title: "การชำระเงินผิดปกติ",
      value: summary.suspiciousPayments,
      description: "แยกการชำระหลายครั้งหรือแบ่งจ่ายที่ดูเสี่ยง",
      tone: summary.suspiciousPayments > 0 ? "warning" : "neutral",
    },
    {
      key: "unresolvedCriticalHigh",
      title: "ยังไม่ตรวจ (High/Critical)",
      value: summary.unresolvedCriticalHigh,
      description: `คงค้างทั้งหมด ${summary.openCount} finding`,
      tone: summary.unresolvedCriticalHigh > 0 ? "danger" : "neutral",
    },
  ];
}

export function formatFindingEvidencePreview(evidence: Record<string, unknown> | null): string {
  if (!evidence) return "-";

  const entries = Object.entries(evidence).filter(([, value]) => value !== null && value !== undefined);
  if (entries.length === 0) return "-";

  return entries
    .slice(0, 4)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `${key}: ${value.join(", ")}`;
      }
      if (typeof value === "object") {
        return `${key}: ${JSON.stringify(value)}`;
      }
      return `${key}: ${String(value)}`;
    })
    .join(" | ");
}
