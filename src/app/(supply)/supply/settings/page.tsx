"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { SupplyPageHeader } from "@/components/supply/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { mergeSupplySettingOptions, normalizeSupplyItemSettings } from "@/lib/supply/item-settings";

interface SupplyItemRow {
  id: number;
  unit: string;
  category: string | null;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

type StringListSetter = (next: string[] | ((current: string[]) => string[])) => void;

export default function SupplySettingsPage() {
  const [catalog, setCatalog] = useState<SupplyItemRow[]>([]);
  const [units, setUnits] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [newUnit, setNewUnit] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/supply/items").then((response) => (response.ok ? response.json() : [])),
      fetch("/api/supply/settings").then((response) => (response.ok ? response.json() : null)),
    ])
      .then(([catalogData, settingsData]) => {
        setCatalog(asArray<SupplyItemRow>(catalogData));
        const settings = normalizeSupplyItemSettings(settingsData);
        setUnits(settings.units);
        setCategories(settings.categories);
      })
      .catch(() => toast.error("โหลดการตั้งค่า Supply ไม่สำเร็จ"));
  }, []);

  const detectedUnits = useMemo(
    () => mergeSupplySettingOptions(catalog.map((row) => row.unit)),
    [catalog]
  );
  const detectedCategories = useMemo(
    () => mergeSupplySettingOptions(catalog.map((row) => row.category)),
    [catalog]
  );

  async function persistSettings(next: { units?: string[]; categories?: string[] }) {
    const payload = {
      units: next.units ?? units,
      categories: next.categories ?? categories,
    };

    setSaving(true);
    try {
      const response = await fetch("/api/supply/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error("บันทึกการตั้งค่าไม่สำเร็จ");
      }
      window.dispatchEvent(new CustomEvent("superice:supply-item-settings-updated"));
      return true;
    } catch {
      toast.error("บันทึกการตั้งค่าไม่สำเร็จ");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function addValue(
    value: string,
    current: string[],
    setter: StringListSetter,
    successMessage: string,
    field: "units" | "categories"
  ) {
    const trimmed = value.trim();
    if (!trimmed) return;
    const next = mergeSupplySettingOptions(current, [trimmed]);
    setter(next);
    const saved = await persistSettings({ [field]: next });
    if (!saved) {
      setter(current);
      return;
    }
    toast.success(successMessage);
  }

  async function removeValue(
    value: string,
    current: string[],
    setter: StringListSetter,
    field: "units" | "categories"
  ) {
    const next = current.filter((entry) => entry !== value);
    setter(next);
    const saved = await persistSettings({ [field]: next });
    if (!saved) {
      setter(current);
      return;
    }
    toast.success("อัปเดตการตั้งค่าแล้ว");
  }

  async function handleSave() {
    const saved = await persistSettings({ units, categories });
    if (!saved) return;
    toast.success("บันทึกการตั้งค่า Supply แล้ว");
  }

  return (
    <div>
      <SupplyPageHeader
        title="Supply Settings"
        description="ตั้งค่ารายการหน่วยนับและหมวดหมู่สำหรับใช้เป็นตัวเลือกในหน้า Catalog"
        actions={<Button className="rounded-full" onClick={() => void handleSave()} disabled={saving}>บันทึกการตั้งค่า</Button>}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="border-slate-200 shadow-none">
          <CardHeader>
            <CardTitle className="text-lg">หน่วยนับ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={newUnit}
                onChange={(event) => setNewUnit(event.target.value)}
                placeholder="เช่น ด้าม, ชิ้น, กล่อง"
              />
              <Button
                variant="outline"
                onClick={() => {
                  void addValue(newUnit, units, setUnits, "เพิ่มหน่วยนับแล้ว", "units");
                  setNewUnit("");
                }}
                disabled={saving}
              >
                เพิ่ม
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {units.length > 0 ? units.map((unit) => (
                <button
                  key={unit}
                  type="button"
                  onClick={() => void removeValue(unit, units, setUnits, "units")}
                  className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-700 transition hover:border-red-200 hover:text-red-600"
                >
                  {unit}
                </button>
              )) : (
                <p className="text-sm text-slate-500">ยังไม่ได้ตั้งหน่วยนับเอง</p>
              )}
            </div>
            {detectedUnits.length > 0 ? (
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-sm font-medium text-slate-800">หน่วยที่พบจาก Catalog ปัจจุบัน</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {detectedUnits.map((unit) => (
                    <Badge key={unit} variant="outline" className="bg-white">{unit}</Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-none">
          <CardHeader>
            <CardTitle className="text-lg">หมวดหมู่</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={newCategory}
                onChange={(event) => setNewCategory(event.target.value)}
                placeholder="เช่น ออฟฟิศ, แพ็คกิ้ง, ทำความสะอาด"
              />
              <Button
                variant="outline"
                onClick={() => {
                  void addValue(newCategory, categories, setCategories, "เพิ่มหมวดหมู่แล้ว", "categories");
                  setNewCategory("");
                }}
                disabled={saving}
              >
                เพิ่ม
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {categories.length > 0 ? categories.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => void removeValue(category, categories, setCategories, "categories")}
                  className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-700 transition hover:border-red-200 hover:text-red-600"
                >
                  {category}
                </button>
              )) : (
                <p className="text-sm text-slate-500">ยังไม่ได้ตั้งหมวดหมู่เอง</p>
              )}
            </div>
            {detectedCategories.length > 0 ? (
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-sm font-medium text-slate-800">หมวดที่พบจาก Catalog ปัจจุบัน</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {detectedCategories.map((category) => (
                    <Badge key={category} variant="outline" className="bg-white">{category}</Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
