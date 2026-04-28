"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { formatCurrency, todayISO } from "@/lib/thai-utils";
import {
  formatCustomerDisplay,
  useShowCustomerIdWithName,
} from "@/lib/customer-display";
import { SHORT_TERM_CREDIT_LABEL, UNPAID_STATUS_LABEL } from "@/lib/customer-credit-labels";
import { computeFinancialTotals } from "@/lib/financial-totals";

interface Transaction {
  id: number;
  customerId: number;
  billNumber?: string;
  internalReference?: string;
  printedBillNumber?: number | null;
  totalAmount: number;
  paid: number;
  status: string;
  transactionKind?: string | null;
  saleDate: string;
  saleTime: string;
  customer: { id: number; name: string };
  items: {
    productType: { name: string };
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }[];
}

export default function UserTransactionsPage() {
  const showCustomerIdWithName = useShowCustomerIdWithName();
  const [txList, setTxList] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const today = todayISO();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/transactions?startDate=${today}&endDate=${today}`
      );
      const data: Transaction[] = await res.json();
      setTxList(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  }, [load]);

  const activeTx = useMemo(() => txList.filter((t) => t.status !== "voided"), [txList]);

  // Aggregate totals
  const totals = useMemo(
    () =>
      computeFinancialTotals(
        activeTx.map((t) => ({
          status: t.status,
          transactionKind: t.transactionKind,
          totalAmount: t.totalAmount,
          paid: t.paid,
        })),
        { includeTransferOut: true }
      ),
    [activeTx]
  );

  // Product type summary
  const productSummary = useMemo(() => {
    const map: Record<string, number> = {};
    for (const tx of activeTx) {
      for (const item of tx.items) {
        const name = item.productType.name;
        map[name] = (map[name] || 0) + item.quantity;
      }
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [activeTx]);

  return (
    <div className="px-3 py-2">
      {/* Header with count */}
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-sm font-bold text-gray-800">วันนี้</h2>
        <span className="text-xs text-gray-400 ml-1">{activeTx.length} รายการ</span>
      </div>

      {/* Cash / Credit / Total summary cards */}
      <div className="grid grid-cols-3 gap-2 mb-2">
        <div className="bg-green-50 border border-green-200 rounded-lg px-2.5 py-1.5 text-center">
          <div className="text-[10px] text-green-600 font-medium">เงินสดสุทธิ</div>
          <div className="text-sm font-bold text-green-700">{formatCurrency(totals.netCash)}</div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5 text-center">
          <div className="text-[10px] text-red-500 font-medium">{SHORT_TERM_CREDIT_LABEL}</div>
          <div className="text-sm font-bold text-red-600">{formatCurrency(totals.outstandingDebt)}</div>
        </div>
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-2.5 py-1.5 text-center">
          <div className="text-[10px] text-indigo-600 font-medium">เครดิตฝั่งคืน</div>
          <div className="text-sm font-bold text-indigo-700">{formatCurrency(totals.refundBalance)}</div>
        </div>
      </div>

      {/* Product type summary pills */}
      {productSummary.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-2 mb-2 scrollbar-hide">
          {productSummary.map(([name, qty]) => (
            <span
              key={name}
              className="flex-shrink-0 text-[11px] bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2.5 py-0.5 font-medium whitespace-nowrap"
            >
              {name} <span className="text-blue-500">x{qty}</span>
            </span>
          ))}
        </div>
      )}

      {/* Column headers */}
      {activeTx.length > 0 && (
        <div className="flex items-center gap-1 px-3 pb-1 text-[10px] text-gray-400 font-medium">
          <span className="w-10 flex-shrink-0">เวลา</span>
          <span className="flex-1 min-w-0">ลูกค้า</span>
          <span className="w-14 text-right text-green-600">เงินสดสุทธิ</span>
          <span className="w-14 text-right text-red-500">ค้าง/คืน</span>
          <span className="w-14 text-right">ยอดสุทธิ</span>
          <span className="w-3 flex-shrink-0"></span>
        </div>
      )}

      {/* Transaction list */}
      {loading && txList.length === 0 ? (
        <p className="text-center text-gray-400 text-sm py-8">กำลังโหลด...</p>
      ) : txList.length === 0 ? (
        <p className="text-center text-gray-400 text-sm py-8">
          ยังไม่มีรายการวันนี้
        </p>
      ) : (
        <div className="space-y-0.5">
          {txList.map((tx) => {
            const expanded = expandedId === tx.id;
            const isVoided = tx.status === "voided";
            const rowTotals = computeFinancialTotals(
              [
                {
                  status: tx.status,
                  transactionKind: tx.transactionKind,
                  totalAmount: tx.totalAmount,
                  paid: tx.paid,
                },
              ],
              { includeTransferOut: true }
            );
            const cashAmt = rowTotals.netCash;
            const creditAmt =
              rowTotals.outstandingDebt > 0
                ? rowTotals.outstandingDebt
                : rowTotals.refundBalance > 0
                  ? -rowTotals.refundBalance
                  : 0;
            return (
              <div
                key={tx.id}
                className={`bg-white border rounded-lg overflow-hidden ${isVoided ? "opacity-40" : ""}`}
              >
                {/* Compact row */}
                <button
                  className="w-full flex items-center gap-1 px-3 py-2 text-left"
                  onClick={() => setExpandedId(expanded ? null : tx.id)}
                >
                  {/* Time */}
                  <span className="text-[11px] text-gray-400 font-mono w-10 flex-shrink-0">
                    {tx.saleTime?.slice(0, 5)}
                  </span>
                  {/* Customer */}
                  <span className="text-xs font-medium text-gray-800 truncate flex-1 min-w-0">
                    {formatCustomerDisplay(
                      tx.customer.id,
                      tx.customer.name,
                      showCustomerIdWithName
                    )}
                  </span>
                  {/* Cash - green */}
                  <span className={`w-14 text-right text-xs font-medium flex-shrink-0 ${cashAmt !== 0 ? "text-green-700" : "text-gray-200"}`}>
                    {cashAmt !== 0 ? formatCurrency(cashAmt) : "-"}
                  </span>
                  {/* Credit / Refund */}
                  <span className={`w-14 text-right text-xs font-medium flex-shrink-0 ${creditAmt > 0 ? "text-red-600" : creditAmt < 0 ? "text-indigo-700" : "text-gray-200"}`}>
                    {creditAmt !== 0 ? formatCurrency(creditAmt) : "-"}
                  </span>
                  {/* Total */}
                  <span className="w-14 text-right text-xs font-bold text-gray-900 flex-shrink-0">
                    {formatCurrency(rowTotals.netSales)}
                  </span>
                  {/* Expand chevron */}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`text-gray-300 transition-transform flex-shrink-0 ${expanded ? "rotate-90" : ""}`}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>

                {/* Expanded detail */}
                {expanded && (
                  <div className="border-t border-gray-100 px-3 py-2 bg-gray-50">
                    <div className="text-xs text-gray-500 mb-1.5 flex gap-3">
                      <span>{tx.billNumber || `#${tx.id}`}</span>
                      {tx.printedBillNumber != null && (
                        <span>{tx.internalReference || `Tx #${tx.id}`}</span>
                      )}
                      {tx.status === "partial" && (
                        <span className="text-orange-600">บางส่วน</span>
                      )}
                      {tx.status === "voided" && (
                        <span className="text-gray-400">ยกเลิก</span>
                      )}
                    </div>
                    {tx.items.length > 0 ? (
                      <table className="w-full text-xs">
                        <tbody>
                          {tx.items.map((item, i) => (
                            <tr
                              key={i}
                              className="border-b border-gray-100 last:border-0"
                            >
                              <td className="py-1 text-gray-700">
                                {item.productType.name}
                              </td>
                              <td className="py-1 text-right text-gray-500 w-8">
                                x{item.quantity}
                              </td>
                              <td className="py-1 text-right font-medium w-16">
                                {formatCurrency(item.subtotal)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-xs text-gray-400">
                        ไม่มีรายละเอียดสินค้า
                      </p>
                    )}
                    {!isVoided && (
                      <div className="mt-1.5 pt-1.5 border-t border-gray-200 text-xs">
                        <div className="flex justify-between">
                          <span className="text-gray-500">รวม</span>
                          <span className="font-bold">{formatCurrency(rowTotals.netSales)}</span>
                        </div>
                        {cashAmt !== 0 && (
                          <div className="flex justify-between text-green-700">
                            <span>เงินสดสุทธิ</span>
                            <span className="font-medium">{formatCurrency(cashAmt)}</span>
                          </div>
                        )}
                        {rowTotals.outstandingDebt > 0 && (
                          <div className="flex justify-between text-red-600">
                            <span>{UNPAID_STATUS_LABEL}</span>
                            <span className="font-medium">{formatCurrency(rowTotals.outstandingDebt)}</span>
                          </div>
                        )}
                        {rowTotals.refundBalance > 0 && (
                          <div className="flex justify-between text-indigo-700">
                            <span>เครดิตฝั่งคืน</span>
                            <span className="font-medium">{formatCurrency(rowTotals.refundBalance)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
