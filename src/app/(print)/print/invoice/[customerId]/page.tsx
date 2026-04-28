"use client";

import { useEffect, useState, use } from "react";
import { useSearchParams } from "next/navigation";
import { formatThaiDate, formatCurrency, formatNumber, todayISO } from "@/lib/thai-utils";

interface InvoiceProductType {
  id: number;
  name: string;
  hasBag: boolean;
}

interface InvoiceRow {
  seq: number;
  id: number;
  date: string;
  time: string;
  pool: number | null;
  row: number | null;
  col: number | null;
  status: string;
  totalAmount: number;
  paid: number;
  quantities: Record<number, number>;
  bagsOut: number;
  bagsReturned: number;
}

interface InvoiceSummary {
  totalsByProduct: Record<number, number>;
  grandTotal: number;
  totalPaid: number;
  totalUnpaid: number;
  totalBagsOut: number;
  totalBagsReturned: number;
  rowCount: number;
}

interface InvoiceData {
  customer: { id: number; name: string; phone: string | null };
  productTypes: InvoiceProductType[];
  rows: InvoiceRow[];
  summary: InvoiceSummary;
}

function formatTime(t: string): string {
  if (!t) return "-";
  const parts = t.split(":");
  return `${parts[0]}:${parts[1]}`;
}

