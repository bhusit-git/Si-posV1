"use client";

import { useEffect, useMemo, useState } from "react";
import { Boxes, ClipboardPenLine, PackagePlus } from "lucide-react";
import { toast } from "sonner";

import { SupplyPageHeader } from "@/components/supply/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  buildApiErrorDescription,
  parseApiErrorResponse,
} from "@/lib/api-error-diagnostics";
import {
  calculateProjectedBaseBalance,
  formatBaseQuantityWithPack,
  formatPackUnitLabel,
  hasPackUnit,
  normalizeQuantityUnit,
  type SupplyQuantityUnit,
} from "@/lib/supply/unit-conversion";

interface StockBalanceRow {
  item: {
    id: number;
    name: string;
    unit: string;
    packSize: number;
    category: string | null;
    imageUrl?: string | null;
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

function parseNumericInput(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function readErrorMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  const payload = parseApiErrorResponse(body);
  const requestId = payload?.requestId || response.headers.get("x-request-id") || null;
  const enrichedPayload = payload || (requestId ? { error: fallback, requestId } : null);
  return buildApiErrorDescription(enrichedPayload, `${fallback} (HTTP ${response.status})`);
}

export default function SupplyStockPage() {
  const [rows, setRows] = useState<StockBalanceRow[]>([]);
  const [factories, setFactories] = useState<Array<{ key: string; name: string }>>([]);
  const [selectedFactory, setSelectedFactory] = useState<string>("");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{
    supplyItemId: string;
    quantity: string;
    quantityUnit: SupplyQuantityUnit;
    type: "purchase_in" | "adjustment";
    note: string;
  }>({
    supplyItemId: "",
    quantity: "",
    quantityUnit: "base",
    type: "purchase_in",
    note: "",
  });

  async function load(factoryKey?: string) {
    const query = factoryKey ? `?factoryKey=${encodeURIComponent(factoryKey)}` : "";
    const response = await fetch(`/api/supply/stock${query}`);
    if (!response.ok) throw new Error(await readErrorMessage(response, "โหลด stock ไม่สำเร็จ"));
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
      .catch((error) => {
        const message = error instanceof Error ? error.message : "โหลดข้อมูลโรงงานไม่สำเร็จ";
        toast.error("โหลดข้อมูลโรงงานไม่สำเร็จ", { description: message });
      });
  }, []);

  const lowCount = useMemo(() => rows.filter((row) => row.isLow).length, [rows]);
  const selectedItem = useMemo(
    () => rows.find((row) => String(row.item.id) === form.supplyItemId) || null,
    [form.supplyItemId, rows]
  );
  const parsedQuantity = useMemo(() => parseNumericInput(form.quantity), [form.quantity]);
  const adjustmentQuantityBase = useMemo(() => {
    if (!selectedItem) return 0;
    if (form.type === "adjustment") {
      return parsedQuantity - selectedItem.balance;
    }

    return parsedQuantity;
  }, [form.type, parsedQuantity, selectedItem]);
  const projectedBalance = useMemo(() => {
    if (!selectedItem) return 0;
    return form.type === "adjustment"
      ? parsedQuantity
      : calculateProjectedBaseBalance(
          selectedItem.balance,
          parsedQuantity,
          form.quantityUnit,
          selectedItem.item.packSize
        );
  }, [form.quantityUnit, form.type, parsedQuantity, selectedItem]);

  function openAdjustDialogForItem(row: StockBalanceRow, type: "purchase_in" | "adjustment") {
    setForm((current) => ({
      ...current,
      supplyItemId: String(row.item.id),
      type,
      quantity: type === "adjustment" ? String(row.balance) : "",
      quantityUnit: type === "purchase_in" && hasPackUnit(row.item.packSize) ? "pack" : "base",
      note: "",
    }));
    setAdjustOpen(true);
  }

  async function handleAdjust() {
    setSaving(true);
    try {
      const response = await fetch("/api/supply/stock/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplyItemId: Number(form.supplyItemId),
          quantity: form.type === "adjustment" ? adjustmentQuantityBase : Number(form.quantity),
          quantityUnit: form.quantityUnit,
          type: form.type,
          note: form.note,
        }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "บันทึกไม่สำเร็จ"));
      }
      toast.success("บันทึกการปรับ stock สำเร็จ");
      setAdjustOpen(false);
      setForm({
        supplyItemId: "",
        quantity: "",
        quantityUnit: "base",
        type: "purchase_in",
        note: "",
      });
      await load(selectedFactory);
    } catch (error) {
      const message = error instanceof Error ? error.message : "บันทึกไม่สำเร็จ";
      toast.error("บันทึกไม่สำเร็จ", { description: message });
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
              <DialogContent className="grid max-h-[88dvh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-slate-200 p-0 sm:max-w-xl">
                <DialogHeader className="gap-1.5 border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
                  <div className="flex items-start gap-3">
                    <div className={form.type === "adjustment" ? "rounded-lg bg-amber-50 p-2 text-amber-600" : "rounded-lg bg-emerald-50 p-2 text-emerald-600"}>
                      {form.type === "adjustment" ? <ClipboardPenLine className="size-4.5" /> : <PackagePlus className="size-4.5" />}
                    </div>
                    <div className="space-y-0.5">
                      <DialogTitle className={form.type === "adjustment" ? "text-lg font-bold tracking-tight text-amber-600 sm:text-xl" : "text-lg font-bold tracking-tight text-emerald-600 sm:text-xl"}>
                        {form.type === "adjustment" ? "ปรับปรุงสต็อก (Adjust)" : "รับสินค้าเข้า (Purchase In)"}
                      </DialogTitle>
                      <DialogDescription className="text-xs text-slate-500 sm:text-sm">
                        {selectedItem ? `${selectedItem.item.name} ${selectedItem.item.category ? `· ${selectedItem.item.category}` : ""}` : "เลือกของใช้ที่ต้องการบันทึก"}
                      </DialogDescription>
                    </div>
                  </div>
                </DialogHeader>
                <div className="min-h-0 space-y-3 overflow-y-auto bg-white px-4 py-3 sm:px-5">
                  <div className="grid gap-3 sm:grid-cols-[1.2fr_0.8fr]">
                    <div className="space-y-1.5">
                      <Label>รายการ</Label>
                      <Select
                        value={form.supplyItemId}
                        onValueChange={(value) => {
                          const nextItem = rows.find((row) => String(row.item.id) === value);
                          setForm((current) => ({
                            ...current,
                            supplyItemId: value,
                            quantityUnit:
                              nextItem && hasPackUnit(nextItem.item.packSize) && current.type === "purchase_in"
                                ? current.quantityUnit
                                : "base",
                          }));
                        }}
                      >
                        <SelectTrigger><SelectValue placeholder="เลือกของใช้" /></SelectTrigger>
                        <SelectContent>
                          {rows.map((row) => (
                            <SelectItem key={row.item.id} value={String(row.item.id)}>{row.item.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>ประเภท</Label>
                      <Select
                        value={form.type}
                        onValueChange={(value: "purchase_in" | "adjustment") =>
                          setForm((current) => ({
                            ...current,
                            type: value,
                            quantity: value === "adjustment" && selectedItem ? String(selectedItem.balance) : "",
                            quantityUnit:
                              value === "purchase_in" && selectedItem && hasPackUnit(selectedItem.item.packSize)
                                ? current.quantityUnit
                                : "base",
                            note: "",
                          }))
                        }
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="purchase_in">ซื้อเข้า</SelectItem>
                          <SelectItem value="adjustment">ปรับยอด</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {selectedItem ? (
                    <div className={form.type === "adjustment" ? "rounded-2xl border border-amber-200 bg-amber-50/60 p-3" : "rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3"}>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="flex items-center gap-2.5">
                          <div className="rounded-xl bg-white p-1.5 text-slate-500 shadow-sm">
                            <Boxes className="size-4" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-500">
                              {form.type === "adjustment" ? "จำนวนปัจจุบัน (ระบบ)" : "คงเหลือปัจจุบัน"}
                            </p>
                            <p className="text-xl font-semibold leading-tight text-slate-900 sm:text-2xl">
                              {selectedItem.balance}
                            </p>
                            <p className="text-xs text-slate-500 sm:text-sm">
                              {formatBaseQuantityWithPack(selectedItem.balance, selectedItem.item.unit, selectedItem.item.packSize)}
                            </p>
                          </div>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-500">
                            {form.type === "adjustment" ? "ผลต่าง" : "ยอดหลังบันทึก"}
                          </p>
                          <p className={form.type === "adjustment" ? `text-xl font-semibold leading-tight sm:text-2xl ${adjustmentQuantityBase > 0 ? "text-emerald-600" : adjustmentQuantityBase < 0 ? "text-rose-600" : "text-slate-900"}` : "text-xl font-semibold leading-tight text-emerald-600 sm:text-2xl"}>
                            {form.type === "adjustment"
                              ? adjustmentQuantityBase > 0
                                ? `+${adjustmentQuantityBase}`
                                : String(adjustmentQuantityBase)
                              : projectedBalance}
                          </p>
                          <p className="text-xs text-slate-500 sm:text-sm">
                            {form.type === "adjustment"
                              ? formatBaseQuantityWithPack(Math.abs(adjustmentQuantityBase), selectedItem.item.unit, selectedItem.item.packSize)
                              : formatBaseQuantityWithPack(projectedBalance, selectedItem.item.unit, selectedItem.item.packSize)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {form.type === "adjustment" ? (
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label className="text-sm font-semibold text-slate-800 sm:text-base">
                          จำนวนที่นับได้จริง (Physical Count) *
                        </Label>
                        <Input
                          type="number"
                          inputMode="numeric"
                          value={form.quantity}
                          onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))}
                          className="h-11 rounded-2xl border-slate-200 px-3 text-center text-lg font-semibold shadow-sm sm:h-12 sm:text-xl"
                          placeholder="0"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-sm font-semibold text-slate-800 sm:text-base">เหตุผล *</Label>
                        <textarea
                          value={form.note}
                          onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                          placeholder="เช่น ตรวจนับประจำวัน, สินค้าชำรุด, ของหาย, ฯลฯ"
                          className="min-h-12 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70 sm:min-h-14"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>หน่วยที่กรอก</Label>
                          <Select
                            value={form.quantityUnit}
                            onValueChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                quantityUnit: normalizeQuantityUnit(value),
                              }))
                            }
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="base">{selectedItem?.item.unit || "หน่วยหลัก"}</SelectItem>
                              {selectedItem && hasPackUnit(selectedItem.item.packSize) ? (
                                <SelectItem value="pack">
                                  {formatPackUnitLabel(selectedItem.item.unit, selectedItem.item.packSize)}
                                </SelectItem>
                              ) : null}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>จำนวนรับเข้า</Label>
                          <Input
                            type="number"
                            inputMode="numeric"
                            value={form.quantity}
                            onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))}
                            placeholder="เช่น 12"
                            className="h-10 rounded-2xl px-3.5 text-sm font-semibold"
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label>หมายเหตุ</Label>
                        <Input
                          value={form.note}
                          onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                          placeholder="เช่น รับของจากร้านค้า, เพิ่ม stock เปิดรอบ"
                          className="h-10 rounded-2xl px-3.5"
                        />
                      </div>
                    </div>
                  )}
                </div>
                <DialogFooter className="border-t border-slate-200 bg-slate-50 px-4 py-2.5 sm:justify-between sm:px-5">
                  <Button variant="ghost" className="h-10 rounded-xl px-4 text-sm sm:h-11 sm:px-5 sm:text-base" onClick={() => setAdjustOpen(false)}>ยกเลิก</Button>
                  <Button
                    onClick={handleAdjust}
                    disabled={saving}
                    className={form.type === "adjustment" ? "h-10 min-w-0 rounded-xl bg-amber-500 px-4 text-sm font-semibold hover:bg-amber-600 sm:h-11 sm:min-w-44 sm:px-5 sm:text-base" : "h-10 min-w-0 rounded-xl bg-emerald-600 px-4 text-sm font-semibold hover:bg-emerald-700 sm:h-11 sm:min-w-44 sm:px-5 sm:text-base"}
                  >
                    {saving
                      ? "กำลังบันทึก..."
                      : form.type === "adjustment"
                        ? "บันทึกการปรับปรุง"
                        : "บันทึกรับสินค้าเข้า"}
                  </Button>
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
              <div className="mb-3 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                {row.item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={row.item.imageUrl}
                    alt={row.item.name}
                    className="h-36 w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-36 items-center justify-center text-xs text-slate-400">
                    ไม่มีรูปสินค้า
                  </div>
                )}
              </div>
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
                  <p className="mt-2 text-sm text-slate-500">
                    {formatBaseQuantityWithPack(row.balance, row.item.unit, row.item.packSize)}
                  </p>
                </div>
                <p className="text-slate-500">{row.item.unit}</p>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Threshold</span>
                <span className="font-medium text-slate-800">
                  {formatBaseQuantityWithPack(row.threshold, row.item.unit, row.item.packSize)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">เคลื่อนไหวล่าสุด</span>
                <span className="text-right text-slate-800">{row.lastMovementAt ? new Date(row.lastMovementAt).toLocaleString("th-TH") : "-"}</span>
              </div>
              <div className="grid gap-2 pt-2 sm:grid-cols-2">
                <Button
                  type="button"
                  className="rounded-2xl"
                  onClick={() => openAdjustDialogForItem(row, "purchase_in")}
                >
                  เพิ่มของ
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-2xl"
                  onClick={() => openAdjustDialogForItem(row, "adjustment")}
                >
                  ปรับยอด
                </Button>
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
