"use client";

import { useEffect, useState } from "react";
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
import { mergeSupplySettingOptions, normalizeSupplyItemSettings } from "@/lib/supply/item-settings";

interface SupplyItemRow {
  id: number;
  name: string;
  unit: string;
  category: string | null;
  linkedProductTypeId: number | null;
  lowStockThreshold: number;
  isActive: boolean;
}

const emptyForm = { name: "", unit: "", category: "", linkedProductTypeId: "", lowStockThreshold: "0" };

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export default function SupplyItemsPage() {
  const [rows, setRows] = useState<SupplyItemRow[]>([]);
  const [units, setUnits] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SupplyItemRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  async function load() {
    const response = await fetch("/api/supply/items");
    if (!response.ok) throw new Error("โหลด catalog ไม่สำเร็จ");
    const data = await response.json();
    setRows(asArray<SupplyItemRow>(data));
  }

  useEffect(() => {
    load().catch(() => toast.error("โหลด catalog ไม่สำเร็จ"));
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
      linkedProductTypeId: row.linkedProductTypeId ? String(row.linkedProductTypeId) : "",
      lowStockThreshold: String(row.lowStockThreshold),
    });
    setOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        unit: form.unit,
        category: form.category || null,
        linkedProductTypeId: form.linkedProductTypeId ? Number(form.linkedProductTypeId) : null,
        lowStockThreshold: Number(form.lowStockThreshold || 0),
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
                <TableHead>ชื่อ</TableHead>
                <TableHead>หน่วย</TableHead>
                <TableHead>หมวด</TableHead>
                <TableHead>จุดแจ้งเตือนขั้นต่ำ</TableHead>
                <TableHead>รหัสวัสดุ</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead className="text-right">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>{row.unit}</TableCell>
                  <TableCell>{row.category || "-"}</TableCell>
                  <TableCell>{row.lowStockThreshold}</TableCell>
                  <TableCell>{row.linkedProductTypeId || "-"}</TableCell>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "แก้ไขของใช้" : "เพิ่มของใช้ใหม่"}</DialogTitle>
            <DialogDescription>ข้อมูลนี้จะถูกใช้ในสต็อก ใบเบิก และการโอนย้ายของโมดูลพัสดุ</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>ชื่อ</Label><Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>หน่วย</Label>
                <Select value={form.unit || undefined} onValueChange={(value) => setForm((current) => ({ ...current, unit: value }))}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="เลือกหน่วย" />
                  </SelectTrigger>
                  <SelectContent>
                    {unitOptions.map((unit) => (
                      <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>จุดแจ้งเตือนขั้นต่ำ</Label><Input value={form.lowStockThreshold} onChange={(event) => setForm((current) => ({ ...current, lowStockThreshold: event.target.value }))} /></div>
              <div className="space-y-2">
                <Label>รหัสวัสดุ</Label>
                <Input value={form.linkedProductTypeId} onChange={(event) => setForm((current) => ({ ...current, linkedProductTypeId: event.target.value }))} />
              </div>
            </div>
            <p className="text-xs text-slate-500">
              ถ้าต้องเพิ่มตัวเลือกใหม่ ให้ไปที่หน้า Supply Settings ใน sidebar ก่อน
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>ยกเลิก</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "กำลังบันทึก..." : "บันทึก"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
