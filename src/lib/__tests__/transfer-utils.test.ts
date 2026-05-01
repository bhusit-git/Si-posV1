import { describe, expect, it } from "vitest";
import {
  applyLegacyAccountingStatusToNote,
  allocateTransferRef,
  buildLocalTransferRef,
  TRANSFER_ALLOWLIST_CUSTOMER_IDS,
  buildTransferNote,
  getTransferAccountingStatus,
  isInvoiceCreditCustomer,
  isTransferEligibleCustomer,
  isTransferCustomerName,
  parseTransferNote,
} from "@/lib/transfer-utils";

describe("transfer utils", () => {
  it("detects transfer customers by XFER-> prefix", () => {
    expect(isTransferCustomerName("XFER->BEARING")).toBe(true);
    expect(isTransferCustomerName("xfer->ktk")).toBe(true);
    expect(isTransferCustomerName("Normal Customer")).toBe(false);
  });

  it("legacy helper still allows transfer customers by operational allowlist id", () => {
    expect(TRANSFER_ALLOWLIST_CUSTOMER_IDS.has(51)).toBe(true);
    expect(isTransferEligibleCustomer({ id: 51, name: "Lotus Express" })).toBe(true);
    expect(isTransferEligibleCustomer({ id: 999999, name: "Lotus Express" })).toBe(false);
  });

  it("active invoice-credit eligibility depends only on transferCustomer flag", () => {
    expect(isInvoiceCreditCustomer({ transferCustomer: true })).toBe(true);
    expect(isInvoiceCreditCustomer({ transferCustomer: false })).toBe(false);
    expect(isInvoiceCreditCustomer({ transferCustomer: null })).toBe(false);
    expect(isInvoiceCreditCustomer(null)).toBe(false);
    expect(isInvoiceCreditCustomer(undefined)).toBe(false);
    // Name prefix and allowlist id must NOT satisfy active eligibility.
    expect(
      isInvoiceCreditCustomer({ transferCustomer: false } as { transferCustomer: boolean })
    ).toBe(false);
    expect(
      isTransferEligibleCustomer({ id: 51, name: "XFER->BEARING", transferCustomer: false })
    ).toBe(true);
  });

  it("builds and parses transfer note payload", () => {
    const note = buildTransferNote({
      ref: "XFER-20260227-001",
      to: "BEARING",
      truck: "AB-123",
      memo: "night shift",
    });

    const parsed = parseTransferNote(note);
    expect(parsed).not.toBeNull();
    expect(parsed?.ref).toBe("XFER-20260227-001");
    expect(parsed?.to).toBe("BEARING");
    expect(parsed?.truck).toBe("AB-123");
    expect(parsed?.memo).toBe("night shift");
    expect(parsed?.accountingStatus).toBe("open");
  });

  it("supports accounting status in transfer note payload", () => {
    const note = buildTransferNote({
      ref: "XFER-20260227-001",
      accountingStatus: "closed",
    });

    const parsed = parseTransferNote(note);
    expect(parsed).not.toBeNull();
    expect(parsed?.accountingStatus).toBe("closed");
    expect(note.includes("acct=closed")).toBe(true);
  });

  it("defaults accounting status to open when note is legacy or malformed", () => {
    const legacyTransferNote = buildTransferNote({ ref: "XFER-20260227-002" });
    expect(getTransferAccountingStatus(legacyTransferNote)).toBe("open");
    expect(getTransferAccountingStatus("plain note")).toBe("open");
  });

  it("stores legacy accounting closed/open in plain notes", () => {
    const closed = applyLegacyAccountingStatusToNote("legacy text", "closed");
    expect(closed).toContain("[acct=closed]");
    expect(getTransferAccountingStatus(closed)).toBe("closed");

    const reopened = applyLegacyAccountingStatusToNote(closed, "open");
    expect(reopened).toBe("legacy text");
    expect(getTransferAccountingStatus(reopened)).toBe("open");
  });

  it("returns null for malformed transfer notes", () => {
    expect(parseTransferNote("XFER|ref=bad")).toBeNull();
    expect(parseTransferNote("plain note")).toBeNull();
  });

  it("allocates next available ref when preferred ref is already used", () => {
    const ref = allocateTransferRef("2026-02-27", ["TRF-20260227-838"], "TRF-20260227-838");
    expect(ref).toBe("TRF-20260227-839");
  });

  it("keeps preferred ref when it is still available", () => {
    const ref = allocateTransferRef("2026-02-27", ["TRF-20260227-001"], "TRF-20260227-838");
    expect(ref).toBe("TRF-20260227-838");
  });

  it("allocates from sale date when preferred ref has different month", () => {
    const ref = allocateTransferRef("2026-02-27", ["TRF-20260227-001"], "TRF-20260126-123");
    expect(ref).toBe("TRF-20260227-002");
  });

  it("restarts numbering monthly and starts at 001", () => {
    const ym = "202602";
    localStorage.removeItem(`superice-transfer-seq-${ym}`);
    const first = buildLocalTransferRef("2026-02-27");
    const second = buildLocalTransferRef("2026-02-27");
    const third = buildLocalTransferRef("2026-03-01");
    expect(first).toBe("TRF-20260227-001");
    expect(second).toBe("TRF-20260227-002");
    expect(third).toBe("TRF-20260301-001");
  });
});
