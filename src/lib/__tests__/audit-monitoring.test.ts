import { describe, expect, it } from "vitest";
import {
  buildAuditSummaryCards,
  formatFindingEvidencePreview,
} from "@/lib/audit-monitoring";

describe("buildAuditSummaryCards", () => {
  it("marks risky cards with warning and danger tones", () => {
    const cards = buildAuditSummaryCards({
      suspiciousCancellations: 3,
      anomalyOrders: 2,
      suspiciousPayments: 4,
      unresolvedCriticalHigh: 1,
      openCount: 6,
    });

    expect(cards.map((card) => card.key)).toEqual([
      "suspiciousCancellations",
      "anomalyOrders",
      "suspiciousPayments",
      "unresolvedCriticalHigh",
    ]);
    expect(cards[0].tone).toBe("danger");
    expect(cards[1].tone).toBe("warning");
    expect(cards[3].description).toContain("6");
  });

  it("falls back to neutral when counts are zero", () => {
    const cards = buildAuditSummaryCards({
      suspiciousCancellations: 0,
      anomalyOrders: 0,
      suspiciousPayments: 0,
      unresolvedCriticalHigh: 0,
      openCount: 0,
    });

    expect(cards.every((card) => card.tone === "neutral")).toBe(true);
  });
});

describe("formatFindingEvidencePreview", () => {
  it("formats arrays, objects, and scalar values safely", () => {
    const preview = formatFindingEvidencePreview({
      transactionIds: [10, 11],
      totalAmount: 900,
      note: "test",
      extra: { paid: 100 },
    });

    expect(preview).toContain("transactionIds: 10, 11");
    expect(preview).toContain("totalAmount: 900");
    expect(preview).toContain("note: test");
    expect(preview).toContain("extra:");
  });

  it("returns dash when evidence is missing", () => {
    expect(formatFindingEvidencePreview(null)).toBe("-");
  });
});
