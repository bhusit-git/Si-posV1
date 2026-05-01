"use client";

import Link from "next/link";
import { useEffect, useState, useMemo } from "react";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatNumber, formatThaiDate, formatThaiTime } from "@/lib/thai-utils";
import { toast } from "sonner";
import type { BagBalance, BagEntry } from "@/lib/types";
import { matchesCustomerQuery } from "@/lib/filter-utils";
import { withRunningBagBalance } from "@/lib/bag-flow";
import type { SessionUser } from "@/lib/auth";

type SortKey = "balance" | "name" | "totalOut";
type BagBalanceApiRow = Omit<
  BagBalance,
  "totalOut" | "totalReturn" | "totalAdjust" | "balance"
> & {
  totalOut: number | string | null;
  totalReturn: number | string | null;
  totalAdjust: number | string | null;
  balance: number | string | null;
};

function formatLedgerDateTimeParts(value: string): { date: string; time: string } {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    const [datePart, timePart] = value.split("T");
    return {
      date: formatThaiDate(datePart || value),
      time: formatThaiTime((timePart || "").slice(0, 5)),
    };
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(parsed);

  const lookup = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  ) as Record<string, string>;

  return {
    date: formatThaiDate(`${lookup.year}-${lookup.month}-${lookup.day}`),
    time: formatThaiTime(`${lookup.hour}:${lookup.minute}`),
  };
}

