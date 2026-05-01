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
        const body = await response.json().catch(() => null);
        const message =
          typeof body?.error === "string"
            ? body.error
            : typeof body?.debugMessage === "string"
            ? body.debugMessage
            : "บันทึกการตั้งค่าไม่สำเร็จ";
        throw new Error(message);
      }
      window.dispatchEvent(new CustomEvent("superice:supply-item-settings-updated"));
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "บันทึกการตั้งค่าไม่สำเร็จ");
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
        <Card className="border-slate-200 shadow-none dark:border-slate-800 dark:bg-slate-950/60">
          <CardHeader>
            <CardTitle className="text-lg dark:text-slate-100">หน่วยนับ</CardTitle>
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
                <div
                  key={unit}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <span>{unit}</span>
                  <button
                    type="button"
                    onClick={() => void removeValue(unit, units, setUnits, "units")}
                    className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-500 transition hover:border-red-200 hover:text-red-600 dark:border-slate-700 dark:text-slate-300 dark:hover:border-red-500/50 dark:hover:text-red-300"
                    aria-label={`ลบหน่วยนับ ${unit}`}
                  >
                    ลบ
                  </button>
                </div>
              )) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">ยังไม่ได้ตั้งหน่วยนับเอง</p>
              )}
            </div>
            {units.length > 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">กดปุ่มลบเพื่อเอาหน่วยนับออกจากรายการตั้งค่า</p>
            ) : null}
            {detectedUnits.length > 0 ? (
              <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-900/80">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">หน่วยที่พบจาก Catalog ปัจจุบัน</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {detectedUnits.map((unit) => (
                    <Badge key={unit} variant="outline" className="bg-white dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">{unit}</Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-none dark:border-slate-800 dark:bg-slate-950/60">
          <CardHeader>
            <CardTitle className="text-lg dark:text-slate-100">หมวดหมู่</CardTitle>
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
                <div
                  key={category}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <span>{category}</span>
                  <button
                    type="button"
                    onClick={() => void removeValue(category, categories, setCategories, "categories")}
                    className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-500 transition hover:border-red-200 hover:text-red-600 dark:border-slate-700 dark:text-slate-300 dark:hover:border-red-500/50 dark:hover:text-red-300"
                    aria-label={`ลบหมวดหมู่ ${category}`}
                  >
                    ลบ
                  </button>
                </div>
              )) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">ยังไม่ได้ตั้งหมวดหมู่เอง</p>
              )}
            </div>
            {categories.length > 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">กดปุ่มลบเพื่อเอาหมวดหมู่ออกจากรายการตั้งค่า</p>
            ) : null}
            {detectedCategories.length > 0 ? (
              <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-900/80">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">หมวดที่พบจาก Catalog ปัจจุบัน</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {detectedCategories.map((category) => (
                    <Badge key={category} variant="outline" className="bg-white dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">{category}</Badge>
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
