import { describe, expect, it } from "vitest";

import {
  buildSupplyRequestRefMap,
  formatSupplyRequestRef,
} from "@/lib/supply/request-ref";

describe("formatSupplyRequestRef", () => {
  it("formats request refs as REQ-YYYYMMDD-###", () => {
    expect(formatSupplyRequestRef("2026-02-28T10:15:00.000Z", 1)).toBe("REQ-20260228-001");
  });

  it("uses Bangkok time when the timestamp crosses midnight locally", () => {
    expect(formatSupplyRequestRef("2026-02-27T17:30:00.000Z", 12)).toBe("REQ-20260228-012");
  });

  it("restarts the running number on a new month", () => {
    const refs = buildSupplyRequestRefMap([
      { id: 10, createdAt: "2026-02-28T01:00:00.000Z" },
      { id: 11, createdAt: "2026-02-28T08:00:00.000Z" },
      { id: 12, createdAt: "2026-03-01T02:00:00.000Z" },
    ]);

    expect(refs.get(10)).toBe("REQ-20260228-001");
    expect(refs.get(11)).toBe("REQ-20260228-002");
    expect(refs.get(12)).toBe("REQ-20260301-001");
  });
});
