"use client";

import { useEffect, useState, use } from "react";
import { useSearchParams } from "next/navigation";
import { formatThaiDate } from "@/lib/thai-utils";
import { loadOfflinePrintPayload } from "@/lib/offline-print-payload";
import {
  INVOICE_CREDIT_LABEL,
  isInvoiceCreditTransaction,
  maskCustomerPrintAmount,
  normalizeCustomerPrintAmount,
} from "@/lib/customer-credit-labels";
import { getSalePrintPaymentSummary } from "@/lib/sale-payment";
import {
  summarizeBagLedgerEntries,
  summarizeSaleBagFlow,
} from "@/lib/bag-flow";
import { startPrintWindowLifecycle } from "@/lib/print-window-lifecycle";

interface ReceiptData {
  id: number;
  customerId?: number;
  transactionKind?: "sale" | "transfer_out" | "return" | "adjustment" | null;
  totalAmount: number;
  paid: number;
  status: string;
  saleDate: string;
  saleTime: string;
  pool: number | null;
  row: number | null;
  col: number | null;
  bagBalanceBefore?: number;
  bagBalanceAfter?: number;
  hidePrintTotals?: boolean;
  customer: { id: number; name: string };
  items: {
    quantity: number;
    unitPrice: number;
    subtotal: number;
    productType: { name: string; hasBag: boolean; decreasesBag: boolean };
  }[];
  bagLedgerEntries?: {
    type: string;
    quantity: number;
    note: string | null;
  }[];
}

