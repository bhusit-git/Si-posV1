"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { BellRing, CheckCircle2, Clock3, MapPin, Package2, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDisplayNumber, getDisplayItemTone } from "@/lib/display-ui";

interface DisplayItem {
  id: number;
  productTypeId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  loadedQty: number;
}

interface DisplayOrder {
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
  items: DisplayItem[];
}

export default function WorkerDisplayPage() {
  const [order, setOrder] = useState<DisplayOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);
  const [flash, setFlash] = useState(false);
  const lastOrderId = useRef<number | null>(null);

  useEffect(() => {
    const ctx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();

    return () => {
      ctx.close();
    };
  }, []);

  const playChime = useCallback(() => {
    try {
      const ctx = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();

      [0, 0.15].forEach((delay, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = index === 0 ? 523.25 : 659.25;
        osc.type = "sine";
        gain.gain.setValueAtTime(0.3, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.4);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + 0.5);
      });

      setTimeout(() => ctx.close(), 1500);
    } catch {
      // Audio not available
    }
  }, []);

  const fetchOrder = useCallback(async () => {
    try {
      const res = await fetch("/api/display?mode=current");
      const data = await res.json();
      const newOrder: DisplayOrder | null = data.order || null;

      if (newOrder && newOrder.id !== lastOrderId.current) {
        playChime();
        setFlash(true);
        setTimeout(() => setFlash(false), 600);
      }

      lastOrderId.current = newOrder?.id ?? null;
      setOrder(newOrder);
    } catch {
      // Network error, keep showing current state
    } finally {
      setLoading(false);
    }
  }, [playChime]);

  useEffect(() => {
    fetchOrder();
    const interval = setInterval(fetchOrder, 3000);
    return () => clearInterval(interval);
  }, [fetchOrder]);

  async function markDone() {
    if (!order || marking) return;
    setMarking(true);
    try {
      await fetch("/api/display", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "done", transactionId: order.id }),
      });
      lastOrderId.current = null;
      await fetchOrder();
    } finally {
      setMarking(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center rounded-[2rem] border border-slate-200 bg-white/80 shadow-sm">
        <div className="flex items-center gap-3 rounded-full border border-blue-200 bg-blue-50 px-6 py-4 text-xl font-semibold text-blue-700 shadow-sm">
          <BellRing className="animate-pulse" size={22} />
          กำลังโหลดออเดอร์ล่าสุด...
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex min-h-[72vh] flex-col items-center justify-center rounded-[2rem] border border-slate-200 bg-white/90 px-6 text-center shadow-sm">
        <div className="mb-6 flex size-28 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50">
          <svg className="size-14 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
          </svg>
        </div>
        <div className="text-4xl font-black tracking-tight text-slate-900 md:text-5xl">
          รอออเดอร์ใหม่...
        </div>
        <div className="mt-3 max-w-xl text-lg text-slate-600 md:text-xl">
          เมื่อมีออเดอร์เข้าคิว หน้านี้จะแสดงออเดอร์ถัดไปให้อัตโนมัติทันที
        </div>
        <div className="mt-6 rounded-full border border-slate-200 bg-slate-50 px-5 py-2 text-sm font-medium text-slate-500">
          ระบบรีเฟรชทุก 3 วินาที
        </div>
      </div>
    );
  }

  const totalQty = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const totalLoaded = order.items.reduce((sum, item) => sum + item.loadedQty, 0);
  const totalRemaining = Math.max(0, totalQty - totalLoaded);
  const completionPct = totalQty > 0 ? Math.round((totalLoaded / totalQty) * 100) : 0;
  const hasStartedLoading = totalLoaded > 0;
  const hasLocation = Boolean(order.row);

  return (
    <div
      className={cn(
        "mx-auto flex min-h-[calc(100vh-156px)] w-full max-w-[1600px] flex-col gap-6 transition-all duration-300 xl:gap-8",
        flash && "rounded-[2rem] bg-amber-50/80 ring-4 ring-amber-200"
      )}
    >
      <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_20px_60px_-40px_rgba(15,23,42,0.35)]">
        <div className="grid gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1.4fr)_420px] lg:px-8 lg:py-8">
          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center rounded-full bg-blue-600 px-3 py-1 text-sm font-semibold text-white">
                ออเดอร์ปัจจุบัน
              </span>
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-semibold text-slate-600">
                #{order.id}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-700">
                <Clock3 size={15} />
                {order.saleTime}
              </span>
            </div>

            <p className="text-sm font-medium uppercase tracking-[0.24em] text-slate-400">
              ลูกค้า
            </p>
            <h2 className="mt-2 truncate text-4xl font-black tracking-tight text-slate-950 md:text-5xl xl:text-6xl">
              {order.customerName}
            </h2>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
                  <Package2 size={18} />
                  จำนวนสั่งทั้งหมด
                </div>
                <div className="mt-2 text-3xl font-black text-slate-950 md:text-4xl">
                  {formatDisplayNumber(totalQty)}
                </div>
              </div>

              <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                  <CheckCircle2 size={18} />
                  โหลดแล้ว
                </div>
                <div className="mt-2 text-3xl font-black text-emerald-700 md:text-4xl">
                  {formatDisplayNumber(totalLoaded)}
                </div>
              </div>

              <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-700">
                  <Truck size={18} />
                  เหลือต้องโหลด
                </div>
                <div className="mt-2 text-3xl font-black text-amber-700 md:text-4xl">
                  {formatDisplayNumber(totalRemaining)}
                </div>
              </div>

              <div className="rounded-3xl border border-blue-200 bg-blue-50 p-4">
                <div className="text-sm font-semibold text-blue-700">ความคืบหน้า</div>
                <div className="mt-2 text-3xl font-black text-blue-700 md:text-4xl">
                  {completionPct}%
                </div>
              </div>
            </div>

            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between text-sm font-medium text-slate-500">
                <span>สถานะการโหลด</span>
                <span>
                  {formatDisplayNumber(totalLoaded)} / {formatDisplayNumber(totalQty)}
                </span>
              </div>
              <div className="h-5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#2563eb_0%,#10b981_100%)] transition-all duration-500"
                  style={{ width: `${completionPct}%` }}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4 rounded-[1.75rem] border border-slate-200 bg-slate-50 p-5 lg:p-6">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.24em] text-slate-400">
                จุดโหลด
              </p>
              <div className="mt-3 rounded-3xl border border-violet-200 bg-white p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-violet-700">
                  <MapPin size={18} />
                  Bay
                </div>
                <div className="mt-2 text-4xl font-black text-violet-700">
                  {order.row ?? "Unassigned"}
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-4">
              <div className="text-sm font-semibold text-slate-500">พร้อมโหลด</div>
              <div className="mt-2 text-2xl font-black text-slate-950">
                {hasStartedLoading ? "กำลังโหลดออเดอร์นี้" : "เริ่มโหลดออเดอร์นี้ได้เลย"}
              </div>
              <p className="mt-2 text-base text-slate-600">
                {hasLocation
                  ? "ตรวจสอบ Bay ด้านขวา แล้วกดโหลดเสร็จเมื่อรายการครบ"
                  : "ออเดอร์นี้ยังไม่ระบุ Bay จึงอยู่ในกลุ่ม Unassigned แต่ยังจัดสินค้าได้ทันที"}
              </p>
            </div>

            <button
              onClick={markDone}
              disabled={marking}
              className="mt-auto min-h-[88px] rounded-[1.75rem] bg-emerald-600 px-8 py-5 text-2xl font-black text-white shadow-[0_18px_35px_-18px_rgba(5,150,105,0.75)] transition-colors hover:bg-emerald-500 active:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 md:text-3xl"
            >
              {marking ? "กำลังบันทึก..." : "โหลดเสร็จ"}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm lg:p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-2xl font-black text-slate-950 md:text-3xl">
              รายการที่ต้องโหลด
            </h3>
            <p className="mt-1 text-base text-slate-500">
              แสดงจำนวนสั่ง โหลดแล้ว และจำนวนที่ยังเหลืออย่างชัดเจน
            </p>
          </div>
          <div className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-500">
            {order.items.length} รายการ
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
          {order.items.map((item) => {
            const tone = getDisplayItemTone(item.productName);
            const remaining = Math.max(0, item.quantity - item.loadedQty);
            const itemPct = item.quantity > 0 ? Math.round((item.loadedQty / item.quantity) * 100) : 0;

            return (
              <div
                key={item.id}
                className={cn(
                  "rounded-[1.75rem] border p-5 shadow-sm",
                  tone.panelClassName,
                  remaining === 0 && "ring-2 ring-emerald-200"
                )}
              >
                <div className="flex h-full flex-col gap-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className={cn("inline-flex rounded-full px-3 py-1 text-sm font-bold", tone.badgeClassName)}>
                        {tone.label}
                      </span>
                      <div className={cn("mt-3 text-2xl font-black leading-tight md:text-3xl", tone.textClassName)}>
                        {item.productName}
                      </div>
                    </div>

                    <div className={cn("rounded-2xl border bg-white/80 px-4 py-3 text-right shadow-sm", tone.borderClassName)}>
                      <div className="text-sm font-semibold text-slate-500">คงเหลือ</div>
                      <div className={cn("text-3xl font-black md:text-4xl", remaining === 0 ? "text-emerald-600" : tone.valueClassName)}>
                        {formatDisplayNumber(remaining)}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-2xl border border-white/70 bg-white/80 p-4">
                      <div className="text-sm font-semibold text-slate-500">สั่ง</div>
                      <div className="mt-2 text-3xl font-black text-slate-950">
                        {formatDisplayNumber(item.quantity)}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-emerald-100 bg-white/80 p-4">
                      <div className="text-sm font-semibold text-emerald-700">โหลดแล้ว</div>
                      <div className="mt-2 text-3xl font-black text-emerald-700">
                        {formatDisplayNumber(item.loadedQty)}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-amber-100 bg-white/80 p-4">
                      <div className="text-sm font-semibold text-amber-700">คงเหลือ</div>
                      <div className="mt-2 text-3xl font-black text-amber-700">
                        {formatDisplayNumber(remaining)}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between text-sm font-medium text-slate-500">
                      <span>ความคืบหน้ารายการ</span>
                      <span>{itemPct}%</span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-white/80">
                      <div
                        className="h-full rounded-full bg-[linear-gradient(90deg,#60a5fa_0%,#10b981_100%)] transition-all"
                        style={{ width: `${itemPct}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