export default function BagsPage() {
  const [authUser, setAuthUser] = useState<SessionUser | null>(null);
  const [balances, setBalances] = useState<BagBalance[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<BagBalance | null>(null);
  const [entries, setEntries] = useState<BagEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("balance");
  const [showZero, setShowZero] = useState(false);
  const [ledgerFrom, setLedgerFrom] = useState("");
  const [ledgerTo, setLedgerTo] = useState("");

  // Adjust dialog
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustCustomerId, setAdjustCustomerId] = useState(0);
  const [adjustType, setAdjustType] = useState("return");
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [supplyOpen, setSupplyOpen] = useState(false);
  const [supplyItems, setSupplyItems] = useState<
    Array<{ id: number; name: string; linkedProductTypeId: number | null }>
  >([]);
  const [supplyItemId, setSupplyItemId] = useState("");
  const [supplyQty, setSupplyQty] = useState("");
  const [supplyNote, setSupplyNote] = useState("");
  const [supplySaving, setSupplySaving] = useState(false);

  // Clear dialog
  const [clearOpen, setClearOpen] = useState(false);
  const [clearCustomerId, setClearCustomerId] = useState(0);
  const [clearCustomerName, setClearCustomerName] = useState("");
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    loadBalances();
    fetch("/api/auth")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setAuthUser(data))
      .catch(() => undefined);
    fetch("/api/supply/items")
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => {
        setSupplyItems(
          Array.isArray(data)
            ? data.filter((item) => item.linkedProductTypeId != null)
            : []
        );
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  async function loadBalances() {
    setLoading(true);
    try {
      const res = await fetch("/api/bags");
      const data: BagBalanceApiRow[] = await res.json();
      const coerced: BagBalance[] = data.map((b) => ({
        ...b,
        totalOut: Number(b.totalOut) || 0,
        totalReturn: Number(b.totalReturn) || 0,
        totalAdjust: Number(b.totalAdjust) || 0,
        balance: Number(b.balance) || 0,
      }));
      setBalances(coerced);
    } catch {
      toast.error("โหลดข้อมูลถุงไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  async function viewCustomerLedger(
    bal: BagBalance,
    options?: { from?: string; to?: string }
  ) {
    setSelectedCustomer(bal);
    setEntriesLoading(true);
    try {
      const params = new URLSearchParams({ customerId: String(bal.customerId) });
      const from = options?.from ?? ledgerFrom;
      const to = options?.to ?? ledgerTo;
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/bags?${params.toString()}`);
      const data = await res.json();
      setEntries(data);
    } catch {
      toast.error("โหลดรายการถุงไม่สำเร็จ");
      setEntries([]);
    } finally {
      setEntriesLoading(false);
    }
  }

  function openAdjustDialog(customerId: number) {
    setAdjustCustomerId(customerId);
    setAdjustType("return");
    setAdjustQty("");
    setAdjustNote("");
    setAdjustOpen(true);
  }

  async function handleAdjust() {
    if (!adjustQty) return;
    setSaving(true);
    try {
      const res = await fetch("/api/bags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: adjustCustomerId,
          type: adjustType,
          quantity: parseInt(adjustQty),
          note: adjustNote || "ปรับปรุงยอดโดยผู้ดูแลระบบ",
        }),
      });
      if (res.ok) {
        toast.success("บันทึกการปรับยอดถุงสำเร็จ");
        setAdjustOpen(false);
        await loadBalances();
        if (selectedCustomer && selectedCustomer.customerId === adjustCustomerId) {
          const updated = balances.find((b) => b.customerId === adjustCustomerId);
          if (updated) viewCustomerLedger(updated);
          else viewCustomerLedger(selectedCustomer);
        }
      } else {
        toast.error("บันทึกไม่สำเร็จ", { description: "กรุณาลองใหม่" });
      }
    } catch {
      toast.error("เกิดข้อผิดพลาด", { description: "กรุณาลองใหม่" });
    } finally {
      setSaving(false);
    }
  }

  function openSupplyConvertDialog(customer: BagBalance) {
    setAdjustCustomerId(customer.customerId);
    setSupplyQty("");
    setSupplyNote(`นำถุงเข้า Supply จากหน้าติดตามถุงของ ${customer.customerName}`);
    setSupplyItemId((current) => current || (supplyItems[0] ? String(supplyItems[0].id) : ""));
    setSupplyOpen(true);
  }

  async function handleSupplyImport() {
    if (!supplyItemId || !supplyQty) return;
    setSupplySaving(true);
    try {
      const res = await fetch("/api/supply/stock/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplyItemId: Number(supplyItemId),
          quantity: Number(supplyQty),
          type: "bag_return_manual",
          note: supplyNote || "นำเข้า Supply Stock จากหน้าถุง",
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "นำเข้า Supply ไม่สำเร็จ");
      }
      toast.success("นำเข้า Supply Stock สำเร็จ");
      setSupplyOpen(false);
      setSupplyQty("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "นำเข้า Supply ไม่สำเร็จ");
    } finally {
      setSupplySaving(false);
    }
  }

  function openClearDialog(customerId: number, customerName: string) {
    setClearCustomerId(customerId);
    setClearCustomerName(customerName);
    setClearOpen(true);
  }

  async function handleClear() {
    setClearing(true);
    try {
      const res = await fetch("/api/bags", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: clearCustomerId }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(`ล้างรายการถุง ${clearCustomerName} สำเร็จ`, {
          description: `ลบ ${data.deleted} รายการ`,
        });
        setClearOpen(false);
        await loadBalances();
        if (selectedCustomer?.customerId === clearCustomerId) {
          setSelectedCustomer(null);
          setEntries([]);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error("ล้างรายการไม่สำเร็จ", { description: err.error || "กรุณาลองใหม่" });
      }
    } catch {
      toast.error("เกิดข้อผิดพลาด");
    } finally {
      setClearing(false);
    }
  }

  const filtered = useMemo(() => {
    let list = balances;
    const normalizedSearch = search.trim().toLowerCase();

    if (normalizedSearch) {
      const q = normalizedSearch;
      list = list.filter(
        (b) =>
          matchesCustomerQuery(b.customerId, b.customerName, q) ||
          (b.phone && b.phone.includes(q))
      );
    }
    if (!showZero && !normalizedSearch) {
      list = list.filter((b) => b.balance !== 0);
    }
    list = [...list].sort((a, b) => {
      if (sortBy === "balance") return b.balance - a.balance;
      if (sortBy === "totalOut") return b.totalOut - a.totalOut;
      return a.customerName.localeCompare(b.customerName, "th");
    });
    return list;
  }, [balances, search, sortBy, showZero]);

  const totalOutstanding = useMemo(
    () => balances.reduce((s, b) => s + b.balance, 0),
    [balances]
  );
  const customersWithBalance = useMemo(
    () => balances.filter((b) => b.balance > 0).length,
    [balances]
  );
  const highBalanceCount = useMemo(
    () => balances.filter((b) => b.balance > 100).length,
    [balances]
  );

  // Running balance for the ledger (entries come desc, reverse for running calc)
  const entriesWithRunning = useMemo(() => withRunningBagBalance(entries), [entries]);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-gray-100">ติดตามถุง</h1>
          <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400">ตรวจสอบยอดถุงค้างของลูกค้าทั้งหมด</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadBalances} disabled={loading}>
          {loading ? "กำลังโหลด..." : "รีเฟรช"}
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-3 md:gap-4 mb-4 md:mb-6">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">ถุงค้างรวม</p>
            <p className="text-xl md:text-2xl font-bold text-orange-600 dark:text-orange-400">
              {formatNumber(totalOutstanding)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">ลูกค้ามีถุงค้าง</p>
            <p className="text-xl md:text-2xl font-bold">
              {formatNumber(customersWithBalance)}
              <span className="text-xs font-normal text-muted-foreground ml-1">ราย</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">ค้าง &gt; 100 ใบ</p>
            <p className="text-xl md:text-2xl font-bold text-red-600 dark:text-red-400">
              {formatNumber(highBalanceCount)}
              <span className="text-xs font-normal text-muted-foreground ml-1">ราย</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 md:gap-6">
        {/* Customer List */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                ลูกค้า ({filtered.length}
                {filtered.length !== balances.length && ` / ${balances.length}`} ราย)
              </CardTitle>
              <div className="space-y-2 pt-2">
                <Input
                  placeholder="Customer name or #id"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="h-8 text-sm"
                />
                <div className="flex items-center gap-2">
                  <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
                    <SelectTrigger className="h-7 text-xs flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="balance">เรียงตามยอดค้าง</SelectItem>
                      <SelectItem value="totalOut">เรียงตามถุงออก</SelectItem>
                      <SelectItem value="name">เรียงตามชื่อ</SelectItem>
                    </SelectContent>
                  </Select>
                  <button
                    onClick={() => setShowZero(!showZero)}
                    className={`text-xs px-2 py-1 rounded border whitespace-nowrap transition-colors ${
                      showZero
                        ? "bg-blue-50 border-blue-300 text-blue-700 dark:bg-blue-950 dark:border-blue-700 dark:text-blue-300"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {showZero ? "แสดงทั้งหมด" : "ซ่อนยอด 0"}
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2 py-2">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground text-sm">
                  {search ? "ไม่พบลูกค้าที่ตรงกับการค้นหา" : "ไม่มีข้อมูล"}
                </p>
              ) : (
                <div className="space-y-1 max-h-[calc(100vh-420px)] min-h-[300px] overflow-y-auto">
                  {filtered.map((b) => (
                    <button
                      key={b.customerId}
                      onClick={() => viewCustomerLedger(b)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                        selectedCustomer?.customerId === b.customerId
                          ? "bg-blue-50 border border-blue-200 dark:bg-blue-950 dark:border-blue-800"
                          : "hover:bg-muted"
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-medium truncate">{b.customerName}</span>
                        <Badge
                          variant={b.balance > 100 ? "destructive" : b.balance > 0 ? "default" : "secondary"}
                          className="ml-2 shrink-0 tabular-nums"
                        >
                          {formatNumber(b.balance)}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex gap-2">
                        <span>ออก {formatNumber(b.totalOut)}</span>
                        <span className="text-muted-foreground/50">|</span>
                        <span>คืน {formatNumber(b.totalReturn)}</span>
                        {b.totalAdjust !== 0 && (
                          <>
                            <span className="text-muted-foreground/50">|</span>
                            <span>ปรับ {formatNumber(b.totalAdjust)}</span>
                          </>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-3">
          {selectedCustomer ? (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{selectedCustomer.customerName}</CardTitle>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-sm">
                        ยอดคงเหลือ:{" "}
                        <span className={`font-bold tabular-nums ${selectedCustomer.balance > 0 ? "text-orange-600 dark:text-orange-400" : "text-green-600 dark:text-green-400"}`}>
                          {formatNumber(selectedCustomer.balance)} ใบ
                        </span>
                      </span>
                    </div>
                    <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                      <span>ออก: {formatNumber(selectedCustomer.totalOut)}</span>
                      <span>คืน: {formatNumber(selectedCustomer.totalReturn)}</span>
                      {selectedCustomer.totalAdjust !== 0 && (
                        <span>ปรับ: {formatNumber(selectedCustomer.totalAdjust)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950 text-xs"
                      onClick={() => openClearDialog(selectedCustomer.customerId, selectedCustomer.customerName)}
                    >
                      ล้างรายการ
                    </Button>
                    <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline" onClick={() => openAdjustDialog(selectedCustomer.customerId)}>
                          ปรับยอด / คืนถุง
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>ปรับยอดถุง — {selectedCustomer.customerName}</DialogTitle>
                          <DialogDescription>
                            ยอดคงเหลือปัจจุบัน: {formatNumber(selectedCustomer.balance)} ใบ
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 pt-2">
                          <div className="space-y-2">
                            <Label>ประเภท</Label>
                            <Select value={adjustType} onValueChange={setAdjustType}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="return">คืนถุง (ลดยอดค้าง)</SelectItem>
                                <SelectItem value="adjust">ปรับปรุงยอด</SelectItem>
                                <SelectItem value="out">ถุงออกเพิ่ม (เพิ่มยอดค้าง)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>จำนวน (ใบ)</Label>
                            <Input
                              type="number"
                              value={adjustQty}
                              onChange={(e) => setAdjustQty(e.target.value)}
                              placeholder="0"
                              min={1}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>หมายเหตุ *</Label>
                            <Input
                              value={adjustNote}
                              onChange={(e) => setAdjustNote(e.target.value)}
                              placeholder="เหตุผลการปรับปรุง"
                            />
                          </div>
                          <Button
                            onClick={handleAdjust}
                            disabled={saving || !adjustQty || !adjustNote}
                            className="w-full"
                          >
                            {saving ? "กำลังบันทึก..." : "บันทึก"}
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                    {authUser?.role === "admin" && supplyItems.length > 0 ? (
                      <Dialog open={supplyOpen} onOpenChange={setSupplyOpen}>
                        <DialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openSupplyConvertDialog(selectedCustomer)}
                          >
                            นำเข้า Supply Stock
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>นำถุงเข้า Supply Stock</DialogTitle>
                            <DialogDescription>
                              ใช้สำหรับบันทึกรับถุงเข้า stock ของ supply แบบ manual เท่านั้น
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4 pt-2">
                            <div className="space-y-2">
                              <Label>Supply item</Label>
                              <Select value={supplyItemId} onValueChange={setSupplyItemId}>
                                <SelectTrigger><SelectValue placeholder="เลือกของใช้" /></SelectTrigger>
                                <SelectContent>
                                  {supplyItems.map((item) => (
                                    <SelectItem key={item.id} value={String(item.id)}>
                                      {item.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label>จำนวน (ใบ)</Label>
                              <Input
                                type="number"
                                value={supplyQty}
                                onChange={(e) => setSupplyQty(e.target.value)}
                                placeholder="0"
                                min={1}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>หมายเหตุ</Label>
                              <Input
                                value={supplyNote}
                                onChange={(e) => setSupplyNote(e.target.value)}
                                placeholder="เหตุผลการนำเข้า Supply"
                              />
                            </div>
                            <Button
                              onClick={handleSupplyImport}
                              disabled={supplySaving || !supplyItemId || !supplyQty}
                              className="w-full"
                            >
                              {supplySaving ? "กำลังบันทึก..." : "บันทึกเข้า Supply"}
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-3 flex flex-wrap items-end gap-2">
                  <div>
                    <Label className="text-xs">From</Label>
                    <Input
                      type="date"
                      value={ledgerFrom}
                      onChange={(e) => setLedgerFrom(e.target.value)}
                      className="h-8 w-40 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">To</Label>
                    <Input
                      type="date"
                      value={ledgerTo}
                      onChange={(e) => setLedgerTo(e.target.value)}
                      className="h-8 w-40 text-xs"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => void viewCustomerLedger(selectedCustomer)}
                  >
                    Apply
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8"
                    onClick={() => {
                      setLedgerFrom("");
                      setLedgerTo("");
                      void viewCustomerLedger(selectedCustomer, { from: "", to: "" });
                    }}
                  >
                    Reset
                  </Button>
                </div>
                {entriesLoading ? (
                  <div className="space-y-2 py-4">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="h-10 bg-muted animate-pulse rounded" />
                    ))}
                  </div>
                ) : entries.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground text-sm">ไม่มีรายการ</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-28">วันเวลา</TableHead>
                          <TableHead className="w-16">ประเภท</TableHead>
                          <TableHead className="text-right w-20">จำนวน</TableHead>
                          <TableHead className="text-right w-24">คงเหลือ</TableHead>
                          <TableHead>หมายเหตุ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {entriesWithRunning.map((e) => {
                          const timestamp = formatLedgerDateTimeParts(e.createdAt);
                          const billLabel = e.transaction?.billNumber || `บิล #${e.transaction?.id}`;

                          return (
                            <TableRow key={e.id}>
                              <TableCell className="text-xs tabular-nums">
                                <div className="flex flex-col">
                                  <span>{timestamp.date}</span>
                                  <span className="text-muted-foreground">{timestamp.time}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                {e.type === "out" && (
                                  <Badge variant="destructive" className="text-xs">ออก</Badge>
                                )}
                                {e.type === "return" && (
                                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs">คืน</Badge>
                                )}
                                {e.type === "adjust" && (
                                  <Badge variant="secondary" className="text-xs">ปรับ</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-medium text-sm tabular-nums">
                                <span
                                  className={
                                    e.balanceDelta > 0
                                      ? "text-red-600 dark:text-red-400"
                                      : e.balanceDelta < 0
                                        ? "text-green-600 dark:text-green-400"
                                        : "text-gray-500 dark:text-gray-400"
                                  }
                                >
                                  {e.balanceDelta > 0 ? "+" : ""}{formatNumber(e.balanceDelta)}
                                </span>
                              </TableCell>
                              <TableCell className="text-right text-sm tabular-nums font-medium">
                                {formatNumber(e.runningBalance)}
                              </TableCell>
                              <TableCell className="max-w-48 text-xs text-muted-foreground">
                                <div className="flex flex-col gap-1">
                                  {e.note && (
                                    <span className="truncate">{e.note}</span>
                                  )}
                                  {e.transaction ? (
                                    <Link
                                      href={`/transactions?transactionId=${e.transaction.id}`}
                                      className="w-fit text-blue-600 transition-colors hover:text-blue-700 hover:underline"
                                    >
                                      {billLabel}
                                    </Link>
                                  ) : !e.note ? (
                                    <span>-</span>
                                  ) : null}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-20 text-center text-muted-foreground">
                <div className="text-4xl mb-3 opacity-30">📦</div>
                <p className="hidden md:block">เลือกลูกค้าจากรายการด้านซ้ายเพื่อดูรายละเอียดถุง</p>
                <p className="md:hidden">เลือกลูกค้าจากรายการด้านบนเพื่อดูรายละเอียดถุง</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Clear Confirmation Dialog */}
      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ล้างรายการถุง</DialogTitle>
            <DialogDescription>
              ลบรายการถุงทั้งหมดของ <strong>{clearCustomerName}</strong> ออกจากระบบ
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-3">
              <p className="text-sm text-red-800 dark:text-red-200 font-medium">
                คำเตือน: การดำเนินการนี้ไม่สามารถย้อนกลับได้
              </p>
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                รายการถุงทั้งหมดของลูกค้ารายนี้จะถูกลบ และยอดถุงจะกลับเป็น 0
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setClearOpen(false)}>
                ยกเลิก
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={handleClear}
                disabled={clearing}
              >
                {clearing ? "กำลังลบ..." : "ยืนยันล้างรายการ"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
