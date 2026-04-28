"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Package2,
  RefreshCcw,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDisplayNumber } from "@/lib/display-ui";

interface BayOrderSummary {
  id: number;
  customerName: string;
  saleTime: string;
  totalOrderedQty: number;
  totalLoadedQty: number;
  totalRemainingQty: number;
}

interface BayItemSummary {
  productTypeId: number;
  productName: string;
  totalOrderedQty: number;
  totalLoadedQty: number;
  totalRemainingQty: number;
}

interface BayBucketSummary {
  bay: number | null;
  orderCount: number;
  totalOrderedQty: number;
  totalLoadedQty: number;
  totalRemainingQty: number;
  orders: BayOrderSummary[];
  items: BayItemSummary[];
}

interface BaysResponse {
  bays: BayBucketSummary[];
  unassigned: BayBucketSummary;
  updatedAt: string;
}

function getCompletionPct(bucket: BayBucketSummary): number {
  if (bucket.totalOrderedQty <= 0) return 0;
  return Math.round((bucket.totalLoadedQty / bucket.totalOrderedQty) * 100);
}

function formatUpdatedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function DisplayBaysPage() {
  const [data, setData] = useState<BaysResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchBays = useCallback(async () => {
    try {
      setRefreshing(true);
      const res = await fetch("/api/display?mode=bays", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`bays_fetch_failed_${res.status}`);
      }
      const payload: BaysResponse = await res.json();
      setData(payload);
    } catch {
      // keep previous data on retry
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBays();
    const interval = setInterval(fetchBays, 5000);
    return () => clearInterval(interval);
  }, [fetchBays]);

  const totals = useMemo(() => {
    if (!data) {
      return {
        orderCount: 0,
        totalOrderedQty: 0,
        totalLoadedQty: 0,
        totalRemainingQty: 0,
      };
    }

    const buckets = [...data.bays, data.unassigned];
    return buckets.reduce(
      (acc, bucket) => ({
        orderCount: acc.orderCount + bucket.orderCount,
        totalOrderedQty: acc.totalOrderedQty + bucket.totalOrderedQty,
        totalLoadedQty: acc.totalLoadedQty + bucket.totalLoadedQty,
        totalRemainingQty: acc.totalRemainingQty + bucket.totalRemainingQty,
      }),
      {
        orderCount: 0,
        totalOrderedQty: 0,
        totalLoadedQty: 0,
        totalRemainingQty: 0,
      }
    );
  }, [data]);

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center rounded-[2rem] border border-slate-200 bg-white/80 shadow-sm">
        <div className="rounded-full border border-blue-200 bg-blue-50 px-6 py-4 text-xl font-semibold text-blue-700 animate-pulse">
          กำลังโหลดบอร์ด 6 Bay...
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center rounded-[2rem] border border-red-200 bg-red-50/70 shadow-sm">
        <div className="text-xl font-semibold text-red-700">ไม่สามารถโหลดข้อมูลบอร์ด Bay ได้</div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm lg:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-slate-400">
              Factory Bay Board
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950 md:text-4xl">
              สถานะโหลดราย Bay (1-6)
            </h2>
            <p className="mt-2 text-base text-slate-500 md:text-lg">
              จอสำหรับทีมโหลดดูคงเหลือต่อ Bay แบบเรียลไทม์
            </p>
          </div>

          <button
            onClick={fetchBays}
            className="inline-flex min-h-[56px] items-center gap-2 self-start rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-100 md:text-base"
          >
            <RefreshCcw size={18} className={refreshing ? "animate-spin" : ""} />
            รีเฟรชข้อมูล
          </button>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-500">ออเดอร์ทั้งหมดในคิว</div>
            <div className="mt-2 text-3xl font-black text-slate-950">
              {formatDisplayNumber(totals.orderCount)}
            </div>
          </div>
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-sm font-semibold text-emerald-700">โหลดแล้วรวม</div>
            <div className="mt-2 text-3xl font-black text-emerald-700">
              {formatDisplayNumber(totals.totalLoadedQty)}
            </div>
          </div>
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-sm font-semibold text-amber-700">เหลือต้องโหลดรวม</div>
            <div className="mt-2 text-3xl font-black text-amber-700">
              {formatDisplayNumber(totals.totalRemainingQty)}
            </div>
          </div>
          <div className="rounded-3xl border border-blue-200 bg-blue-50 p-4">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700">
              <Clock3 size={16} />
              อัปเดตล่าสุด
            </div>
            <div className="mt-2 text-2xl font-black text-blue-700">
              {formatUpdatedAt(data.updatedAt)}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.bays.map((bay) => {
          const completionPct = getCompletionPct(bay);
          const hasOrders = bay.orderCount > 0;

          return (
            <article
              key={bay.bay}
              className={cn(
                "rounded-[1.75rem] border bg-white p-5 shadow-sm",
                hasOrders ? "border-slate-200" : "border-slate-100"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Bay
                  </p>
                  <h3 className="mt-1 text-4xl font-black text-slate-950">{bay.bay}</h3>
                </div>
                <span
                  className={cn(
                    "inline-flex rounded-full px-3 py-1 text-sm font-semibold",
                    hasOrders ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"
                  )}
                >
                  {hasOrders
                    ? `${formatDisplayNumber(bay.orderCount)} ออเดอร์`
                    : "ไม่มีคิว"}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                    <Package2 size={14} />
                    สั่ง
                  </div>
                  <div className="mt-1 text-xl font-black text-slate-950">
                    {formatDisplayNumber(bay.totalOrderedQty)}
                  </div>
                </div>
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
                  <div className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                    <CheckCircle2 size={14} />
                    โหลดแล้ว
                  </div>
                  <div className="mt-1 text-xl font-black text-emerald-700">
                    {formatDisplayNumber(bay.totalLoadedQty)}
                  </div>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                  <div className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                    <Truck size={14} />
                    คงเหลือ
                  </div>
                  <div className="mt-1 text-xl font-black text-amber-700">
                    {formatDisplayNumber(bay.totalRemainingQty)}
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span>ความคืบหน้า Bay</span>
                  <span>{completionPct}%</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#2563eb_0%,#10b981_100%)] transition-all"
                    style={{ width: `${completionPct}%` }}
                  />
                </div>
              </div>

              {hasOrders ? (
                <>
                  <div className="mt-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                      สินค้าคงเหลือ (Top 4)
                    </div>
                    <div className="mt-2 space-y-2">
                      {bay.items.slice(0, 4).map((item) => (
                        <div
                          key={`${bay.bay}-${item.productTypeId}`}
                          className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                        >
                          <span className="truncate text-sm font-semibold text-slate-700">
                            {item.productName}
                          </span>
                          <span className="text-sm font-black text-amber-700">
                            {formatDisplayNumber(item.totalRemainingQty)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                      คิวออเดอร์
                    </div>
                    <div className="mt-2 space-y-2">
                      {bay.orders.slice(0, 3).map((order) => (
                        <div
                          key={`${bay.bay}-order-${order.id}`}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-semibold text-slate-700">
                              #{order.id} {order.customerName}
                            </span>
                            <span className="text-xs font-medium text-slate-500">{order.saleTime}</span>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            คงเหลือ {formatDisplayNumber(order.totalRemainingQty)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-center text-sm font-semibold text-emerald-700">
                  Bay นี้ไม่มีงานคงค้าง
                </div>
              )}
            </article>
          );
        })}
      </section>

      {data.unassigned.orderCount > 0 ? (
        <section className="rounded-[1.75rem] border border-amber-200 bg-amber-50/60 p-5 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="inline-flex items-center gap-2 text-2xl font-black text-amber-800">
                <AlertCircle size={24} />
                Unassigned ({formatDisplayNumber(data.unassigned.orderCount)} ออเดอร์)
              </h3>
              <p className="mt-1 text-sm text-amber-700">
                ออเดอร์ที่ยังไม่ได้ระบุ Bay (หรือข้อมูล Bay นอกช่วง 1-6)
              </p>
            </div>
            <div className="text-lg font-black text-amber-800">
              เหลือรวม {formatDisplayNumber(data.unassigned.totalRemainingQty)}
            </div>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {data.unassigned.orders.map((order) => (
              <div
                key={`unassigned-order-${order.id}`}
                className="rounded-xl border border-amber-200 bg-white px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-slate-700">
                    #{order.id} {order.customerName}
                  </span>
                  <span className="text-xs font-medium text-slate-500">{order.saleTime}</span>
                </div>
                <div className="mt-1 text-xs text-amber-700">
                  คงเหลือ {formatDisplayNumber(order.totalRemainingQty)}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
