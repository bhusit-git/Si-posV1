"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { suggestNextCatalogCode } from "@/lib/product-catalog-codes";
import type {
  ProductFamily,
  ProductForm,
  ProductPackageType,
  ProductSizeUnit,
  ProductType,
} from "@/lib/types";

const FAMILY_OPTIONS: Array<{ value: ProductFamily; label: string }> = [
  { value: "block", label: "ซอง" },
  { value: "large_tube", label: "หลอดใหญ่" },
  { value: "small_tube", label: "หลอดเล็ก" },
  { value: "iceberg", label: "Iceberg" },
];

const FORM_OPTIONS: Array<{ value: ProductForm; label: string }> = [
  { value: "standard", label: "ปกติ" },
  { value: "crushed", label: "โม่" },
];

const PACKAGE_TYPE_OPTIONS: Array<{ value: ProductPackageType; label: string }> = [
  { value: "loose", label: "ไม่ใช้ถุง" },
  { value: "returnable_bag", label: "ถุงเวียน" },
  { value: "clear_bag", label: "ถุงใส" },
  { value: "basket", label: "ตะกร้า" },
];

const SIZE_UNIT_OPTIONS: Array<{ value: ProductSizeUnit; label: string }> = [
  { value: "piece", label: "ก้อน" },
  { value: "kg", label: "กก." },
  { value: "basket", label: "ตะกร้า" },
];

function familyLabel(value: ProductFamily | null | undefined): string {
  return FAMILY_OPTIONS.find((option) => option.value === value)?.label || "-";
}

function formLabel(value: ProductForm | null | undefined): string {
  return FORM_OPTIONS.find((option) => option.value === value)?.label || "-";
}

function packageTypeLabel(value: ProductPackageType | null | undefined): string {
  return PACKAGE_TYPE_OPTIONS.find((option) => option.value === value)?.label || "-";
}

function sizeUnitLabel(value: ProductSizeUnit | null | undefined): string {
  return SIZE_UNIT_OPTIONS.find((option) => option.value === value)?.label || "";
}

function displaySize(product: ProductType): string {
  if (product.sizeLabel) return product.sizeLabel;
  if (typeof product.sizeValue === "number") {
    const unit = sizeUnitLabel(product.sizeUnit);
    return unit ? `${product.sizeValue} ${unit}` : String(product.sizeValue);
  }
  return "-";
}

