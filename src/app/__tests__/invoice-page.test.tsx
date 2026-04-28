import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InvoiceWorkspacePage from "@/app/(dashboard)/invoice/page";

let currentSearchParams = new URLSearchParams();

const generatedInvoiceRows = [
  {
    id: 11,
    invoiceNo: "INV-001",
    customerId: 101,
    customerName: "Alpha Retail",
    periodStart: "2026-03-01",
    periodEnd: "2026-03-31",
    status: "draft",
    displayStatus: "draft",
    grandTotal: 1250,
    paidTotal: 0,
    outstandingTotal: 1250,
    issueDate: null,
    dueDate: null,
    createdAt: "2026-03-31T08:00:00.000Z",
    updatedAt: "2026-03-31T08:10:00.000Z",
  },
  {
    id: 12,
    invoiceNo: "INV-002",
    customerId: 202,
    customerName: "Bearing Shop",
    periodStart: "2026-04-01",
    periodEnd: "2026-04-15",
    status: "issued",
    displayStatus: "partially_paid",
    grandTotal: 3400,
    paidTotal: 900,
    outstandingTotal: 2500,
    issueDate: "2026-04-16",
    dueDate: "2026-04-23",
    createdAt: "2026-04-16T08:00:00.000Z",
    updatedAt: "2026-04-18T09:30:00.000Z",
  },
];

function generatedInvoiceDetail(id: number) {
  if (id === 12) {
    return {
      invoice: {
        id: 12,
        invoiceNo: "INV-002",
        status: "issued",
        displayStatus: "partially_paid",
        periodStart: "2026-04-01",
        periodEnd: "2026-04-15",
        vatEnabled: false,
        vatRate: 0.07,
        subtotal: 3400,
        vatAmount: 0,
        grandTotal: 3400,
        paidTotal: 900,
        outstandingTotal: 2500,
        notes: null,
        voidReason: null,
        generatedAt: "2026-04-16T08:00:00.000Z",
        sentAt: "2026-04-16T10:00:00.000Z",
        paidAt: null,
        issueDate: "2026-04-16",
        dueDate: "2026-04-23",
      },
      customer: { id: 202, name: "Bearing Shop", phone: null },
      payments: [],
      timeline: [
        {
          event: "Issued",
          at: "2026-04-16T10:00:00.000Z",
          userId: 1,
          userName: "Admin",
          detail: "Marked as sent",
        },
      ],
      lines: [],
    };
  }

  return {
    invoice: {
      id: 11,
      invoiceNo: "INV-001",
      status: "draft",
      displayStatus: "draft",
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      vatEnabled: false,
      vatRate: 0.07,
      subtotal: 1250,
      vatAmount: 0,
      grandTotal: 1250,
      paidTotal: 0,
      outstandingTotal: 1250,
      notes: null,
      voidReason: null,
      generatedAt: "2026-03-31T08:00:00.000Z",
      sentAt: null,
      paidAt: null,
      issueDate: null,
      dueDate: null,
    },
    customer: { id: 101, name: "Alpha Retail", phone: null },
    payments: [],
    timeline: [
      {
        event: "Draft",
        at: "2026-03-31T08:00:00.000Z",
        userId: 1,
        userName: "Admin",
        detail: "Draft created",
      },
    ],
    lines: [],
  };
}

