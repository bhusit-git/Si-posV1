"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, formatThaiDate, todayISO } from "@/lib/thai-utils";
import {
  formatCustomerDisplay,
  useShowCustomerIdWithName,
} from "@/lib/customer-display";
import { matchesTransactionSearchQuery } from "@/lib/filter-utils";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { getBagEntryBalanceDelta } from "@/lib/bag-flow";
import { computeFinancialTotals } from "@/lib/financial-totals";

// ---- Date helpers ----
function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DATE_SHORTCUTS = [
  { key: "today", label: "วันนี้" },
  { key: "yesterday", label: "เมื่อวาน" },
  { key: "thisWeek", label: "สัปดาห์นี้" },
  { key: "lastWeek", label: "สัปดาห์ก่อน" },
  { key: "thisMonth", label: "เดือนนี้" },
  { key: "lastMonth", label: "เดือนก่อน" },
  { key: "last3Months", label: "3 เดือน" },
  { key: "all", label: "ทั้งหมด" },
];

interface Transaction {
  id: number;
  customerId: number;
  billNumber?: string;
  internalReference?: string;
  printedBillNumber?: number | null;
  totalAmount: number;
  paid: number;
  status: string;
  saleDate: string;
  saleTime: string;
  transactionKind?: string | null;
  pool: number | null;
  row: number | null;
  col: number | null;
  note?: string | null;
  customer: { id: number; name: string };
  items: { productType: { name: string }; quantity: number; unitPrice: number; subtotal: number }[];
  bagLedgerEntries?: {
    id: number;
    type: "out" | "return" | "adjust";
    quantity: number;
    note?: string | null;
    transactionId?: number | null;
    productType?: { name: string } | null;
  }[];
}

interface CountOnlyResponse {
  count: number;
}

