import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CreditPage from "@/app/(dashboard)/credit/page";

const sonnerMocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: sonnerMocks.toastSuccess,
    error: sonnerMocks.toastError,
  },
}));

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("credit page payment handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.stubGlobal("open", vi.fn());
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method || (typeof input === "object" && "method" in input ? input.method : "GET");

      if (url.includes("/api/reports?type=creditSummary")) {
        return jsonResponse({
          customers: [
            {
              customerId: 9,
              customerName: "SI Customer",
              unpaidCount: 1,
              totalOutstanding: 500,
              aging0to30: 500,
              aging31to60: 0,
              aging60plus: 0,
              oldestDate: "2026-03-01",
              newestDate: "2026-03-01",
            },
          ],
          grandTotals: {
            totalCustomers: 1,
            totalOutstanding: 500,
            totalUnpaidCount: 1,
          },
        });
      }

      if (url.includes("/api/transactions?customerId=9") && url.includes("status=unpaid")) {
        return jsonResponse([
          {
            id: 77,
            customerId: 9,
            totalAmount: 500,
            paid: 0,
            status: "unpaid",
            saleDate: "2026-03-01",
            saleTime: "09:00:00",
            customer: { id: 9, name: "SI Customer" },
            items: [],
          },
        ]);
      }

      if (url.includes("/api/transactions?customerId=9") && url.includes("status=partial")) {
        return jsonResponse([]);
      }

      if (url.endsWith("/api/transactions") && method === "PUT") {
        return jsonResponse({ error: "server boom" }, 500);
      }

      return jsonResponse({});
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("does not show success UI when the payment request fails", async () => {
    render(<CreditPage />);

    await waitFor(() => {
      expect(screen.getByText(/SI Customer/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/SI Customer/));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "ชำระ" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "ชำระ" }));

    await waitFor(() => {
      expect(screen.getByText("บันทึกการชำระเงิน")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "ยืนยันชำระเงิน" }));

    await waitFor(() => {
      expect(sonnerMocks.toastError).toHaveBeenCalledWith("server boom");
    });
    expect(sonnerMocks.toastSuccess).not.toHaveBeenCalled();
  });
});
