import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReturnsPage from "@/app/(dashboard)/returns/page";

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("returns page", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        if (url.includes("/api/products")) {
          return jsonResponse([{ id: 1, name: "ซอง", hasBag: false, isActive: true }]);
        }
        if (url.includes("/api/auth")) {
          return jsonResponse({ role: "admin" });
        }
        if (url.includes("/api/customers?search=")) {
          return jsonResponse([{ id: 9, name: "SI Customer", credit: false }]);
        }
        if (url.includes("/api/transactions?customerId=9&limit=10")) {
          return jsonResponse([
            {
              id: 88,
              billNumber: "B-88",
              saleDate: "2026-04-06",
              saleTime: "09:00:00",
              totalAmount: 1000,
              paid: 1000,
              status: "paid",
              transactionKind: "transfer_out",
              pool: 1,
              row: 1,
              col: 1,
              items: [
                {
                  quantity: 5,
                  unitPrice: 200,
                  subtotal: 1000,
                  productType: { id: 1, name: "ซอง", hasBag: false },
                },
              ],
            },
          ]);
        }

        return jsonResponse([]);
      })
    );
    vi.stubGlobal("open", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("labels invoice-credit bills and explains invoice-net return behavior", async () => {
    render(<ReturnsPage />);

    fireEvent.click(screen.getByRole("button", { name: "เปิดรายชื่อลูกค้า (เรียง ก-ฮ)" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /SI Customer/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /SI Customer/i }));

    await waitFor(() => {
      expect(screen.getByText("B-88")).toBeInTheDocument();
      expect(screen.getAllByText("เครดิต").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("button", { name: /B-88/i }));

    await waitFor(() => {
      expect(
        screen.getByText("การคืนบิลเครดิตจะหักจากยอดใบวางบิลในรอบถัดไป และจะไม่สร้างการคืนเงินสดอัตโนมัติ")
      ).toBeInTheDocument();
      expect(screen.getByText("ประเภท:")).toBeInTheDocument();
    });
  });

  it("shows zero-value transfer_out bills in the returns picker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        if (url.includes("/api/products")) {
          return jsonResponse([{ id: 1, name: "ซอง", hasBag: false, isActive: true }]);
        }
        if (url.includes("/api/auth")) {
          return jsonResponse({ role: "admin" });
        }
        if (url.includes("/api/customers?search=")) {
          return jsonResponse([{ id: 9, name: "SI Customer", credit: false }]);
        }
        if (url.includes("/api/transactions?customerId=9&limit=10")) {
          return jsonResponse([
            {
              id: 77,
              billNumber: "XFER-77",
              saleDate: "2026-04-06",
              saleTime: "09:00:00",
              totalAmount: 0,
              paid: 0,
              status: "paid",
              transactionKind: "transfer_out",
              pool: null,
              row: null,
              col: null,
              items: [
                {
                  quantity: 5,
                  unitPrice: 0,
                  subtotal: 0,
                  productType: { id: 1, name: "ซอง", hasBag: false },
                },
              ],
            },
            {
              id: 78,
              billNumber: "ZERO-SALE",
              saleDate: "2026-04-06",
              saleTime: "08:00:00",
              totalAmount: 0,
              paid: 0,
              status: "paid",
              transactionKind: "sale",
              pool: 1,
              row: 1,
              col: 1,
              items: [],
            },
          ]);
        }

        return jsonResponse([]);
      })
    );

    render(<ReturnsPage />);

    fireEvent.click(screen.getByRole("button", { name: "เปิดรายชื่อลูกค้า (เรียง ก-ฮ)" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /SI Customer/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /SI Customer/i }));

    await waitFor(() => {
      expect(screen.getByText("XFER-77")).toBeInTheDocument();
    });

    expect(screen.queryByText("ZERO-SALE")).not.toBeInTheDocument();
  });

  it("shows only the latest five returnable bills", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        if (url.includes("/api/products")) {
          return jsonResponse([{ id: 1, name: "ซอง", hasBag: false, isActive: true }]);
        }
        if (url.includes("/api/auth")) {
          return jsonResponse({ role: "admin" });
        }
        if (url.includes("/api/customers?search=")) {
          return jsonResponse([{ id: 9, name: "SI Customer", credit: false }]);
        }
        if (url.includes("/api/transactions?customerId=9&limit=10")) {
          return jsonResponse(
            Array.from({ length: 6 }, (_, index) => ({
              id: 200 + index,
              billNumber: `B-${200 + index}`,
              saleDate: "2026-04-06",
              saleTime: `0${index}:00:00`,
              totalAmount: 100 + index,
              paid: 100 + index,
              status: "paid",
              transactionKind: "sale",
              pool: 1,
              row: 1,
              col: 1,
              items: [
                {
                  quantity: 1,
                  unitPrice: 100 + index,
                  subtotal: 100 + index,
                  productType: { id: 1, name: "ซอง", hasBag: false },
                },
              ],
            }))
          );
        }

        return jsonResponse([]);
      })
    );

    render(<ReturnsPage />);

    fireEvent.click(screen.getByRole("button", { name: "เปิดรายชื่อลูกค้า (เรียง ก-ฮ)" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /SI Customer/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /SI Customer/i }));

    await waitFor(() => {
      expect(screen.getByText("B-200")).toBeInTheDocument();
      expect(screen.getByText("B-204")).toBeInTheDocument();
    });

    expect(screen.queryByText("B-205")).not.toBeInTheDocument();
  });

  it("supports sale-style keyboard navigation for customer selection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        if (url.includes("/api/products")) {
          return jsonResponse([{ id: 1, name: "ซอง", hasBag: false, isActive: true }]);
        }
        if (url.includes("/api/auth")) {
          return jsonResponse({ role: "admin" });
        }
        if (url.includes("/api/customers?search=")) {
          return jsonResponse([
            { id: 8, name: "Alpha Customer", credit: false },
            { id: 9, name: "Beta Customer", credit: false },
          ]);
        }
        if (url.includes("/api/transactions?customerId=9&limit=10")) {
          return jsonResponse([
            {
              id: 88,
              billNumber: "B-88",
              saleDate: "2026-04-06",
              saleTime: "09:00:00",
              totalAmount: 500,
              paid: 500,
              status: "paid",
              transactionKind: "sale",
              pool: 1,
              row: 1,
              col: 1,
              items: [
                {
                  quantity: 1,
                  unitPrice: 500,
                  subtotal: 500,
                  productType: { id: 1, name: "ซอง", hasBag: false },
                },
              ],
            },
          ]);
        }

        return jsonResponse([]);
      })
    );

    render(<ReturnsPage />);

    fireEvent.click(screen.getByRole("button", { name: "เปิดรายชื่อลูกค้า (เรียง ก-ฮ)" }));

    const searchInput = screen.getByPlaceholderText("พิมพ์ชื่อหรือรหัสลูกค้า...");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Alpha Customer/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Beta Customer/i })).toBeInTheDocument();
    });

    fireEvent.keyDown(searchInput, { key: "ArrowDown" });
    fireEvent.keyDown(searchInput, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Beta Customer")).toBeInTheDocument();
      expect(screen.getByText("B-88")).toBeInTheDocument();
    });
  });
});
