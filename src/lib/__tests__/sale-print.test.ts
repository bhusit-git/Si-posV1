import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OfflinePrintPayload } from "@/lib/offline-print-payload";
import { openSalePrint } from "@/lib/sale-print";

const { openOfflineEpsonPrintWindow, printUrlInHiddenFrame } = vi.hoisted(() => ({
  openOfflineEpsonPrintWindow: vi.fn(),
  printUrlInHiddenFrame: vi.fn(),
}));

vi.mock("@/lib/offline-epson-print", () => ({
  openOfflineEpsonPrintWindow,
}));

vi.mock("@/lib/hidden-print-frame", () => ({
  printUrlInHiddenFrame,
}));

function buildPayload(): OfflinePrintPayload {
  return {
    id: 5001,
    clientId: "5001-test",
    transactionKind: "sale",
    saleDate: "2026-04-03",
    saleTime: "12:34:00",
    totalAmount: 300,
    paid: 300,
    status: "paid",
    pool: null,
    row: 1,
    col: null,
    customer: {
      id: 8,
      name: "ลูกค้า",
    },
    items: [],
    bagLedgerEntries: [],
  };
}

describe("sale-print", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "open").mockImplementation(() => null);
    printUrlInHiddenFrame.mockReturnValue(document.createElement("iframe"));
  });

  it("uses the offline Epson popup helper for queued offline Epson prints", () => {
    const payload = buildPayload();

    openSalePrint({
      saleId: 5001,
      mode: "epson",
      sessionRole: "manager",
      canUseEpsonPrintTools: false,
      hidePrintTotals: true,
      offlinePayload: payload,
      offlineToken: "tok-1",
    });

    expect(openOfflineEpsonPrintWindow).toHaveBeenCalledWith(payload, {
      hideTotals: true,
      minimal: true,
      autoclose: true,
      simple: true,
      useSavedLayout: false,
    });
    expect(window.open).not.toHaveBeenCalled();
  });

  it("routes online Epson printing through the hidden iframe manager", () => {
    openSalePrint({
      saleId: 123,
      mode: "epson",
      offlineToken: "tok-2",
      hidePrintTotals: true,
      sessionRole: "admin",
      canUseEpsonPrintTools: true,
    });

    expect(openOfflineEpsonPrintWindow).not.toHaveBeenCalled();
    expect(printUrlInHiddenFrame).toHaveBeenCalledWith(
      "/print/preprinted-bill/123?offlineToken=tok-2&hideTotals=1&autoclose=1"
    );
    expect(window.open).not.toHaveBeenCalled();
  });

  it("routes Epson Print 2 through the saved-layout cashier print page", () => {
    openSalePrint({
      saleId: 124,
      mode: "epson_v2",
      offlineToken: "tok-v2",
      hidePrintTotals: true,
      sessionRole: "admin",
      canUseEpsonPrintTools: true,
    });

    expect(openOfflineEpsonPrintWindow).not.toHaveBeenCalled();
    expect(printUrlInHiddenFrame).toHaveBeenCalledWith(
      "/print/preprinted-bill/124?offlineToken=tok-v2&hideTotals=1&autoclose=1&layout=v2"
    );
  });

  it("opens the Epson test print editor in a visible window", () => {
    openSalePrint({
      saleId: 321,
      mode: "epson_test",
      offlineToken: "tok-test",
      hidePrintTotals: true,
      sessionRole: "admin",
      canUseEpsonPrintTools: true,
      offlinePayload: buildPayload(),
    });

    expect(openOfflineEpsonPrintWindow).not.toHaveBeenCalled();
    expect(printUrlInHiddenFrame).not.toHaveBeenCalled();
    expect(window.open).toHaveBeenCalledWith(
      "/print/preprinted-bill-test/321?offlineToken=tok-test&hideTotals=1",
      "_blank",
      "width=1400,height=980"
    );
  });

  it("routes receipt printing through the hidden iframe manager even when offline payload exists", () => {
    openSalePrint({
      saleId: 77,
      mode: "receipt",
      offlineToken: "tok-3",
      hidePrintTotals: true,
      sessionRole: "manager",
      canUseEpsonPrintTools: true,
      offlinePayload: buildPayload(),
    });

    expect(openOfflineEpsonPrintWindow).not.toHaveBeenCalled();
    expect(printUrlInHiddenFrame).toHaveBeenCalledWith(
      "/print/receipt/77?offlineToken=tok-3&hideTotals=1&autoclose=1&minimal=1"
    );
    expect(window.open).not.toHaveBeenCalled();
  });

  it("falls back to a popup when the iframe manager is unavailable", () => {
    printUrlInHiddenFrame.mockReturnValueOnce(null);

    openSalePrint({
      saleId: 123,
      mode: "epson",
      offlineToken: "tok-fallback",
      sessionRole: "admin",
      canUseEpsonPrintTools: true,
    });

    expect(window.open).toHaveBeenCalledWith(
      "/print/preprinted-bill/123?offlineToken=tok-fallback&autoclose=1",
      "_blank",
      "width=900,height=700"
    );
  });

  it("passes the saved-layout flag to offline Epson Print 2", () => {
    const payload = buildPayload();

    openSalePrint({
      saleId: 5002,
      mode: "epson_v2",
      sessionRole: "manager",
      canUseEpsonPrintTools: false,
      hidePrintTotals: true,
      offlinePayload: payload,
      offlineToken: "tok-v2-offline",
    });

    expect(openOfflineEpsonPrintWindow).toHaveBeenCalledWith(payload, {
      hideTotals: true,
      minimal: true,
      autoclose: true,
      simple: true,
      useSavedLayout: true,
    });
  });
});
