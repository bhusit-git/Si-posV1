import { describe, expect, it } from "vitest";
import {
  addMinuteToSaleTime,
  buildSaleLaunchUrl,
  getBackdatedInsertState,
  getInvoiceComposerDefaultDateRange,
} from "@/lib/invoice-sale-launch";

describe("invoice-sale-launch", () => {
  it("defaults the invoice composer date range to the current day", () => {
    expect(getInvoiceComposerDefaultDateRange("2026-04-02")).toEqual({
      startDate: "2026-04-02",
      endDate: "2026-04-02",
    });
  });

  it("adds a minute to the anchor time and clamps the end of day", () => {
    expect(addMinuteToSaleTime("08:15:00")).toBe("08:16:00");
    expect(addMinuteToSaleTime("23:59:00")).toBe("23:59:59");
  });

  it("builds a sale launch url with invoice return context", () => {
    expect(
      buildSaleLaunchUrl({
        customerId: 15,
        saleDate: "2026-03-18",
        saleTime: "09:01:00",
        invoiceStartDate: "2026-03-01",
        invoiceEndDate: "2026-03-31",
        invoiceKinds: "sale,return",
        invoiceVatEnabled: true,
        invoiceSource: "new",
        anchorTransactionId: 99,
        backdateMode: true,
      })
    ).toBe(
      "/sale?customerId=15&saleDate=2026-03-18&saleTime=09%3A01%3A00&returnTo=invoice&invoiceStartDate=2026-03-01&invoiceEndDate=2026-03-31&invoiceKinds=sale%2Creturn&invoiceVatEnabled=1&invoiceSource=new&anchorTransactionId=99&backdateMode=1"
    );
  });

  it("enables backdated insert only for admin and only when the target date is in the past", () => {
    expect(
      getBackdatedInsertState({
        selectedAnchorSaleDate: "2026-03-19",
        invoiceEndDate: "2026-04-02",
        today: "2026-04-02",
        isAdmin: true,
      })
    ).toEqual({
      targetSaleDate: "2026-03-19",
      isBackdatedTarget: true,
      canLaunch: true,
    });

    expect(
      getBackdatedInsertState({
        selectedAnchorSaleDate: null,
        invoiceEndDate: "2026-04-02",
        today: "2026-04-02",
        isAdmin: true,
      })
    ).toEqual({
      targetSaleDate: "2026-04-02",
      isBackdatedTarget: false,
      canLaunch: false,
    });

    expect(
      getBackdatedInsertState({
        selectedAnchorSaleDate: "2026-03-19",
        invoiceEndDate: "2026-03-31",
        today: "2026-04-02",
        isAdmin: false,
      })
    ).toEqual({
      targetSaleDate: "2026-03-19",
      isBackdatedTarget: true,
      canLaunch: false,
    });
  });
});
