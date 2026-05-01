"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, ClipboardList, Boxes } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function SupplyAlertWidget() {
  const [pendingCount, setPendingCount] = useState(0);
  const [lowCount, setLowCount] = useState(0);

  useEffect(() => {
    Promise.all([
      fetch("/api/supply/requests?status=pending").then((response) => (response.ok ? response.json() : [])),
      fetch("/api/supply/stock?lowOnly=true").then((response) => (response.ok ? response.json() : [])),
    ])
      .then(([requests, stock]) => {
        setPendingCount(Array.isArray(requests) ? requests.length : 0);
        setLowCount(Array.isArray(stock) ? stock.length : 0);
      })
      .catch(() => undefined);
  }, []);

  return (
    <Card className="mb-6 border-sky-200 bg-[linear-gradient(135deg,_rgba(240,249,255,0.95),_rgba(250,245,255,0.95))]">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-slate-900">Supply alerts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-amber-200 bg-white/80 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
              <AlertTriangle className="size-4" />
              สินค้าใกล้หมด
            </div>
            <p className="mt-2 text-3xl font-semibold text-slate-900">{lowCount}</p>
            <p className="mt-1 text-xs text-slate-500">รายการที่ balance ต่ำกว่าหรือเท่ากับ threshold</p>
          </div>
          <div className="rounded-2xl border border-sky-200 bg-white/80 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-sky-800">
              <ClipboardList className="size-4" />
              ใบเบิกรออนุมัติ
            </div>
            <p className="mt-2 text-3xl font-semibold text-slate-900">{pendingCount}</p>
            <p className="mt-1 text-xs text-slate-500">เอกสารที่ยังต้อง review ก่อนจ่ายของหรือสร้าง transfer</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" className="rounded-full">
            <Link href="/supply/requests">
              <ClipboardList className="size-4" />
              เปิดใบเบิก
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="rounded-full">
            <Link href="/supply/stock">
              <Boxes className="size-4" />
              ดู stock
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
