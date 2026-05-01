"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, Boxes, ClipboardList, MoveRight, Package2, Truck } from "lucide-react";

import { SupplyPageHeader } from "@/components/supply/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface StockRow {
  isLow: boolean;
}

interface RequestRow {
  id: number;
  status: string;
}

interface TransferRow {
  id: number;
  status: string;
}

export default function SupplyOverviewPage() {
  const [lowItems, setLowItems] = useState<StockRow[]>([]);
  const [pendingRequests, setPendingRequests] = useState<RequestRow[]>([]);
  const [pendingTransfers, setPendingTransfers] = useState<TransferRow[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/supply/stock?lowOnly=true").then((response) => (response.ok ? response.json() : [])),
      fetch("/api/supply/requests?status=pending").then((response) => (response.ok ? response.json() : [])),
      fetch("/api/supply/transfers?status=pending_receive&direction=incoming").then((response) => (response.ok ? response.json() : [])),
    ])
      .then(([stock, requests, transfers]) => {
        setLowItems(stock);
        setPendingRequests(requests);
        setPendingTransfers(transfers);
      })
      .catch(() => undefined);
  }, []);

  return (
    <div>
      <SupplyPageHeader
        title="Overview"
        description="ติดตามของใกล้หมด ใบเบิกที่รออนุมัติ และ transfer ที่ยังรอรับของในมุมเดียว"
        actions={
          <>
            <Button asChild className="rounded-full">
              <Link href="/supply/requests">สร้างใบเบิก</Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/supply/stock">ดู Stock</Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard title="สินค้าใกล้หมด" value={lowItems.length} icon={AlertTriangle} tone="amber" href="/supply/stock" />
        <SummaryCard title="ใบเบิกรออนุมัติ" value={pendingRequests.length} icon={ClipboardList} tone="sky" href="/supply/requests" />
        <SummaryCard title="Transfer รอรับของ" value={pendingTransfers.length} icon={Truck} tone="emerald" href="/supply/transfers" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card className="border-slate-200 shadow-none dark:border-slate-800 dark:bg-slate-950/60">
          <CardHeader>
            <CardTitle className="ui-scale-section-title dark:text-slate-100">Quick actions</CardTitle>
            <CardDescription className="ui-scale-body dark:text-slate-400">เริ่ม flow หลักของ module ได้จากปุ่มลัดชุดนี้</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <QuickLink href="/supply/requests" title="เปิดใบเบิกใหม่" description="สร้าง draft แล้วส่งอนุมัติต่อได้ทันที" icon={ClipboardList} />
            <QuickLink href="/supply/transfers" title="ดูการโอนย้าย" description="ตรวจของที่ส่งแล้วหรือรอยืนยันรับ" icon={Truck} />
            <QuickLink href="/supply/stock" title="ตรวจสต็อกคงเหลือ" description="ดู balance และ threshold ของแต่ละรายการ" icon={Boxes} />
            <QuickLink href="/supply/items" title="จัดการ catalog" description="เพิ่มของใช้ใหม่และเชื่อมกับ product type" icon={Package2} />
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-none dark:border-slate-800 dark:bg-slate-950/60">
          <CardHeader>
            <CardTitle className="ui-scale-section-title dark:text-slate-100">สถานะตอนนี้</CardTitle>
            <CardDescription className="ui-scale-body dark:text-slate-400">จุดที่ควรจับตาในรอบทำงานนี้</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm ui-scale-body">
            <StatusLine label="สินค้าใกล้ threshold" value={`${lowItems.length} รายการ`} emphasis={lowItems.length > 0} />
            <StatusLine label="ใบเบิกค้างอนุมัติ" value={`${pendingRequests.length} ใบ`} emphasis={pendingRequests.length > 0} />
            <StatusLine label="ของค้างรอยืนยันรับ" value={`${pendingTransfers.length} transfer`} emphasis={pendingTransfers.length > 0} />
            <div className="rounded-2xl bg-slate-50 p-4 text-slate-600 ui-scale-body dark:bg-slate-900 dark:text-slate-300">
              approve ยังไม่ตัด stock ระบบจะตัดตอน fulfil หรือ transfer สำเร็จจริง
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryCard({ title, value, icon: Icon, tone, href }: { title: string; value: number; icon: React.ComponentType<{ className?: string }>; tone: "amber" | "sky" | "emerald"; href: string; }) {
  const toneClass = {
    amber: "bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-500/10 dark:text-amber-200 dark:border-amber-500/20",
    sky: "bg-sky-50 text-sky-700 border-sky-100 dark:bg-sky-500/10 dark:text-sky-200 dark:border-sky-500/20",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-200 dark:border-emerald-500/20",
  }[tone];

  return (
    <Card className="border-slate-200 shadow-none dark:border-slate-800 dark:bg-slate-950/60">
      <CardContent className="flex items-center justify-between gap-4 p-6">
        <div>
          <p className="text-sm text-slate-500 ui-scale-summary-label dark:text-slate-400">{title}</p>
          <p className="mt-2 text-4xl font-semibold tracking-tight text-slate-900 ui-scale-summary-value dark:text-slate-100">{value}</p>
          <Button asChild variant="link" className="mt-2 h-auto p-0 text-slate-600 ui-scale-body dark:text-slate-300">
            <Link href={href}>เปิดดูรายละเอียด</Link>
          </Button>
        </div>
        <div className={`rounded-2xl border p-4 ${toneClass}`}>
          <Icon className="size-6" />
        </div>
      </CardContent>
    </Card>
  );
}

function QuickLink({ href, title, description, icon: Icon }: { href: string; title: string; description: string; icon: React.ComponentType<{ className?: string }>; }) {
  return (
    <Link href={href} className="group rounded-3xl border border-slate-200 p-4 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:border-slate-600 dark:hover:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-slate-900 ui-scale-section-title dark:text-slate-100">{title}</p>
          <p className="mt-2 text-sm text-slate-500 ui-scale-body dark:text-slate-400">{description}</p>
        </div>
        <Icon className="size-5 text-slate-400 transition group-hover:text-slate-700 dark:text-slate-500 dark:group-hover:text-slate-200" />
      </div>
      <div className="mt-4 flex items-center gap-2 text-sm text-slate-600 ui-scale-body dark:text-slate-300">
        เปิดหน้า <MoveRight className="size-4" />
      </div>
    </Link>
  );
}

function StatusLine({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 px-4 py-3 dark:border-slate-800">
      <span className="text-slate-500 ui-scale-body dark:text-slate-400">{label}</span>
      <Badge variant="outline" className={emphasis ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" : "dark:border-slate-700 dark:text-slate-300"}>{value}</Badge>
    </div>
  );
}
