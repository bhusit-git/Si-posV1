"use client";

import { use, useEffect, useMemo, useState } from "react";
import { formatCurrency, formatNumber, formatThaiDate, todayISO } from "@/lib/thai-utils";
import {
  formatCustomerDisplay,
  useShowCustomerIdWithName,
} from "@/lib/customer-display";
import { getBagDisplayQuantities } from "@/lib/bag-flow";
import { computeFinancialTotals } from "@/lib/financial-totals";

type InvoiceStatus = "draft" | "issued" | "paid" | "void";

interface InvoiceDetailResponse {
  invoice: {
    id: number;
    invoiceNo: string | null;
    status: InvoiceStatus;
    periodStart: string;
    periodEnd: string;
    subtotal: number;
    vatEnabled: boolean;
    vatRate: number;
    vatAmount: number;
    grandTotal: number;
    paidTotal: number;
    outstandingTotal: number;
    generatedAt: string;
    sentAt: string | null;
    paidAt: string | null;
  };
  customer: { id: number; name: string; phone?: string | null } | null;
  lines: Array<{
    id: number;
    transactionId: number;
    saleDate: string;
    saleTime: string;
    amount: number;
    lineType: "sale" | "return";
    transactionStatus: "paid" | "unpaid" | "partial" | "voided" | null;
    snapshot?: unknown;
    bagsOut?: number;
    bagsReturned?: number;
    bagsBought?: number;
    bagAdjustDelta?: number;
  }>;
}

interface ProductRow {
  id: number;
  name: string;
  sortOrder: number | null;
}

type DisplayRow = {
  transactionId: number;
  customerName: string;
  saleDate: string;
  saleTime: string;
  transactionStatus: string;
  quantities: Record<number, number>;
  bagsOut: number;
  bagsReturned: number;
  cashPaid: number;
  creditOwed: number;
  refundBalance: number;
  sumTotal: number;
};

function asFiniteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function hasFiniteNumber(value: unknown): boolean {
  return Number.isFinite(Number(value));
}

function formatTime(value: string): string {
  if (!value) return "-";
  return value.slice(0, 5);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("th-TH");
}

function formatPdfFilenameDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year.slice(-2)}`;
}

function buildInvoicePdfFilename(
  customerId: number | null | undefined,
  invoiceId: number,
  periodEnd: string
): string {
  const datePart = formatPdfFilenameDate(periodEnd);
  if (Number.isFinite(customerId) && Number(customerId) > 0) {
    return `${customerId}-${datePart}`;
  }
  return `invoice-${invoiceId}-${datePart}`;
}

function getCompactProductCode(name: string): string {
  const normalized = name
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ดล็ก/g, "เล็ก");

  if (normalized.includes("ซอง") && normalized.includes("โม่")) return "ซม";
  if (normalized.includes("ซอง") && normalized.includes("กั๊ก")) return "ซก";
  if (normalized === "ซอง" || normalized.includes("น้ำแข็งซอง")) return "ซ";
  if (normalized.includes("แพ็ค 20")) return "P20";
  if (normalized.includes("แพ็ค 15")) return "P15";
  if (normalized.includes("หลอดใหญ่") && normalized.includes("20")) return "ญ20";
  if (normalized.includes("หลอดเล็ก") && normalized.includes("20")) return "ล20";
  if (normalized.includes("หลอดใหญ่") && normalized.includes("โม่")) return "ญม";
  if (normalized.includes("หลอดเล็ก") && normalized.includes("โม่")) return "ลม";
  if (normalized.includes("ถุงใสหลอดใหญ่") && normalized.includes("20")) return "ถญ20";
  if (normalized.includes("ถุงใสหลอดเล็ก") && normalized.includes("20")) return "ถล20";
  if (normalized.includes("ถุงใสหลอดใหญ่") && normalized.includes("13")) return "ถญ13";
  if (normalized.includes("ถุงใสหลอดเล็ก") && normalized.includes("13")) return "ถล13";
  if (normalized.includes("ถุงใสป่น") && normalized.includes("20")) return "ถป20";
  if (normalized.includes("ถุงใสป่น") && normalized.includes("13")) return "ถป13";

  return normalized.replace(/[.\s()]/g, "").slice(0, 5) || normalized;
}

export default function GeneratedInvoicePrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const showCustomerIdWithName = useShowCustomerIdWithName();
  const { id } = use(params);
  const [data, setData] = useState<InvoiceDetailResponse | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [invoiceRes, productsRes] = await Promise.all([
          fetch(`/api/invoices/${id}`),
          fetch("/api/products"),
        ]);

        if (!invoiceRes.ok) {
          setData(null);
          return;
        }

        const invoiceData = (await invoiceRes.json()) as InvoiceDetailResponse;
        let productRows: ProductRow[] = [];
        if (productsRes.ok) {
          productRows = (await productsRes.json()) as ProductRow[];
        }

        if (!cancelled) {
          setData(invoiceData);
          setProducts(Array.isArray(productRows) ? productRows : []);
        }
      } catch {
        if (!cancelled) {
          setData(null);
          setProducts([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const rows = useMemo<DisplayRow[]>(() => {
    if (!data) return [];

    return data.lines
      .map((line) => {
        const snapshot =
          line.snapshot && typeof line.snapshot === "object"
            ? (line.snapshot as Record<string, unknown>)
            : null;

        const rawQuantities =
          snapshot && snapshot.quantities && typeof snapshot.quantities === "object"
            ? (snapshot.quantities as Record<string, unknown>)
            : {};

        const quantities: Record<number, number> = {};
        for (const [key, value] of Object.entries(rawQuantities)) {
          const productId = Number(key);
          if (!Number.isInteger(productId) || productId <= 0) continue;
          quantities[productId] = asFiniteNumber(value);
        }

        const hasSnapshotBagData =
          hasFiniteNumber(snapshot?.bagsOut) ||
          hasFiniteNumber(snapshot?.bagsReturned) ||
          hasFiniteNumber(snapshot?.bagsBought) ||
          hasFiniteNumber(snapshot?.bagAdjustDelta);

        const bagDisplay = hasSnapshotBagData
          ? getBagDisplayQuantities({
              bagsOut: hasFiniteNumber(snapshot?.bagsOut)
                ? asFiniteNumber(snapshot?.bagsOut)
                : 0,
              bagsReturned: hasFiniteNumber(snapshot?.bagsReturned)
                ? asFiniteNumber(snapshot?.bagsReturned)
                : 0,
              bagsBought: hasFiniteNumber(snapshot?.bagsBought)
                ? asFiniteNumber(snapshot?.bagsBought)
                : asFiniteNumber(line.bagsBought),
              bagAdjustDelta: hasFiniteNumber(snapshot?.bagAdjustDelta)
                ? asFiniteNumber(snapshot?.bagAdjustDelta)
                : asFiniteNumber(line.bagAdjustDelta),
            })
          : {
              bagsOut: asFiniteNumber(line.bagsOut),
              bagsReturned: asFiniteNumber(line.bagsReturned),
            };

        return {
          transactionId: line.transactionId,
          customerName:
            (snapshot?.customerName as string | undefined) || data.customer?.name || "-",
          saleDate:
            (snapshot?.saleDate as string | undefined) || line.saleDate || data.invoice.periodStart,
          saleTime: (snapshot?.saleTime as string | undefined) || line.saleTime || "00:00:00",
          transactionStatus:
            (snapshot?.transactionStatus as string | undefined) || line.transactionStatus || "-",
          quantities,
          ...bagDisplay,
          cashPaid: asFiniteNumber(snapshot?.cashPaid),
          creditOwed: asFiniteNumber(snapshot?.creditOwed),
          refundBalance: asFiniteNumber(snapshot?.refundBalance),
          sumTotal:
            snapshot && Number.isFinite(Number(snapshot.sumTotal))
              ? asFiniteNumber(snapshot.sumTotal)
              : asFiniteNumber(line.amount),
        };
      })
      .sort((a, b) => {
        const ta = `${a.saleDate} ${a.saleTime}`;
        const tb = `${b.saleDate} ${b.saleTime}`;
        if (ta !== tb) return ta.localeCompare(tb);
        return a.transactionId - b.transactionId;
      });
  }, [data]);

  const productColumns = useMemo(() => {
    const usedProductIds = new Set<number>();
    for (const row of rows) {
      for (const [productId, qty] of Object.entries(row.quantities)) {
        if (asFiniteNumber(qty) !== 0) usedProductIds.add(Number(productId));
      }
    }

    const byId = new Map<number, ProductRow>();
    for (const product of products) {
      byId.set(product.id, product);
    }

    return Array.from(usedProductIds)
      .map((id) => ({
        id,
        name: byId.get(id)?.name || `สินค้า #${id}`,
        sortOrder: byId.get(id)?.sortOrder ?? null,
      }))
      .sort((a, b) => {
        const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
        const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        if (a.id !== b.id) return a.id - b.id;
        return a.name.localeCompare(b.name, "th");
      });
  }, [products, rows]);

  const showCompactProductHeaders = productColumns.length > 5;

  const pdfFilename = useMemo(() => {
    if (!data) return "invoice";
    return buildInvoicePdfFilename(data.customer?.id, data.invoice.id, data.invoice.periodEnd);
  }, [data]);

  const totals = useMemo(() => {
    const totalsByProduct: Record<number, number> = {};
    for (const col of productColumns) totalsByProduct[col.id] = 0;

    const financialTotals = computeFinancialTotals(
      rows.map((row) => ({
        status: row.transactionStatus,
        totalAmount: row.sumTotal,
        paid: row.cashPaid,
      })),
      { includeTransferOut: true }
    );
    let totalBagsOut = 0;
    let totalBagsReturned = 0;

    for (const row of rows) {
      totalBagsOut += row.bagsOut;
      totalBagsReturned += row.bagsReturned;
      for (const col of productColumns) {
        totalsByProduct[col.id] += row.quantities[col.id] || 0;
      }
    }

    return {
      totalsByProduct,
      totalCashPaid: financialTotals.netCash,
      totalCreditOwed: financialTotals.outstandingDebt,
      totalRefundBalance: financialTotals.refundBalance,
      totalSum: financialTotals.netSales,
      totalBagsOut,
      totalBagsReturned,
      rowCount: rows.length,
    };
  }, [productColumns, rows]);

  useEffect(() => {
    if (!loading && data && rows.length > 0) {
      const timer = setTimeout(() => window.print(), 500);
      return () => clearTimeout(timer);
    }
  }, [data, loading, rows.length]);

  useEffect(() => {
    if (typeof document === "undefined" || !data) return;
    const previousTitle = document.title;
    document.title = pdfFilename;
    return () => {
      document.title = previousTitle;
    };
  }, [data, pdfFilename]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">กำลังโหลดตัวอย่างใบวางบิล...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">ไม่พบข้อมูลใบวางบิล</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-none min-w-0 print:max-w-none invoice-print-root">
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 10mm;
          }

          .invoice-print-sheet {
            border: 0 !important;
          }

          .invoice-print-content {
            padding: 0 !important;
          }

          .invoice-print-root {
            width: 100% !important;
          }

          .invoice-print-table {
            width: 100% !important;
            table-layout: fixed !important;
            font-size: 12px !important;
            line-height: 1.24 !important;
          }

          .invoice-print-table th,
          .invoice-print-table td {
            font-size: 12px !important;
            line-height: 1.24 !important;
            padding: 4px 6px !important;
            vertical-align: middle !important;
          }

          .invoice-print-date {
            width: 28mm !important;
          }

          .invoice-print-time {
            width: 15mm !important;
          }

          .invoice-print-qty {
            width: auto !important;
          }

          .invoice-print-bag-col {
            width: 14mm !important;
          }

          .invoice-print-money-col {
            width: 22mm !important;
          }

          .invoice-print-money {
            font-size: 12px !important;
            line-height: 1.1 !important;
            font-variant-numeric: tabular-nums;
          }

          .invoice-print-product-full {
            white-space: normal !important;
            line-height: 1.15 !important;
          }
        }
      `}</style>
      <div className="max-w-[210mm] mx-auto p-4 text-sm">
      <div className="print:hidden mb-4 flex gap-2">
        <button
          onClick={() => window.print()}
          className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
        >
          พิมพ์ / บันทึก PDF
        </button>
        <button
          onClick={() => window.history.back()}
          className="px-4 py-2 bg-gray-200 rounded text-sm hover:bg-gray-300"
        >
          กลับ
        </button>
      </div>

        <div className="w-full bg-white rounded-lg border border-gray-200 print:border-0 print:rounded-none invoice-print-sheet">
          <div className="p-6 print:p-4 invoice-print-content">
            <div className="text-center mb-4">
              <h1 className="text-2xl font-bold print:text-xl">ใบวางบิล</h1>
              <p className="text-sm text-gray-600 mt-1 print:text-xs">
                ช่วงบิล {formatThaiDate(data.invoice.periodStart)} - {formatThaiDate(data.invoice.periodEnd)}
              </p>
            </div>

            <div className="flex items-start justify-between gap-4 text-xs mb-4">
              <div className="space-y-1">
                <p><span className="font-semibold">เลขที่:</span> {data.invoice.invoiceNo || `Draft #${data.invoice.id}`}</p>
                <p>
                  <span className="font-semibold">ลูกค้า:</span>{" "}
                  {formatCustomerDisplay(
                    data.customer?.id,
                    data.customer?.name,
                    showCustomerIdWithName
                  )}
                </p>
                {data.customer?.phone ? <p><span className="font-semibold">โทร:</span> {data.customer.phone}</p> : null}
              </div>
              <div className="text-right space-y-1">
                <p><span className="font-semibold">สร้าง:</span> {formatDateTime(data.invoice.generatedAt)}</p>
                <p><span className="font-semibold">ส่ง:</span> {formatDateTime(data.invoice.sentAt)}</p>
                <p><span className="font-semibold">ชำระ:</span> {formatDateTime(data.invoice.paidAt)}</p>
              </div>
            </div>

            <div className="w-full overflow-x-auto print:overflow-visible">
              <table className="w-full min-w-max text-sm border-collapse print:text-[9px] invoice-print-table">
                <colgroup>
                  <col className="invoice-print-date" />
                  <col className="invoice-print-time" />
                  {productColumns.map((col) => (
                    <col key={col.id} className="invoice-print-qty" />
                  ))}
                  <col className="invoice-print-bag-col" />
                  <col className="invoice-print-bag-col" />
                  <col className="invoice-print-money-col" />
                </colgroup>
                <thead>
                  <tr className="border-b-2 border-gray-400">
                    <th className="text-left py-2 px-1 whitespace-nowrap invoice-print-date">วัน</th>
                    <th className="text-left py-2 px-1 whitespace-nowrap invoice-print-time">เวลา</th>
                    {productColumns.map((col, index) => (
                      <th
                        key={col.id}
                        className={`text-center py-2 px-1 invoice-print-qty ${showCompactProductHeaders ? "whitespace-nowrap" : "invoice-print-product-full"}`}
                      >
                        {showCompactProductHeaders ? (
                          <div
                            className="flex flex-col items-center gap-0.5 leading-none"
                            title={`${col.sortOrder ?? col.id}. ${col.name}`}
                          >
                            <span className="text-[10px] font-semibold">{col.sortOrder ?? index + 1}</span>
                            <span className="mt-0.5 text-[9px] text-slate-700">{getCompactProductCode(col.name)}</span>
                          </div>
                        ) : (
                          <div className="text-[10px] font-semibold leading-tight text-center">
                            {col.name}
                          </div>
                        )}
                      </th>
                    ))}
                    <th className="text-right py-2 px-1 whitespace-nowrap invoice-print-bag-col">ถุงออก</th>
                    <th className="text-right py-2 px-1 whitespace-nowrap invoice-print-bag-col">คืนถุง</th>
                    <th className="text-right py-2 px-1 whitespace-nowrap invoice-print-money-col">รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const prevRow = index > 0 ? rows[index - 1] : null;
                    const showDate = !prevRow || prevRow.saleDate !== row.saleDate;

                    return (
                      <tr key={row.transactionId} className="border-b border-gray-200">
                        <td className="py-1.5 px-1 whitespace-nowrap text-xs invoice-print-date">
                          {showDate ? formatThaiDate(row.saleDate) : ""}
                        </td>
                        <td className="py-1.5 px-1 whitespace-nowrap text-xs invoice-print-time">
                          {formatTime(row.saleTime)}
                        </td>
                        {productColumns.map((col) => (
                          <td key={col.id} className="py-1.5 px-1 text-center text-xs invoice-print-qty">
                            {row.quantities[col.id] ? formatNumber(row.quantities[col.id]) : ""}
                          </td>
                        ))}
                        <td className="py-1.5 px-1 text-right text-xs whitespace-nowrap invoice-print-bag-col">
                          {row.bagsOut ? formatNumber(row.bagsOut) : ""}
                        </td>
                        <td className="py-1.5 px-1 text-right text-xs whitespace-nowrap invoice-print-bag-col">
                          {row.bagsReturned ? formatNumber(row.bagsReturned) : ""}
                        </td>
                        <td className="py-1.5 px-1 text-right text-xs font-medium whitespace-nowrap invoice-print-money invoice-print-money-col">
                          {formatCurrency(row.sumTotal)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-400 font-bold bg-gray-50 print:bg-transparent">
                    <td className="py-2 px-1" colSpan={2}>รวม ({totals.rowCount} รายการ)</td>
                    {productColumns.map((col) => (
                      <td key={col.id} className="py-2 px-1 text-center invoice-print-qty">
                        {totals.totalsByProduct[col.id] ? formatNumber(totals.totalsByProduct[col.id]) : ""}
                      </td>
                    ))}
                    <td className="py-2 px-1 text-right whitespace-nowrap invoice-print-bag-col">
                      {totals.totalBagsOut ? formatNumber(totals.totalBagsOut) : ""}
                    </td>
                    <td className="py-2 px-1 text-right whitespace-nowrap invoice-print-bag-col">
                      {totals.totalBagsReturned ? formatNumber(totals.totalBagsReturned) : ""}
                    </td>
                    <td className="py-2 px-1 text-right whitespace-nowrap invoice-print-money invoice-print-money-col">
                      {formatCurrency(totals.totalSum)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="mt-3 text-center text-[10px] text-gray-500">
              พิมพ์เมื่อ {formatThaiDate(todayISO())}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
