import { describe, expect, it } from "vitest";
import { formatCompactPrintDate } from "@/lib/preprinted-bill-date-format";

describe("preprinted-bill-date-format", () => {
  it("formats dates as dd.month.yy using compact Thai month text", () => {
    expect(formatCompactPrintDate("2026-04-03")).toBe("03.เม.26");
    expect(formatCompactPrintDate("2026-12-31")).toBe("31.ธค.26");
  });
});
