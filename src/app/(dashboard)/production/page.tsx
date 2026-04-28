"use client";

import { useEffect, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatNumber, formatThaiDate } from "@/lib/thai-utils";
import type { ProductType } from "@/lib/types";

interface StockRow {
  productTypeId: number;
  productName: string;
  totalProduced: number;
  totalSold: number;
  currentStock: number;
}

interface LogRow {
  id: number;
  quantity: number;
  note: string | null;
  createdAt: string;
  productType: { id: number; name: string };
}

export default function ProductionPage() {
  const [products, setProducts] = useState<ProductType[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Production form
  const [selectedProduct, setSelectedProduct] = useState("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadProducts();
    loadStock();
    loadLogs();
  }, []);

  async function loadProducts() {
    const res = await fetch("/api/products");
    const data = await res.json();
    setProducts(data.filter((p: ProductType) => p.isActive));
  }

  async function loadStock() {
    const res = await fetch("/api/production?type=stock");
    const data = await res.json();
    setStock(data);
  }

  async function loadLogs() {
    setLoading(true);
    const res = await fetch("/api/production?type=logs");
    const data = await res.json();
    setLogs(data);
    setLoading(false);
  }

  async function handleRecord() {
    if (!selectedProduct || !quantity) return;
    setSaving(true);
    try {
      const res = await fetch("/api/production", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productTypeId: parseInt(selectedProduct),
          quantity: parseFloat(quantity),
          note: note || null,
        }),
      });
      if (res.ok) {
        setQuantity("");
        setNote("");
        loadStock();
        loadLogs();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ผลิตน้ำแข็ง / สต็อก</h1>
          <p className="text-sm text-gray-500">บันทึกการผลิตและตรวจสอบสต็อก</p>
        </div>
      </div>

      <Tabs defaultValue="stock">
        <TabsList>
          <TabsTrigger value="stock">สต็อกปัจจุบัน</TabsTrigger>
          <TabsTrigger value="produce">บันทึกการผลิต</TabsTrigger>
          <TabsTrigger value="history">ประวัติการผลิต</TabsTrigger>
        </TabsList>

        {/* Stock Dashboard */}
        <TabsContent value="stock" className="mt-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {stock.map((s) => (
              <Card key={s.productTypeId}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{s.productName}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-blue-700 mb-2">
                    {formatNumber(s.currentStock)}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                    <div>
                      ผลิต:{" "}
                      <span className="font-medium text-green-700">
                        {formatNumber(s.totalProduced)}
                      </span>
                    </div>
                    <div>
                      ขาย:{" "}
                      <span className="font-medium text-red-600">
                        {formatNumber(s.totalSold)}
                      </span>
                    </div>
                  </div>
                  {s.currentStock <= 0 && (
                    <Badge variant="destructive" className="mt-2 text-xs">
                      หมดสต็อก
                    </Badge>
                  )}
                </CardContent>
              </Card>
            ))}
            {stock.length === 0 && (
              <Card className="col-span-full">
                <CardContent className="py-8 text-center text-gray-500">
                  ยังไม่มีข้อมูลสต็อก — เริ่มบันทึกการผลิตได้ที่แท็บ &quot;บันทึกการผลิต&quot;
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Record Production */}
        <TabsContent value="produce" className="mt-4">
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle className="text-base">บันทึกการผลิต</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>ประเภทสินค้า</Label>
                <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                  <SelectTrigger>
                    <SelectValue placeholder="เลือกสินค้า" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.id.toString()}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>จำนวนที่ผลิต</Label>
                <Input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="0"
                  min={1}
                />
              </div>
              <div className="space-y-2">
                <Label>หมายเหตุ</Label>
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="เช่น ผลิตรอบเช้า"
                />
              </div>
              <Button
                onClick={handleRecord}
                disabled={saving || !selectedProduct || !quantity}
                className="w-full"
              >
                {saving ? "กำลังบันทึก..." : "บันทึกการผลิต"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* History */}
        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                ประวัติการผลิตล่าสุด ({logs.length} รายการ)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-center py-8 text-gray-500">กำลังโหลด...</p>
              ) : logs.length === 0 ? (
                <p className="text-center py-8 text-gray-500">ยังไม่มีรายการผลิต</p>
              ) : (
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>วันที่</TableHead>
                      <TableHead>สินค้า</TableHead>
                      <TableHead className="text-right">จำนวน</TableHead>
                      <TableHead>หมายเหตุ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-sm whitespace-nowrap">
                          {formatThaiDate(log.createdAt.split("T")[0])}
                        </TableCell>
                        <TableCell className="font-medium">{log.productType.name}</TableCell>
                        <TableCell className="text-right font-medium text-green-700">
                          +{formatNumber(log.quantity)}
                        </TableCell>
                        <TableCell className="text-sm text-gray-500">{log.note || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
