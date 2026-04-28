"use client";

import { useEffect, useState, useCallback } from "react";
import { AlertCircle, CheckCircle2, Clock3, ListOrdered, PackageOpen, TimerReset } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDisplayNumber } from "@/lib/display-ui";

interface SummaryData {
  today: {
    totalOrders: number;
    loadedOrders: number;
    pendingOrders: number;
    otherOrders: number;
    completionPct: number;
  };
  pending: {
    id: number;
    customerName: string;
    saleTime: string;
    itemCount: number;
    totalQty: number;
    loadedQty: number;
  }[];
}

export default function LoadingSummaryPage() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/display?mode=summary");
      const json = await res.json();
      setData(json);
    } catch {
      // Silently retry
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
    const interval = setInterval(fetchSummary, 10000);
    return () => clearInterval(interval);
  }, [fetchSummary]);

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center rounded-[2rem] border border-slate-200 bg-white/80 shadow-sm">
        <div className="rounded-full border border-blue-200 bg-blue-50 px-6 py-4 text-xl font-semibold text-blue-700 animate-pulse">
          กำลังโหลดสรุปหน้าจอโรงงาน...
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center rounded-[2rem] border border-red-200 bg-red-50/70 shadow-sm">
        <div className="text-xl font-semibold text-red-700">ไม่สามารถโหลดข้อมูลได้</div>
      </div>
    );
  }

  const { today, pending } = data;
  const pctColor =
    today.completionPct >= 80
      ? "text-emerald-700"
      : today.completionPct >= 50
        ? "text-amber-700"
        : "text-orange-700";
  const trackedOrders = today.loadedOrders + today.pendingOrders;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm lg:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-slate-400">
              Factory Operations Board
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950 md:text-4xl">
              สรุปการโหลดวันนี้
            </h2>
            <p className="mt-2 text-base text-slate-500 md:text-lg">
              อัปเดตอัตโนมัติทุก 10 วินาที พร้อมคิวออเดอร์ที่ยังต้องติดตาม
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
              <TimerReset size={18} />
              รีเฟรชอัตโนมัติ
            </div>
            <div className="mt-2 text-2xl font-black text-slate-950">ทุก 10 วินาที</div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
              <ListOrdered size={18} />
              ออเดอร์ทั้งหมด
            </div>
            <div className="mt-3 text-4xl font-black text-slate-950">
              {formatDisplayNumber(today.totalOrders)}
            </div>
          </div>

          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
              <CheckCircle2 size={18} />
              โหลดแล้ว
            </div>
            <div className="mt-3 text-4xl font-black text-emerald-700">
              {formatDisplayNumber(today.loadedOrders)}
            </div>
          </div>

          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-700">
              <AlertCircle size={18} />
              รอโหลด
            </div>
            <div className="mt-3 text-4xl font-black text-amber-700">
              {formatDisplayNumber(today.pendingOrders)}
            </div>
          </div>

          <div className="rounded-3xl border border-blue-200 bg-blue-50 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-700">
              <PackageOpen size={18} />
              สำเร็จ
            </div>
            <div className={cn("mt-3 text-4xl font-black", pctColor)}>
              {today.completionPct}%
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-[1.75rem] border border-slate-200 bg-slate-50 p-5">
          <div className="mb-3 flex items-center justify-between gap-3 text-sm font-medium text-slate-500">
            <span>ความคืบหน้าของออเดอร์ที่ติดตามได้</span>
            <span>
              {formatDisplayNumber(today.loadedOrders)} / {formatDisplayNumber(trackedOrders)} ออเดอร์
            </span>
          </div>
          <div className="h-5 overflow-hidden rounded-full bg-white">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#2563eb_0%,#10b981_100%)] transition-all duration-500"
              style={{ width: `${today.completionPct}%` }}
            />
          </div>
        </div>
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm lg:p-6">
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-2xl font-black text-slate-950 md:text-3xl">
              ออเดอร์ที่รอโหลด ({pending.length})
            </h3>
            <p className="mt-1 text-base text-slate-500">
              เรียงจากคิวเก่าที่สุดไปใหม่สุด เพื่อให้ติดตามงานที่ค้างอยู่ก่อน
            </p>
          </div>
          <div className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-500">
            ดูคงเหลือและเปอร์เซ็นต์โหลดต่อออเดอร์
          </div>
        </div>

        {pending.length === 0 ? (
          <div className="flex min-h-[32vh] flex-col items-center justify-center rounded-[1.75rem] border border-emerald-200 bg-emerald-50/60 px-6 text-center">
            <div className="mb-4 flex size-20 items-center justify-center rounded-full border border-emerald-200 bg-white">
              <CheckCircle2 className="text-emerald-600" size={34} />
            </div>
            <div className="text-3xl font-black text-slate-950">ไม่มีออเดอร์รอโหลด</div>
            <div className="mt-2 text-lg text-slate-500">คิววันนี้เคลียร์เรียบร้อยแล้ว</div>
          </div>
        ) : (
          <div className="space-y-4">
            {pending.map((order, index) => {
              const loadPct = order.totalQty > 0 ? Math.round((order.loadedQty / order.totalQty) * 100) : 0;
              const remainingQty = Math.max(0, order.totalQty - order.loadedQty);

              return (
                <div
                  key={order.id}
                  className="rounded-[1.75rem] border border-slate-200 bg-slate-50/80 p-4 shadow-sm lg:p-5"
                >
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="min-w-0">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-600">
                          คิวที่ {index + 1}
                        </span>
                        <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-600">
                          #{order.id}
                        </span>
                        <span
                          className={cn(
                            "inline-flex rounded-full px-3 py-1 text-sm font-semibold",
                            order.loadedQty > 0 ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
                          )}
                        >
                          {order.loadedQty > 0 ? "กำลังโหลด" : "รอเริ่มโหลด"}
                        </span>
                      </div>

                      <div className="truncate text-2xl font-black text-slate-950 md:text-3xl">
                        {order.customerName}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm font-medium text-slate-500 md:text-base">
                        <span className="inline-flex items-center gap-1.5">
                          <Clock3 size={16} />
                          {order.saleTime?.substring(0, 5)}
                        </span>
                        <span>{formatDisplayNumber(order.itemCount)} รายการสินค้า</span>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[520px]">
                      <div className="rounded-3xl border border-slate-200 bg-white p-4">
                        <div className="text-sm font-semibold text-slate-500">จำนวนทั้งหมด</div>
                        <div className="mt-2 text-3xl font-black text-slate-950">
                          {formatDisplayNumber(order.totalQty)}
                        </div>
                      </div>
                      <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4">
                        <div className="text-sm font-semibold text-emerald-700">โหลดแล้ว</div>
                        <div className="mt-2 text-3xl font-black text-emerald-700">
                          {formatDisplayNumber(order.loadedQty)}
                        </div>
                      </div>
                      <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4">
                        <div className="text-sm font-semibold text-amber-700">คงเหลือ</div>
                        <div className="mt-2 text-3xl font-black text-amber-700">
                          {formatDisplayNumber(remainingQty)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between text-sm font-medium text-slate-500">
                      <span>ความคืบหน้าออเดอร์</span>
                      <span>{loadPct}%</span>
                    </div>
                    <div className="h-4 overflow-hidden rounded-full bg-white">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          order.loadedQty > 0 ? "bg-amber-500" : "bg-blue-500"
                        )}
                        style={{ width: `${loadPct}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
