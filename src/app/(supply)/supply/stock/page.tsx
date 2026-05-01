"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { SupplyPageHeader } from "@/components/supply/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface StockBalanceRow {
  item: {
    id: number;
    name: string;
    unit: string;
    category: string | null;
  };
  balance: number;
  threshold: number;
  isLow: boolean;
  lastMovementAt: string | null;
}

interface FactoryResponse {
  current: string;
  factories: Array<{ key: string; name: string }>;
}

export default function SupplyStockPage() {
  const [rows, setRows] = useState<StockBalanceRow[]>([]);
  const [factories, setFactories] = useState<Array<{ key: string; name: string }>>([]);
  const [selectedFactory, setSelectedFactory] = useState<string>("");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ supplyItemId: "", quantity: "", type: "purchase_in", note: "" });

  async function load(factoryKey?: string) {
    const query = factoryKey ? `?factoryKey=${encodeURIComponent(factoryKey)}` : "";
    const response = await fetch(`/api/supply/stock${query}`);
    if (!response.ok) throw new Error("โหลด stock ไม่สำเร็จ");
    const data = await response.json();
    setRows(data);
  }

  useEffect(() => {
    fetch("/api/factory")
      .then((response) => response.json())
      .then((data: FactoryResponse) => {
        setFactories(data.factories || []);
        setSelectedFactory(data.current || "");
        return load(data.current || "");
      })
      .catch(() => {
        toast.error("โหลดข้อมูลโรงงานไม่สำเร็จ");
      });
  }, []);

  const lowCount = useMemo(() => rows.filter((row) => row.isLow).length, [rows]);

  async function handleAdjust() {
    setSaving(true);
    try {
      const response = await fetch("/api/supply/stock/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplyItemId: Number(form.supplyItemId),
          quantity: Number(form.quantity),
          type: form.type,
          note: form.note,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "บันทึกไม่สำเร็จ");
      }
      toast.success("บันทึกการปรับ stock สำเร็จ");
      setAdjustOpen(false);
      setForm({ supplyItemId: "", quantity: "", type: "purchase_in", note: "" });
      await load(selectedFactory);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <SupplyPageHeader
        title="Stock"
        description="ดูยอดคงเหลือของของใช้แต่ละรายการ เทียบกับ threshold ของโรงงานที่ใช้งานอยู่"
        actions={
          <>
            <Select value={selectedFactory} onValueChange={(value) => { setSelectedFactory(value); void load(value); }}>
              <SelectTrigger className="w-48 rounded-full"><SelectValue placeholder="เลือกโรงงาน" /></SelectTrigger>
              <SelectContent>
                {factories.map((factory) => (
                  <SelectItem key={factory.key} value={factory.key}>{factory.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
              <DialogTrigger asChild>
                <Button className="rounded-full">ปรับยอด / ซื้อเข้า</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>ปรับยอด stock</DialogTitle>
                  <DialogDescription>ใช้สำหรับซื้อเข้า หรือปรับนับใหม่</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>รายการ</Label>
                    <Select value={form.supplyItemId} onValueChange={(value) => setForm((current) => ({ ...current, supplyItemId: value }))}>
                      <SelectTrigger><SelectValue placeholder="เลือกของใช้" /></SelectTrigger>
                      <SelectContent>
                        {rows.map((row) => (
                          <SelectItem key={row.item.id} value={String(row.item.id)}>{row.item.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>ประเภท</Label>
                      <Select value={form.type} onValueChange={(value) => setForm((current) => ({ ...current, type: value }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="purchase_in">ซื้อเข้า</SelectItem>
                          <SelectItem value="adjustment">ปรับยอด</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>จำนวน</Label>
                      <Input value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} placeholder="เช่น 12" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>หมายเหตุ</Label>
                    <Input value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="เช่น ตรวจนับรอบเย็น" />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAdjustOpen(false)}>ยกเลิก</Button>
                  <Button onClick={handleAdjust} disabled={saving}>{saving ? "กำลังบันทึก..." : "บันทึก"}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <MetricCard label="รายการทั้งหมด" value={String(rows.length)} />
        <MetricCard label="ใกล้หมด" value={String(lowCount)} accent={lowCount > 0 ? "amber" : "slate"} />
        <MetricCard label="โรงงานที่กำลังดู" value={selectedFactory || "-"} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => (
          <Card key={row.item.id} className="border-slate-200 shadow-none">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{row.item.name}</CardTitle>
                  <CardDescription>{row.item.category || "ไม่ระบุหมวด"}</CardDescription>
                </div>
                <Badge variant="outline" className={row.isLow ? "border-amber-300 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-700"}>
                  {row.isLow ? "Low" : "OK"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-end justify-between gap-3 rounded-2xl bg-slate-50 p-4">
                <div>
                  <p className="text-slate-500">คงเหลือ</p>
                  <p className="mt-1 text-3xl font-semibold text-slate-900">{row.balance}</p>
                </div>
                <p className="text-slate-500">{row.item.unit}</p>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Threshold</span>
                <span className="font-medium text-slate-800">{row.threshold}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">เคลื่อนไหวล่าสุด</span>
                <span className="text-right text-slate-800">{row.lastMovementAt ? new Date(row.lastMovementAt).toLocaleString("th-TH") : "-"}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function MetricCard({ label, value, accent = "slate" }: { label: string; value: string; accent?: "slate" | "amber" }) {
  return (
    <Card className="border-slate-200 shadow-none">
      <CardContent className="p-6">
        <p className="text-sm text-slate-500">{label}</p>
        <p className={accent === "amber" ? "mt-2 text-3xl font-semibold text-amber-700" : "mt-2 text-3xl font-semibold text-slate-900"}>{value}</p>
      </CardContent>
    </Card>
  );
}
