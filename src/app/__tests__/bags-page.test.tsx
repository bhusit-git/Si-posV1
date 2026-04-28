import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BagsPage from "@/app/(dashboard)/bags/page";

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("bags page search", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        if (url === "/api/bags") {
          return jsonResponse([
            {
              customerId: 1,
              customerName: "Zero Balance Customer",
              phone: "0812345678",
              totalOut: 10,
              totalReturn: 10,
              totalAdjust: 0,
              balance: 0,
            },
            {
              customerId: 2,
              customerName: "Outstanding Customer",
              phone: "0899999999",
              totalOut: 5,
              totalReturn: 0,
              totalAdjust: 0,
              balance: 5,
            },
          ]);
        }

        if (url.startsWith("/api/bags?customerId=")) {
          return jsonResponse([]);
        }

        return jsonResponse([]);
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps zero-balance customers searchable even when zero rows are hidden by default", async () => {
    render(<BagsPage />);

    await waitFor(() => {
      expect(screen.getByText("Outstanding Customer")).toBeInTheDocument();
    });

    expect(screen.queryByText("Zero Balance Customer")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Customer name or #id"), {
      target: { value: "Zero Balance" },
    });

    await waitFor(() => {
      expect(screen.getByText("Zero Balance Customer")).toBeInTheDocument();
    }, { timeout: 1000 });
  });

  it("shows Bangkok transaction time and links bill rows to transaction details", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "/api/bags") {
        return jsonResponse([
          {
            customerId: 2,
            customerName: "Outstanding Customer",
            phone: "0899999999",
            totalOut: 5,
            totalReturn: 0,
            totalAdjust: 0,
            balance: 5,
          },
        ]);
      }

      if (url.startsWith("/api/bags?customerId=2")) {
        return jsonResponse([
          {
            id: 10,
            type: "out",
            quantity: 5,
            note: null,
            createdAt: "2026-04-23T03:30:00.000Z",
            productType: { id: 1, name: "Bag" },
            transaction: { id: 207158, saleDate: "2026-04-23" },
          },
        ]);
      }

      return jsonResponse([]);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<BagsPage />);

    await waitFor(() => {
      expect(screen.getByText("Outstanding Customer")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Outstanding Customer"));

    const billLink = await screen.findByRole("link", { name: "บิล #207158" });

    expect(screen.getByText("10:30 น.")).toBeInTheDocument();
    expect(billLink).toHaveAttribute("href", "/transactions?transactionId=207158");
  });
});
