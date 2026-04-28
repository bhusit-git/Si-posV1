import { describe, expect, it } from "vitest";

import type { SessionUser } from "@/lib/auth";
import {
  canAccessDailyLedger,
  clampDailyLedgerDateForAccess,
  getBangkokTodayISO,
  getDailyLedgerRecentWindow,
  usesRestrictedDailyLedgerRecentWindow,
} from "@/lib/daily-ledger-access";

const REFERENCE_DATE = new Date("2026-04-19T12:00:00+07:00");

describe("daily-ledger access", () => {
  it("allows admin, office, and Bearing managers", () => {
    expect(canAccessDailyLedger({ role: "admin", factoryKey: null })).toBe(true);
    expect(canAccessDailyLedger({ role: "office", factoryKey: null })).toBe(true);
    expect(canAccessDailyLedger({ role: "manager", factoryKey: "bearing" })).toBe(true);
  });

  it("keeps Daily Ledger hidden for non-Bearing managers and factory users", () => {
    expect(canAccessDailyLedger({ role: "manager", factoryKey: "si" })).toBe(false);
    expect(canAccessDailyLedger({ role: "factory", factoryKey: "bearing" })).toBe(false);
  });

  it("restricts only Bearing managers to the recent window", () => {
    expect(
      usesRestrictedDailyLedgerRecentWindow({ role: "manager", factoryKey: "bearing" })
    ).toBe(true);
    expect(
      usesRestrictedDailyLedgerRecentWindow({ role: "admin", factoryKey: null })
    ).toBe(false);
    expect(
      usesRestrictedDailyLedgerRecentWindow({ role: "manager", factoryKey: "si" })
    ).toBe(false);
  });
});

describe("daily-ledger date clamping", () => {
  it("builds the Bangkok recent window as today and yesterday", () => {
    expect(getBangkokTodayISO(REFERENCE_DATE)).toBe("2026-04-19");
    expect(getDailyLedgerRecentWindow(REFERENCE_DATE)).toEqual({
      yesterday: "2026-04-18",
      today: "2026-04-19",
    });
  });

  it("clamps out-of-range dates for Bearing managers", () => {
    const identity: Pick<SessionUser, "role" | "factoryKey"> = {
      role: "manager",
      factoryKey: "bearing",
    };

    expect(clampDailyLedgerDateForAccess("2026-04-17", identity, REFERENCE_DATE)).toBe(
      "2026-04-18"
    );
    expect(clampDailyLedgerDateForAccess("2026-04-20", identity, REFERENCE_DATE)).toBe(
      "2026-04-19"
    );
    expect(clampDailyLedgerDateForAccess("2026-04-18", identity, REFERENCE_DATE)).toBe(
      "2026-04-18"
    );
  });

  it("leaves admin and office dates unchanged", () => {
    expect(
      clampDailyLedgerDateForAccess(
        "2026-04-10",
        { role: "admin", factoryKey: null },
        REFERENCE_DATE
      )
    ).toBe("2026-04-10");
    expect(
      clampDailyLedgerDateForAccess(
        "2026-04-10",
        { role: "office", factoryKey: null },
        REFERENCE_DATE
      )
    ).toBe("2026-04-10");
  });
});
