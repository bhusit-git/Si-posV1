"use client";

import { useEffect, useState, useCallback, useRef, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { PrintedBillCounter } from "@/components/printed-bill-counter";
import { formatCurrency, formatThaiDate, todayISO, nowTimeISO } from "@/lib/thai-utils";
import type { ProductType, Customer } from "@/lib/types";
import {
  INVOICE_CREDIT_LABEL,
  SHORT_TERM_CREDIT_LABEL,
  isInvoiceCreditTransaction,
} from "@/lib/customer-credit-labels";

interface RecentTransactionItem {
  quantity: number;
  unitPrice: number;
  subtotal: number;
  productType: { id: number; name: string; hasBag: boolean };
}

interface RecentTransaction {
  id: number;
  billNumber?: string;
  saleDate: string;
  saleTime: string;
  totalAmount: number;
  paid: number;
  status: string;
  transactionKind?: "sale" | "transfer_out" | "return" | "adjustment" | null;
  pool: number | null;
  row: number | null;
  items: RecentTransactionItem[];
}

const RECENT_TRANSACTION_FETCH_LIMIT = 10;
const RECENT_TRANSACTION_SHOW_LIMIT = 5;

function isReturnableRecentTransaction(tx: RecentTransaction): boolean {
  if (tx.status === "voided") return false;
  if ((tx.totalAmount || 0) > 0) return true;
  return tx.transactionKind === "transfer_out";
}

function statusText(status: string): string {
  if (status === "paid") return "ชำระแล้ว";
  if (status === "unpaid") return "ค้างชำระ";
  if (status === "partial") return "บางส่วน";
  if (status === "voided") return "ยกเลิก";
  return status;
}

function openReturnPrint(
  transactionId: number,
  sessionRole: string | null,
  canUseEpsonPrintTools: boolean
) {
  const params = new URLSearchParams();
  params.set("autoclose", "1");
  if (sessionRole === "manager") {
    params.set("minimal", "1");
  }
  if (!canUseEpsonPrintTools) {
    params.set("simple", "1");
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  window.open(`/print/preprinted-bill/${transactionId}${suffix}`, "_blank", "width=900,height=700");
}

export default function ReturnsPage() {
  const [products, setProducts] = useState<ProductType[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showCustomerList, setShowCustomerList] = useState(false);
  const [highlightedCustomerIndex, setHighlightedCustomerIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [bagReturnQty, setBagReturnQty] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const highlightedCustomerRef = useRef<HTMLButtonElement>(null);

  const [recentTxs, setRecentTxs] = useState<RecentTransaction[]>([]);
  const [selectedTxId, setSelectedTxId] = useState<number | null>(null);
  const [loadingTxs, setLoadingTxs] = useState(false);
  const [sessionRole, setSessionRole] = useState<string | null>(null);
  const [nextBillNumber, setNextBillNumber] = useState<number | null>(null);
  const [loadingBillCounter, setLoadingBillCounter] = useState(false);
  const [savingBillCounter, setSavingBillCounter] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  const canUseEpsonPrintTools =
    sessionRole === "admin" || sessionRole === "office";

  const selectedTx = selectedTxId
    ? recentTxs.find((tx) => tx.id === selectedTxId) || null
    : null;

  const selectedReturnItems = (selectedTx?.items || []).filter((i) => i.quantity > 0);
  const totalRefund = selectedReturnItems.reduce(
    (sum, i) => sum + Math.max(0, i.quantity || 0) * Math.max(0, i.unitPrice || 0),
    0
  );
  const canSubmit = !!selectedCustomer && (selectedReturnItems.length > 0 || bagReturnQty > 0) && !saving;

  useEffect(() => {
    fetch("/api/products")
      .then((r) => r.json())
      .then((data) => {
        setProducts(data.filter((p: ProductType) => p.isActive));
      })
      .catch(() => {
        toast.error("โหลดข้อมูลสินค้าไม่สำเร็จ");
      });
  }, []);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setSessionRole(typeof data?.role === "string" ? data.role : null))
      .catch(() => setSessionRole(null));
  }, []);

  useEffect(() => {
    setIsOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const loadBillCounter = useCallback(async () => {
    setLoadingBillCounter(true);
    try {
      const res = await fetch("/api/bill-counter");
      if (!res.ok) throw new Error("load_bill_counter_failed");
      const data = await res.json();
      setNextBillNumber(typeof data?.nextBillNumber === "number" ? data.nextBillNumber : null);
    } catch {
      setNextBillNumber(null);
    } finally {
      setLoadingBillCounter(false);
    }
  }, []);

  useEffect(() => {
    if (!isOnline) return;
    void loadBillCounter();
  }, [isOnline, loadBillCounter]);

  const handleBillCounterCommit = useCallback(async (requestedNextBillNumber: number) => {
    setSavingBillCounter(true);
    try {
      const res = await fetch("/api/bill-counter", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nextBillNumber: requestedNextBillNumber,
          sourcePage: "returns",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(typeof data?.error === "string" ? data.error : "save_bill_counter_failed");
      }
      const data = await res.json();
      setNextBillNumber(typeof data?.nextBillNumber === "number" ? data.nextBillNumber : requestedNextBillNumber);
      toast.success("อัปเดตเลขบิลถัดไปแล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "อัปเดตเลขบิลไม่สำเร็จ");
      void loadBillCounter();
    } finally {
      setSavingBillCounter(false);
    }
  }, [loadBillCounter]);

  const searchCustomers = useCallback(async (query: string) => {
    try {
      const res = await fetch(`/api/customers?search=${encodeURIComponent(query)}`);
      const data = await res.json();
      setCustomers(Array.isArray(data) ? data : []);
    } catch {
      setCustomers([]);
    }
  }, []);

  const loadAllCustomersForDropdown = useCallback(async () => {
    try {
      const res = await fetch("/api/customers?search=");
      const data = await res.json();
      const sorted = Array.isArray(data)
        ? [...data].sort((a: Customer, b: Customer) => (a.name || "").localeCompare(b.name || "", "th"))
        : [];
      setCustomers(sorted);
    } catch {
      setCustomers([]);
    }
  }, []);

  useEffect(() => {
    if (!selectedCustomer && searchQuery.length > 0) {
      const timer = setTimeout(() => searchCustomers(searchQuery), 200);
      return () => clearTimeout(timer);
    }

    if (!selectedCustomer && !searchQuery) {
      setCustomers([]);
    }
  }, [searchQuery, selectedCustomer, searchCustomers]);

  useEffect(() => {
    if (customers.length > 0) setHighlightedCustomerIndex(0);
  }, [customers]);

  useEffect(() => {
    if (showCustomerList && customers.length > 0) {
      if (typeof highlightedCustomerRef.current?.scrollIntoView === "function") {
        highlightedCustomerRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [highlightedCustomerIndex, showCustomerList, customers.length]);

  const fetchRecentTransactions = useCallback(async (customerId: number) => {
    setLoadingTxs(true);
    try {
      const txRes = await fetch(
        `/api/transactions?customerId=${customerId}&limit=${RECENT_TRANSACTION_FETCH_LIMIT}`
      );
      const txData: RecentTransaction[] = await txRes.json();
      const filtered = txData
        .filter(isReturnableRecentTransaction)
        .slice(0, RECENT_TRANSACTION_SHOW_LIMIT);
      setRecentTxs(filtered);
    } catch {
      setRecentTxs([]);
    } finally {
      setLoadingTxs(false);
    }
  }, []);

  async function selectCustomer(customer: Customer) {
    setSelectedCustomer(customer);
    setShowCustomerList(false);
    setSearchQuery(customer.name);
    setSelectedTxId(null);
    setBagReturnQty(0);
    setNote("");
    await fetchRecentTransactions(customer.id);
  }

  function selectTransaction(tx: RecentTransaction) {
    setSelectedTxId(tx.id);
  }

  function clearSelectedBill() {
    setSelectedTxId(null);
  }

  function handleClear() {
    setSelectedCustomer(null);
    setSearchQuery("");
    setCustomers([]);
    setRecentTxs([]);
    setSelectedTxId(null);
    setBagReturnQty(0);
    setNote("");
    setShowCustomerList(false);
    searchRef.current?.focus();
  }

  function handleCustomerSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!showCustomerList || customers.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedCustomerIndex((i) => Math.min(i + 1, customers.length - 1));
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedCustomerIndex((i) => Math.max(0, i - 1));
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const idx =
        highlightedCustomerIndex >= 0 && highlightedCustomerIndex < customers.length
          ? highlightedCustomerIndex
          : 0;
      void selectCustomer(customers[idx]);
      setShowCustomerList(false);
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      setShowCustomerList(false);
    }
  }

  async function handleSave() {
    if (!selectedCustomer) return;
    if (selectedReturnItems.length === 0 && bagReturnQty === 0) return;

    setSaving(true);
    try {
      const bagPt = products.find((p) => p.hasBag);
      const bagReturnsPayload =
        bagReturnQty > 0 && bagPt
          ? [{ productTypeId: bagPt.id, quantity: bagReturnQty }]
          : [];

      const res = await fetch("/api/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: selectedCustomer.id,
          items: selectedReturnItems.map((i) => ({
            productTypeId: i.productType.id,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          })),
          bagReturns: bagReturnsPayload,
          saleDate: todayISO(),
          saleTime: nowTimeISO(),
          note: note || "",
          originalBill: selectedTxId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (typeof data?.nextBillNumber === "number") {
          setNextBillNumber(data.nextBillNumber);
        }

        toast.success(`คืนสินค้าสำเร็จ ${data.billNumber || "#" + data.id}`, {
          description: `คืนเงิน ${formatCurrency(totalRefund)} บาท${bagReturnQty > 0 ? ` + คืนถุง ${bagReturnQty} ใบ` : ""}`,
        });

        openReturnPrint(data.id, sessionRole, canUseEpsonPrintTools);

        setSelectedTxId(null);
        setBagReturnQty(0);
        setNote("");

        await fetchRecentTransactions(selectedCustomer.id);
      } else {
        const errData = await res.json().catch(() => null);
        const errMsg = errData?.error || "กรุณาลองใหม่";
        toast.error("บันทึกไม่สำเร็จ", { description: errMsg });
      }
    } finally {
      setSaving(false);
    }
  }

  const hasBagProducts = products.some((p) => p.hasBag);

  return (
    <div className="w-full xl:h-[calc(100vh-3rem)] 2xl:h-[calc(100vh-3.5rem)] xl:overflow-hidden xl:flex xl:flex-col">
      <div className="flex items-center justify-between mb-4 shrink-0 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">คืนสินค้า</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">เลือกบิลเดิมเพื่อตั้งรายการคืน (แก้ไขไม่ได้)</p>
        </div>
        <PrintedBillCounter
          value={nextBillNumber}
          loading={loadingBillCounter}
          saving={savingBillCounter}
          disabled={!isOnline}
          onCommit={handleBillCounterCommit}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] gap-4 xl:flex-1 xl:min-h-0">
        <div className="space-y-4 xl:min-h-0 xl:flex xl:flex-col">
          <Card className="py-2 gap-2">
            <CardHeader className="pb-2 px-4">
              <CardTitle className="text-base xl:text-lg">เลือกลูกค้า</CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <div className="relative">
                <div className="flex gap-1">
                  <Input
                    ref={searchRef}
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setShowCustomerList(true);
                      if (!e.target.value) {
                        setSelectedCustomer(null);
                        setRecentTxs([]);
                        setSelectedTxId(null);
                        setBagReturnQty(0);
                      }
                    }}
                    onFocus={() => {
                      if (searchQuery) setShowCustomerList(true);
                    }}
                    onKeyDown={handleCustomerSearchKeyDown}
                    placeholder="พิมพ์ชื่อหรือรหัสลูกค้า..."
                    autoFocus
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0 h-10 w-10"
                    onClick={() => {
                      if (showCustomerList) {
                        setShowCustomerList(false);
                      } else {
                        setShowCustomerList(true);
                        setHighlightedCustomerIndex(0);
                        void loadAllCustomersForDropdown();
                        searchRef.current?.focus();
                      }
                    }}
                    aria-expanded={showCustomerList}
                    aria-label={showCustomerList ? "ปิดรายชื่อลูกค้า" : "เปิดรายชื่อลูกค้า (เรียง ก-ฮ)"}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={showCustomerList ? "rotate-180" : ""}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </Button>
                </div>
                {showCustomerList && (
                  <div className="absolute z-50 w-full mt-1 left-0 right-0 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {customers.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-gray-500">ไม่พบลูกค้าที่ค้นหา</div>
                    ) : (
                      customers.map((c, i) => (
                        <button
                          key={c.id}
                          ref={i === highlightedCustomerIndex ? highlightedCustomerRef : undefined}
                          type="button"
                          className={`w-full text-left px-4 py-3 md:py-2 flex justify-between items-center hover:bg-blue-50 dark:hover:bg-blue-900/20 ${
                            i === highlightedCustomerIndex ? "bg-blue-100 dark:bg-blue-900/30" : ""
                          }`}
                          onClick={() => void selectCustomer(c)}
                        >
                          <span className="font-medium">{c.name}</span>
                          <span className="text-xs text-gray-400">#{c.id}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {selectedCustomer && (
                <div className="mt-2 flex items-center gap-2">
                  <Badge>{selectedCustomer.name}</Badge>
                  {selectedCustomer.credit && <Badge variant="destructive">{SHORT_TERM_CREDIT_LABEL}</Badge>}
                  <Button variant="ghost" size="sm" className="ml-auto text-xs" onClick={handleClear}>
                    เปลี่ยนลูกค้า
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {selectedCustomer && (
            <Card className="py-2 gap-2">
              <CardHeader className="pb-2 px-4">
                <CardTitle className="text-base xl:text-lg">เลือกบิลอ้างอิง</CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                {loadingTxs ? (
                  <p className="text-sm text-gray-500 py-2">กำลังโหลด...</p>
                ) : recentTxs.length === 0 ? (
                  <p className="text-sm text-gray-500 py-2">ไม่พบบิลที่ใช้คืนได้ของลูกค้ารายนี้</p>
                ) : (
                  <div className="space-y-2">
                    {recentTxs.map((tx) => {
                      const isSelected = selectedTxId === tx.id;
                      const isInvoiceCreditBill = isInvoiceCreditTransaction(tx.transactionKind);
                      return (
                        <button
                          key={tx.id}
                          onClick={() => selectTransaction(tx)}
                          className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
                            isSelected
                              ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40 dark:border-blue-400"
                              : "border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 hover:bg-gray-50 dark:hover:bg-gray-800"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold">{tx.billNumber || `บิล #${tx.id}`}</span>
                              {isInvoiceCreditBill && (
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                  {INVOICE_CREDIT_LABEL}
                                </Badge>
                              )}
                              <Badge variant={tx.status === "paid" ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
                                {statusText(tx.status)}
                              </Badge>
                            </div>
                            <span className="text-sm font-bold">{formatCurrency(tx.totalAmount)}</span>
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {formatThaiDate(tx.saleDate)} {tx.saleTime?.slice(0, 5)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {selectedTx && (
            <Card className="py-2 gap-2 xl:flex-1 xl:min-h-0 xl:flex xl:flex-col">
              <CardHeader className="pb-2 px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base xl:text-lg">รายละเอียดบิล (อ่านอย่างเดียว)</CardTitle>
                  <Button variant="ghost" size="sm" className="text-xs" onClick={clearSelectedBill}>
                    ยกเลิกการเลือกบิล
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="px-4 xl:min-h-0 xl:overflow-y-auto">
                <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                  <div><strong>บิล:</strong> #{selectedTx.id}</div>
                  <div><strong>สถานะ:</strong> {statusText(selectedTx.status)}</div>
                  <div>
                    <strong>ประเภท:</strong>{" "}
                    {isInvoiceCreditTransaction(selectedTx.transactionKind) ? INVOICE_CREDIT_LABEL : "ขายปกติ"}
                  </div>
                  <div><strong>วันที่:</strong> {formatThaiDate(selectedTx.saleDate)}</div>
                  <div><strong>เวลา:</strong> {selectedTx.saleTime?.slice(0, 5)}</div>
                  {selectedTx.pool && selectedTx.row && (
                    <div><strong>ที่โหลด:</strong> {selectedTx.pool}-{selectedTx.row}</div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-gray-500 px-1">
                    <div className="col-span-6">สินค้า</div>
                    <div className="col-span-2 text-right">จำนวน</div>
                    <div className="col-span-2 text-right">ราคา</div>
                    <div className="col-span-2 text-right">รวม</div>
                  </div>
                  <Separator />
                  {selectedReturnItems.map((item) => (
                    <div key={item.productType.id} className="grid grid-cols-12 gap-2 items-center text-sm">
                      <div className="col-span-6 font-medium">{item.productType.name}</div>
                      <div className="col-span-2 text-right">{item.quantity}</div>
                      <div className="col-span-2 text-right">{formatCurrency(item.unitPrice)}</div>
                      <div className="col-span-2 text-right font-medium">{formatCurrency(item.subtotal)}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4 xl:min-h-0 xl:flex xl:flex-col">
          <Card className="shrink-0 py-4 gap-4">
            <CardHeader className="pb-2 px-4">
              <CardTitle className="text-base xl:text-lg flex items-center gap-2">
                <Undo2 size={16} />
                สรุปการคืน
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 space-y-3">
              {!selectedCustomer ? (
                <p className="text-sm text-gray-400">เลือกลูกค้า</p>
              ) : selectedReturnItems.length === 0 && bagReturnQty === 0 ? (
                <p className="text-sm text-gray-400">เลือกบิล หรือใส่จำนวนคืนถุง</p>
              ) : (
                <>
                  {selectedTx && (
                    <div className="text-sm text-gray-600 dark:text-gray-300">
                      อ้างอิงบิล <span className="font-medium">#{selectedTx.id}</span>
                    </div>
                  )}

                  {selectedTx && isInvoiceCreditTransaction(selectedTx.transactionKind) && (
                    <div className="text-sm rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-blue-900">
                      การคืนบิล{INVOICE_CREDIT_LABEL}จะหักจากยอดใบวางบิลในรอบถัดไป และจะไม่สร้างการคืนเงินสดอัตโนมัติ
                    </div>
                  )}

                  {selectedReturnItems.map((i) => (
                    <div key={i.productType.id} className="flex justify-between text-sm">
                      <span>{i.productType.name} x{i.quantity}</span>
                      <span className="font-medium">{formatCurrency(i.subtotal)}</span>
                    </div>
                  ))}

                  {selectedReturnItems.length > 0 && <Separator />}

                  <div className="flex justify-between text-lg font-bold">
                    <span>คืนเงินรวม</span>
                    <span className="text-green-700 dark:text-green-400">{formatCurrency(totalRefund)}</span>
                  </div>

                  {bagReturnQty > 0 && (
                    <div className="text-sm">คืนถุง: <span className="font-medium">{bagReturnQty}</span> ใบ</div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {selectedCustomer && hasBagProducts && (
            <Card className="shrink-0 py-4 gap-4">
              <CardHeader className="pb-2 px-4">
                <CardTitle className="text-base">ปรับคืนถุง</CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <div className="flex items-center gap-3">
                  <Label className="text-sm shrink-0">จำนวนถุงคืน</Label>
                  <Input
                    type="number"
                    className="h-9 text-sm w-28"
                    value={bagReturnQty || ""}
                    min={0}
                    onChange={(e) => setBagReturnQty(parseInt(e.target.value) || 0)}
                    placeholder="0"
                  />
                  <span className="text-sm text-gray-500 dark:text-gray-400">ใบ</span>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="shrink-0 py-4 gap-4">
            <CardHeader className="pb-2 px-4">
              <CardTitle className="text-base">หมายเหตุ</CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="เหตุผลการคืนสินค้า"
              />
            </CardContent>
          </Card>

          <div className="space-y-2 shrink-0">
            <Button
              className="w-full"
              size="lg"
              onClick={handleSave}
              disabled={!canSubmit}
            >
              {saving ? "กำลังบันทึก..." : "บันทึกการคืน"}
            </Button>
            <Button variant="outline" className="w-full" onClick={handleClear}>
              ล้างข้อมูล
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
