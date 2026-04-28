"use client";

import { useEffect, useState, use, useCallback } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatThaiDate, formatThaiMonth, formatCurrency, formatNumber } from "@/lib/thai-utils";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import Link from "next/link";
import type { ProductType } from "@/lib/types";
import {
  INVOICE_CREDIT_LABEL,
  SHORT_TERM_CREDIT_LABEL,
} from "@/lib/customer-credit-labels";
import { getBagBalanceFromEntries, getBagEntryBalanceDelta } from "@/lib/bag-flow";
import { getInvoiceCreditEligibilityState } from "@/lib/invoice-credit-rollout";

interface CustomerPriceWithId {
  id: number;
  productTypeId: number;
  unitPrice: number;
  bagDeposit: number;
  productType: ProductType;
}

interface CustomerData {
  id: number;
  name: string;
  phone: string | null;
  credit: boolean;
  transferCustomer?: boolean;
  createdAt: string;
  prices: CustomerPriceWithId[];
}

interface BagEntry {
  id: number;
  type: string;
  quantity: number;
  note: string | null;
  createdAt: string;
  productType: ProductType;
  transaction: { id: number; billNumber?: string; saleDate: string } | null;
}

interface TransactionData {
  id: number;
  totalAmount: number;
  paid: number;
  status: string;
  saleDate: string;
  saleTime: string;
  pool: number | null;
  row: number | null;
  col: number | null;
  items: {
    quantity: number;
    unitPrice: number;
    subtotal: number;
    productType: ProductType;
  }[];
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerData | null>(null);
  const [bagEntries, setBagEntries] = useState<BagEntry[]>([]);
  const [recentTx, setRecentTx] = useState<TransactionData[]>([]);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editCredit, setEditCredit] = useState(false);
  const [editTransferCustomer, setEditTransferCustomer] = useState(false);
  const [editPrices, setEditPrices] = useState<
    { productTypeId: number; unitPrice: number; bagDeposit: number }[]
  >([]);
  const [saving, setSaving] = useState(false);
  const [historyMonth, setHistoryMonth] = useState(() => new Date());
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadCustomer = useCallback(async () => {
    const res = await fetch(`/api/customers?id=${id}`);
    const data: CustomerData = await res.json();
    setCustomer(data);
    setEditName(data.name);
    setEditPhone(data.phone || "");
    setEditCredit(data.credit);
    setEditTransferCustomer(!!data.transferCustomer);
    setEditPrices(
      data.prices.map((p) => ({
        productTypeId: p.productTypeId,
        unitPrice: p.unitPrice,
        bagDeposit: p.bagDeposit,
      }))
    );
  }, [id]);

  const loadBagEntries = useCallback(async () => {
    const res = await fetch(`/api/bags?customerId=${id}`);
    const data = await res.json();
    setBagEntries(data);
  }, [id]);

  const loadTransactions = useCallback(async (month: Date) => {
    setHistoryLoading(true);
    try {
      const y = month.getFullYear();
      const m = month.getMonth();
      const startDate = `${y}-${String(m + 1).padStart(2, "0")}-01`;
      const lastDay = new Date(y, m + 1, 0).getDate();
      const endDate = `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      const res = await fetch(`/api/transactions?customerId=${id}&startDate=${startDate}&endDate=${endDate}`);
      const data = await res.json();
      setRecentTx(Array.isArray(data) ? data : []);
    } catch {
      setRecentTx([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [id]);

  function navigateHistoryMonth(delta: number) {
    setHistoryMonth((prev) => {
      const next = new Date(prev.getFullYear(), prev.getMonth() + delta, 1);
      loadTransactions(next);
      return next;
    });
  }

  useEffect(() => {
    loadCustomer();
    loadBagEntries();
    loadTransactions(historyMonth);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadCustomer, loadBagEntries]);

  async function handleSave() {
    if (!customer) return;
    setSaving(true);
    try {
      await fetch("/api/customers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: customer.id,
          name: editName,
          phone: editPhone,
          credit: editCredit,
          transferCustomer: editTransferCustomer,
          prices: editPrices,
        }),
      });
      setEditing(false);
      loadCustomer();
    } finally {
      setSaving(false);
    }
  }

  function updateEditPrice(
    productTypeId: number,
    field: "unitPrice" | "bagDeposit",
    value: number
  ) {
    setEditPrices((prev) =>
      prev.map((p) =>
        p.productTypeId === productTypeId ? { ...p, [field]: value } : p
      )
    );
  }

  // Compute bag balance
  const bagBalance = getBagBalanceFromEntries(bagEntries);
  const invoiceCreditState = getInvoiceCreditEligibilityState(customer);

  if (!customer)
    return <div className="text-center py-8 text-gray-500">กำลังโหลด...</div>;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4 md:mb-6 flex-wrap gap-2">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 truncate ui-scale-page-title">{customer.name}</h1>
          <p className="text-xs md:text-sm text-gray-500 ui-scale-page-subtitle">
            รหัส #{customer.id} | สมัครเมื่อ {formatThaiDate(customer.createdAt)}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {!editing ? (
            <Button size="sm" onClick={() => setEditing(true)}>แก้ไข</Button>
          ) : (
            <>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? "บันทึก..." : "บันทึก"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                ยกเลิก
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" onClick={() => router.back()}>
            กลับ
          </Button>
        </div>
      </div>

      <Tabs defaultValue="info">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="info" className="text-xs md:text-sm">ข้อมูล & ราคา</TabsTrigger>
          <TabsTrigger value="bags" className="text-xs md:text-sm">
            ถุง ({formatNumber(bagBalance)} ใบ)
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs md:text-sm">ประวัติซื้อ</TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base ui-scale-section-title">ข้อมูลลูกค้า</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {editing ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="ui-scale-label">ชื่อ</Label>
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="ui-scale-label">โทรศัพท์</Label>
                      <Input
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="flex items-center justify-between rounded-md border px-3 py-2">
                      <Label className="text-sm font-medium text-gray-700 ui-scale-label">ลูกค้า{SHORT_TERM_CREDIT_LABEL}</Label>
                      <Button
                        type="button"
                        size="sm"
                        variant={editCredit ? "default" : "outline"}
                        className="h-8 min-w-24"
                        aria-pressed={editCredit}
                        onClick={() => setEditCredit((prev) => !prev)}
                      >
                        {editCredit ? "✓ เปิด" : "ปิด"}
                      </Button>
                    </div>
                    <div className="flex items-center justify-between rounded-md border px-3 py-2">
                      <Label className="text-sm font-medium text-gray-700 ui-scale-label">ลูกค้า{INVOICE_CREDIT_LABEL}</Label>
                      <Button
                        type="button"
                        size="sm"
                        variant={editTransferCustomer ? "destructive" : "outline"}
                        className="h-8 min-w-24"
                        aria-pressed={editTransferCustomer}
                        onClick={() => setEditTransferCustomer((prev) => !prev)}
                      >
                        {editTransferCustomer ? `✓ ${INVOICE_CREDIT_LABEL}` : "ปกติ"}
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2 md:gap-4 text-sm ui-scale-body">
                  <div>
                    <span className="text-gray-500">โทรศัพท์:</span>{" "}
                    {customer.phone || "-"}
                  </div>
                  <div>
                    <span className="text-gray-500">{SHORT_TERM_CREDIT_LABEL}:</span>{" "}
                    {customer.credit ? (
                      <Badge variant="destructive">{SHORT_TERM_CREDIT_LABEL}</Badge>
                    ) : (
                      "ไม่"
                    )}
                  </div>
                  <div>
                    <span className="text-gray-500">{INVOICE_CREDIT_LABEL}:</span>{" "}
                    {invoiceCreditState === "saved" ? (
                      <Badge variant="secondary">{INVOICE_CREDIT_LABEL}</Badge>
                    ) : (
                      "ไม่"
                    )}
                  </div>
                  <div>
                    <span className="text-gray-500">ถุงค้าง:</span>{" "}
                    <span
                      className={
                        bagBalance > 0 ? "text-orange-600 font-bold" : ""
                      }
                    >
                      {formatNumber(bagBalance)} ใบ
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base ui-scale-section-title">ราคาสินค้า</CardTitle>
            </CardHeader>
            <CardContent>
              <Table className="ui-scale-dense-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>สินค้า</TableHead>
                    <TableHead className="text-right">ราคา/หน่วย</TableHead>
                    <TableHead className="text-right">ค่ามัดจำถุง</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customer.prices.map((p) => {
                    const ep = editPrices.find(
                      (ep) => ep.productTypeId === p.productTypeId
                    );
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">
                          {p.productType.name}
                        </TableCell>
                        <TableCell className="text-right">
                          {editing ? (
                            <Input
                              type="number"
                              className="h-8 w-28 text-right ml-auto"
                              value={ep?.unitPrice || ""}
                              onChange={(e) =>
                                updateEditPrice(
                                  p.productTypeId,
                                  "unitPrice",
                                  parseFloat(e.target.value) || 0
                                )
                              }
                            />
                          ) : (
                            formatCurrency(p.unitPrice)
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {p.productType.hasBag ? (
                            editing ? (
                              <Input
                                type="number"
                                className="h-8 w-28 text-right ml-auto"
                                value={ep?.bagDeposit || ""}
                                onChange={(e) =>
                                  updateEditPrice(
                                    p.productTypeId,
                                    "bagDeposit",
                                    parseFloat(e.target.value) || 0
                                  )
                                }
                              />
                            ) : (
                              formatCurrency(p.bagDeposit)
                            )
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bags" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base ui-scale-section-title">ประวัติถุง</CardTitle>
                <Badge
                  variant={bagBalance > 0 ? "destructive" : "secondary"}
                  className="text-base"
                >
                  คงเหลือ: {formatNumber(bagBalance)} ใบ
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {bagEntries.length === 0 ? (
                <p className="text-center py-4 text-gray-500">ไม่มีรายการถุง</p>
              ) : (
                <Table className="ui-scale-dense-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>วันที่</TableHead>
                      <TableHead>ประเภท</TableHead>
                      <TableHead className="text-right">จำนวน</TableHead>
                      <TableHead>หมายเหตุ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bagEntries.map((e) => {
                      const balanceDelta = getBagEntryBalanceDelta(e);
                      const qtyDisplay = `${balanceDelta > 0 ? "+" : ""}${balanceDelta}`;
                      const qtyClass =
                        balanceDelta > 0
                          ? "text-red-600"
                          : balanceDelta < 0
                            ? "text-green-600"
                            : "text-gray-500";
                      return (
                      <TableRow key={e.id}>
                        <TableCell className="text-sm">
                          {formatThaiDate(e.createdAt.split("T")[0])}
                        </TableCell>
                        <TableCell>
                          {e.type === "out" && (
                            <Badge variant="destructive">ออก</Badge>
                          )}
                          {e.type === "return" && (
                            <Badge className="bg-green-100 text-green-800">
                              คืน
                            </Badge>
                          )}
                          {e.type === "adjust" && (
                            <Badge variant="secondary">ปรับ</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          <span className={qtyClass}>{qtyDisplay}</span>
                        </TableCell>
                        <TableCell className="text-sm text-gray-500 max-w-48 truncate">
                          {e.note || (e.transaction ? `บิล ${e.transaction.billNumber || "#" + e.transaction.id}` : "-")}
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4 space-y-4">
          {/* Quick links */}
          <div className="flex flex-wrap gap-2">
            <Link href={`/invoice?customerId=${customer.id}`}>
              <Button variant="outline" size="sm" className="text-xs">ดูใบวางบิล</Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => {
                const y = historyMonth.getFullYear();
                const m = historyMonth.getMonth();
                const start = `${y}-${String(m + 1).padStart(2, "0")}-01`;
                const lastDay = new Date(y, m + 1, 0).getDate();
                const end = `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
                window.open(`/print/statement/${customer.id}?start=${start}&end=${end}`, "_blank");
              }}
            >
              ใบแจ้งยอดบัญชี
            </Button>
            <Link href="/reports">
              <Button variant="outline" size="sm" className="text-xs">ดูรายงาน</Button>
            </Link>
          </div>

          {/* Summary Cards */}
          {(() => {
            const txCount = recentTx.length;
            const totalAmt = recentTx.reduce((s, t) => s + Number(t.totalAmount), 0);
            const totalUnits = recentTx.reduce((s, t) => s + t.items.reduce((u, i) => u + i.quantity, 0), 0);
            const avgPerTx = txCount > 0 ? totalAmt / txCount : 0;
            return (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="pt-4 pb-3 px-4 text-center">
                    <p className="text-xs text-gray-500 ui-scale-summary-label">จำนวนบิล</p>
                    <p className="text-xl font-bold text-gray-900 ui-scale-summary-value">{formatNumber(txCount)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3 px-4 text-center">
                    <p className="text-xs text-gray-500 ui-scale-summary-label">ยอดรวม</p>
                    <p className="text-xl font-bold text-blue-700 ui-scale-summary-value">{formatCurrency(totalAmt)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3 px-4 text-center">
                    <p className="text-xs text-gray-500 ui-scale-summary-label">จำนวนรวม</p>
                    <p className="text-xl font-bold text-gray-900 ui-scale-summary-value">{formatNumber(totalUnits)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3 px-4 text-center">
                    <p className="text-xs text-gray-500 ui-scale-summary-label">เฉลี่ย/บิล</p>
                    <p className="text-xl font-bold text-gray-900 ui-scale-summary-value">{formatCurrency(avgPerTx)}</p>
                  </CardContent>
                </Card>
              </div>
            );
          })()}

          {/* 5-day MA Trendline Chart */}
          {(() => {
            // Build daily aggregation
            const dailyMap = new Map<string, { amount: number; units: number }>();
            recentTx.forEach((tx) => {
              const day = tx.saleDate.slice(0, 10);
              const prev = dailyMap.get(day) || { amount: 0, units: 0 };
              prev.amount += Number(tx.totalAmount);
              prev.units += tx.items.reduce((s, i) => s + i.quantity, 0);
              dailyMap.set(day, prev);
            });

            // Fill all days in the month
            const y = historyMonth.getFullYear();
            const m = historyMonth.getMonth();
            const daysInMonth = new Date(y, m + 1, 0).getDate();
            const today = toISO(new Date());
            const chartData: { day: string; amount: number; units: number; ma5amt: number | null; ma5units: number | null }[] = [];

            for (let d = 1; d <= daysInMonth; d++) {
              const dateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
              if (dateStr > today) break;
              const entry = dailyMap.get(dateStr) || { amount: 0, units: 0 };
              chartData.push({ day: String(d), amount: entry.amount, units: entry.units, ma5amt: null, ma5units: null });
            }

            // Calculate 5-day moving average
            for (let i = 0; i < chartData.length; i++) {
              if (i >= 4) {
                let sumAmt = 0, sumUnits = 0;
                for (let j = i - 4; j <= i; j++) {
                  sumAmt += chartData[j].amount;
                  sumUnits += chartData[j].units;
                }
                chartData[i].ma5amt = sumAmt / 5;
                chartData[i].ma5units = sumUnits / 5;
              }
            }

            if (chartData.length === 0) return null;

            return (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm ui-scale-section-title">ยอดขายรายวัน & เส้นค่าเฉลี่ย 5 วัน</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <ComposedChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(v: number | string | undefined, name: string | undefined) => {
                          const num = Number(v) || 0;
                          const label = name === "amount" ? "ยอดขาย" : name === "ma5amt" ? "MA5 ยอดขาย" : name === "units" ? "จำนวน" : name === "ma5units" ? "MA5 จำนวน" : name;
                          return [name?.includes("unit") ? formatNumber(num) : formatCurrency(num), label];
                        }}
                      />
                      <Bar yAxisId="left" dataKey="amount" fill="#93c5fd" radius={[2, 2, 0, 0]} name="amount" />
                      <Line yAxisId="left" dataKey="ma5amt" stroke="#ef4444" strokeWidth={2} dot={false} connectNulls name="ma5amt" />
                      <Line yAxisId="right" dataKey="ma5units" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls name="ma5units" />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <div className="flex justify-center gap-4 text-xs mt-1 text-gray-500">
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-blue-300" /> ยอดขาย</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-red-500" /> MA5 ยอดขาย</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-blue-500" /> MA5 จำนวน</span>
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* Month Navigator */}
          <div className="flex items-center justify-center gap-4">
            <Button variant="outline" size="sm" onClick={() => navigateHistoryMonth(-1)}>
              &lt;
            </Button>
            <span className="text-sm font-medium min-w-[180px] text-center">
              {formatThaiMonth(`${historyMonth.getFullYear()}-${String(historyMonth.getMonth() + 1).padStart(2, "0")}`)}
            </span>
            <Button variant="outline" size="sm" onClick={() => navigateHistoryMonth(1)}>
              &gt;
            </Button>
          </div>

          {/* Transaction Table */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base ui-scale-section-title">รายการขาย</CardTitle>
                {historyLoading && <span className="text-xs text-gray-400">กำลังโหลด...</span>}
              </div>
            </CardHeader>
            <CardContent>
              {recentTx.length === 0 ? (
                <p className="text-center py-8 text-gray-500">
                  {historyLoading ? "กำลังโหลด..." : "ไม่มีรายการในเดือนนี้"}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table className="ui-scale-dense-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[70px]">วันที่</TableHead>
                        <TableHead className="w-[50px]">เวลา</TableHead>
                        <TableHead>รายการ</TableHead>
                        <TableHead className="text-right w-[90px]">ยอด</TableHead>
                        <TableHead className="w-[70px] text-center">สถานะ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentTx.map((tx) => (
                        <TableRow key={tx.id}>
                          <TableCell className="text-xs whitespace-nowrap">
                            {formatThaiDate(tx.saleDate)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {tx.saleTime?.slice(0, 5) || "-"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {tx.items.map((it, i) => (
                              <span key={i}>
                                {i > 0 && ", "}
                                {it.productType.name} x{it.quantity}
                              </span>
                            ))}
                          </TableCell>
                          <TableCell className="text-right font-medium text-sm">
                            {formatCurrency(tx.totalAmount)}
                          </TableCell>
                          <TableCell className="text-center">
                            {tx.status === "voided" ? (
                              <Badge variant="secondary" className="text-[10px]">ยกเลิก</Badge>
                            ) : Number(tx.paid) >= Number(tx.totalAmount) ? (
                              <Badge className="bg-green-100 text-green-800 text-[10px]">จ่ายแล้ว</Badge>
                            ) : Number(tx.paid) > 0 ? (
                              <Badge className="bg-yellow-100 text-yellow-800 text-[10px]">จ่ายบางส่วน</Badge>
                            ) : (
                              <Badge variant="destructive" className="text-[10px]">ค้าง</Badge>
                            )}
                          </TableCell>
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
