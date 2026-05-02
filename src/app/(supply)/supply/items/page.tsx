"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { toast } from "sonner";

import { SupplyPageHeader } from "@/components/supply/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buildApiErrorDescription, parseApiErrorResponse } from "@/lib/api-error-diagnostics";
import { mergeSupplySettingOptions, normalizeSupplyItemSettings } from "@/lib/supply/item-settings";

interface SupplyItemRow {
  id: number;
  name: string;
  unit: string;
  category: string | null;
  itemCode: string | null;
  imageUrl: string | null;
  itemType: string | null;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  barcode: string | null;
  details: string | null;
  purchasedAt: string | null;
  warrantyExpiresAt: string | null;
  packSize: number;
  borrowLimit: number;
  linkedProductTypeId: number | null;
  lowStockThreshold: number;
  isActive: boolean;
}

const emptyForm = {
  name: "",
  unit: "",
  category: "",
  itemCode: "",
  imageUrl: "",
  itemType: "consumable",
  brand: "",
  model: "",
  serialNumber: "",
  barcode: "",
  details: "",
  purchasedAt: "",
  warrantyExpiresAt: "",
  packSize: "1",
  borrowLimit: "0",
  lowStockThreshold: "0",
};

const itemTypeLabels: Record<string, string> = {
  consumable: "ใช้แล้วหมดไป",
  durable: "อุปกรณ์ใช้งานซ้ำ",
};

const EMPTY_SELECT_VALUE = "__empty__";