function displayCatalogCode(product: ProductType): string {
  return typeof product.catalogCode === "number" ? String(product.catalogCode) : "-";
}

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductType[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductType | null>(null);
  const [formName, setFormName] = useState("");
  const [formNameEn, setFormNameEn] = useState("");
  const [formHasBag, setFormHasBag] = useState(false);
  const [formSortOrder, setFormSortOrder] = useState(99);
  const [formCatalogCode, setFormCatalogCode] = useState("");
  const [formFamily, setFormFamily] = useState<ProductFamily | "">("");
  const [formForm, setFormForm] = useState<ProductForm | "">("");
  const [formPackageType, setFormPackageType] = useState<ProductPackageType | "">("");
  const [formSizeValue, setFormSizeValue] = useState("");
  const [formSizeUnit, setFormSizeUnit] = useState<ProductSizeUnit | "">("");
  const [formSizeLabel, setFormSizeLabel] = useState("");
  const [catalogCodeTouched, setCatalogCodeTouched] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadProducts();
  }, []);

  useEffect(() => {
    if (!dialogOpen || editingProduct || catalogCodeTouched) return;
    if (!formFamily) {
      setFormCatalogCode("");
      return;
    }
    const suggestedCode = suggestNextCatalogCode(
      products.map((product) => product.catalogCode),
      formFamily
    );
    setFormCatalogCode(suggestedCode == null ? "" : String(suggestedCode));
  }, [catalogCodeTouched, dialogOpen, editingProduct, formFamily, products]);

  async function loadProducts() {
    const res = await fetch("/api/products");
    const data = await res.json();
    setProducts(data);
  }

  function openAddDialog() {
    setEditingProduct(null);
    setFormName("");
    setFormNameEn("");
    setFormHasBag(false);
    setFormSortOrder(Math.max(0, ...products.map((product) => product.sortOrder)) + 1);
    setFormCatalogCode("");
    setFormFamily("");
    setFormForm("");
    setFormPackageType("");
    setFormSizeValue("");
    setFormSizeUnit("");
    setFormSizeLabel("");
    setCatalogCodeTouched(false);
    setSaveError(null);
    setDialogOpen(true);
  }

  function openEditDialog(p: ProductType) {
    setEditingProduct(p);
    setFormName(p.name);
    setFormNameEn(p.nameEn || "");
    setFormHasBag(p.hasBag);
    setFormSortOrder(p.sortOrder);
    setFormCatalogCode(typeof p.catalogCode === "number" ? String(p.catalogCode) : "");
    setFormFamily(p.family ?? "");
    setFormForm(p.form ?? "");
    setFormPackageType(p.packageType ?? "");
    setFormSizeValue(typeof p.sizeValue === "number" ? String(p.sizeValue) : "");
    setFormSizeUnit(p.sizeUnit ?? "");
    setFormSizeLabel(p.sizeLabel || "");
    setCatalogCodeTouched(true);
    setSaveError(null);
    setDialogOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        name: formName,
        nameEn: formNameEn,
        hasBag: formHasBag,
        sortOrder: formSortOrder,
        catalogCode:
          formCatalogCode.trim().length > 0 ? Number.parseInt(formCatalogCode, 10) : null,
        family: formFamily || null,
        form: formForm || null,
        packageType: formPackageType || null,
        sizeValue: formSizeValue.trim().length > 0 ? Number.parseInt(formSizeValue, 10) : null,
        sizeUnit: formSizeUnit || null,
        sizeLabel: formSizeLabel,
      };
      let response: Response;
      if (editingProduct) {
        response = await fetch("/api/products", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editingProduct.id,
            isActive: editingProduct.isActive,
            ...payload,
          }),
        });
      } else {
        response = await fetch("/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      const responseBody = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof responseBody?.error === "string"
            ? responseBody.error
            : "ไม่สามารถบันทึกสินค้าได้"
        );
      }
      setDialogOpen(false);
      await loadProducts();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "ไม่สามารถบันทึกสินค้าได้");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(p: ProductType) {
    await fetch("/api/products", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: p.id,
        name: p.name,
        nameEn: p.nameEn,
        hasBag: p.hasBag,
        isActive: !p.isActive,
        sortOrder: p.sortOrder,
        catalogCode: p.catalogCode ?? null,
        family: p.family ?? null,
        form: p.form ?? null,
        packageType: p.packageType ?? null,
        sizeValue: p.sizeValue ?? null,
        sizeUnit: p.sizeUnit ?? null,
        sizeLabel: p.sizeLabel ?? null,
      }),
    });
    loadProducts();
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">จัดการสินค้า</h1>
          <p className="text-sm text-gray-500">
            เพิ่ม แก้ไข หรือปิดใช้งานประเภทสินค้า
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openAddDialog}>เพิ่มสินค้าใหม่</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingProduct ? "แก้ไขสินค้า" : "เพิ่มสินค้าใหม่"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>ชื่อสินค้า (ภาษาไทย) *</Label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="เช่น น้ำแข็งหลอดใหญ่"
                />
              </div>
              <div className="space-y-2">
                <Label>ชื่อภาษาอังกฤษ</Label>
                <Input
                  value={formNameEn}
                  onChange={(e) => setFormNameEn(e.target.value)}
                  placeholder="เช่น Unit"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>รหัสสินค้า</Label>
                  <Input
                    type="number"
                    value={formCatalogCode}
                    onChange={(e) => {
                      setCatalogCodeTouched(true);
                      setFormCatalogCode(e.target.value);
                    }}
                    placeholder={formFamily ? "ระบบแนะนำให้แล้ว แก้เองได้" : "เช่น 101"}
                  />
                  <p className="text-xs text-gray-500">
                    ใช้เป็นรหัสอ้างอิงหลักในหน้าจอแทนลำดับเดิม
                  </p>
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <input
                    type="checkbox"
                    id="hasBag"
                    checked={formHasBag}
                    onChange={(e) => setFormHasBag(e.target.checked)}
                    className="rounded"
                  />
                  <Label htmlFor="hasBag">มีถุง (ติดตามถุง)</Label>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>หมวดหลัก</Label>
                  <select
                    value={formFamily}
                    onChange={(e) => setFormFamily((e.target.value as ProductFamily | "") || "")}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">-</option>
                    {FAMILY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>รูปแบบ</Label>
                  <select
                    value={formForm}
                    onChange={(e) => setFormForm((e.target.value as ProductForm | "") || "")}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">-</option>
                    {FORM_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>ประเภทบรรจุภัณฑ์</Label>
                  <select
                    value={formPackageType}
                    onChange={(e) => setFormPackageType((e.target.value as ProductPackageType | "") || "")}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">-</option>
                    {PACKAGE_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>ข้อความขนาด</Label>
                  <Input
                    value={formSizeLabel}
                    onChange={(e) => setFormSizeLabel(e.target.value)}
                    placeholder="เช่น 20 กก. หรือ 160 ก้อน"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>ค่าขนาด</Label>
                  <Input
                    type="number"
                    value={formSizeValue}
                    onChange={(e) => setFormSizeValue(e.target.value)}
                    placeholder="เช่น 20"
                  />
                </div>
                <div className="space-y-2">
                  <Label>หน่วยขนาด</Label>
                  <select
                    value={formSizeUnit}
                    onChange={(e) => setFormSizeUnit((e.target.value as ProductSizeUnit | "") || "")}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">-</option>
                    {SIZE_UNIT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                {saveError ? (
                  <p className="flex-1 text-sm text-red-600">{saveError}</p>
                ) : (
                  <div className="flex-1" />
                )}
                <Button onClick={handleSave} disabled={saving || !formName.trim()}>
                  {saving ? "กำลังบันทึก..." : "บันทึก"}
                </Button>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  ยกเลิก
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">รหัสสินค้า</TableHead>
                <TableHead>ชื่อสินค้า</TableHead>
                <TableHead>หมวด</TableHead>
                <TableHead>บรรจุภัณฑ์</TableHead>
                <TableHead>ขนาด</TableHead>
                <TableHead className="text-center">มีถุง</TableHead>
                <TableHead className="text-center">สถานะ</TableHead>
                <TableHead className="w-32"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => (
                <TableRow key={p.id} className={!p.isActive ? "opacity-50" : ""}>
                  <TableCell className="text-sm text-gray-500">
                    {displayCatalogCode(p)}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{p.name}</div>
                  </TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {familyLabel(p.family)}
                    {p.form ? ` / ${formLabel(p.form)}` : ""}
                  </TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {packageTypeLabel(p.packageType)}
                  </TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {displaySize(p)}
                  </TableCell>
                  <TableCell className="text-center">
                    {p.hasBag ? (
                      <Badge className="bg-blue-100 text-blue-800">มีถุง</Badge>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {p.isActive ? (
                      <Badge className="bg-green-100 text-green-800">ใช้งาน</Badge>
                    ) : (
                      <Badge variant="secondary">ปิดใช้งาน</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog(p)}
                      >
                        แก้ไข
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleActive(p)}
                        className={p.isActive ? "text-red-600" : "text-green-600"}
                      >
                        {p.isActive ? "ปิด" : "เปิด"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