export default function InvoicePrintPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = use(params);
  const searchParams = useSearchParams();
  const startDate = searchParams.get("start") || todayISO();
  const endDate = searchParams.get("end") || todayISO();

  const [data, setData] = useState<InvoiceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const params = new URLSearchParams({
          type: "customerInvoice",
          customerId,
          startDate,
          endDate,
        });
        const res = await fetch(`/api/reports?${params}`);
        const invoiceData: InvoiceData = await res.json();
        setData(invoiceData);
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [customerId, startDate, endDate]);

  // Auto-print
  useEffect(() => {
    if (data && !loading && data.rows.length > 0) {
      const timer = setTimeout(() => window.print(), 500);
      return () => clearTimeout(timer);
    }
  }, [data, loading]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">กำลังโหลด...</p>
      </div>
    );
  }

  if (!data || data.rows.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">ไม่พบข้อมูลใบวางบิล</p>
      </div>
    );
  }

  const pts = data.productTypes;
  const rows = data.rows;
  const summary = data.summary;

  return (
    <div className="w-full max-w-none min-w-0 print:max-w-none invoice-print-root">
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 10mm;
          }

          .invoice-print-root {
            width: 100% !important;
          }

          .invoice-print-sheet {
            border: 0 !important;
          }

          .invoice-print-content {
            padding: 0 !important;
          }

          .invoice-print-table {
            width: 100% !important;
            table-layout: fixed !important;
            font-size: 12.4px !important;
            line-height: 1.18 !important;
          }

          .invoice-print-table th,
          .invoice-print-table td {
            font-size: 12.4px !important;
            line-height: 1.18 !important;
            padding: 2px 2px !important;
            vertical-align: middle !important;
          }

          .invoice-print-time {
            width: 11mm !important;
          }

          .invoice-print-seq {
            width: 10mm !important;
          }

          .invoice-print-location {
            width: 11mm !important;
          }

          .invoice-print-hide-location {
            display: none !important;
          }

          .invoice-print-qty {
            width: 8.2mm !important;
          }

          .invoice-print-status-col {
            width: 11mm !important;
          }

          .invoice-print-money-col {
            width: 14mm !important;
          }

          .invoice-print-money {
            font-size: 14px !important;
            line-height: 1.05 !important;
            font-variant-numeric: tabular-nums;
          }
        }
      `}</style>
      <div className="max-w-[210mm] mx-auto p-6 text-sm">
      {/* Print controls */}
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

      <div className="border border-gray-200 rounded-md p-4 flex flex-col gap-4 min-h-[257mm] invoice-print-sheet">
        {/* Top-left bill + customer info */}
        <div className="text-xs space-y-1 invoice-print-content">
          <p className="text-base font-bold">ใบวางบิล</p>
          <p><span className="font-semibold">ลูกค้า:</span> {data.customer.name}</p>
          {data.customer.phone && (
            <p><span className="font-semibold">โทร:</span> {data.customer.phone}</p>
          )}
          <p><span className="font-semibold">ช่วงวันที่:</span> {formatThaiDate(startDate)} - {formatThaiDate(endDate)}</p>
          <p><span className="font-semibold">พิมพ์เมื่อ:</span> {formatThaiDate(todayISO())}</p>
        </div>

        {/* Invoice table */}
        <table className="w-full text-[10px] border-collapse invoice-print-table">
          <thead>
            <tr className="border-b-2 border-gray-400">
              <th className="text-left py-2 px-1">วัน</th>
              <th className="text-left py-2 px-1 invoice-print-time">เวลา</th>
              <th className="text-center py-2 px-1 invoice-print-seq">ที่</th>
              <th className="text-center py-2 px-1 invoice-print-location invoice-print-hide-location">ที่โหลด</th>
              {pts.map((pt) => (
                <th key={pt.id} className="text-center py-2 px-1 invoice-print-qty">{pt.name}</th>
              ))}
              <th className="text-center py-2 px-1 invoice-print-qty">ถุงออก</th>
              <th className="text-center py-2 px-1 invoice-print-qty">คืนถุง</th>
              <th className="text-center py-2 px-1 invoice-print-status-col">สถานะ</th>
              <th className="text-right py-2 px-1 invoice-print-money-col">ราคา</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const prevRow = idx > 0 ? rows[idx - 1] : null;
              const showDate = !prevRow || prevRow.date !== row.date;
              return (
                <tr key={row.id} className={`border-b border-gray-200 ${row.status === "unpaid" ? "font-semibold" : ""}`}>
                  <td className="py-1 px-1">{showDate ? formatThaiDate(row.date) : ""}</td>
                  <td className="py-1 px-1 invoice-print-time">{formatTime(row.time)}</td>
                  <td className="py-1 px-1 text-center invoice-print-seq">{row.seq}</td>
                  <td className="py-1 px-1 text-center invoice-print-location invoice-print-hide-location">{row.pool && row.row ? `${row.pool}-${row.row}` : ""}</td>
                  {pts.map((pt) => (
                    <td key={pt.id} className="py-1 px-1 text-center invoice-print-qty">
                      {row.quantities[pt.id] ? formatNumber(row.quantities[pt.id]) : ""}
                    </td>
                  ))}
                  <td className="py-1 px-1 text-center invoice-print-qty">{row.bagsOut > 0 ? formatNumber(row.bagsOut) : ""}</td>
                  <td className="py-1 px-1 text-center invoice-print-qty">{row.bagsReturned > 0 ? formatNumber(row.bagsReturned) : ""}</td>
                  <td className="py-1 px-1 text-center invoice-print-status-col">{row.status === "paid" ? "ชำระ" : row.status === "unpaid" ? "ค้าง" : "บางส่วน"}</td>
                  <td className="py-1 px-1 text-right font-medium invoice-print-money invoice-print-money-col">{formatCurrency(row.totalAmount)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-400 font-bold">
              <td className="py-2 px-1 print:hidden" colSpan={4}>รวม ({summary.rowCount} รายการ)</td>
              <td className="hidden py-2 px-1 print:table-cell" colSpan={3}>รวม ({summary.rowCount} รายการ)</td>
              {pts.map((pt) => (
                <td key={pt.id} className="py-2 px-1 text-center invoice-print-qty">
                  {(summary.totalsByProduct[pt.id] || 0) > 0 ? formatNumber(summary.totalsByProduct[pt.id]) : ""}
                </td>
              ))}
              <td className="py-2 px-1 text-center invoice-print-qty">{summary.totalBagsOut > 0 ? formatNumber(summary.totalBagsOut) : ""}</td>
              <td className="py-2 px-1 text-center invoice-print-qty">{summary.totalBagsReturned > 0 ? formatNumber(summary.totalBagsReturned) : ""}</td>
              <td className="py-2 px-1"></td>
              <td className="py-2 px-1 text-right invoice-print-money invoice-print-money-col">{formatCurrency(summary.grandTotal)}</td>
            </tr>
          </tfoot>
        </table>

        {/* Bottom-right summary */}
        <div className="mt-auto flex justify-end">
          <div className="w-[84mm] border rounded-md p-3 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-600">ยอดรวมทั้งหมด</span>
              <span className="font-bold">{formatCurrency(summary.grandTotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-green-700">ชำระแล้ว</span>
              <span className="font-bold text-green-700">{formatCurrency(summary.totalPaid)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-red-600">ค้างชำระ</span>
              <span className="font-bold text-red-600">{formatCurrency(summary.totalUnpaid)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-blue-700">ถุงค้าง</span>
              <span className="font-bold text-blue-700">{formatNumber(summary.totalBagsOut - summary.totalBagsReturned)}</span>
            </div>
          </div>
        </div>
      </div>

      </div>
    </div>
  );
}