function normalizeItemType(value: string | null | undefined): "consumable" | "durable" {
  if (value === "durable" || value === "tool" || value === "spare_part") return "durable";
  return "consumable";
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function parseFormInteger(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

async function readErrorMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  const payload = parseApiErrorResponse(body);
  const requestId = payload?.requestId || response.headers.get("x-request-id") || null;
  const enrichedPayload = payload || (requestId ? { error: fallback, requestId } : null);
  return buildApiErrorDescription(enrichedPayload, `${fallback} (HTTP ${response.status})`);
}

export default function SupplyItemsPage() {
  const [rows, setRows] = useState<SupplyItemRow[]>([]);
  const [units, setUnits] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SupplyItemRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  async function load() {
    const response = await fetch("/api/supply/items");
    if (!response.ok) throw new Error(await readErrorMessage(response, "โหลด catalog ไม่สำเร็จ"));
    const data = await response.json();
    setRows(asArray<SupplyItemRow>(data));
  }

  useEffect(() => {
    load().catch((error) => {
      const message = error instanceof Error ? error.message : "โหลด catalog ไม่สำเร็จ";
      console.error("[supply.items.load.failed]", { message });
      toast.error("โหลด catalog ไม่สำเร็จ", { description: message });
    });
  }, []);

  useEffect(() => {
    async function syncSettings() {
      try {
        const response = await fetch("/api/supply/settings");
        const data = response.ok ? await response.json() : null;
        const saved = normalizeSupplyItemSettings(data);
        setUnits(saved.units);
        setCategories(saved.categories);
      } catch {
        setUnits([]);
        setCategories([]);
      }
    }

    void syncSettings();
    const listener = () => {
      void syncSettings();
    };
    window.addEventListener("superice:supply-item-settings-updated", listener);

    return () => {
      window.removeEventListener("superice:supply-item-settings-updated", listener);
    };
  }, []);

  const unitOptions = mergeSupplySettingOptions(
    units,
    rows.map((row) => row.unit),
    [form.unit]
  );
  const categoryOptions = mergeSupplySettingOptions(
    categories,
    rows.map((row) => row.category),
    [form.category]
  );
  const packSizePreview = Math.max(1, parseFormInteger(form.packSize, 1));

  function beginCreate() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function beginEdit(row: SupplyItemRow) {
    setEditing(row);
    setForm({
      name: row.name,
      unit: row.unit,
      category: row.category || "",
      itemCode: row.itemCode || "",
      imageUrl: row.imageUrl || "",
      itemType: normalizeItemType(row.itemType),
      brand: row.brand || "",
      model: row.model || "",
      serialNumber: row.serialNumber || "",
      barcode: row.barcode || "",
      details: row.details || "",
      purchasedAt: row.purchasedAt || "",
      warrantyExpiresAt: row.warrantyExpiresAt || "",
      packSize: String(row.packSize || 1),
      borrowLimit: String(row.borrowLimit || 0),
      lowStockThreshold: String(row.lowStockThreshold),
    });
    setOpen(true);
  }

  async function handleImageFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("กรุณาเลือกไฟล์รูปภาพ");
      event.target.value = "";
      return;
    }

    setUploadingImage(true);
    try {
      const payload = new FormData();
      payload.append("file", file);

      const response = await fetch("/api/supply/items/upload", {
        method: "POST",
        body: payload,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || "อัปโหลดรูปไม่สำเร็จ");
      }
      const imageUrl =
        typeof result.imageUrl === "string" ? result.imageUrl : "";
      if (!imageUrl) {
        throw new Error("ไม่ได้ URL รูปกลับมาจากระบบ");
      }
      setForm((current) => ({ ...current, imageUrl }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "อัปโหลดรูปไม่สำเร็จ");
    } finally {
      setUploadingImage(false);
      event.target.value = "";
    }
  }

  async function handleSave() {
    if (uploadingImage) {
      toast.error("กรุณารอให้อัปโหลดรูปเสร็จก่อน");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name,
        unit: form.unit,
        category: form.category || null,
        itemCode: form.itemCode || null,
        imageUrl: form.imageUrl || null,
        itemType: normalizeItemType(form.itemType),
        brand: form.brand || null,
        model: form.model || null,
        serialNumber: form.serialNumber || null,
        barcode: form.barcode || null,
        details: form.details || null,
        purchasedAt: form.purchasedAt || null,
        warrantyExpiresAt: form.warrantyExpiresAt || null,
        packSize: Math.max(1, parseFormInteger(form.packSize, 1)),
        borrowLimit: Math.max(0, parseFormInteger(form.borrowLimit, 0)),
        lowStockThreshold: Math.max(0, parseFormInteger(form.lowStockThreshold, 0)),
      };
      const response = await fetch(editing ? `/api/supply/items/${editing.id}` : "/api/supply/items", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { ...payload, isActive: editing.isActive } : payload),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "บันทึกไม่สำเร็จ");
      }
      toast.success(editing ? "อัปเดตของใช้แล้ว" : "สร้างของใช้ใหม่แล้ว");
      setOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row: SupplyItemRow) {
    try {
      const response = await fetch(`/api/supply/items/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !row.isActive }),
      });
      if (!response.ok) throw new Error();
      await load();
    } catch {
      toast.error("อัปเดตสถานะไม่สำเร็จ");
    }
  }

  return (
    <div>
      <SupplyPageHeader
        title="รายการของใช้"
        description="จัดการรายการของใช้ภายใน กำหนดหน่วยนับ หมวดหมู่ และจุดแจ้งเตือนขั้นต่ำเริ่มต้นของแต่ละรายการ"
        actions={<Button className="rounded-full" onClick={beginCreate}>เพิ่มของใช้</Button>}
      />

      <Card className="border-slate-200 shadow-none">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>รายการ</TableHead>
                <TableHead>ประเภท / หมวด</TableHead>
                <TableHead>รหัส / Barcode</TableHead>
                <TableHead>ยี่ห้อ / รุ่น</TableHead>
                <TableHead>หน่วย / การเบิก</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead className="text-right">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-[10px] text-slate-400">
                        {row.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={row.imageUrl} alt={row.name} className="size-full object-cover" loading="lazy" />
                        ) : (
                          "No Image"
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-slate-900">{row.name}</p>
                        <p className="mt-1 max-w-72 truncate text-xs text-slate-500">{row.details || "ไม่มีรายละเอียด"}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <p>{itemTypeLabels[normalizeItemType(row.itemType)]}</p>
                      <p className="text-xs text-slate-500">{row.category || "ไม่ระบุหมวด"}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <p>{row.itemCode || "-"}</p>
                      <p className="text-xs text-slate-500">{row.barcode || "ไม่มี barcode"}</p>
                      {row.serialNumber ? <p className="text-xs text-slate-500">S/N {row.serialNumber}</p> : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <p>{row.brand || "-"}</p>
                      <p className="text-xs text-slate-500">{row.model || "ไม่ระบุรุ่น"}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <p>{row.unit} · แพ็คละ {row.packSize || 1}</p>
                      <p className="text-xs text-slate-500">
                        จำกัดเบิก {row.borrowLimit && row.borrowLimit > 0 ? `${row.borrowLimit} ${row.unit}` : "ไม่จำกัด"}
                      </p>
                      <p className="text-xs text-slate-500">แจ้งเตือน {row.lowStockThreshold}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={row.isActive ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-600"}>
                      {row.isActive ? "ใช้งาน" : "ปิดใช้งาน"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => beginEdit(row)}>แก้ไข</Button>
                      <Button variant="outline" size="sm" onClick={() => void toggleActive(row)}>{row.isActive ? "ปิดใช้" : "เปิดใช้"}</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="grid max-h-[min(88dvh,780px)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-5xl">
          <DialogHeader className="pr-8">
            <DialogTitle>{editing ? "แก้ไขของใช้" : "เพิ่มของใช้ใหม่"}</DialogTitle>
            <DialogDescription>ข้อมูลนี้จะถูกใช้ในสต็อก ใบเบิก และการโอนย้ายของโมดูลพัสดุ</DialogDescription>
          </DialogHeader>
          <div className="-mr-2 min-h-0 space-y-5 overflow-y-auto pr-2">
            <section className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>ชื่อรายการ *</Label>
                  <Input value={form.name ?? ""} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>รหัส</Label>
                  <Input
                    value={form.itemCode ?? ""}
                    onChange={(event) => setForm((current) => ({ ...current, itemCode: event.target.value }))}
                    placeholder="ว่างเพื่อสร้าง/ใส่รหัสภายหลัง"
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>หมวดหมู่</Label>
                  <Select value={form.category || "none"} onValueChange={(value) => setForm((current) => ({ ...current, category: value === "none" ? "" : value }))}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="เลือกหมวดหมู่" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">ไม่ระบุ</SelectItem>
                      {categoryOptions.map((category) => (
                        <SelectItem key={category} value={category}>{category}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>ประเภทรายการ *</Label>
                  <Select value={normalizeItemType(form.itemType)} onValueChange={(value) => setForm((current) => ({ ...current, itemType: value }))}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="consumable">ใช้แล้วหมดไป</SelectItem>
                      <SelectItem value="durable">อุปกรณ์ใช้งานซ้ำ (เบิกแล้วต้องคืน)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500">
                    เลือกว่า item นี้ใช้แล้วตัดหมดไป หรือเป็นของใช้งานซ้ำที่ต้องคืนหลังเบิก
                  </p>
                </div>
              </div>
            </section>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:max-w-md">
                <Label>หน่วย</Label>
                <Select
                  value={form.unit || EMPTY_SELECT_VALUE}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      unit: value === EMPTY_SELECT_VALUE ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="เลือกหน่วย" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={EMPTY_SELECT_VALUE}>เลือกหน่วย</SelectItem>
                    {unitOptions.map((unit) => (
                      <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="hidden sm:block" />
            </div>
            <section className="rounded-xl border border-sky-100 bg-sky-50/80 p-3">
              <div className="space-y-3">
                <div>
                  <h3 className="text-base font-semibold text-blue-800">การแปลงหน่วย (Unit Conversion)</h3>
                </div>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1.1fr)_minmax(220px,0.9fr)] md:items-center">
                  <div className="space-y-2">
                    <Label className="font-semibold text-slate-700">จำนวนต่อแพ็ค (Pack Size)</Label>
                    <Input
                      type="number"
                      min="1"
                      value={form.packSize ?? ""}
                      onChange={(event) => setForm((current) => ({ ...current, packSize: event.target.value }))}
                      placeholder="เช่น 12"
                      className="border-slate-200 bg-white shadow-sm"
                    />
                    <p className="text-xs font-medium text-blue-700">เช่น 1 กล่อง มี 12 ชิ้น ให้ระบุ 12</p>
                  </div>
                  <div className="space-y-1 rounded-xl bg-white/70 p-3 text-slate-600">
                    <p className="text-sm font-medium leading-snug text-slate-700">
                      ระบบจะใช้ค่านี้ในการคำนวณเมื่อรับสินค้าเข้าเป็นแพ็ค
                    </p>
                    <p className="text-base font-semibold text-slate-700">
                      ({`1 แพ็ค = ${packSizePreview}`})
                    </p>
                  </div>
                </div>
              </div>
            </section>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>จุดแจ้งเตือนขั้นต่ำ</Label>
                <Input type="number" min="0" value={form.lowStockThreshold ?? ""} onChange={(event) => setForm((current) => ({ ...current, lowStockThreshold: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>จำกัดการเบิกต่อครั้ง (Borrow Limit)</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.borrowLimit ?? ""}
                  onChange={(event) => setForm((current) => ({ ...current, borrowLimit: event.target.value }))}
                  placeholder="0 (ไม่จำกัด)"
                />
                <p className="text-xs text-slate-500">ใส่ 0 หากไม่ต้องการจำกัด</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>ยี่ห้อ (Brand)</Label>
                <Input value={form.brand ?? ""} onChange={(event) => setForm((current) => ({ ...current, brand: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>รุ่น (Model)</Label>
                <Input value={form.model ?? ""} onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Serial Number</Label>
                <Input value={form.serialNumber ?? ""} onChange={(event) => setForm((current) => ({ ...current, serialNumber: event.target.value }))} placeholder="S/N" />
              </div>
              <div className="space-y-2">
                <Label>Barcode (จากผู้ผลิต)</Label>
                <Input value={form.barcode ?? ""} onChange={(event) => setForm((current) => ({ ...current, barcode: event.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>รายละเอียด (Details/Spec)</Label>
              <textarea
                value={form.details ?? ""}
                onChange={(event) => setForm((current) => ({ ...current, details: event.target.value }))}
                className="min-h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>วันที่ซื้อ/ติดตั้ง</Label>
                <Input type="date" value={form.purchasedAt ?? ""} onChange={(event) => setForm((current) => ({ ...current, purchasedAt: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>วันหมดประกัน</Label>
                <Input type="date" value={form.warrantyExpiresAt ?? ""} onChange={(event) => setForm((current) => ({ ...current, warrantyExpiresAt: event.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>ลิงก์รูปสินค้า</Label>
              <Input
                value={form.imageUrl ?? ""}
                onChange={(event) => setForm((current) => ({ ...current, imageUrl: event.target.value }))}
                placeholder="https://example.com/item-image.jpg"
              />
            </div>
            <div className="space-y-2">
              <Label>หรือเลือกไฟล์รูป</Label>
              <Input
                type="file"
                accept="image/*"
                disabled={uploadingImage}
                onChange={(event) => void handleImageFileChange(event)}
                className="h-12 cursor-pointer border-sky-200 bg-sky-50/40 text-sm file:mr-4 file:rounded-md file:border-0 file:bg-blue-700 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white file:transition hover:file:bg-blue-800 focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-60 disabled:file:bg-blue-300"
              />
              <p className="text-xs text-slate-500">
                {uploadingImage
                  ? "กำลังอัปโหลดรูป..."
                  : "ระบบจะอัปโหลดไฟล์รูปและเก็บ URL ลงใน field รูปสินค้า"}
              </p>
            </div>
            {form.imageUrl ? (
              <div className="space-y-2">
                <Label>ตัวอย่างรูป</Label>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={form.imageUrl}
                    alt="ตัวอย่างรูปสินค้า"
                    className="h-28 w-28 rounded-md object-cover"
                  />
                </div>
              </div>
            ) : null}
            <p className="text-xs text-slate-500">
              ถ้าต้องเพิ่มตัวเลือกใหม่ ให้ไปที่หน้า Supply Settings ใน sidebar ก่อน
            </p>
          </div>
          <DialogFooter className="border-t border-slate-200 bg-white pt-4">
            <Button variant="outline" onClick={() => setOpen(false)}>ยกเลิก</Button>
            <Button onClick={handleSave} disabled={saving || uploadingImage}>
              {saving ? "กำลังบันทึก..." : uploadingImage ? "กำลังอัปโหลดรูป..." : "บันทึก"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
