import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OfflinePrintPayload } from "@/lib/offline-print-payload";
import {
  buildOfflineEpsonPrintHtml,
  openOfflineEpsonPrintWindow,
} from "@/lib/offline-epson-print";

const { printHtmlInHiddenFrame } = vi.hoisted(() => ({
  printHtmlInHiddenFrame: vi.fn(),
}));

vi.mock("@/lib/hidden-print-frame", () => ({
  printHtmlInHiddenFrame,
}));

function buildPayload(
  overrides: Partial<OfflinePrintPayload> = {}
): OfflinePrintPayload {
  return {
    id: 1201,
    clientId: "1201-test",
    transactionKind: "sale",
    saleDate: "2026-04-07",
    saleTime: "11:45:00",
    totalAmount: 320,
    paid: 320,
    status: "paid",
    pool: null,
    row: 1,
    col: null,
    customer: {
      id: 12,
      name: "ร้านทดสอบ",
    },
    items: [
      {
        productTypeId: 1,
        quantity: 4,
        unitPrice: 80,
        subtotal: 320,
        productType: {
          name: "ซอง",
          hasBag: true,
          decreasesBag: false,
        },
      },
    ],
    bagLedgerEntries: [{ type: "out", quantity: 4, note: null }],
    ...overrides,
  };
}

describe("offline-epson-print", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    document.cookie = "superice_factory=si; path=/";
    printHtmlInHiddenFrame.mockReturnValue(document.createElement("iframe"));
  });

  it("embeds the hardened auto-print and auto-close lifecycle script", () => {
    const html = buildOfflineEpsonPrintHtml(buildPayload(), {
      autoclose: true,
    });

    expect(html).toContain("requestAnimationFrame");
    expect(html).toContain("beforeprint");
    expect(html).toContain("visibilitychange");
    expect(html).toContain("fallbackCloseMs = 15000");
    expect(html).toContain("focusGraceMs = 1500");
  });

  it("lets Epson numeric fields overflow instead of clipping large amounts", () => {
    const html = buildOfflineEpsonPrintHtml(
      buildPayload({
        items: [
          {
            productTypeId: 1,
            quantity: 4,
            unitPrice: 80,
            subtotal: 320,
            productType: {
              name: "ซอง",
              hasBag: true,
              decreasesBag: false,
            },
          },
          {
            productTypeId: 99,
            quantity: 1,
            unitPrice: 10000,
            subtotal: 10000,
            productType: {
              name: "ซื้อกระสอบ",
              hasBag: false,
              decreasesBag: false,
            },
          },
        ],
      })
    );

    expect(html).toContain("overflow: visible;");
    expect(html).toContain("text-overflow: clip;");
    expect(html).toContain(">10,000<");
  });

  it("uses the hidden iframe manager before falling back to a popup", () => {
    const payload = buildPayload();

    openOfflineEpsonPrintWindow(payload, {
      autoclose: true,
    });

    expect(printHtmlInHiddenFrame).toHaveBeenCalledTimes(1);
    expect(printHtmlInHiddenFrame.mock.calls[0]?.[0]).toContain("บิล Epson #1201");
  });

  it("renders the saved factory field layout when Epson Print 2 is requested", () => {
    window.localStorage.setItem(
      "superice-print-field-layout:preprinted-bill-test:si",
      JSON.stringify({
        customer: { dxMm: -2.5 },
      })
    );

    const html = buildOfflineEpsonPrintHtml(buildPayload(), {
      useSavedLayout: true,
    });

    expect(html).toContain('left:-7.5mm;top:25mm;width:44mm');
    expect(html).toContain(">12 ร้านทดสอบ<");
  });
});
