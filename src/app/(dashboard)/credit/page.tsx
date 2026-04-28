"use client";

import { Fragment, useEffect, useState, useCallback } from "react";
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
import { formatCurrency, formatThaiDate, formatNumber, todayISO } from "@/lib/thai-utils";
import {
  formatCustomerDisplay,
  useShowCustomerIdWithName,
} from "@/lib/customer-display";
import { generateIdempotencyKey } from "@/lib/idempotency-client";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  SHORT_TERM_CREDIT_LABEL,
  UNPAID_STATUS_LABEL,
} from "@/lib/customer-credit-labels";

interface CreditCustomer {
  customerId: number;
  customerName: string;
  unpaidCount: number;
  totalOutstanding: number;
  aging0to30: number;
  aging31to60: number;
  aging60plus: number;
  oldestDate: string;
  newestDate: string;
}

interface CreditSummaryResponse {
  customers: CreditCustomer[];
  grandTotals: {
    totalCustomers: number;
    totalOutstanding: number;
    totalUnpaidCount: number;
  };
}

interface Transaction {
  id: number;
  customerId: number;
  totalAmount: number;
  paid: number;
  status: string;
  saleDate: string;
  saleTime: string;
  customer: { id: number; name: string };
  items: { productType: { name: string }; quantity: number; unitPrice: number; subtotal: number }[];
}

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function dateBefore(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
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

export default function CreditPage() {
  const showCustomerIdWithName = useShowCustomerIdWithName();
  const initialStartDate = dateBefore(7);
  const initialEndDate = todayISO();
  const [summary, setSummary] = useState<CreditCustomer[]>([]);
  const [grandTotals, setGrandTotals] = useState<CreditSummaryResponse["grandTotals"]>({
    totalCustomers: 0, totalOutstanding: 0, totalUnpaidCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [filterCustomer, setFilterCustomer] = useState("");
  const [draftFilterCustomer, setDraftFilterCustomer] = useState("");

  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [dateMode, setDateMode] = useState<"year" | "all" | "custom">("custom");
  const [draftStartDate, setDraftStartDate] = useState(initialStartDate);
  const [draftEndDate, setDraftEndDate] = useState(initialEndDate);
  const [draftDateMode, setDraftDateMode] = useState<"year" | "all" | "custom">("custom");
  const [activeQuick, setActiveQuick] = useState("");

  const [expandedCustomer, setExpandedCustomer] = useState<number | null>(null);
  const [expandedTx, setExpandedTx] = useState<Transaction[]>([]);
  const [expandLoading, setExpandLoading] = useState(false);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [generatingInvoiceForCustomerId, setGeneratingInvoiceForCustomerId] = useState<number | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setExpandedCustomer(null);
    setExpandedTx([]);
    try {
      const params = new URLSearchParams({ type: "creditSummary" });
      if (dateMode !== "all") {
        params.set("startDate", startDate);
        params.set("endDate", endDate);
      }
      if (filterCustomer.trim()) params.set("customerQuery", filterCustomer.trim());
      const res = await fetch(`/api/reports?${params}`);
      const data: CreditSummaryResponse = await res.json();
      setSummary(data.customers);
      setGrandTotals(data.grandTotals);
    } catch {
      toast.error("ไม่สามารถโหลดข้อมูลได้");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, dateMode, filterCustomer]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  function applyQuickRange(key: string) {
    const now = new Date();
    let s: Date;
    let e: Date;
    switch (key) {
      case "today":
        s = now;
        e = now;
        setDraftDateMode("custom");
        break;
      case "yesterday": {
        const y = new Date(now);
        y.setDate(y.getDate() - 1);
        s = y;
        e = y;
        setDraftDateMode("custom");
        break;
      }
      case "thisWeek":
        s = getMonday(now);
        e = now;
        setDraftDateMode("custom");
        break;
      case "lastWeek": {
        const lm = getMonday(now);
        lm.setDate(lm.getDate() - 7);
        const ls = new Date(lm);
        ls.setDate(ls.getDate() + 6);
        s = lm;
        e = ls;
        setDraftDateMode("custom");
        break;
      }
      case "thisMonth":
        s = new Date(now.getFullYear(), now.getMonth(), 1);
        e = now;
        setDraftDateMode("custom");
        break;
      case "lastMonth":
        s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        e = new Date(now.getFullYear(), now.getMonth(), 0);
        setDraftDateMode("custom");
        break;
      case "last3Months":
        s = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        e = now;
        setDraftDateMode("custom");
        break;
      case "all":
        s = new Date(2000, 0, 1);
        e = now;
        setDraftDateMode("all");
        break;
      default:
        return;
    }

    setDraftStartDate(toISO(s));
    setDraftEndDate(toISO(e));
    setActiveQuick(key);
  }

  function applyFilters() {
    setDateMode(draftDateMode);
    setStartDate(draftStartDate);
    setEndDate(draftEndDate);
    setFilterCustomer(draftFilterCustomer);
  }

  function resetFilters() {
    setDraftDateMode("custom");
    setDraftStartDate(initialStartDate);
    setDraftEndDate(initialEndDate);
    setDraftFilterCustomer("");
    setActiveQuick("");
    setDateMode("custom");
    setStartDate(initialStartDate);
    setEndDate(initialEndDate);
    setFilterCustomer("");
  }

  async function toggleExpand(customerId: number) {
    if (expandedCustomer === customerId) {
      setExpandedCustomer(null);
      setExpandedTx([]);
      return;
    }
    setExpandedCustomer(customerId);
    setExpandLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("customerId", String(customerId));
      if (dateMode !== "all") {
        params.set("startDate", startDate);
        params.set("endDate", endDate);
      }
      const [res1, res2] = await Promise.all([
        fetch(`/api/transactions?${params}&status=unpaid`),
        fetch(`/api/transactions?${params}&status=partial`),
      ]);
      const unpaid: Transaction[] = await res1.json();
      const partial: Transaction[] = await res2.json();
      const all = [...unpaid, ...partial]
        .filter((tx) => tx.totalAmount - tx.paid > 0)
        .sort((a, b) => b.saleDate.localeCompare(a.saleDate));
      setExpandedTx(all);
    } catch {
      setExpandedTx([]);
    } finally {
      setExpandLoading(false);
    }
  }

  function openPayment(tx: Transaction) {
    setSelectedTx(tx);
    setPayAmount((tx.totalAmount - tx.paid).toFixed(2));
    setPaymentOpen(true);
  }

  async function handlePayment() {
    if (!selectedTx || !payAmount) return;
    setSaving(true);
    try {
      const res = await fetch("/api/transactions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedTx.id,
          action: "payment",
          amount: parseFloat(payAmount),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string" && data.error.length > 0
            ? data.error
            : "บันทึกการชำระเงินไม่สำเร็จ"
        );
      }

      setPaymentOpen(false);
      toast.success("บันทึกการชำระเงินสำเร็จ", {
        description: `บิล #${selectedTx.id} - ${formatCurrency(parseFloat(payAmount))} บาท`,
      });
      await loadSummary();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "บันทึกการชำระเงินไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateDraftInvoice(customerId: number) {
    setGeneratingInvoiceForCustomerId(customerId);
    try {
      const effectiveStartDate = dateMode === "all" ? "2000-01-01" : startDate;
      const effectiveEndDate = dateMode === "all" ? todayISO() : endDate;
      const includeKindsCsv = "sale,return,adjustment";

      const previewRes = await fetch(
        `/api/invoices/preview?customerId=${customerId}&startDate=${effectiveStartDate}&endDate=${effectiveEndDate}&includeKinds=${encodeURIComponent(includeKindsCsv)}`
      );
      const previewData = await previewRes.json().catch(() => ({}));
      if (!previewRes.ok) {
        throw new Error(previewData?.error || "preview_failed");
      }

      const selectedTransactionIds = Array.isArray(previewData?.rows)
        ? previewData.rows.map((row: { transactionId: number }) => row.transactionId)
        : [];

      if (selectedTransactionIds.length === 0) {
        toast.error("ไม่พบบิลค้างที่สร้างใบวางบิลได้ในช่วงนี้");
        return;
      }

      const idempotencyKey = generateIdempotencyKey("invoice.create");
      const createRes = await fetch("/api/invoices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          customerId,
          periodStart: effectiveStartDate,
          periodEnd: effectiveEndDate,
          includeKinds: ["sale", "return", "adjustment"],
          selectedTransactionIds,
          vatEnabled: false,
          vatRate: 0.07,
          notes: "",
        }),
      });
      const createData = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        throw new Error(createData?.error || "create_draft_failed");
      }

      window.dispatchEvent(
        new CustomEvent("invoice-created", {
          detail: { id: Number(createData.id) || null },
        })
      );

      toast.success(`สร้างร่างใบวางบิล #${createData.id} สำเร็จ`);
      window.open(`/print/invoice/generated/${createData.id}`, "_blank");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "สร้างร่างใบวางบิลไม่สำเร็จ");
    } finally {
      setGeneratingInvoiceForCustomerId(null);
    }
  }

  const filteredSummary = filterCustomer
    ? summary.filter((s) =>
        s.customerName.toLowerCase().includes(filterCustomer.toLowerCase()) ||
        s.customerId.toString().includes(filterCustomer)
      )
    : summary;

  const displayTotal = filteredSummary.reduce((s, r) => s + r.totalOutstanding, 0);

  return (
    <div className="w-full max-w-none">
      <div className="flex items-center justify-between mb-4 md:mb-6 flex-wrap gap-2">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 ui-scale-page-title">{SHORT_TERM_CREDIT_LABEL}</h1>
          <p className="text-xs md:text-sm text-gray-500 ui-scale-page-subtitle">ติดตามและบันทึกการชำระเงิน</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="destructive" className="text-sm md:text-lg px-3 md:px-4 py-1 md:py-2">
            {SHORT_TERM_CREDIT_LABEL}รวม {formatCurrency(displayTotal)}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            พิมพ์หน้านี้
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const custIds = summary.map((s: { customerId: number }) => s.customerId);
              if (custIds.length === 0) return;
              const url = `/print/invoice/batch?customers=${custIds.join(",")}&start=${startDate}&end=${endDate}`;
              window.open(url, "_blank");
            }}
          >
            พิมพ์ใบวางบิลทั้งหมด
          </Button>
        </div>
      </div>

      <Card className="mb-4 print:hidden">
        <CardContent className="pt-4">
          <div className="grid grid-cols-4 md:grid-cols-8 gap-1.5 mb-3">
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
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
            <div>
              <div className="text-xs text-gray-500 mb-1 ui-scale-label">จากวันที่</div>
              <Input
                type="date"
                value={draftStartDate}
                onChange={(e) => {
                  setDraftStartDate(e.target.value);
                  setDraftDateMode("custom");
                  setActiveQuick("");
                }}
              />
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1 ui-scale-label">ถึงวันที่</div>
              <Input
                type="date"
                value={draftEndDate}
                onChange={(e) => {
                  setDraftEndDate(e.target.value);
                  setDraftDateMode("custom");
                  setActiveQuick("");
                }}
              />
            </div>
            <div className="md:col-span-2">
              <div className="text-xs text-gray-500 mb-1 ui-scale-label">ค้นหาลูกค้า</div>
              <Input
                value={draftFilterCustomer}
                onChange={(e) => setDraftFilterCustomer(e.target.value)}
                placeholder="ชื่อหรือรหัส..."
                className="h-9"
              />
            </div>
            <div className="flex items-end">
              <Button onClick={applyFilters} className="w-full">
                Apply
              </Button>
            </div>
            <div className="flex items-end">
              <Button variant="outline" onClick={resetFilters} className="w-full">
                Reset
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {!loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-800 p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400 ui-scale-summary-label">ลูกค้า{SHORT_TERM_CREDIT_LABEL}</p>
            <p className="text-lg font-bold ui-scale-summary-value">{formatNumber(grandTotals.totalCustomers)} <span className="text-sm font-normal text-gray-400">ราย</span></p>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-800 p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400 ui-scale-summary-label">บิล{SHORT_TERM_CREDIT_LABEL}</p>
            <p className="text-lg font-bold ui-scale-summary-value">{formatNumber(grandTotals.totalUnpaidCount)} <span className="text-sm font-normal text-gray-400">รายการ</span></p>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-800 p-3">
            <p className="text-xs text-red-600 ui-scale-summary-label">ยอดค้างรวม (เลือก)</p>
            <p className="text-lg font-bold text-red-600 ui-scale-summary-value">{formatCurrency(displayTotal)}</p>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-800 p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400 ui-scale-summary-label">ช่วงวันที่</p>
            <p className="text-sm font-medium ui-scale-body">
              {dateMode === "all" ? "ทั้งหมด" : `${formatThaiDate(startDate)} - ${formatThaiDate(endDate)}`}
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <Card>
          <CardContent className="pt-6 space-y-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <Skeleton className="h-4 w-4" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-12 ml-auto" />
                <Skeleton className="h-4 w-20 hidden md:block" />
                <Skeleton className="h-4 w-20 hidden md:block" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-7 w-20 rounded" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : filteredSummary.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-gray-500">
            {filterCustomer ? "ไม่พบลูกค้าที่ค้นหา" : `ไม่มีรายการ${SHORT_TERM_CREDIT_LABEL}`}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base ui-scale-section-title">
              ลูกค้า{SHORT_TERM_CREDIT_LABEL} ({filteredSummary.length} ราย)
              {filterCustomer && <span className="font-normal text-sm text-gray-500 ml-2">กรอง: &quot;{filterCustomer}&quot;</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
            <Table className="ui-scale-dense-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead className="text-xs md:text-sm">ลูกค้า</TableHead>
                  <TableHead className="text-right text-xs md:text-sm">บิล</TableHead>
                  <TableHead className="text-right text-xs hidden md:table-cell">0-30 วัน</TableHead>
                  <TableHead className="text-right text-xs hidden md:table-cell">31-60 วัน</TableHead>
                  <TableHead className="text-right text-xs hidden md:table-cell">60+ วัน</TableHead>
                  <TableHead className="text-right text-xs md:text-sm">ยอดค้างรวม</TableHead>
                  <TableHead className="w-24 md:w-32 print:hidden"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSummary.map((s) => (
                  <Fragment key={s.customerId}>
                    <TableRow
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => toggleExpand(s.customerId)}
                    >
                      <TableCell className="text-center text-gray-400">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={`transition-transform ${expandedCustomer === s.customerId ? "rotate-90" : ""}`}
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </TableCell>
                      <TableCell className="font-medium text-xs md:text-sm">
                        {formatCustomerDisplay(
                          s.customerId,
                          s.customerName,
                          showCustomerIdWithName
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs md:text-sm">{formatNumber(s.unpaidCount)}</TableCell>
                      <TableCell className="text-right text-gray-600 hidden md:table-cell">
                        {s.aging0to30 > 0 ? formatCurrency(s.aging0to30) : "-"}
                      </TableCell>
                      <TableCell className="text-right text-orange-600 hidden md:table-cell">
                        {s.aging31to60 > 0 ? formatCurrency(s.aging31to60) : "-"}
                      </TableCell>
                      <TableCell className="text-right text-red-700 font-medium hidden md:table-cell">
                        {s.aging60plus > 0 ? formatCurrency(s.aging60plus) : "-"}
                      </TableCell>
                      <TableCell className="text-right font-bold text-red-600 text-xs md:text-sm">
                        {formatCurrency(s.totalOutstanding)}
                      </TableCell>
                      <TableCell className="print:hidden" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1 items-center">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs"
                            onClick={() => void handleGenerateDraftInvoice(s.customerId)}
                            disabled={generatingInvoiceForCustomerId === s.customerId}
                          >
                            {generatingInvoiceForCustomerId === s.customerId
                              ? "กำลังสร้าง..."
                              : "สร้างร่างใบวางบิล"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs h-7 hidden md:inline-flex"
                            onClick={() => {
                              const url = `/print/statement/${s.customerId}?start=${startDate}&end=${endDate}`;
                              window.open(url, "_blank");
                            }}
                          >
                            ยอดบัญชี
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>

                    {expandedCustomer === s.customerId && (
                      <TableRow>
                        <TableCell colSpan={8} className="p-0 bg-gray-50">
                          <div className="px-4 py-2">
                            {expandLoading ? (
                              <p className="text-center text-sm text-gray-500 py-4">กำลังโหลดรายการ...</p>
                            ) : expandedTx.length === 0 ? (
                              <p className="text-center text-sm text-gray-500 py-4">ไม่มีรายการ{SHORT_TERM_CREDIT_LABEL}</p>
                            ) : (
                              <div className="overflow-x-auto">
                              <table className="w-full text-sm ui-scale-bill-table">
                                <thead>
                                  <tr className="text-xs text-gray-500 border-b border-gray-200">
                                    <th className="text-left py-1.5 font-medium">บิล</th>
                                    <th className="text-left py-1.5 font-medium">วันที่</th>
                                    <th className="text-left py-1.5 font-medium hidden md:table-cell">เวลา</th>
                                    <th className="text-right py-1.5 font-medium hidden md:table-cell">ยอดรวม</th>
                                    <th className="text-right py-1.5 font-medium hidden md:table-cell">ชำระแล้ว</th>
                                    <th className="text-right py-1.5 font-medium">ค้าง</th>
                                    <th className="text-center py-1.5 font-medium hidden md:table-cell">สถานะ</th>
                                    <th className="w-16 md:w-20 py-1.5 print:hidden"></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {expandedTx.map((tx) => {
                                    const outstanding = tx.totalAmount - tx.paid;
                                    return (
                                      <tr key={tx.id} className="border-b border-gray-100">
                                        <td className="py-1.5 font-mono text-xs text-gray-500">#{tx.id}</td>
                                        <td className="py-1.5 text-xs md:text-sm whitespace-nowrap">{formatThaiDate(tx.saleDate)}</td>
                                        <td className="py-1.5 hidden md:table-cell">{tx.saleTime?.slice(0, 5)}</td>
                                        <td className="py-1.5 text-right hidden md:table-cell">{formatCurrency(tx.totalAmount)}</td>
                                        <td className="py-1.5 text-right text-green-700 hidden md:table-cell">
                                          {tx.paid > 0 ? formatCurrency(tx.paid) : "-"}
                                        </td>
                                        <td className="py-1.5 text-right text-red-600 font-medium text-xs md:text-sm">
                                          {formatCurrency(outstanding)}
                                        </td>
                                        <td className="py-1.5 text-center hidden md:table-cell">
                                          <Badge
                                            variant={tx.status === "unpaid" ? "destructive" : "secondary"}
                                            className="text-[10px] px-1.5 py-0"
                                          >
                                            {tx.status === "unpaid" ? "ค้าง" : "บางส่วน"}
                                          </Badge>
                                        </td>
                                        <td className="py-1.5 print:hidden">
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 text-xs text-blue-600"
                                            onClick={() => openPayment(tx)}
                                          >
                                            ชำระ
                                          </Button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}

                <TableRow className="font-bold bg-gray-50">
                  <TableCell></TableCell>
                  <TableCell className="text-xs md:text-sm">รวมทั้งหมด</TableCell>
                  <TableCell className="text-right text-xs md:text-sm">
                    {formatNumber(filteredSummary.reduce((s, r) => s + r.unpaidCount, 0))}
                  </TableCell>
                  <TableCell className="text-right text-gray-600 hidden md:table-cell">
                    {formatCurrency(filteredSummary.reduce((s, r) => s + r.aging0to30, 0))}
                  </TableCell>
                  <TableCell className="text-right text-orange-600 hidden md:table-cell">
                    {formatCurrency(filteredSummary.reduce((s, r) => s + r.aging31to60, 0))}
                  </TableCell>
                  <TableCell className="text-right text-red-700 hidden md:table-cell">
                    {formatCurrency(filteredSummary.reduce((s, r) => s + r.aging60plus, 0))}
                  </TableCell>
                  <TableCell className="text-right text-red-700 text-xs md:text-sm">
                    {formatCurrency(displayTotal)}
                  </TableCell>
                  <TableCell className="print:hidden"></TableCell>
                </TableRow>
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>บันทึกการชำระเงิน</DialogTitle>
          </DialogHeader>
          {selectedTx && (
            <div className="space-y-4 pt-4">
              <div className="text-sm space-y-1 ui-scale-body">
                <p><strong>บิล:</strong> #{selectedTx.id}</p>
                <p>
                  <strong>ลูกค้า:</strong>{" "}
                  {formatCustomerDisplay(
                    selectedTx.customer.id,
                    selectedTx.customer.name,
                    showCustomerIdWithName
                  )}
                </p>
                <p><strong>วันที่:</strong> {formatThaiDate(selectedTx.saleDate)}</p>
              </div>

              <div className="grid grid-cols-3 gap-2 text-sm rounded-lg border p-3 ui-scale-body">
                <div>
                  <p className="text-xs text-gray-500">ยอดรวม</p>
                  <p className="font-bold">{formatCurrency(selectedTx.totalAmount)}</p>
                </div>
                <div>
                  <p className="text-xs text-green-600">ชำระแล้ว</p>
                  <p className="font-bold text-green-700">{formatCurrency(selectedTx.paid)}</p>
                </div>
                <div>
                  <p className="text-xs text-red-600">{UNPAID_STATUS_LABEL}</p>
                  <p className="font-bold text-red-600">
                    {formatCurrency(selectedTx.totalAmount - selectedTx.paid)}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>จำนวนเงินที่ชำระ (บาท)</Label>
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
                  min={0}
                  step="0.01"
                  autoFocus
                />
              </div>
              <Button
                onClick={handlePayment}
                disabled={saving || !payAmount || parseFloat(payAmount) <= 0}
                className="w-full"
              >
                {saving ? "กำลังบันทึก..." : "ยืนยันชำระเงิน"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