export default function ReceiptPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const offlineToken = searchParams.get("offlineToken");
  const hideTotalsFromQuery = searchParams.get("hideTotals") === "1";
  const minimalMode = searchParams.get("minimal") === "1";
  const autoCloseMode = searchParams.get("autoclose") === "1";
  const [data, setData] = useState<ReceiptData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const offlineData = loadOfflinePrintPayload(offlineToken) as ReceiptData | null;
      if (offlineData) {
        setData(offlineData);
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(`/api/transactions?id=${encodeURIComponent(id)}`);
        if (res.ok) {
          const tx: ReceiptData = await res.json();
          setData(tx);
        } else {
          setData(null);
        }
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id, offlineToken]);

  useEffect(() => {
    if (!data || loading) return;
    return startPrintWindowLifecycle(window, {
      autoClose: autoCloseMode,
    });
  }, [autoCloseMode, data, loading]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">กำลังโหลด...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">ไม่พบใบเสร็จ #{id}</p>
      </div>
    );
  }

  const activeItems = data.items.filter((i) => i.quantity > 0);
  const hideCustomerPrices = isInvoiceCreditTransaction(data.transactionKind);
  const hidePrintTotals = hideTotalsFromQuery || data.hidePrintTotals === true;
  const partialSummary = getSalePrintPaymentSummary({
    transactionKind: data.transactionKind,
    status: data.status,
    totalAmount: data.totalAmount,
    paid: data.paid,
  });
  const ledgerBagSummary = summarizeBagLedgerEntries(data.bagLedgerEntries || []);
  const itemBagFallback = summarizeSaleBagFlow({ items: activeItems });
  const bagsOut = ledgerBagSummary.bagsOut > 0 ? ledgerBagSummary.bagsOut : itemBagFallback.bagsOut;
  const bagsDecrease = ledgerBagSummary.bagsBought > 0 ? ledgerBagSummary.bagsBought : itemBagFallback.bagsBought;
  const bagsReturn = ledgerBagSummary.bagsReturned;
  const hasBagBalanceBefore = Number.isFinite(Number(data.bagBalanceBefore));
  const hasBagBalanceAfter = Number.isFinite(Number(data.bagBalanceAfter));
  const hasBagInfo =
    bagsOut > 0 ||
    bagsReturn > 0 ||
    bagsDecrease > 0 ||
    ledgerBagSummary.bagAdjustDelta !== 0 ||
    hasBagBalanceBefore ||
    hasBagBalanceAfter;

  return (
    <div className="max-w-[80mm] mx-auto p-4 font-[Sarabun,sans-serif] text-xs">
      {!minimalMode && (
        <div className="print:hidden mb-4 flex gap-2">
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
          >
            พิมพ์ใบเสร็จ
          </button>
          <button
            onClick={() => window.close()}
            className="px-4 py-2 bg-gray-200 rounded text-sm hover:bg-gray-300"
          >
            ปิด
          </button>
        </div>
      )}

      {/* Receipt content */}
      <div className="text-center mb-2">
        <h1 className="text-base font-bold">Super Ice (SI)</h1>
        <p className="text-[11px]">ใบเสร็จรับเงิน #{data.id}</p>
      </div>

      <div className="border-t border-dashed border-gray-400 my-2" />

      <div className="space-y-0.5">
        <p><strong>ลูกค้า:</strong> {data.customer.name}</p>
        <p><strong>วันที่:</strong> {formatThaiDate(data.saleDate)}</p>
        <p><strong>เวลา:</strong> {data.saleTime?.slice(0, 5)}</p>
        {hideCustomerPrices && (
          <p className="font-bold">** {INVOICE_CREDIT_LABEL} **</p>
        )}
        {data.status === "unpaid" && (
          <p className="font-bold">** ค้างชำระ **</p>
        )}
        {data.status === "partial" && (
          <p className="font-bold">** บางส่วน **</p>
        )}
        {data.pool && (
          <p><strong>ตำแหน่งโหลด:</strong> อาคาร {data.pool} ช่องจอด {data.row}</p>
        )}
      </div>

      <div className="border-t border-dashed border-gray-400 my-2" />

      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-300">
            <th className="text-left py-0.5">สินค้า</th>
            <th className="text-right py-0.5">จำนวน</th>
            <th className="text-right py-0.5">ราคา</th>
            <th className="text-right py-0.5">รวม</th>
          </tr>
        </thead>
        <tbody>
          {activeItems.map((item, i) => (
            <tr key={i} className="border-b border-dotted border-gray-200">
              <td className="py-0.5">{item.productType.name}</td>
              <td className="text-right py-0.5">{item.quantity}</td>
              <td className="text-right py-0.5">{maskCustomerPrintAmount(item.unitPrice, data.transactionKind, hidePrintTotals).toFixed(2)}</td>
              <td className="text-right py-0.5">{maskCustomerPrintAmount(item.subtotal, data.transactionKind, hidePrintTotals).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-800 font-bold text-sm">
            <td colSpan={3} className="py-1">รวมทั้งหมด</td>
            <td className="text-right py-1">{normalizeCustomerPrintAmount(data.totalAmount, data.transactionKind, hidePrintTotals).toFixed(2)}</td>
          </tr>
          {partialSummary && (
            <>
              <tr>
                <td colSpan={3} className="py-0.5">รับวันนี้</td>
                <td className="text-right py-0.5">{maskCustomerPrintAmount(partialSummary.paidNow, data.transactionKind, hidePrintTotals).toFixed(2)}</td>
              </tr>
              <tr className="font-bold">
                <td colSpan={3} className="py-0.5">ค้างเหลือ</td>
                <td className="text-right py-0.5">{maskCustomerPrintAmount(partialSummary.remainingAmount, data.transactionKind, hidePrintTotals).toFixed(2)}</td>
              </tr>
            </>
          )}
        </tfoot>
      </table>

      {hasBagInfo && (
        <>
          <div className="border-t border-dashed border-gray-400 my-2" />
          <div className="space-y-0.5">
            {bagsOut > 0 && (
              <div className="flex justify-between">
                <span>ถุงออก</span>
                <span>+{bagsOut} ใบ</span>
              </div>
            )}
            {bagsReturn > 0 && (
              <div className="flex justify-between">
                <span>ถุงคืน</span>
                <span>-{bagsReturn} ใบ</span>
              </div>
            )}
            {bagsDecrease > 0 && (
              <div className="flex justify-between">
                <span>ซื้อกระสอบ</span>
                <span>-{bagsDecrease} ใบ</span>
              </div>
            )}
            {hasBagBalanceBefore && (
              <div className="flex justify-between">
                <span>ถุงก่อนหน้า</span>
                <span>{Number(data.bagBalanceBefore)} ใบ</span>
              </div>
            )}
            <div className="flex justify-between font-bold border-t border-dotted border-gray-300 pt-0.5">
              <span>{hasBagBalanceAfter ? "ถุงค้าง" : "ถุงรวม"}</span>
              <span>
                {hasBagBalanceAfter
                  ? `${Number(data.bagBalanceAfter)} ใบ`
                  : `${bagsOut - bagsReturn - bagsDecrease} ใบ`}
              </span>
            </div>
          </div>
        </>
      )}

      <div className="border-t border-dashed border-gray-400 my-2" />

      <p className="text-center text-[10px] mt-3">ขอบคุณที่ใช้บริการ</p>

      {/* Print-specific styles */}
      <style jsx>{`
        @media print {
          @page {
            size: 80mm auto;
            margin: 5mm;
          }
        }
      `}</style>
    </div>
  );
}
