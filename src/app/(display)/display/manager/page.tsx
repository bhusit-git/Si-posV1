"use client";

import { useEffect, useState, useCallback } from "react";
import { CheckCircle2, Clock3, ExternalLink, PackageCheck, RefreshCcw, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDisplayNumber, getDisplayItemTone } from "@/lib/display-ui";

interface ManagerItem {
  id: number;
  transactionId: number;
  productTypeId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  loadedQty: number;
}

interface ManagerOrder {
  id: number;
  customerId: number;
  customerName: string;
  totalAmount: number;
  paid: number;
  status: string;
  pool: number | null;
  row: number | null;
  col: number | null;
  fulfillment: string;
  saleDate: string;
  saleTime: string;
  note: string | null;
  createdAt: string;
  items: ManagerItem[];
}

export default function ManagerDisplayPage() {
  const [orders, setOrders] = useState<ManagerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch("/api/display?mode=queue");
      if (!res.ok) {
        throw new Error(`queue_fetch_failed_${res.status}`);
      }

      const data: unknown = await res.json();
      const nextOrders =
        data &&
        typeof data === "object" &&
        "orders" in data &&
        Array.isArray((data as { orders?: unknown }).orders)
          ? ((data as { orders: ManagerOrder[] }).orders ?? [])
          : [];

      setOrders(nextOrders);
    } catch {
      // Silently retry
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 5000);
    return () => clearInterval(interval);
  }, [fetchQueue]);

  async function updateLoaded(itemId: number, delta: number) {
    const key = `item-${itemId}-${delta}`;
    setActionInFlight(key);

    setOrders((prev) =>
      prev.map((order) => ({
        ...order,
        items: order.items.map((item) => {
          if (item.id !== itemId) return item;
          const nextLoaded = Math.max(0, Math.min(item.quantity, item.loadedQty + delta));
          return { ...item, loadedQty: nextLoaded };
        }),
      }))
    );

    try {
      const res = await fetch("/api/display", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateLoaded", transactionItemId: itemId, delta }),
      });

      if (!res.ok) {
        throw new Error(`update_loaded_failed_${res.status}`);
      }
    } catch {
      fetchQueue();
    } finally {
      setActionInFlight(null);
    }
  }

  async function markDone(transactionId: number) {
    setActionInFlight(`done-${transactionId}`);
    try {
      const res = await fetch("/api/display", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "done", transactionId }),
      });

      if (!res.ok) {
        throw new Error(`mark_done_failed_${res.status}`);
      }

      setOrders((prev) => prev.filter((order) => order.id !== transactionId));
    } catch {
      fetchQueue();
    } finally {
      setActionInFlight(null);
    }
  }

  function resetLoaded(itemId: number) {
    const order = orders.find((candidate) => candidate.items.some((item) => item.id === itemId));
    const item = order?.items.find((candidate) => candidate.id === itemId);
    if (item) {
      updateLoaded(itemId, -item.loadedQty);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center rounded-[2rem] border border-slate-200 bg-white/80 shadow-sm">
        <div className="rounded-full border border-blue-200 bg-blue-50 px-6 py-4 text-xl font-semibold text-blue-700 animate-pulse">
          กำลังโหลดคิวออเดอร์...
        </div>
      </div>
    );
  }

  const pendingOrders = orders.length;
  const totalOrdered = orders.reduce(
    (sum, order) => sum + order.items.reduce((inner, item) => inner + item.quantity, 0),
    0
  );
  const totalLoaded = orders.reduce(
    (sum, order) => sum + order.items.reduce((inner, item) => inner + item.loadedQty, 0),
    0
  );
  const totalRemaining = Math.max(0, totalOrdered - totalLoaded);
  const overallPct = totalOrdered > 0 ? Math.round((totalLoaded / totalOrdered) * 100) : 0;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm lg:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-slate-400">
              Queue Control
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950 md:text-4xl">
              จัดการออเดอร์
            </h2>
            <p className="mt-2 text-base text-slate-500 md:text-lg">
              {pendingOrders > 0
                ? `${pendingOrders} ออเดอร์กำลังรอโหลด พร้อมปุ่มอัปเดตสถานะแบบเร็ว`
                : "ไม่มีออเดอร์รอโหลดในคิวตอนนี้"}
            </p>
            <a
              href="/display/bays"
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-700 transition-colors hover:bg-violet-100"
            >
              <ExternalLink size={16} />
              เปิดบอร์ด 6 Bay (จอ HDMI)
            </a>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-500">ออเดอร์รอโหลด</div>
              <div className="mt-2 text-3xl font-black text-slate-950">
                {formatDisplayNumber(pendingOrders)}
              </div>
            </div>
            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-sm font-semibold text-emerald-700">โหลดแล้วรวม</div>
              <div className="mt-2 text-3xl font-black text-emerald-700">
                {formatDisplayNumber(totalLoaded)}
              </div>
            </div>
            <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-sm font-semibold text-amber-700">เหลือต้องโหลด</div>
              <div className="mt-2 text-3xl font-black text-amber-700">
                {formatDisplayNumber(totalRemaining)}
              </div>
            </div>
            <button
              onClick={fetchQueue}
              className="flex min-h-[124px] flex-col justify-between rounded-3xl border border-blue-200 bg-blue-50 p-4 text-left transition-colors hover:bg-blue-100"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-blue-700">
                <RefreshCcw size={18} />
                รีเฟรชคิว
              </div>
              <div className="text-3xl font-black text-blue-700">{overallPct}%</div>
              <div className="text-sm text-blue-600">อัปเดตข้อมูลล่าสุดทันที</div>
            </button>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between text-sm font-medium text-slate-500">
            <span>ความคืบหน้ารวมของคิว</span>
            <span>
              {formatDisplayNumber(totalLoaded)} / {formatDisplayNumber(totalOrdered)}
            </span>
          </div>
          <div className="h-4 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#2563eb_0%,#10b981_100%)] transition-all"
              style={{ width: `${overallPct}%` }}
            />
          </div>
        </div>
      </section>

      {pendingOrders === 0 ? (
        <section className="flex min-h-[48vh] flex-col items-center justify-center rounded-[2rem] border border-slate-200 bg-white/90 px-6 text-center shadow-sm">
          <div className="mb-5 flex size-24 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50">
            <PackageCheck className="text-emerald-600" size={42} />
          </div>
          <div className="text-3xl font-black text-slate-950">ไม่มีออเดอร์รอโหลด</div>
          <div className="mt-2 text-lg text-slate-500">
            ระบบจะตรวจสอบคิวใหม่ให้อัตโนมัติทุก 5 วินาที
          </div>
        </section>
      ) : null}

      <div className="space-y-5">
        {orders.map((order, index) => {
          const allLoaded = order.items.every((item) => item.loadedQty >= item.quantity);
          const orderTotalOrdered = order.items.reduce((sum, item) => sum + item.quantity, 0);
          const orderTotalLoaded = order.items.reduce((sum, item) => sum + item.loadedQty, 0);
          const orderRemaining = Math.max(0, orderTotalOrdered - orderTotalLoaded);
          const orderPct = orderTotalOrdered > 0 ? Math.round((orderTotalLoaded / orderTotalOrdered) * 100) : 0;
          const isSavingOrder = actionInFlight === `done-${order.id}`;

          return (
            <section
              key={order.id}
              className={cn(
                "overflow-hidden rounded-[2rem] border bg-white shadow-sm transition-colors",
                allLoaded ? "border-emerald-300" : "border-slate-200"
              )}
            >
              <div className="border-b border-slate-200 bg-slate-50/90 px-5 py-5 lg:px-6">
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
                          allLoaded
                            ? "bg-emerald-100 text-emerald-700"
                            : orderTotalLoaded > 0
                              ? "bg-amber-100 text-amber-700"
                              : "bg-blue-100 text-blue-700"
                        )}
                      >
                        {allLoaded ? "พร้อมปิดงาน" : orderTotalLoaded > 0 ? "กำลังโหลด" : "รอเริ่มโหลด"}
                      </span>
                    </div>

                    <h3 className="truncate text-2xl font-black text-slate-950 md:text-3xl">
                      {order.customerName}
                    </h3>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-sm font-medium text-slate-500 md:text-base">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock3 size={16} />
                        {order.saleTime}
                      </span>
                      {order.row ? (
                        <span>Bay {order.row}</span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          Unassigned
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[420px]">
                    <div className="rounded-3xl border border-slate-200 bg-white p-4">
                      <div className="text-sm font-semibold text-slate-500">สั่งทั้งหมด</div>
                      <div className="mt-2 text-3xl font-black text-slate-950">
                        {formatDisplayNumber(orderTotalOrdered)}
                      </div>
                    </div>
                    <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4">
                      <div className="text-sm font-semibold text-emerald-700">โหลดแล้ว</div>
                      <div className="mt-2 text-3xl font-black text-emerald-700">
                        {formatDisplayNumber(orderTotalLoaded)}
                      </div>
                    </div>
                    <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4">
                      <div className="text-sm font-semibold text-amber-700">คงเหลือ</div>
                      <div className="mt-2 text-3xl font-black text-amber-700">
                        {formatDisplayNumber(orderRemaining)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between text-sm font-medium text-slate-500">
                    <span>ความคืบหน้าออเดอร์</span>
                    <span>{orderPct}%</span>
                  </div>
                  <div className="h-4 overflow-hidden rounded-full bg-white">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        allLoaded
                          ? "bg-emerald-500"
                          : orderTotalLoaded > 0
                            ? "bg-amber-500"
                            : "bg-blue-500"
                      )}
                      style={{ width: `${orderPct}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3 px-5 py-5 lg:px-6">
                <div className="hidden grid-cols-[minmax(0,1.4fr)_130px_130px_130px_320px] items-center gap-3 px-2 text-sm font-semibold text-slate-500 xl:grid">
                  <div>รายการสินค้า</div>
                  <div className="text-center">สั่ง</div>
                  <div className="text-center">โหลดแล้ว</div>
                  <div className="text-center">คงเหลือ</div>
                  <div className="text-right">อัปเดตจำนวน</div>
                </div>

                {order.items.map((item) => {
                  const remaining = Math.max(0, item.quantity - item.loadedQty);
                  const isDone = remaining <= 0;
                  const tone = getDisplayItemTone(item.productName);
                  const isUpdating =
                    actionInFlight === `item-${item.id}-1` ||
                    actionInFlight === `item-${item.id}-5` ||
                    actionInFlight === `item-${item.id}-10`;

                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "rounded-[1.5rem] border p-4 shadow-sm xl:grid xl:grid-cols-[minmax(0,1.4fr)_130px_130px_130px_320px] xl:items-center xl:gap-3",
                        isDone ? "border-emerald-200 bg-emerald-50/80" : tone.subtlePanelClassName
                      )}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn("inline-flex rounded-full px-3 py-1 text-sm font-bold", tone.badgeClassName)}>
                            {tone.label}
                          </span>
                          {isDone ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-700">
                              <CheckCircle2 size={15} />
                              ครบแล้ว
                            </span>
                          ) : null}
                        </div>
                        <div className={cn("mt-3 truncate text-xl font-black md:text-2xl", tone.textClassName)}>
                          {item.productName}
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-3 gap-3 xl:mt-0 xl:contents">
                        <div className="rounded-2xl border border-white/80 bg-white/85 p-3 text-center xl:rounded-none xl:border-0 xl:bg-transparent xl:p-0">
                          <div className="text-xs font-semibold text-slate-500 xl:hidden">สั่ง</div>
                          <div className="text-2xl font-black text-slate-950">
                            {formatDisplayNumber(item.quantity)}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-emerald-100 bg-white/85 p-3 text-center xl:rounded-none xl:border-0 xl:bg-transparent xl:p-0">
                          <div className="text-xs font-semibold text-emerald-700 xl:hidden">โหลดแล้ว</div>
                          <div className="text-2xl font-black text-emerald-700">
                            {formatDisplayNumber(item.loadedQty)}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-amber-100 bg-white/85 p-3 text-center xl:rounded-none xl:border-0 xl:bg-transparent xl:p-0">
                          <div className="text-xs font-semibold text-amber-700 xl:hidden">คงเหลือ</div>
                          <div className={cn("text-2xl font-black", isDone ? "text-emerald-700" : "text-amber-700")}>
                            {isDone ? "0" : formatDisplayNumber(remaining)}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap justify-end gap-2 xl:mt-0">
                        <button
                          onClick={() => updateLoaded(item.id, 1)}
                          disabled={isDone || isUpdating}
                          className="min-h-[56px] min-w-[72px] rounded-2xl border border-slate-200 bg-white px-4 text-lg font-black text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          +1
                        </button>
                        <button
                          onClick={() => updateLoaded(item.id, 5)}
                          disabled={isDone || isUpdating}
                          className="min-h-[56px] min-w-[84px] rounded-2xl bg-blue-600 px-4 text-lg font-black text-white shadow-sm transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          +5
                        </button>
                        <button
                          onClick={() => updateLoaded(item.id, 10)}
                          disabled={isDone || isUpdating}
                          className="min-h-[56px] min-w-[92px] rounded-2xl bg-indigo-600 px-4 text-lg font-black text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          +10
                        </button>
                        <button
                          onClick={() => resetLoaded(item.id)}
                          disabled={item.loadedQty === 0 || isUpdating}
                          className="inline-flex min-h-[56px] min-w-[72px] items-center justify-center rounded-2xl border border-red-200 bg-red-50 px-4 text-lg font-black text-red-600 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-35"
                          title="รีเซ็ต"
                        >
                          ↺
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-col gap-4 border-t border-slate-200 bg-slate-50/90 px-5 py-5 lg:flex-row lg:items-center lg:justify-between lg:px-6">
                <div className="flex flex-wrap items-center gap-3 text-sm font-semibold text-slate-500 md:text-base">
                  <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5">
                    <Truck size={16} className="text-blue-600" />
                    โหลดแล้ว {formatDisplayNumber(orderTotalLoaded)} / {formatDisplayNumber(orderTotalOrdered)}
                  </span>
                  {!allLoaded ? (
                    <span className="inline-flex rounded-full bg-amber-100 px-3 py-1.5 text-amber-700">
                      เหลืออีก {formatDisplayNumber(orderRemaining)}
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1.5 text-emerald-700">
                      พร้อมกดโหลดเสร็จ
                    </span>
                  )}
                </div>

                <button
                  onClick={() => markDone(order.id)}
                  disabled={isSavingOrder}
                  className={cn(
                    "min-h-[64px] rounded-[1.5rem] px-8 text-lg font-black transition-colors md:text-xl",
                    allLoaded
                      ? "bg-emerald-600 text-white shadow-[0_16px_28px_-18px_rgba(5,150,105,0.85)] hover:bg-emerald-500"
                      : "bg-slate-900 text-white hover:bg-slate-800",
                    isSavingOrder && "cursor-not-allowed bg-slate-300 text-slate-500"
                  )}
                >
                  {isSavingOrder ? "กำลังบันทึก..." : allLoaded ? "โหลดเสร็จ" : "ปิดออเดอร์นี้"}
                </button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
