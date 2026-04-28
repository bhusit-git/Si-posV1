import { Suspense } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EpsonPreprintedBillPage from "@/app/(print)/print/preprinted-bill-test/[id]/page";
import { readFactoryPrintFieldLayout } from "@/lib/print-field-layout";
import { PREPRINTED_BILL_TEST_LAYOUT_SCOPE } from "@/lib/preprinted-bill-test-layout";
import { OFFLINE_PRINT_PREFIX, type OfflinePrintPayload } from "@/lib/offline-print-payload";

let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => currentSearchParams,
}));

const payload: OfflinePrintPayload = {
  id: 901,
  clientId: "901-alpha",
  transactionKind: "sale",
  saleDate: "2026-04-03",
  saleTime: "09:45:00",
  totalAmount: 260,
  paid: 260,
  status: "paid",
  pool: null,
  row: 2,
  col: null,
  bagBalanceBefore: 10,
  bagBalanceAfter: 12,
  hidePrintTotals: false,
  customer: {
    id: 77,
    name: "ร้านทดสอบ",
  },
  items: [
    {
      productTypeId: 1,
      quantity: 5,
      unitPrice: 50,
      subtotal: 250,
      productType: {
        name: "ซอง",
        hasBag: true,
        decreasesBag: false,
      },
    },
  ],
  bagLedgerEntries: [{ type: "out", quantity: 5, note: null }],
};

function setOfflinePayload(token: string, value: OfflinePrintPayload): void {
  window.localStorage.setItem(`${OFFLINE_PRINT_PREFIX}${token}`, JSON.stringify(value));
}

async function renderPage(): Promise<ReturnType<typeof render>> {
  let rendered!: ReturnType<typeof render>;
  await act(async () => {
    rendered = render(
      <Suspense fallback={<div>loading</div>}>
        <EpsonPreprintedBillPage params={Promise.resolve({ id: "901" })} />
      </Suspense>
    );
  });
  return rendered;
}

describe("preprinted bill test layout editor", () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    document.cookie = "superice_factory=si; path=/";
    currentSearchParams = new URLSearchParams("offlineToken=test-token");
    setOfflinePayload("test-token", payload);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens in editor mode without auto-printing, updates the selected field, and reloads saved layout", async () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    const { unmount } = await renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("layout-inspector")).toBeInTheDocument();
    });
    expect(screen.getByTestId("bill-grid")).toBeInTheDocument();
    expect(printSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("bill-element-customer"));

    const customerXInput = screen.getByLabelText("Customer X (mm)") as HTMLInputElement;
    expect(customerXInput.value).toBe("-5");

    fireEvent.change(customerXInput, { target: { value: "-7.5" } });

    await waitFor(() => {
      expect((screen.getByLabelText("Customer X (mm)") as HTMLInputElement).value).toBe("-7.5");
    });

    fireEvent.click(screen.getByRole("button", { name: "Save for this factory" }));

    expect(readFactoryPrintFieldLayout(PREPRINTED_BILL_TEST_LAYOUT_SCOPE, "si")).toEqual({
      customer: { dxMm: -2.5 },
    });

    unmount();

    await renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("layout-inspector")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("bill-element-customer"));

    await waitFor(() => {
      expect((screen.getByLabelText("Customer X (mm)") as HTMLInputElement).value).toBe("-7.5");
    });
  });

  it("resets the selected field and leaves whole-bill offset untouched when resetting all fields", async () => {
    await renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("layout-inspector")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("bill-element-customer"));

    fireEvent.change(screen.getByLabelText("Customer X (mm)"), {
      target: { value: "-8" },
    });

    await waitFor(() => {
      expect((screen.getByLabelText("Customer X (mm)") as HTMLInputElement).value).toBe("-8");
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset selected" }));

    await waitFor(() => {
      expect((screen.getByLabelText("Customer X (mm)") as HTMLInputElement).value).toBe("-5");
    });

    fireEvent.change(screen.getByLabelText("Customer X (mm)"), {
      target: { value: "-7" },
    });
    fireEvent.change(screen.getByLabelText("Offset X (mm)"), {
      target: { value: "3" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset all" }));

    await waitFor(() => {
      expect((screen.getByLabelText("Customer X (mm)") as HTMLInputElement).value).toBe("-5");
      expect((screen.getByLabelText("Offset X (mm)") as HTMLInputElement).value).toBe("3");
    });
  });
});
