import { describe, expect, it } from "vitest";
import {
  buildTransferCustomerBackfillAuditDetails,
  classifyTransferCustomerBackfillSource,
  collectTransferCustomerBackfillCandidates,
  collectTransferCustomerBackfillTargets,
  parseTransferCustomerBackfillArgs,
} from "@/lib/transfer-customer-backfill";

describe("transfer customer backfill helpers", () => {
  it("parses apply mode and per-factory targeting", () => {
    expect(parseTransferCustomerBackfillArgs([])).toEqual({
      apply: false,
      factorySelection: "all",
    });
    expect(parseTransferCustomerBackfillArgs(["--apply", "--factory", "bearing"])).toEqual({
      apply: true,
      factorySelection: "bearing",
    });
  });

  it("collects only factory DB targets and never includes the central DATABASE_URL", () => {
    const targets = collectTransferCustomerBackfillTargets("all", {
      DATABASE_URL: "postgres://central",
      DATABASE_URL_SI: "postgres://si",
      DATABASE_URL_BEARING: "postgres://bearing",
      DATABASE_URL_KTK: "postgres://ktk",
    });

    expect(targets.map((target) => target.factoryKey)).toEqual(["si", "bearing", "ktk"]);
    expect(targets.map((target) => target.envVar)).toEqual([
      "DATABASE_URL_SI",
      "DATABASE_URL_BEARING",
      "DATABASE_URL_KTK",
    ]);
  });

  it("fails when a targeted factory DB is unavailable", () => {
    expect(() =>
      collectTransferCustomerBackfillTargets("bearing", {
        DATABASE_URL: "postgres://central",
        DATABASE_URL_SI: "postgres://si",
      })
    ).toThrow('Missing DATABASE_URL_BEARING for factory "bearing"');
  });

  it("classifies allowlist and XFER-prefix candidates for backfill", () => {
    expect(classifyTransferCustomerBackfillSource({ id: 96, name: "สดปลีก" })).toBe("allowlist");
    expect(classifyTransferCustomerBackfillSource({ id: 9999, name: "XFER->BEARING" })).toBe(
      "xfer_prefix"
    );
    expect(classifyTransferCustomerBackfillSource({ id: 96, name: "XFER->BEARING" })).toBe(
      "allowlist+xfer_prefix"
    );
    expect(classifyTransferCustomerBackfillSource({ id: 9999, name: "หน้าร้าน" })).toBeNull();
  });

  it("builds per-customer audit details for persisted runs", () => {
    const candidates = collectTransferCustomerBackfillCandidates([
      { id: 96, name: "สดปลีก", transfer_customer: false },
      { id: 9999, name: "หน้าร้าน", transfer_customer: false },
    ]);

    expect(candidates).toEqual([
      {
        id: 96,
        name: "สดปลีก",
        transfer_customer: false,
        source: "allowlist",
      },
    ]);
    expect(
      buildTransferCustomerBackfillAuditDetails({
        factoryKey: "bearing",
        customerId: 96,
        customerName: "สดปลีก",
        source: "allowlist",
        apply: true,
      })
    ).toEqual(
      expect.objectContaining({
        reason: "invoice_credit_unification_backfill",
        factoryKey: "bearing",
        customerId: 96,
        oldTransferCustomer: false,
        newTransferCustomer: true,
        runMode: "apply",
      })
    );
  });
});
