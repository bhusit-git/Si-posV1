"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProductType } from "@/lib/types";
import {
  INVOICE_CREDIT_LABEL,
  SHORT_TERM_CREDIT_LABEL,
} from "@/lib/customer-credit-labels";

interface PriceEntry {
  productTypeId: number;
  unitPrice: number;
  bagDeposit: number;
}

export default function NewCustomerPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [credit, setCredit] = useState(false);
  const [transferCustomer, setTransferCustomer] = useState(false);
  const [products, setProducts] = useState<ProductType[]>([]);
  const [prices, setPrices] = useState<PriceEntry[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/products")
      .then((r) => r.json())
      .then((data: ProductType[]) => {
        const active = data.filter((p) => p.isActive);
        setProducts(active);
        setPrices(
          active.map((p) => ({
            productTypeId: p.id,
            unitPrice: 0,
            bagDeposit: p.hasBag ? 10 : 0,
          }))
        );
      });
  }, []);

  function updatePrice(productTypeId: number, field: "unitPrice" | "bagDeposit", value: number) {
    setPrices((prev) =>
      prev.map((p) =>
        p.productTypeId === productTypeId ? { ...p, [field]: value } : p
      )
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);

    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, credit, transferCustomer, prices }),
      });

      if (res.ok) {
        const data = await res.json();

        router.push(`/customers/${data.id}`);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">เพิ่มลูกค้าใหม่</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ข้อมูลลูกค้า</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>ชื่อลูกค้า *</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ชื่อลูกค้า"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>โทรศัพท์</Label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="เบอร์โทรศัพท์"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <Label className="text-sm font-medium text-gray-700">ลูกค้า{SHORT_TERM_CREDIT_LABEL}</Label>
                <Button
                  type="button"
                  size="sm"
                  variant={credit ? "default" : "outline"}
                  className="h-8 min-w-24"
                  aria-pressed={credit}
                  onClick={() => setCredit((prev) => !prev)}
                >
                  {credit ? "✓ เปิด" : "ปิด"}
                </Button>
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <Label className="text-sm font-medium text-gray-700">ลูกค้า{INVOICE_CREDIT_LABEL}</Label>
                <Button
                  type="button"
                  size="sm"
                  variant={transferCustomer ? "destructive" : "outline"}
                  className="h-8 min-w-24"
                  aria-pressed={transferCustomer}
                  onClick={() => setTransferCustomer((prev) => !prev)}
                >
                  {transferCustomer ? `✓ ${INVOICE_CREDIT_LABEL}` : "ปกติ"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">ตั้งราคาสินค้า</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>สินค้า</TableHead>
                  <TableHead className="text-right">ราคา/หน่วย</TableHead>
                  <TableHead className="text-right">ค่ามัดจำถุง</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((pt) => {
                  const price = prices.find((p) => p.productTypeId === pt.id);
                  return (
                    <TableRow key={pt.id}>
                      <TableCell className="font-medium">{pt.name}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          className="text-right h-8 w-32 ml-auto"
                          value={price?.unitPrice || ""}
                          onChange={(e) =>
                            updatePrice(pt.id, "unitPrice", parseFloat(e.target.value) || 0)
                          }
                          placeholder="0"
                        />
                      </TableCell>
                      <TableCell>
                        {pt.hasBag ? (
                          <Input
                            type="number"
                            className="text-right h-8 w-32 ml-auto"
                            value={price?.bagDeposit || ""}
                            onChange={(e) =>
                              updatePrice(pt.id, "bagDeposit", parseFloat(e.target.value) || 0)
                            }
                            placeholder="0"
                          />
                        ) : (
                          <span className="text-gray-400 text-sm">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? "กำลังบันทึก..." : "บันทึก"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            ยกเลิก
          </Button>
        </div>
      </form>
    </div>
  );
}
