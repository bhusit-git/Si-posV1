"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, ShoppingCart, Truck } from "lucide-react";
import { toast } from "sonner";

import { SupplyPageHeader } from "@/components/supply/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
}

interface FactoryResponse {
  current: string;
  factories: Array<{ key: string; name: string }>;
}

interface CartItem {
  supplyItemId: number;
  name: string;
  unit: string;
  available: number;
  quantity: number;
}

function clampQuantity(value: number, max: number) {
  return Math.max(0, Math.min(Math.trunc(value), max));
}

export default function NewSupplyRequestPage() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rows, setRows] = useState<StockBalanceRow[]>([]);
  const [factories, setFactories] = useState<Array<{ key: string; name: string }>>([]);
  const [currentFactoryKey, setCurrentFactoryKey] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("ทั้งหมด");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [requestType, setRequestType] = useState<"internal_factory" | "cross_factory">(
    "internal_factory"
  );
  const [targetFactoryKey, setTargetFactoryKey] = useState("");
  const [requesterName, setRequesterName] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    startTransition(() => {
      void (async () => {
        try {
          const [stockResponse, factoryResponse] = await Promise.all([
            fetch("/api/supply/stock"),
            fetch("/api/factory"),
          ]);

          if (!stockResponse.ok) {
            throw new Error("โหลด stock สำหรับการเบิกไม่สำเร็จ");
          }
          if (!factoryResponse.ok) {
            throw new Error("โหลดข้อมูลโรงงานไม่สำเร็จ");
          }

          const stock = (await stockResponse.json()) as StockBalanceRow[];
          const factoryData = (await factoryResponse.json()) as FactoryResponse;
          setRows(Array.isArray(stock) ? stock : []);
          setFactories(Array.isArray(factoryData.factories) ? factoryData.factories : []);
          setCurrentFactoryKey(factoryData.current || "");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ");
        }
      })();
    });
  }, []);

  const categories = useMemo(() => {
    const names = Array.from(
      new Set(rows.map((row) => row.item.category?.trim()).filter(Boolean))
    ) as string[];
    return ["ทั้งหมด", ...names.sort((left, right) => left.localeCompare(right, "th"))];
  }, [rows]);

  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (activeCategory !== "ทั้งหมด" && row.item.category !== activeCategory) {
        return false;
      }
      if (!normalizedQuery) return true;
      return (
        row.item.name.toLowerCase().includes(normalizedQuery) ||
        (row.item.category || "").toLowerCase().includes(normalizedQuery)
      );
    });
  }, [activeCategory, query, rows]);

  const cartCount = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity, 0),
    [cart]
  );

  const canSubmit =
    cart.length > 0 &&
    requesterName.trim().length > 0 &&
    note.trim().length > 0 &&
    (requestType === "internal_factory" || targetFactoryKey.trim().length > 0);

  function updateCart(row: StockBalanceRow, nextQuantity: number) {
    const quantity = clampQuantity(nextQuantity, row.balance);
    setCart((current) => {
      const existing = current.find((item) => item.supplyItemId === row.item.id);
      if (quantity <= 0) {
        return current.filter((item) => item.supplyItemId !== row.item.id);
      }
      if (existing) {
        return current.map((item) =>
          item.supplyItemId === row.item.id ? { ...item, quantity, available: row.balance } : item
        );
      }
      return [
        ...current,
        {
          supplyItemId: row.item.id,
          name: row.item.name,
          unit: row.item.unit,
          available: row.balance,
          quantity,
        },
      ];
    });
  }

  function getCartQuantity(supplyItemId: number) {
    return cart.find((item) => item.supplyItemId === supplyItemId)?.quantity || 0;
  }

  async function submitRequest() {
    if (!canSubmit || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/supply/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "pending",
          requestType,
          targetFactoryKey: requestType === "cross_factory" ? targetFactoryKey : null,
          requesterName,
          note,
          items: cart.map((item) => ({
            supplyItemId: item.supplyItemId,
            quantity: item.quantity,
          })),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "ส่งคำขอไม่สำเร็จ");
      }

      toast.success("ส่งใบเบิกเรียบร้อยแล้ว");
      router.push("/supply/requests");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ส่งคำขอไม่สำเร็จ");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      <SupplyPageHeader
        title="สร้างใบเบิกใหม่"
        description="เลือกของจาก catalog แล้วสรุปเป็นใบเบิกเดียว จากนั้นส่งเข้า status pending ได้ทันที"
        actions={
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/supply/requests">กลับรายการใบเบิก</Link>
          </Button>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[240px_minmax(0,1fr)_380px]">
        <Card className="border-slate-200 shadow-none">
          <CardHeader>
            <CardTitle>หมวดหมู่</CardTitle>
            <CardDescription>กรองรายการตามการใช้งานหลัก</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setActiveCategory(category)}
                className={
                  activeCategory === category
                    ? "w-full rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-left text-sm font-medium text-emerald-900"
                    : "w-full rounded-2xl border border-slate-200 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50"
                }
              >
                {category}
              </button>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-slate-200 shadow-none">
            <CardContent className="p-4">
              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3">
                <Search className="size-4 text-slate-400" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="ค้นหาชื่อของใช้หรือหมวดหมู่"
                  className="border-0 p-0 shadow-none focus-visible:ring-0"
                />
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {visibleRows.map((row) => {
              const selectedQty = getCartQuantity(row.item.id);
              const outOfStock = row.balance <= 0;

              return (
                <Card
                  key={row.item.id}
                  className={
                    outOfStock
                      ? "border-slate-200 bg-slate-50/80 opacity-70 shadow-none"
                      : "border-slate-200 shadow-none"
                  }
                >
                  <CardHeader className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">{row.item.name}</CardTitle>
                        <CardDescription>
                          {row.item.category || "ไม่ระบุหมวด"} · {row.item.unit}
                        </CardDescription>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          row.isLow
                            ? "border-amber-300 bg-amber-50 text-amber-800"
                            : "border-slate-200 bg-slate-50 text-slate-600"
                        }
                      >
                        {row.balance} {row.item.unit}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                      threshold {row.threshold}
                      {outOfStock ? " · ของหมด" : row.isLow ? " · ใกล้หมด" : " · พร้อมเบิก"}
                    </div>

                    {selectedQty <= 0 ? (
                      <Button
                        className="w-full rounded-2xl"
                        disabled={outOfStock}
                        onClick={() => updateCart(row, 1)}
                      >
                        {outOfStock ? "ของหมด" : "เบิกของ"}
                      </Button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="flex-1 rounded-2xl"
                          onClick={() => updateCart(row, selectedQty - 1)}
                        >
                          -
                        </Button>
                        <div className="min-w-16 rounded-2xl bg-slate-50 px-4 py-2 text-center text-sm font-medium">
                          {selectedQty}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="flex-1 rounded-2xl"
                          disabled={selectedQty >= row.balance}
                          onClick={() => updateCart(row, selectedQty + 1)}
                        >
                          +
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        <Card className="border-slate-200 shadow-none xl:sticky xl:top-6 xl:self-start">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>สรุปรายการเบิก</CardTitle>
                <CardDescription>ตรวจรายการก่อนส่งเป็นใบเบิก pending</CardDescription>
              </div>
              <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-800">
                <ShoppingCart className="size-5" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
              {cart.length > 0 ? `ในตะกร้า ${cartCount} ชิ้น จาก ${cart.length} รายการ` : "ยังไม่มีสินค้าในตะกร้า"}
            </div>

            <div className="space-y-3">
              {cart.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                  เลือกรายการจาก catalog ทางซ้ายก่อน
                </div>
              ) : (
                cart.map((item) => (
                  <div
                    key={item.supplyItemId}
                    className="rounded-2xl border border-slate-200 px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-900">{item.name}</p>
                        <p className="mt-1 text-sm text-slate-500">
                          คงเหลือ {item.available} {item.unit}
                        </p>
                      </div>
                      <Badge variant="outline">
                        {item.quantity} {item.unit}
                      </Badge>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1 rounded-2xl"
                        onClick={() =>
                          updateCart(
                            {
                              item: {
                                id: item.supplyItemId,
                                name: item.name,
                                unit: item.unit,
                                category: null,
                              },
                              balance: item.available,
                              threshold: 0,
                              isLow: false,
                            },
                            item.quantity - 1
                          )
                        }
                      >
                        -
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1 rounded-2xl"
                        disabled={item.quantity >= item.available}
                        onClick={() =>
                          updateCart(
                            {
                              item: {
                                id: item.supplyItemId,
                                name: item.name,
                                unit: item.unit,
                                category: null,
                              },
                              balance: item.available,
                              threshold: 0,
                              isLow: false,
                            },
                            item.quantity + 1
                          )
                        }
                      >
                        +
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="rounded-2xl text-rose-600 hover:text-rose-700"
                        onClick={() =>
                          setCart((current) =>
                            current.filter(
                              (entry) => entry.supplyItemId !== item.supplyItemId
                            )
                          )
                        }
                      >
                        ลบ
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-2">
              <Label>ประเภทใบเบิก</Label>
              <Select
                value={requestType}
                onValueChange={(value: "internal_factory" | "cross_factory") => {
                  setRequestType(value);
                  if (value === "internal_factory") {
                    setTargetFactoryKey("");
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="internal_factory">เบิกในโรงงาน</SelectItem>
                  <SelectItem value="cross_factory">เบิกข้ามโรงงาน</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {requestType === "cross_factory" ? (
              <div className="space-y-2">
                <Label>โรงงานต้นทาง</Label>
                <Select value={targetFactoryKey} onValueChange={setTargetFactoryKey}>
                  <SelectTrigger>
                    <SelectValue placeholder="เลือกโรงงานต้นทาง" />
                  </SelectTrigger>
                  <SelectContent>
                    {factories
                      .filter((factory) => factory.key !== currentFactoryKey)
                      .map((factory) => (
                        <SelectItem key={factory.key} value={factory.key}>
                          {factory.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <div className="rounded-2xl bg-sky-50 p-3 text-sm text-sky-900">
                  <div className="flex items-start gap-2">
                    <Truck className="mt-0.5 size-4" />
                    <p>approve จะเกิดที่โรงงานต้นทาง และระบบจะตัด stock ตอนสร้าง transfer จริง</p>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>ผู้ขอใช้จริง</Label>
              <Input
                value={requesterName}
                onChange={(event) => setRequesterName(event.target.value)}
                placeholder="เช่น แผนกแพ็กของ หรือชื่อ worker"
              />
            </div>

            <div className="space-y-2">
              <Label>หมายเหตุ / เหตุผลการเบิก</Label>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="อธิบายว่าจะนำไปใช้งานอะไร หรือเหตุผลที่ต้องเบิก"
                className="min-h-28 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
              />
            </div>

            <Button
              className="w-full rounded-2xl"
              disabled={!canSubmit || isPending || isSubmitting}
              onClick={() => void submitRequest()}
            >
              {isSubmitting ? "กำลังส่งคำขอ..." : isPending ? "กำลังโหลด..." : "ส่งคำขอ"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