vi.mock("next/navigation", () => ({
  useSearchParams: () => currentSearchParams,
}));

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("invoice workspace page", () => {
  beforeEach(() => {
    currentSearchParams = new URLSearchParams("tab=new&startDate=2026-03-01&endDate=2026-03-31");
    delete process.env.NEXT_PUBLIC_INVOICE_DUPLICATE_WORKFLOW;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        if (url.includes("/api/auth")) {
          return jsonResponse({ role: "admin" });
        }
        if (url.includes("/api/factory")) {
          return jsonResponse({ current: "si", factories: [{ key: "si", name: "SI" }] });
        }
        if (url.includes("/api/invoices?")) {
          return jsonResponse({
            rows: [],
            meta: { total: 0, limit: 20, offset: 0, hasMore: false },
          });
        }
        if (url.includes("/api/customers")) {
          return jsonResponse([]);
        }

        return jsonResponse({});
      })
    );
    window.scrollTo = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps composer dates editable after hydrating them from the url", async () => {
    const { container } = render(<InvoiceWorkspacePage />);
    const dateInputs = container.querySelectorAll("input[type='date']");
    const startInput = dateInputs[0] as HTMLInputElement;
    const endInput = dateInputs[1] as HTMLInputElement;

    expect(screen.queryByText("Invoice Notes")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Optional notes")).not.toBeInTheDocument();
    expect(
      screen.queryByText("หากเป็นรายการวันนี้ ให้บันทึกจากหน้าขายปกติ")
    ).not.toBeInTheDocument();

    await waitFor(() => {
      expect(startInput.value).toBe("2026-03-01");
      expect(endInput.value).toBe("2026-03-31");
    });

    fireEvent.change(startInput, { target: { value: "2026-02-15" } });
    fireEvent.change(endInput, { target: { value: "2026-02-16" } });

    await waitFor(() => {
      expect(startInput.value).toBe("2026-02-15");
      expect(endInput.value).toBe("2026-02-16");
    });
  });

  it("shows the Bearing Discounts tab only for the Bearing factory", async () => {
    currentSearchParams = new URLSearchParams("tab=generated");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        if (url.includes("/api/auth")) {
          return jsonResponse({ role: "admin" });
        }
        if (url.includes("/api/factory")) {
          return jsonResponse({ current: "bearing", factories: [{ key: "bearing", name: "Bearing" }] });
        }
        if (url.includes("/api/invoices/bearing-discounts")) {
          return jsonResponse({
            factoryKey: "bearing",
            startDate: "2026-04-26",
            endDate: "2026-04-26",
            rowCount: 0,
            grandTotalDiscount: 0,
            rows: [],
            dailyTotals: [],
          });
        }
        if (url.includes("/api/invoices?")) {
          return jsonResponse({
            rows: [],
            meta: { total: 0, limit: 20, offset: 0, hasMore: false },
          });
        }
        if (url.includes("/api/customers")) {
          return jsonResponse([]);
        }

        return jsonResponse({});
      })
    );

    render(<InvoiceWorkspacePage />);

    expect(await screen.findByRole("button", { name: "Bearing Discounts" })).toBeInTheDocument();
  });

  it("hides the Bearing Discounts tab for non-Bearing factories", async () => {
    render(<InvoiceWorkspacePage />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/factory");
    });
    expect(screen.queryByRole("button", { name: "Bearing Discounts" })).not.toBeInTheDocument();
  });

  it("renders a generated invoice ledger with workflow actions", async () => {
    currentSearchParams = new URLSearchParams("tab=generated");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        if (url.includes("/api/auth")) {
          return jsonResponse({ role: "admin" });
        }
        if (url.includes("/api/factory")) {
          return jsonResponse({ current: "si", factories: [{ key: "si", name: "SI" }] });
        }
        if (url.includes("/api/invoices?")) {
          return jsonResponse({
            rows: generatedInvoiceRows,
            meta: { total: generatedInvoiceRows.length, limit: 20, offset: 0, hasMore: false },
          });
        }
        if (url.includes("/api/invoices/11")) {
          return jsonResponse(generatedInvoiceDetail(11));
        }
        if (url.includes("/api/invoices/12")) {
          return jsonResponse(generatedInvoiceDetail(12));
        }
        if (url.includes("/api/customers")) {
          return jsonResponse([]);
        }

        return jsonResponse({});
      })
    );

    render(<InvoiceWorkspacePage />);

    expect(await screen.findByText("Invoice No.")).toBeInTheDocument();
    expect(screen.getByText("Billing Period")).toBeInTheDocument();
    expect(screen.getByText("Outstanding")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Draft/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sent/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Paid/i }).length).toBeGreaterThan(0);
    expect(await screen.findByText("Draft created")).toBeInTheDocument();
  });

  it("updates the bottom invoice detail when a different ledger row is selected", async () => {
    currentSearchParams = new URLSearchParams("tab=generated");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        if (url.includes("/api/auth")) {
          return jsonResponse({ role: "admin" });
        }
        if (url.includes("/api/factory")) {
          return jsonResponse({ current: "si", factories: [{ key: "si", name: "SI" }] });
        }
        if (url.includes("/api/invoices?")) {
          return jsonResponse({
            rows: generatedInvoiceRows,
            meta: { total: generatedInvoiceRows.length, limit: 20, offset: 0, hasMore: false },
          });
        }
        if (url.includes("/api/invoices/11")) {
          return jsonResponse(generatedInvoiceDetail(11));
        }
        if (url.includes("/api/invoices/12")) {
          return jsonResponse(generatedInvoiceDetail(12));
        }
        if (url.includes("/api/customers")) {
          return jsonResponse([]);
        }

        return jsonResponse({});
      })
    );

    render(<InvoiceWorkspacePage />);

    expect(await screen.findByText("Draft created")).toBeInTheDocument();

    fireEvent.click(screen.getByText("INV-002"));

    expect(await screen.findByText("Marked as sent")).toBeInTheDocument();
  });

  it("applies the status pill filter immediately", async () => {
    currentSearchParams = new URLSearchParams("tab=generated");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes("/api/auth")) {
        return jsonResponse({ role: "admin" });
      }
      if (url.includes("/api/factory")) {
        return jsonResponse({ current: "si", factories: [{ key: "si", name: "SI" }] });
      }
      if (url.includes("/api/invoices/11")) {
        return jsonResponse(generatedInvoiceDetail(11));
      }
      if (url.includes("/api/invoices?")) {
        return jsonResponse({
          rows: generatedInvoiceRows,
          meta: { total: generatedInvoiceRows.length, limit: 20, offset: 0, hasMore: false },
        });
      }
      if (url.includes("/api/customers")) {
        return jsonResponse([]);
      }

      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<InvoiceWorkspacePage />);

    await screen.findByText("Invoice No.");

    fireEvent.click(screen.getByRole("button", { name: "Void" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/invoices?"));
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("status=void"));
    });
  });

  it("confirms before issuing when transactions already exist in another active invoice", async () => {
    currentSearchParams = new URLSearchParams("tab=generated");
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmMock);

    const issuedInvoiceDetail = {
      ...generatedInvoiceDetail(11),
      invoice: {
        ...generatedInvoiceDetail(11).invoice,
        status: "issued",
        displayStatus: "issued",
        sentAt: "2026-03-31T09:00:00.000Z",
        issueDate: "2026-03-31",
      },
      timeline: [
        ...generatedInvoiceDetail(11).timeline,
        {
          event: "Issued",
          at: "2026-03-31T09:00:00.000Z",
          userId: 1,
          userName: "Admin",
          detail: "Marked as sent",
        },
      ],
    };

    let issueAttemptCount = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes("/api/auth")) {
        return jsonResponse({ role: "admin" });
      }
      if (url.includes("/api/factory")) {
        return jsonResponse({ current: "si", factories: [{ key: "si", name: "SI" }] });
      }
      if (url.includes("/api/invoices?")) {
        return jsonResponse({
          rows: generatedInvoiceRows,
          meta: { total: generatedInvoiceRows.length, limit: 20, offset: 0, hasMore: false },
        });
      }
      if (url.includes("/api/invoices/11/issue")) {
        issueAttemptCount += 1;
        if (issueAttemptCount === 1) {
          return jsonResponse(
            {
              error: "Some transactions already exist in an active invoice",
              conflicts: [
                {
                  transactionId: 101,
                  invoiceId: 88,
                  invoiceNo: "INV-SI-2026-00088",
                },
              ],
            },
            409
          );
        }

        expect(init?.body).toBe(JSON.stringify({ allowDuplicateActiveInvoice: true }));
        return jsonResponse({ id: 11, invoiceNo: "INV-001", status: "issued" });
      }
      if (url.includes("/api/invoices/11")) {
        return issueAttemptCount >= 2 ? jsonResponse(issuedInvoiceDetail) : jsonResponse(generatedInvoiceDetail(11));
      }
      if (url.includes("/api/customers")) {
        return jsonResponse([]);
      }

      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<InvoiceWorkspacePage />);

    expect(await screen.findByText("Draft created")).toBeInTheDocument();

    fireEvent.click(screen.getByText("ส่งใบวางบิลให้ลูกค้า").closest("button") as HTMLButtonElement);

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledWith(
        expect.stringContaining("INV-SI-2026-00088 (invoice #88)")
      );
    });

    await waitFor(() => {
      expect(issueAttemptCount).toBe(2);
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/invoices/11/issue",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ allowDuplicateActiveInvoice: true }),
        })
      );
    });

    expect(await screen.findByText("Marked as sent")).toBeInTheDocument();
  });

  it("restores strict issue behavior without showing the duplicate confirmation popup", async () => {
    process.env.NEXT_PUBLIC_INVOICE_DUPLICATE_WORKFLOW = "strict";
    currentSearchParams = new URLSearchParams("tab=generated");
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmMock);

    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes("/api/auth")) {
        return jsonResponse({ role: "admin" });
      }
      if (url.includes("/api/factory")) {
        return jsonResponse({ current: "si", factories: [{ key: "si", name: "SI" }] });
      }
      if (url.includes("/api/invoices?")) {
        return jsonResponse({
          rows: generatedInvoiceRows,
          meta: { total: generatedInvoiceRows.length, limit: 20, offset: 0, hasMore: false },
        });
      }
      if (url.includes("/api/invoices/11/issue")) {
        expect(init?.body).toBe(JSON.stringify({ allowDuplicateActiveInvoice: false }));
        return jsonResponse(
          {
            error: "Some transactions already exist in an active invoice",
            conflicts: [
              {
                transactionId: 101,
                invoiceId: 88,
                invoiceNo: "INV-SI-2026-00088",
              },
            ],
          },
          409
        );
      }
      if (url.includes("/api/invoices/11")) {
        return jsonResponse(generatedInvoiceDetail(11));
      }
      if (url.includes("/api/customers")) {
        return jsonResponse([]);
      }

      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<InvoiceWorkspacePage />);

    expect(await screen.findByText("Draft created")).toBeInTheDocument();

    fireEvent.click(screen.getByText("ส่งใบวางบิลให้ลูกค้า").closest("button") as HTMLButtonElement);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/invoices/11/issue",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ allowDuplicateActiveInvoice: false }),
        })
      );
    });

    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("shows the empty generated invoice state when no invoices match", async () => {
    currentSearchParams = new URLSearchParams("tab=generated");

    render(<InvoiceWorkspacePage />);

    expect(await screen.findByText("ไม่พบใบวางบิลตามเงื่อนไขที่เลือก")).toBeInTheDocument();
    expect(
      screen.getByText("เลือกใบวางบิลจากตารางด้านบนเพื่อดู workflow สรุปข้อมูล และปุ่มจัดการ")
    ).toBeInTheDocument();
  });

  it("renders Bearing discount rows and daily totals from the report", async () => {
    currentSearchParams = new URLSearchParams("tab=bearingDiscounts");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        if (url.includes("/api/auth")) {
          return jsonResponse({ role: "admin" });
        }
        if (url.includes("/api/factory")) {
          return jsonResponse({ current: "bearing", factories: [{ key: "bearing", name: "Bearing" }] });
        }
        if (url.includes("/api/invoices/bearing-discounts")) {
          return jsonResponse({
            factoryKey: "bearing",
            startDate: "2026-04-26",
            endDate: "2026-04-26",
            rowCount: 1,
            grandTotalDiscount: 240,
            dailyTotals: [{ saleDate: "2026-04-26", discountAmount: 240, rowCount: 1 }],
            rows: [{
              transactionId: 501,
              billNumber: "0042",
              customerId: 88,
              customerName: "Bearing Shop",
              saleDate: "2026-04-26",
              saleTime: "08:30:00",
              originalSubtotal: 1670,
              discountAmount: 240,
              finalSubtotal: 1430,
            }],
          });
        }
        if (url.includes("/api/invoices?")) {
          return jsonResponse({
            rows: [],
            meta: { total: 0, limit: 20, offset: 0, hasMore: false },
          });
        }
        if (url.includes("/api/customers")) {
          return jsonResponse([]);
        }

        return jsonResponse({});
      })
    );

    render(<InvoiceWorkspacePage />);

    expect(await screen.findByText("0042")).toBeInTheDocument();
    expect(screen.getByText("88 | Bearing Shop")).toBeInTheDocument();
    expect(screen.getAllByText("240.00").length).toBeGreaterThan(0);
    expect(screen.getByText("1,670.00")).toBeInTheDocument();
    expect(screen.getByText("1,430.00")).toBeInTheDocument();
  });
});