function extractReferenceBillId(note?: string | null): number | null {
  if (!note) return null;
  const match = note.match(/อ้างอิงบิล\s*#\s*(\d+)/);
  if (!match) return null;
  const id = Number.parseInt(match[1], 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Maximum rows to render in the browser before we paginate
const PAGE_SIZE = 500;

function buildTxCursor(tx?: Pick<Transaction, "id" | "saleDate" | "saleTime" | "status"> | null): string {
  if (!tx) return "none";
  return `${tx.id}:${tx.saleDate}:${tx.saleTime}:${tx.status}`;
}

export default function TransactionsPage() {
  const searchParams = useSearchParams();
  const showCustomerIdWithName = useShowCustomerIdWithName();
  const deepLinkedTransactionId = searchParams.get("transactionId");
  const lastDeepLinkedTransactionId = useRef<number | null>(null);
  const initialDate = todayISO();
  const [txList, setTxList] = useState<Transaction[]>([]);
  const [sessionRole, setSessionRole] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(initialDate);
  const [endDate, setEndDate] = useState(initialDate);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCustomer, setFilterCustomer] = useState("");
  const [draftStartDate, setDraftStartDate] = useState(initialDate);
  const [draftEndDate, setDraftEndDate] = useState(initialDate);
  const [draftFilterStatus, setDraftFilterStatus] = useState("all");
  const [draftFilterCustomer, setDraftFilterCustomer] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  // Inline payment state
  const [payAmount, setPayAmount] = useState("");
  const [showPayForm, setShowPayForm] = useState(false);
  const [paying, setPaying] = useState(false);
  const [openingReference, setOpeningReference] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [pendingRefreshCount, setPendingRefreshCount] = useState(0);

  // Pagination
  const [displayLimit, setDisplayLimit] = useState(PAGE_SIZE);

  // Quick date shortcut
  const [activeQuick, setActiveQuick] = useState("today");
  const canUseEpsonPrintTools =
    sessionRole === "admin" || sessionRole === "office";

  function applyQuickRange(key: string) {
    const now = new Date();
    let s: Date, e: Date;
    switch (key) {
      case "today":
        s = now; e = now; break;
      case "yesterday": {
        const y = new Date(now);
        y.setDate(y.getDate() - 1);
        s = y; e = y; break;
      }
      case "thisWeek":
        s = getMonday(now); e = now; break;
      case "lastWeek": {
        const lm = getMonday(now);
        lm.setDate(lm.getDate() - 7);
        const ls = new Date(lm);
        ls.setDate(ls.getDate() + 6);
        s = lm; e = ls; break;
      }
      case "thisMonth":
        s = new Date(now.getFullYear(), now.getMonth(), 1); e = now; break;
      case "lastMonth":
        s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        e = new Date(now.getFullYear(), now.getMonth(), 0); break;
      case "last3Months":
        s = new Date(now.getFullYear(), now.getMonth() - 3, 1); e = now; break;
      case "all":
        s = new Date(2000, 0, 1); e = now; break;
      default: return;
    }
    setDraftStartDate(toISO(s));
    setDraftEndDate(toISO(e));
    setActiveQuick(key);
  }

  function applyFilters() {
    setStartDate(draftStartDate);
    setEndDate(draftEndDate);
    setFilterStatus(draftFilterStatus);
    setFilterCustomer(draftFilterCustomer);
  }

  function resetFilters() {
    setDraftStartDate(initialDate);
    setDraftEndDate(initialDate);
    setDraftFilterStatus("all");
    setDraftFilterCustomer("");
    setStartDate(initialDate);
    setEndDate(initialDate);
    setFilterStatus("all");
    setFilterCustomer("");
    setActiveQuick("today");
  }

  const loadTransactions = useCallback(
    async (options?: { showLoader?: boolean; resetDisplayLimit?: boolean }) => {
      const showLoader = options?.showLoader ?? true;
      const resetDisplayLimit = options?.resetDisplayLimit ?? true;
      if (showLoader) setLoading(true);
      if (resetDisplayLimit) setDisplayLimit(PAGE_SIZE);

      try {
        const params = new URLSearchParams();
        params.set("startDate", startDate);
        params.set("endDate", endDate);
        if (filterCustomer.trim()) params.set("customerQuery", filterCustomer.trim());
        // No hard limit -- the API now returns all matching rows when date range is set

        if (filterStatus !== "all") {
          // Specific status: single fetch
          params.set("status", filterStatus);
          const res = await fetch(`/api/transactions?${params}`);
          if (!res.ok) throw new Error("load_transactions_failed");
          const data: Transaction[] = await res.json();
          setTxList(data);
        } else {
          // Fetch non-voided + voided separately, merge
          const [res, res2] = await Promise.all([
            fetch(`/api/transactions?${params}`),
            fetch(`/api/transactions?${params}&status=voided`),
          ]);
          if (!res.ok || !res2.ok) throw new Error("load_transactions_failed");
          const data: Transaction[] = await res.json();
          const voided: Transaction[] = await res2.json();

          const all = [...data, ...voided].sort((a, b) => {
            if (a.saleDate !== b.saleDate) return b.saleDate.localeCompare(a.saleDate);
            return b.saleTime.localeCompare(a.saleTime);
          });

          const seen = new Set<number>();
          const unique = all.filter((t) => {
            if (seen.has(t.id)) return false;
            seen.add(t.id);
            return true;
          });

          setTxList(unique);
        }
        setPendingRefreshCount(0);
      } catch {
        if (showLoader) {
          toast.error("โหลดรายการไม่สำเร็จ");
        }
      } finally {
        if (showLoader) setLoading(false);
      }
    },
    [startDate, endDate, filterStatus, filterCustomer]
  );

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setSessionRole(typeof data?.role === "string" ? data.role : null))
      .catch(() => setSessionRole(null));
  }, []);

  function triggerReprint(txId: number) {
    const params = new URLSearchParams();
    params.set("autoclose", "1");
    if (sessionRole === "manager") {
      params.set("minimal", "1");
    }
    if (!canUseEpsonPrintTools) {
      params.set("simple", "1");
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    window.open(`/print/preprinted-bill/${txId}${suffix}`, "_blank", "width=900,height=700");
  }

  const currentTopCursor = useMemo(() => {
    if (filterStatus !== "all") {
      return buildTxCursor(txList[0]);
    }
    const topNonVoided = txList.find((tx) => tx.status !== "voided");
    const topVoided = txList.find((tx) => tx.status === "voided");
    return `${buildTxCursor(topNonVoided)}|${buildTxCursor(topVoided)}`;
  }, [txList, filterStatus]);

  useEffect(() => {
    let isPolling = false;
    const today = todayISO();
    const includesToday = startDate <= today && endDate >= today;
    const pollMs = includesToday ? 8000 : 30000;

    async function fetchTopCursorForStatus(status?: string): Promise<string | null> {
      const params = new URLSearchParams();
      params.set("startDate", startDate);
      params.set("endDate", endDate);
      params.set("limit", "1");
      if (filterCustomer.trim()) params.set("customerQuery", filterCustomer.trim());
      if (status) params.set("status", status);

      const res = await fetch(`/api/transactions?${params}`);
      if (!res.ok) return null;
      const rows: Transaction[] = await res.json();
      return buildTxCursor(rows[0]);
    }

    async function fetchMatchingCount(): Promise<number | null> {
      const fetchCount = async (status?: string): Promise<number | null> => {
        const params = new URLSearchParams();
        params.set("startDate", startDate);
        params.set("endDate", endDate);
        params.set("countOnly", "true");
        if (filterCustomer.trim()) params.set("customerQuery", filterCustomer.trim());
        if (status) params.set("status", status);
        const res = await fetch(`/api/transactions?${params}`);
        if (!res.ok) return null;
        const data: CountOnlyResponse = await res.json();
        return data.count || 0;
      };

      if (filterStatus === "all") {
        const [activeCount, voidedCount] = await Promise.all([
          fetchCount(),
          fetchCount("voided"),
        ]);
        if (activeCount == null || voidedCount == null) return null;
        return activeCount + voidedCount;
      }

      return fetchCount(filterStatus);
    }

    async function pollForNewTransactions() {
      if (isPolling) return;
      if (loading || showDetail || showPayForm || confirmVoid || voiding || paying || openingReference) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;

      isPolling = true;
      try {
        let serverCursor: string | null = null;

        if (filterStatus === "all") {
          const [topNonVoided, topVoided] = await Promise.all([
            fetchTopCursorForStatus(),
            fetchTopCursorForStatus("voided"),
          ]);
          if (topNonVoided == null || topVoided == null) return;
          serverCursor = `${topNonVoided}|${topVoided}`;
        } else {
          serverCursor = await fetchTopCursorForStatus(filterStatus);
          if (serverCursor == null) return;
        }

        if (serverCursor === currentTopCursor) return;

        const nearTop = typeof window !== "undefined" ? window.scrollY < 140 : true;
        if (nearTop) {
          await loadTransactions({ showLoader: false, resetDisplayLimit: false });
          return;
        }

        const serverCount = await fetchMatchingCount();
        setPendingRefreshCount((prev) =>
          Math.max(
            prev,
            serverCount != null ? Math.max(1, serverCount - txList.length) : prev > 0 ? prev : 1
          )
        );
      } finally {
        isPolling = false;
      }
    }

    const intervalId = window.setInterval(() => {
      void pollForNewTransactions();
    }, pollMs);

    return () => window.clearInterval(intervalId);
  }, [
    startDate,
    endDate,
    filterStatus,
    filterCustomer,
    currentTopCursor,
    loadTransactions,
    txList.length,
    loading,
    showDetail,
    showPayForm,
    confirmVoid,
    voiding,
    paying,
    openingReference,
  ]);

  // Client-side customer filter
  const filteredTxList = filterCustomer
    ? txList.filter(
        (tx) =>
          matchesTransactionSearchQuery(
            {
              customerId: tx.customerId,
              customerName: tx.customer.name,
              printedBillNumber: tx.printedBillNumber,
            },
            filterCustomer
          )
      )
    : txList;

  // Paginated display
  const displayedTx = filteredTxList.slice(0, displayLimit);
  const hasMore = displayLimit < filteredTxList.length;

  // Summary totals (from ALL filtered data, not just displayed page)
  const summaryTotals = useMemo(
    () =>
      computeFinancialTotals(
        filteredTxList.map((tx) => ({
          status: tx.status,
          transactionKind: tx.transactionKind,
          totalAmount: tx.totalAmount,
          paid: tx.paid,
        })),
        { includeTransferOut: true }
      ),
    [filteredTxList]
  );

  function viewDetail(tx: Transaction) {
    setSelectedTx(tx);
    setShowDetail(true);
    setConfirmVoid(false);
    setShowPayForm(false);
    setPayAmount("");
    void loadTransactionDetail(tx.id);
  }

  const loadTransactionDetail = useCallback(async (id: number) => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/transactions?id=${id}`);
      if (!res.ok) throw new Error("load_tx_detail_failed");
      const data: Transaction = await res.json();
      setSelectedTx(data);
    } catch {
      toast.error(`โหลดรายละเอียดบิล #${id} ไม่สำเร็จ`);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  async function openReferencedBill(referenceId: number) {
    setOpeningReference(true);
    try {
      const res = await fetch(`/api/transactions?id=${referenceId}`);
      if (!res.ok) {
        throw new Error("reference_bill_not_found");
      }
      const refTx: Transaction = await res.json();
      setSelectedTx(refTx);
      setConfirmVoid(false);
      setShowPayForm(false);
      setPayAmount("");
      setVoidReason("");
    } catch {
      toast.error(`ไม่พบบิลอ้างอิง #${referenceId}`);
    } finally {
      setOpeningReference(false);
    }
  }

  useEffect(() => {
    if (!deepLinkedTransactionId) {
      lastDeepLinkedTransactionId.current = null;
      return;
    }

    const parsedId = Number.parseInt(deepLinkedTransactionId, 10);
    if (!Number.isInteger(parsedId) || parsedId <= 0) return;
    if (lastDeepLinkedTransactionId.current === parsedId) return;

    lastDeepLinkedTransactionId.current = parsedId;
    setSelectedTx(null);
    setShowDetail(true);
    setConfirmVoid(false);
    setShowPayForm(false);
    setPayAmount("");
    setVoidReason("");
    void loadTransactionDetail(parsedId);
  }, [deepLinkedTransactionId, loadTransactionDetail]);

  async function handleVoid() {
    if (!selectedTx) return;
    if (!voidReason.trim()) {
      toast.error("กรุณาระบุเหตุผลในการยกเลิก");
      return;
    }
    setVoiding(true);
    try {
      const res = await fetch("/api/transactions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedTx.id, action: "void", reason: voidReason.trim() }),
      });
      if (res.ok) {
        setConfirmVoid(false);
        setShowDetail(false);
        setVoidReason("");
        toast.warning(`ยกเลิกบิล #${selectedTx.id} สำเร็จ`);
        loadTransactions();
      } else {
        const data = await res.json();
        toast.error(data.error || "ยกเลิกไม่สำเร็จ");
      }
    } finally {
      setVoiding(false);
    }
  }

  async function handlePayment(options?: {
    amount?: number;
    successTitle?: string;
    successDescription?: string;
  }) {
    if (!selectedTx) return;
    const requestedAmount = options?.amount ?? parseFloat(payAmount);
    if (!Number.isFinite(requestedAmount) || requestedAmount === 0) return;
    setPaying(true);
    try {
      const res = await fetch("/api/transactions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedTx.id,
          action: "payment",
          amount: requestedAmount,
        }),
      });
      if (res.ok) {
        setShowPayForm(false);
        setShowDetail(false);
        setPayAmount("");
        toast.success(options?.successTitle || "บันทึกชำระเงินสำเร็จ", {
          description:
            options?.successDescription ||
            `บิล #${selectedTx.id} - ${formatCurrency(Math.abs(requestedAmount))} บาท`,
        });
        loadTransactions();
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || "บันทึกชำระเงินไม่สำเร็จ");
      }
    } finally {
      setPaying(false);
    }
  }

  const statusLabel: Record<string, string> = {
    paid: "ชำระแล้ว",
    unpaid: "ค้างชำระ",
    partial: "บางส่วน",
    voided: "ยกเลิก",
  };

  const statusVariant = (s: string) => {
    if (s === "paid") return "secondary" as const;
    if (s === "voided") return "outline" as const;
    return "destructive" as const;
  };

  const canConvertPaymentStatus = (tx: Transaction) =>
    tx.status !== "voided" &&
    tx.transactionKind !== "transfer_out" &&
    tx.totalAmount > 0;

  const isBagReturnOnlyTx = (tx: Transaction) => tx.status !== "voided" && tx.totalAmount === 0 && tx.items.length === 0;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4 md:mb-6 flex-wrap gap-2">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 ui-scale-page-title">รายการขาย</h1>
          <p className="text-xs md:text-sm text-gray-500 ui-scale-page-subtitle">ดูรายการทั้งหมด ชำระเงิน และยกเลิกใบเสร็จ</p>
        </div>
      </div>

      {pendingRefreshCount > 0 && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-blue-900 ui-scale-body">
            มีรายการใหม่ประมาณ {pendingRefreshCount.toLocaleString()} รายการ
          </p>
          <Button
            size="sm"
            onClick={() => {
              window.scrollTo({ top: 0, behavior: "smooth" });
              void loadTransactions({ showLoader: false, resetDisplayLimit: false });
            }}
          >
            รีเฟรชตอนนี้
          </Button>
        </div>
      )}

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="pt-6 space-y-3">
          {/* Quick date shortcuts */}
          <div className="grid grid-cols-4 md:grid-cols-8 gap-1.5">
            {DATE_SHORTCUTS.map((btn) => (
              <button
                key={btn.key}
                onClick={() => applyQuickRange(btn.key)}
                className={`px-2 py-1.5 text-xs font-medium rounded-lg border transition-colors text-center ${
                  activeQuick === btn.key
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-600 border-gray-200 hover:border-blue-400 hover:text-blue-600"
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
          {/* Date inputs + filters */}
          <div className="grid grid-cols-2 md:flex md:items-end gap-2 md:gap-4 md:flex-wrap">
            <div className="space-y-1">
              <Label className="text-xs md:text-sm ui-scale-label">วันที่เริ่มต้น</Label>
              <Input type="date" value={draftStartDate} onChange={(e) => { setDraftStartDate(e.target.value); setActiveQuick(""); }} className="w-full md:w-40 h-9" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs md:text-sm ui-scale-label">วันที่สิ้นสุด</Label>
              <Input type="date" value={draftEndDate} onChange={(e) => { setDraftEndDate(e.target.value); setActiveQuick(""); }} className="w-full md:w-40 h-9" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs md:text-sm ui-scale-label">สถานะ</Label>
              <Select value={draftFilterStatus} onValueChange={setDraftFilterStatus}>
                <SelectTrigger className="w-full md:w-36 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ทั้งหมด</SelectItem>
                  <SelectItem value="paid">ชำระแล้ว</SelectItem>
                  <SelectItem value="unpaid">ค้างชำระ</SelectItem>
                  <SelectItem value="partial">บางส่วน</SelectItem>
                  <SelectItem value="voided">ยกเลิก</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs md:text-sm ui-scale-label">ค้นหา</Label>
              <Input
                value={draftFilterCustomer}
                onChange={(e) => setDraftFilterCustomer(e.target.value)}
                placeholder="Customer name, #id, #101, #102, or 4-digit bill"
                className="w-full md:w-40 h-9"
              />
            </div>
            <Button
              onClick={applyFilters}
              disabled={loading}
              className="col-span-2 md:col-span-1 h-9"
            >
              {loading ? "กำลังโหลด..." : "Apply"}
            </Button>
            <Button type="button" variant="outline" onClick={resetFilters} className="col-span-2 md:col-span-1 h-9">
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      {!loading && filteredTxList.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
          <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-800 p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400 ui-scale-summary-label">รายการปกติ</p>
            <p className="text-lg font-bold ui-scale-summary-value">{summaryTotals.activeCount} <span className="text-sm font-normal text-gray-400">รายการ</span></p>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-800 p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400 ui-scale-summary-label">รายการยกเลิก</p>
            <p className="text-lg font-bold text-gray-700 dark:text-gray-300 ui-scale-summary-value">{summaryTotals.voidCount}</p>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-800 p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400 ui-scale-summary-label">ยอดขายสุทธิ</p>
            <p className="text-lg font-bold ui-scale-summary-value">{formatCurrency(summaryTotals.netSales)}</p>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-800 p-3">
            <p className="text-xs text-green-600 ui-scale-summary-label">เงินสดสุทธิ</p>
            <p className="text-lg font-bold text-green-700 dark:text-green-400 ui-scale-summary-value">{formatCurrency(summaryTotals.netCash)}</p>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-800 p-3">
            <p className="text-xs text-red-600 ui-scale-summary-label">ค้างชำระ</p>
            <p className="text-lg font-bold text-red-600 ui-scale-summary-value">{formatCurrency(summaryTotals.outstandingDebt)}</p>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-800 p-3">
            <p className="text-xs text-indigo-600 ui-scale-summary-label">เครดิตฝั่งคืน</p>
            <p className="text-lg font-bold text-indigo-700 dark:text-indigo-400 ui-scale-summary-value">{formatCurrency(summaryTotals.refundBalance)}</p>
          </div>
        </div>
      )}

      {/* Transaction table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base ui-scale-section-title">
            รายการ ({filteredTxList.length} รายการ)
            {hasMore && (
              <span className="font-normal text-sm text-amber-600 ml-2">
                แสดง {displayedTx.length} จาก {filteredTxList.length}
              </span>
            )}
            {filterCustomer && <span className="font-normal text-sm text-gray-500 ml-2">กรอง: &quot;{filterCustomer}&quot;</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-2">
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-32 hidden md:block" />
                  <Skeleton className="h-4 flex-1 max-w-[120px]" />
                  <Skeleton className="h-4 w-20 ml-auto" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              ))}
            </div>
          ) : filteredTxList.length === 0 ? (
            <p className="text-center py-8 text-gray-500">ไม่พบรายการ</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table className="ui-scale-dense-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">บิล</TableHead>
                      <TableHead className="text-xs">วันที่</TableHead>
                      <TableHead className="text-xs hidden md:table-cell">เวลา</TableHead>
                      <TableHead className="text-xs">ลูกค้า</TableHead>
                      <TableHead className="text-right text-xs">ยอดรวม</TableHead>
                      <TableHead className="text-right text-xs hidden md:table-cell">ชำระแล้ว</TableHead>
                      <TableHead className="text-right text-xs hidden md:table-cell">ค้าง</TableHead>
                      <TableHead className="text-xs">สถานะ</TableHead>
                      <TableHead className="w-12 md:w-16"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedTx.map((tx) => {
                      const rowTotals = computeFinancialTotals(
                        [
                          {
                            status: tx.status,
                            transactionKind: tx.transactionKind,
                            totalAmount: tx.totalAmount,
                            paid: tx.paid,
                          },
                        ],
                        { includeTransferOut: true }
                      );
                      const signedCredit =
                        rowTotals.outstandingDebt > 0
                          ? rowTotals.outstandingDebt
                          : rowTotals.refundBalance > 0
                            ? -rowTotals.refundBalance
                            : 0;
                      const isVoided = tx.status === "voided";
                      const isBagReturnOnly = isBagReturnOnlyTx(tx);
                      const displayStatusLabel = isBagReturnOnly ? "คืนถุง" : (statusLabel[tx.status] || tx.status);
                      const displayStatusVariant = isBagReturnOnly ? ("secondary" as const) : statusVariant(tx.status);
                      return (
                        <TableRow key={tx.id} className={isVoided ? "opacity-50" : ""}>
                          <TableCell className="font-mono text-xs">
                            <div className="flex flex-col">
                              <span>{tx.billNumber || `#${tx.id}`}</span>
                              {tx.printedBillNumber != null && tx.internalReference && (
                                <span className="font-sans text-[10px] text-gray-400">
                                  {tx.internalReference}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs md:text-sm whitespace-nowrap">{formatThaiDate(tx.saleDate)}</TableCell>
                          <TableCell className="text-sm hidden md:table-cell">{tx.saleTime?.slice(0, 5)}</TableCell>
                          <TableCell className="font-medium text-xs md:text-sm max-w-[140px] md:max-w-none truncate">
                            <Link
                              href={`/customers/${tx.customer.id}`}
                              className="block truncate hover:underline focus-visible:underline"
                            >
                              {formatCustomerDisplay(
                                tx.customer.id,
                                tx.customer.name,
                                showCustomerIdWithName
                              )}
                            </Link>
                          </TableCell>
                          <TableCell className="text-right text-xs md:text-sm">
                            {isVoided ? (
                              <span className="line-through text-gray-400">{formatCurrency(tx.totalAmount)}</span>
                            ) : (
                              formatCurrency(rowTotals.netSales)
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm hidden md:table-cell">
                            {isVoided ? (
                              <span className="text-gray-400">-</span>
                            ) : (
                              <span className={rowTotals.netCash !== 0 ? "text-green-700" : "text-gray-400"}>
                                {rowTotals.netCash !== 0 ? formatCurrency(rowTotals.netCash) : "-"}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm hidden md:table-cell">
                            {isVoided ? (
                              <span className="text-gray-400">-</span>
                            ) : signedCredit > 0 ? (
                              <span className="text-red-600 font-medium">{formatCurrency(signedCredit)}</span>
                            ) : signedCredit < 0 ? (
                              <span className="text-indigo-700 font-medium">{formatCurrency(signedCredit)}</span>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={displayStatusVariant} className="text-[10px] md:text-xs">
                              {displayStatusLabel}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" className="text-xs h-7 px-2" onClick={() => viewDetail(tx)}>
                              ดู
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Load more button */}
              {hasMore && (
                <div className="text-center pt-4">
                  <Button
                    variant="outline"
                    onClick={() => setDisplayLimit((prev) => prev + PAGE_SIZE)}
                  >
                    โหลดเพิ่ม ({filteredTxList.length - displayLimit} รายการที่เหลือ)
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog with inline payment */}
      <Dialog open={showDetail} onOpenChange={(open) => { setShowDetail(open); if (!open) { setShowPayForm(false); setConfirmVoid(false); } }}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-lg max-h-[90dvh] overflow-hidden p-4 sm:p-6">
          <DialogHeader className="pr-8">
            <DialogTitle>รายละเอียดบิล {selectedTx?.billNumber || `#${selectedTx?.id}`}</DialogTitle>
          </DialogHeader>
          {selectedTx && (
            <div className="max-h-[calc(90dvh-5rem)] space-y-4 overflow-y-auto pt-2 pr-1">
              {(() => {
                const isBagReturnOnly = isBagReturnOnlyTx(selectedTx);
                const displayStatusLabel = isBagReturnOnly
                  ? "คืนถุง"
                  : statusLabel[selectedTx.status] || selectedTx.status;
                const displayStatusVariant = isBagReturnOnly
                  ? ("secondary" as const)
                  : statusVariant(selectedTx.status);
                return (
                  <>
              {(() => {
                const referenceBillId = extractReferenceBillId(selectedTx.note);
                if (!referenceBillId) return null;
                return (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-blue-800">
                      <strong>บิลอ้างอิง:</strong> #{referenceBillId}
                    </span>
                    <Button
                      variant="link"
                      className="h-auto p-0 text-blue-700"
                      onClick={() => openReferencedBill(referenceBillId)}
                      disabled={openingReference}
                    >
                      {openingReference ? "กำลังเปิด..." : "เปิดรายละเอียด"}
                    </Button>
                  </div>
                );
              })()}

              <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 ui-scale-body">
                <div><strong>บิล:</strong> {selectedTx.billNumber || `#${selectedTx.id}`}</div>
                <div><strong>อ้างอิงภายใน:</strong> {selectedTx.internalReference || `Tx #${selectedTx.id}`}</div>
                <div>
                  <strong>ลูกค้า:</strong>{" "}
                  {formatCustomerDisplay(
                    selectedTx.customer.id,
                    selectedTx.customer.name,
                    showCustomerIdWithName
                  )}
                </div>
                <div><strong>วันที่:</strong> {formatThaiDate(selectedTx.saleDate)}</div>
                <div><strong>เวลา:</strong> {selectedTx.saleTime}</div>
                <div>
                  <strong>สถานะ:</strong>{" "}
                  <Badge variant={displayStatusVariant}>
                    {displayStatusLabel}
                  </Badge>
                </div>
                {selectedTx.pool && (
                  <div>
                    <strong>ตำแหน่งโหลด:</strong> อาคาร {selectedTx.pool} ช่องจอด {selectedTx.row}
                  </div>
                )}
              </div>

              {loadingDetail && (
                <p className="text-sm text-gray-500">กำลังโหลดรายละเอียดเพิ่มเติม...</p>
              )}

              <Table className="text-xs sm:text-sm ui-scale-dense-table">
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[120px]">สินค้า</TableHead>
                    <TableHead className="text-right">จำนวน</TableHead>
                    <TableHead className="text-right">ราคา</TableHead>
                    <TableHead className="text-right">รวม</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedTx.items.map((item, i) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-normal">{item.productType.name}</TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.unitPrice)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.subtotal)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold">
                    <TableCell colSpan={3}>รวมทั้งหมด</TableCell>
                    <TableCell className="text-right">{formatCurrency(selectedTx.totalAmount)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>

              {selectedTx.bagLedgerEntries && selectedTx.bagLedgerEntries.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-semibold">รายการถุง</div>
                  <Table className="text-xs sm:text-sm ui-scale-dense-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>ประเภท</TableHead>
                        <TableHead>สินค้า</TableHead>
                        <TableHead className="text-right">จำนวน</TableHead>
                        <TableHead>หมายเหตุ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedTx.bagLedgerEntries.map((entry) => {
                        const typeLabel =
                          entry.type === "out"
                            ? "ออกถุง"
                            : entry.type === "return"
                              ? "คืนถุง"
                              : "ปรับยอด";
                        const balanceDelta = getBagEntryBalanceDelta(entry);
                        const qtyDisplay = `${balanceDelta > 0 ? "+" : ""}${balanceDelta}`;
                        const qtyClass =
                          balanceDelta > 0
                            ? "text-red-600"
                            : balanceDelta < 0
                              ? "text-green-600"
                              : "text-amber-600";
                        return (
                          <TableRow key={entry.id}>
                            <TableCell>{typeLabel}</TableCell>
                            <TableCell>&nbsp;</TableCell>
                            <TableCell className={`text-right font-medium ${qtyClass}`}>
                              {qtyDisplay}
                            </TableCell>
                            <TableCell className="whitespace-normal">{entry.note || "-"}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Payment summary for non-voided */}
              {selectedTx.status !== "voided" && (
                (() => {
                  const selectedTotals = computeFinancialTotals(
                    [
                      {
                        status: selectedTx.status,
                        transactionKind: selectedTx.transactionKind,
                        totalAmount: selectedTx.totalAmount,
                        paid: selectedTx.paid,
                      },
                    ],
                    { includeTransferOut: true }
                  );

                  return (
                    <div className="grid grid-cols-1 gap-2 text-sm rounded-lg border p-3 sm:grid-cols-4 ui-scale-body">
                      <div>
                        <p className="text-xs text-gray-500">ยอดรวมสุทธิ</p>
                        <p className="font-bold">{formatCurrency(selectedTotals.netSales)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-green-600">เงินสดสุทธิ</p>
                        <p className="font-bold text-green-700">{formatCurrency(selectedTotals.netCash)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-red-600">ค้างชำระ</p>
                        <p className="font-bold text-red-600">
                          {formatCurrency(selectedTotals.outstandingDebt)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-indigo-600">เครดิตฝั่งคืน</p>
                        <p className="font-bold text-indigo-700">
                          {formatCurrency(selectedTotals.refundBalance)}
                        </p>
                      </div>
                    </div>
                  );
                })()
              )}

              {/* Actions */}
              {selectedTx.status !== "voided" && (
                <div className="space-y-2 pt-1">
                  {/* Payment mode shortcuts */}
                  {canConvertPaymentStatus(selectedTx) && (
                    <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium ui-scale-label">เปลี่ยนสถานะการชำระ</p>
                        <p className="text-xs text-gray-500">
                          สลับระหว่างเงินสดกับเครดิตระยะสั้นโดยไม่ต้องแก้รายการขาย
                        </p>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        {selectedTx.status !== "paid" && (
                          <Button
                            className="flex-1"
                            variant="secondary"
                            onClick={() =>
                              handlePayment({
                                amount: selectedTx.totalAmount - selectedTx.paid,
                                successTitle: "เปลี่ยนเป็นเงินสดสำเร็จ",
                                successDescription: `บิล #${selectedTx.id} ชำระครบแล้ว`,
                              })
                            }
                            disabled={paying}
                          >
                            เปลี่ยนเป็นเงินสด
                          </Button>
                        )}
                        {selectedTx.status !== "unpaid" && (
                          <Button
                            className="flex-1"
                            variant="outline"
                            onClick={() =>
                              handlePayment({
                                amount: -selectedTx.paid,
                                successTitle: "เปลี่ยนเป็นเครดิตระยะสั้นสำเร็จ",
                                successDescription: `บิล #${selectedTx.id} ถูกย้ายกลับไปค้างชำระ`,
                              })
                            }
                            disabled={paying}
                          >
                            เปลี่ยนเป็นเครดิตระยะสั้น
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Inline payment form */}
                  {(selectedTx.status === "unpaid" || selectedTx.status === "partial") && (
                    <>
                      {!showPayForm ? (
                        <Button
                          className="w-full"
                          onClick={() => {
                            setShowPayForm(true);
                            setPayAmount((selectedTx.totalAmount - selectedTx.paid).toFixed(2));
                          }}
                        >
                          บันทึกชำระเงิน
                        </Button>
                      ) : (
                        <div className="space-y-3 p-3 rounded-lg border border-blue-200 bg-blue-50">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm font-medium ui-scale-label">จำนวนเงินที่ชำระ (บาท)</Label>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs text-blue-600 h-6"
                              onClick={() => setPayAmount((selectedTx.totalAmount - selectedTx.paid).toFixed(2))}
                            >
                              เต็มจำนวน
                            </Button>
                          </div>
                          <Input
                            type="number"
                            value={payAmount}
                            onChange={(e) => setPayAmount(e.target.value)}
                            step="0.01"
                            autoFocus
                          />
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Button
                              className="flex-1"
                              onClick={() => {
                                void handlePayment();
                              }}
                              disabled={paying || !payAmount || parseFloat(payAmount) <= 0}
                            >
                              {paying ? "กำลังบันทึก..." : "ยืนยันชำระ"}
                            </Button>
                            <Button
                              variant="outline"
                              className="flex-1"
                              onClick={() => setShowPayForm(false)}
                            >
                              ยกเลิก
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Reprint receipt */}
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => triggerReprint(selectedTx.id)}
                  >
                    พิมพ์บิล Epson
                  </Button>

                  {/* Void button */}
                  {!showPayForm && (
                    <>
                      {!confirmVoid ? (
                        <Button
                          variant="destructive"
                          className="w-full"
                          onClick={() => setConfirmVoid(true)}
                        >
                          ยกเลิกใบเสร็จ
                        </Button>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-sm text-red-600 font-medium text-center">
                            ยืนยันการยกเลิก? ระบบจะยกเลิกรายการขายและปรับยอดถุงอัตโนมัติ
                          </p>
                          <Input
                            placeholder="เหตุผลในการยกเลิก (จำเป็น)"
                            value={voidReason}
                            onChange={(e) => setVoidReason(e.target.value)}
                            className="text-sm"
                          />
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Button
                              variant="destructive"
                              className="flex-1"
                              onClick={handleVoid}
                              disabled={voiding || !voidReason.trim()}
                            >
                              {voiding ? "กำลังยกเลิก..." : "ยืนยันยกเลิก"}
                            </Button>
                            <Button
                              variant="outline"
                              className="flex-1"
                              onClick={() => { setConfirmVoid(false); setVoidReason(""); }}
                            >
                              ไม่ยกเลิก
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
                  </>
                );
              })()}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
