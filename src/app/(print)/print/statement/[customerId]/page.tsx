"use client";

import { useEffect, useState, use } from "react";
import { useSearchParams } from "next/navigation";
import { formatThaiDate, formatCurrency, todayISO } from "@/lib/thai-utils";

interface StatementEvent {
  date: string;
  time: string;
  type: "SALE" | "PAYMENT" | "RETURN" | "VOID";
  refId: number;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

interface StatementData {
  customer: { id: number; name: string; phone: string | null };
  startDate: string;
  endDate: string;
  openingBalance: number;
  closingBalance: number;
  totalDebits: number;
  totalCredits: number;
  events: StatementEvent[];
  eventCount: number;
}

const TYPE_LABELS: Record<string, string> = {
  SALE: "ขาย",
  PAYMENT: "ชำระเงิน",
  RETURN: "คืนสินค้า",
  VOID: "ยกเลิก",
};

const TYPE_COLORS: Record<string, string> = {
  SALE: "text-gray-900",
  PAYMENT: "text-green-700",
  RETURN: "text-blue-700",
  VOID: "text-red-600",
};

function formatTime(t: string): string {
  if (!t || t === "00:00:00") return "";
  const parts = t.split(":");
  return `${parts[0]}:${parts[1]}`;
}

export default function StatementPrintPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = use(params);
  const searchParams = useSearchParams();
  const startDate = searchParams.get("start") || (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  })();
  const endDate = searchParams.get("end") || todayISO();

  const [data, setData] = useState<StatementData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const params = new URLSearchParams({
          type: "customerStatement",
          customerId,
          startDate,
          endDate,
        });
        const res = await fetch(`/api/reports?${params}`);
        if (!res.ok) throw new Error("Failed to load");
        const json: StatementData = await res.json();
        setData(json);
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
    if (data && !loading && data.events.length > 0) {
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

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">ไม่สามารถโหลดข้อมูลได้</p>
      </div>
    );
  }

  return (
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

      {/* Statement header */}
      <div className="text-center mb-4">
        <h1 className="text-2xl font-bold">ใบแจ้งยอดบัญชี</h1>
        <p className="text-sm text-gray-600 mt-1">Customer Account Statement</p>
      </div>

      <div className="flex justify-between items-start mb-4 text-xs border-b border-gray-300 pb-3">
        <div>
          <p className="text-base font-bold">{data.customer.name}</p>
          {data.customer.phone && (
            <p className="text-gray-600">โทร: {data.customer.phone}</p>
          )}
          <p className="text-gray-600">รหัสลูกค้า: #{data.customer.id}</p>
        </div>
        <div className="text-right">
          <p><span className="font-semibold">ตั้งแต่วันที่:</span> {formatThaiDate(data.startDate)}</p>
          <p><span className="font-semibold">ถึงวันที่:</span> {formatThaiDate(data.endDate)}</p>
          <p className="mt-1 text-gray-500">พิมพ์เมื่อ {formatThaiDate(todayISO())}</p>
        </div>
      </div>

      {/* Opening balance */}
      <div className="flex justify-between items-center bg-gray-100 px-3 py-2 rounded text-xs font-medium mb-1">
        <span>ยอดยกมา (Opening Balance)</span>
        <span className={data.openingBalance > 0 ? "text-red-600 font-bold" : "font-bold"}>
          {formatCurrency(data.openingBalance)}
        </span>
      </div>

      {/* Statement table */}
      {data.events.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          ไม่มีรายการในช่วงวันที่ที่เลือก
        </div>
      ) : (
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="border-b-2 border-gray-400">
              <th className="text-left py-2 px-1 w-[70px]">วันที่</th>
              <th className="text-left py-2 px-1 w-[40px]">เวลา</th>
              <th className="text-center py-2 px-1 w-[60px]">ประเภท</th>
              <th className="text-left py-2 px-1 w-[40px]">บิล</th>
              <th className="text-left py-2 px-1">รายละเอียด</th>
              <th className="text-right py-2 px-1 w-[80px]">เดบิต (ซื้อ)</th>
              <th className="text-right py-2 px-1 w-[80px]">เครดิต (ชำระ)</th>
              <th className="text-right py-2 px-1 w-[80px]">คงเหลือ</th>
            </tr>
          </thead>
          <tbody>
            {data.events.map((event, idx) => {
              const prevEvent = idx > 0 ? data.events[idx - 1] : null;
              const showDate = !prevEvent || prevEvent.date !== event.date;
              return (
                <tr
                  key={`${event.type}-${event.refId}-${idx}`}
                  className={`border-b border-gray-200 ${event.type === "VOID" ? "line-through opacity-60" : ""}`}
                >
                  <td className="py-1 px-1 whitespace-nowrap">
                    {showDate ? formatThaiDate(event.date) : ""}
                  </td>
                  <td className="py-1 px-1">{formatTime(event.time)}</td>
                  <td className={`py-1 px-1 text-center font-medium ${TYPE_COLORS[event.type]}`}>
                    {TYPE_LABELS[event.type]}
                  </td>
                  <td className="py-1 px-1 text-gray-500">#{event.refId}</td>
                  <td className="py-1 px-1 max-w-[200px] truncate">{event.description}</td>
                  <td className="py-1 px-1 text-right">
                    {event.debit > 0 ? formatCurrency(event.debit) : ""}
                  </td>
                  <td className="py-1 px-1 text-right text-green-700">
                    {event.credit > 0 ? formatCurrency(event.credit) : ""}
                  </td>
                  <td className={`py-1 px-1 text-right font-medium ${event.balance > 0 ? "text-red-600" : event.balance < 0 ? "text-green-700" : ""}`}>
                    {formatCurrency(event.balance)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-400 font-bold">
              <td className="py-2 px-1" colSpan={5}>
                รวม ({data.eventCount} รายการ)
              </td>
              <td className="py-2 px-1 text-right">{formatCurrency(data.totalDebits)}</td>
              <td className="py-2 px-1 text-right text-green-700">{formatCurrency(data.totalCredits)}</td>
              <td className="py-2 px-1 text-right"></td>
            </tr>
          </tfoot>
        </table>
      )}

      {/* Closing summary */}
      <div className="mt-4 pt-4 border-t border-gray-300">
        <div className="grid grid-cols-4 gap-4 text-xs">
          <div className="border p-3 rounded">
            <p className="text-gray-500">ยอดยกมา</p>
            <p className="text-base font-bold">{formatCurrency(data.openingBalance)}</p>
          </div>
          <div className="border p-3 rounded">
            <p className="text-gray-500">รวมซื้อ (เดบิต)</p>
            <p className="text-base font-bold">{formatCurrency(data.totalDebits)}</p>
          </div>
          <div className="border p-3 rounded">
            <p className="text-green-700">รวมชำระ (เครดิต)</p>
            <p className="text-base font-bold text-green-700">{formatCurrency(data.totalCredits)}</p>
          </div>
          <div className="border p-3 rounded">
            <p className={data.closingBalance > 0 ? "text-red-600" : "text-gray-500"}>
              ยอดค้างชำระ
            </p>
            <p className={`text-base font-bold ${data.closingBalance > 0 ? "text-red-600" : "text-green-700"}`}>
              {formatCurrency(data.closingBalance)}
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-6 pt-4 border-t border-gray-300 text-center text-[10px] text-gray-500">
        <p>โดยสั่งจ่ายชื่อ Super Ice (SI)</p>
        <p className="mt-1">กรุณาชำระเงินภายใน 7 วัน หลังจากได้รับใบแจ้งยอด</p>
      </div>

      <style jsx>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 10mm;
          }
        }
      `}</style>
    </div>
  );
}
