"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
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
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  formatThaiDate,
  formatCurrency,
  formatNumber,
  todayISO,
} from "@/lib/thai-utils";
import {
  formatCustomerDisplay,
  useShowCustomerIdWithName,
} from "@/lib/customer-display";
import { buildExactBillRows } from "@/lib/sale-entry-view";
import { toast } from "sonner";
import { getBagDisplayQuantities, summarizeBagLedgerEntries } from "@/lib/bag-flow";
import { computeFinancialTotals } from "@/lib/financial-totals";
import type { SessionUser } from "@/lib/auth";
import {
  addDaysISO,
  canAccessDailyLedger,
  clampDailyLedgerDateForAccess,
  getDailyLedgerRecentWindow,
  usesRestrictedDailyLedgerRecentWindow,
} from "@/lib/daily-ledger-access";
import { readOfflineCapableSessionUser } from "@/lib/offline-session";

interface ProductType {
  id: number;
  name: string;
  sortOrder: number;
  hasBag?: boolean;
  decreasesBag?: boolean;
  isActive?: boolean;
}

interface TransactionItem {
  quantity: number;
  unitPrice: number;
  subtotal: number;
  productType: {
    id: number;
    name: string;
    sortOrder?: number;
    hasBag?: boolean;
    decreasesBag?: boolean;
  };
}

interface LedgerTransaction {
  id: number;
  customer: { id: number; name: string };
  saleDate: string;
  saleTime: string;
  transactionKind?: string;
  pool: number | null;
  row: number | null;
  status: string;
  totalAmount: number;
  paid: number;
  note?: string | null;
  items: TransactionItem[];
  bagLedgerEntries?: Array<{
    type: "out" | "return" | "adjust";
    quantity: number;
  }>;
}

interface BillDetailTransaction {
  id: number;
  customer: { id: number; name: string };
  saleDate: string;
  saleTime: string;
  transactionKind?: string;
  pool: number | null;
  row: number | null;
  col: number | null;
  status: string;
  totalAmount: number;
  paid: number;
  note?: string | null;
  items: TransactionItem[];
  bagLedgerEntries?: Array<{
    id: number;
    type: "out" | "return" | "adjust";
    quantity: number;
    note?: string | null;
    productType?: {
      id: number;
      name: string;
    };
  }>;
}

interface LedgerRow {
  id: number;
  customerId: number;
  customerName: string;
  saleDate: string;
  saleTime: string;
  transactionKind?: string;
  location: string;
  status: string;
  totalAmount: number;
  paid: number;
  quantities: Record<number, number>;
  bagsOut: number;
  bagsReturned: number;
  isBagOnly: boolean;
  isZeroCostTransfer: boolean;
  isCreditTransaction: boolean;
}

function getStatusDisplay(
  row: LedgerRow
): { label: string; className: string } {
  if (row.isBagOnly) {
    return { label: "คืนถุง", className: "text-blue-700 print:text-black" };
  }

  if (row.isCreditTransaction) {
    return { label: "เครดิต", className: "text-slate-700 print:text-black" };
  }

  if (row.status === "paid") {
    return { label: "ชำระ", className: "text-green-700 print:text-black" };
  }

  if (row.status === "unpaid") {
    return {
      label: "ค้าง",
      className: "text-red-600 font-semibold print:text-black print:font-bold",
    };
  }

  if (row.status === "partial") {
    return { label: "บางส่วน", className: "text-orange-600 print:text-black" };
  }

  if (row.status === "voided") {
    return { label: "ยกเลิก", className: "text-gray-600 print:text-black" };
  }

  return { label: row.status || "-", className: "text-gray-700 print:text-black" };
}

function formatTime(t: string): string {
  if (!t) return "-";
  const parts = t.split(":");
  return `${parts[0]}:${parts[1]}`;
}

function getBangkokExportTimestamp(): { date: string; time: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}${parts.minute}${parts.second}`,
  };
}

function csvEscape(value: string | number): string {
  const raw = String(value ?? "");
  if (/["\n,]/.test(raw)) return `"${raw.replace(/"/g, "\"\"")}"`;
  return raw;
}

function timeToSeconds(value: string): number {
  const [hh, mm, ss] = value.split(":").map((v) => Number(v) || 0);
  return hh * 3600 + mm * 60 + ss;
}

function normalizeTimeInput(value: string): string {
  if (!value) return "00:00:00";
  return value.length === 5 ? `${value}:00` : value.slice(0, 8);
}

function spansNextDay(startTime: string, endTime: string): boolean {
  const start = timeToSeconds(normalizeTimeInput(startTime));
  const end = timeToSeconds(normalizeTimeInput(endTime));
  return end <= start;
}

function inSelectedTimeWindow(
  txDate: string,
  txTime: string,
  ledgerDate: string,
  startTime: string,
  endTime: string,
  nextDate: string,
): boolean {
  const start = timeToSeconds(normalizeTimeInput(startTime));
  const end = timeToSeconds(normalizeTimeInput(endTime));
  const current = timeToSeconds(normalizeTimeInput(txTime || "00:00:00"));
  const crossesMidnight = end <= start;

  if (!crossesMidnight) {
    return txDate === ledgerDate && current >= start && current < end;
  }

  return (
    (txDate === ledgerDate && current >= start) ||
    (txDate === nextDate && current < end)
  );
}

function timeRangeLabel(startTime: string, endTime: string): string {
  if (normalizeTimeInput(startTime) === normalizeTimeInput(endTime)) {
    return `${startTime}-${endTime} (24 ชั่วโมง)`;
  }
  if (spansNextDay(startTime, endTime)) {
    return `${startTime}-${endTime} (ข้ามวัน)`;
  }
  return `${startTime}-${endTime}`;
}

function sortProducts(a: ProductType, b: ProductType): number {
  const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
  if (ao !== bo) return ao - bo;
  return a.name.localeCompare(b.name, "th");
}

function matchesLedgerPaymentFilter(
  row: LedgerRow,
  filters: { cash: boolean; outstanding: boolean; credit: boolean }
): boolean {
  const rowTotals = computeFinancialTotals(
    [
      {
        status: row.status,
        transactionKind: row.transactionKind,
        totalAmount: row.totalAmount,
        paid: row.paid,
      },
    ],
    { includeTransferOut: true }
  );
  const outstandingAmount = rowTotals.outstandingDebt;
  const isCredit = row.isCreditTransaction;
  const isOutstanding = !isCredit && outstandingAmount > 0;
  const isCash = !isCredit && !isOutstanding;

  return (
    (filters.cash && isCash) ||
    (filters.outstanding && isOutstanding) ||
    (filters.credit && isCredit)
  );
}

function getLedgerMoneyDisplay(row: LedgerRow): {
  cashPaidText: string;
  creditOwedText: string;
  sumTotalText: string;
} {
  if (row.isBagOnly || row.status === "voided") {
    return {
      cashPaidText: "-",
      creditOwedText: "-",
      sumTotalText: "-",
    };
  }

  if (row.isZeroCostTransfer) {
    return {
      cashPaidText: formatCurrency(0),
      creditOwedText: formatCurrency(0),
      sumTotalText: formatCurrency(0),
    };
  }

  const rowTotals = computeFinancialTotals(
    [
      {
        status: row.status,
        transactionKind: row.transactionKind,
        totalAmount: row.totalAmount,
        paid: row.paid,
      },
    ],
    { includeTransferOut: true }
  );
  const cashPaid = rowTotals.netCash;
  const creditOwed = rowTotals.outstandingDebt;
  const refundBalance = rowTotals.refundBalance;
  const sumTotal = rowTotals.netSales;
  const signedCredit = creditOwed > 0 ? creditOwed : refundBalance > 0 ? -refundBalance : 0;

  return {
    cashPaidText: cashPaid === 0 ? "-" : formatCurrency(cashPaid),
    creditOwedText: signedCredit === 0 ? "-" : formatCurrency(signedCredit),
    sumTotalText: sumTotal === 0 ? "-" : formatCurrency(sumTotal),
  };
}

function getLedgerPrintProductCode(name: string): string {
  const normalized = name
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ดล็ก/g, "เล็ก");

  if (normalized.includes("ซอง") && normalized.includes("โม่")) return "ซม";
  if (normalized.includes("ซอง") && normalized.includes("กั๊ก")) return "ซก";
  if (normalized === "ซอง" || normalized.includes("น้ำแข็งซอง")) return "ซ";
  if (normalized.includes("แพ็ค 20")) return "P20";
  if (normalized.includes("แพ็ค 15")) return "P15";
  if (normalized.includes("หลอดใหญ่") && normalized.includes("20")) return "ญ20";
  if (normalized.includes("หลอดเล็ก") && normalized.includes("20")) return "ล20";
  if (normalized.includes("หลอดใหญ่") && normalized.includes("โม่")) return "ญม";
  if (normalized.includes("หลอดเล็ก") && normalized.includes("โม่")) return "ลม";
  if (normalized.includes("ถุงใสหลอดใหญ่") && normalized.includes("20")) return "ถญ20";
  if (normalized.includes("ถุงใสหลอดเล็ก") && normalized.includes("20")) return "ถล20";
  if (normalized.includes("ถุงใสหลอดใหญ่") && normalized.includes("13")) return "ถญ13";
  if (normalized.includes("ถุงใสหลอดเล็ก") && normalized.includes("13")) return "ถล13";
  if (normalized.includes("ถุงใสป่น") && normalized.includes("20")) return "ถป20";
  if (normalized.includes("ถุงใสป่น") && normalized.includes("13")) return "ถป13";

  return normalized.replace(/[.\s()]/g, "").slice(0, 5) || normalized;
}

function getLedgerPrintProductLabel(name: string, index: number): string {
  return `${index + 1}.${getLedgerPrintProductCode(name)}`;
}

export default function InvoicePage() {
  const showCustomerIdWithName = useShowCustomerIdWithName();
  const router = useRouter();
  const recentWindow = useMemo(() => getDailyLedgerRecentWindow(), []);
  const initialLedgerDate = recentWindow.today;
  const initialStartTime = "08:00";
  const initialEndTime = "20:00";
  const defaultPaymentFilters = {
    cash: true,
    outstanding: true,
    credit: true,
  };
  const [ledgerDate, setLedgerDate] = useState(initialLedgerDate);
  const [startTime, setStartTime] = useState(initialStartTime);
  const [endTime, setEndTime] = useState(initialEndTime);
  const [filterCustomer, setFilterCustomer] = useState("");
  const [showCash, setShowCash] = useState(defaultPaymentFilters.cash);
  const [showOutstanding, setShowOutstanding] = useState(defaultPaymentFilters.outstanding);
  const [showCredit, setShowCredit] = useState(defaultPaymentFilters.credit);
  const [draftLedgerDate, setDraftLedgerDate] = useState(initialLedgerDate);
  const [draftStartTime, setDraftStartTime] = useState(initialStartTime);
  const [draftEndTime, setDraftEndTime] = useState(initialEndTime);
  const [draftFilterCustomer, setDraftFilterCustomer] = useState("");
  const [draftShowCash, setDraftShowCash] = useState(defaultPaymentFilters.cash);
  const [draftShowOutstanding, setDraftShowOutstanding] = useState(defaultPaymentFilters.outstanding);
  const [draftShowCredit, setDraftShowCredit] = useState(defaultPaymentFilters.credit);
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [selectedTx, setSelectedTx] = useState<BillDetailTransaction | null>(null);
  const [billOrderView, setBillOrderView] = useState(false);
  const [showOtherProductsInBillOrder, setShowOtherProductsInBillOrder] = useState(false);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(() =>
    typeof window === "undefined" ? null : readOfflineCapableSessionUser()
  );
  const [authResolved, setAuthResolved] = useState(false);

  const canViewDailyLedger = useMemo(() => canAccessDailyLedger(sessionUser), [sessionUser]);
  const isRestrictedRecentWindowUser = useMemo(
    () => usesRestrictedDailyLedgerRecentWindow(sessionUser),
    [sessionUser]
  );

  useEffect(() => {
    let cancelled = false;

    fetch("/api/auth")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const nextUser =
          data &&
          typeof data?.role === "string" &&
          typeof data?.username === "string" &&
          typeof data?.id === "number"
            ? ({
                id: data.id,
                username: data.username,
                role: data.role,
                factoryKey:
                  typeof data?.factoryKey === "string" && data.factoryKey.length > 0
                    ? data.factoryKey
                    : null,
              } as SessionUser)
            : readOfflineCapableSessionUser();

        setSessionUser(nextUser);
        setAuthResolved(true);

        if (!canAccessDailyLedger(nextUser)) {
          router.replace("/dashboard");
        }
      })
      .catch(() => {
        if (cancelled) return;
        const fallbackUser = readOfflineCapableSessionUser();
        setSessionUser(fallbackUser);
        setAuthResolved(true);

        if (!canAccessDailyLedger(fallbackUser)) {
          router.replace("/dashboard");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!isRestrictedRecentWindowUser) return;

    const normalizedLedgerDate = clampDailyLedgerDateForAccess(ledgerDate, sessionUser);
    const normalizedDraftLedgerDate = clampDailyLedgerDateForAccess(
      draftLedgerDate,
      sessionUser
    );

    if (normalizedLedgerDate !== ledgerDate) {
      setLedgerDate(normalizedLedgerDate);
    }
    if (normalizedDraftLedgerDate !== draftLedgerDate) {
      setDraftLedgerDate(normalizedDraftLedgerDate);
    }
  }, [draftLedgerDate, isRestrictedRecentWindowUser, ledgerDate, sessionUser]);

  const loadLedger = useCallback(async () => {
    if (!canViewDailyLedger) return;

    setLoading(true);
    try {
      const nextDate = addDaysISO(ledgerDate, 1);
      const rangeEndDate = spansNextDay(startTime, endTime)
        ? nextDate
        : ledgerDate;

      const params = new URLSearchParams({
        startDate: ledgerDate,
        endDate: rangeEndDate,
        includeBagLedger: "1",
      });
      if (filterCustomer.trim()) params.set("customerQuery", filterCustomer.trim());
      const txRes = await fetch(`/api/transactions?${params.toString()}`);

      if (!txRes.ok) throw new Error("load_transactions_failed");

      const txData: LedgerTransaction[] = await txRes.json();

      const byId = new Map<number, ProductType>();

      for (const tx of txData) {
        for (const item of tx.items || []) {
          const pt = item.productType;
          if (!byId.has(pt.id)) {
            byId.set(pt.id, {
              id: pt.id,
              name: pt.name,
              sortOrder: pt.sortOrder ?? Number.MAX_SAFE_INTEGER,
              hasBag: !!pt.hasBag,
              decreasesBag: !!pt.decreasesBag,
            });
          }
        }
      }

      const mappedRows = txData
        .filter((tx) =>
          inSelectedTimeWindow(
            tx.saleDate,
            tx.saleTime,
            ledgerDate,
            startTime,
            endTime,
            nextDate
          )
        )
        .sort((a, b) => {
          const ta = `${a.saleDate} ${a.saleTime}`;
          const tb = `${b.saleDate} ${b.saleTime}`;
          const cmp = ta.localeCompare(tb);
          if (cmp !== 0) return cmp;
          return a.customer.name.localeCompare(b.customer.name, "th");
        })
        .map((tx) => {
          const quantities: Record<number, number> = {};
          let bagsOutFromItems = 0;
          let bagsReturnedFromItems = 0;

          for (const item of tx.items || []) {
            const qty = item.quantity || 0;
            if (qty === 0) continue;

            quantities[item.productType.id] =
              (quantities[item.productType.id] || 0) + qty;

            if (item.productType.hasBag && qty > 0) bagsOutFromItems += qty;
            if (item.productType.decreasesBag) bagsReturnedFromItems += Math.abs(qty);
          }

          const ledgerBagSummary = summarizeBagLedgerEntries(tx.bagLedgerEntries || []);
          const ledgerBagDisplay = getBagDisplayQuantities(ledgerBagSummary);
          const bagsOut =
            (tx.bagLedgerEntries || []).length > 0
              ? ledgerBagDisplay.bagsOut
              : bagsOutFromItems;
          const bagsReturned =
            (tx.bagLedgerEntries || []).length > 0
              ? ledgerBagDisplay.bagsReturned
              : bagsReturnedFromItems;
          const hasAnyItemQuantity = Object.values(quantities).some((qty) => qty !== 0);
          const isCreditTransaction =
            tx.transactionKind === "transfer_out" ||
            (tx.note || "").trim().startsWith("XFER|");
          const isZeroCostTransfer =
            isCreditTransaction && tx.totalAmount === 0;

          return {
            id: tx.id,
            customerId: tx.customer.id,
            customerName: tx.customer.name,
            saleDate: tx.saleDate,
            saleTime: tx.saleTime,
            transactionKind: tx.transactionKind,
            location: tx.pool && tx.row ? `${tx.pool}-${tx.row}` : "",
            status: tx.status,
            totalAmount: tx.totalAmount,
            paid: tx.paid,
            quantities,
            bagsOut,
            bagsReturned,
            isBagOnly: tx.totalAmount === 0 && !hasAnyItemQuantity && bagsReturned > 0,
            isZeroCostTransfer,
            isCreditTransaction,
          };
        });

      const soldProductIds = new Set<number>();
      for (const row of mappedRows) {
        for (const [id, qty] of Object.entries(row.quantities)) {
          if ((qty || 0) !== 0) soldProductIds.add(Number(id));
        }
      }

      setRows(mappedRows);
      const columns = Array.from(byId.values())
        .filter((p) => soldProductIds.has(p.id))
        .sort(sortProducts);
      setProductTypes(columns);
      setLoadedOnce(true);
    } catch {
      toast.error("ไม่สามารถโหลดข้อมูลรายวันได้");
    } finally {
      setLoading(false);
    }
  }, [canViewDailyLedger, endTime, filterCustomer, ledgerDate, startTime]);

  useEffect(() => {
    if (!canViewDailyLedger) return;
    void loadLedger();
  }, [canViewDailyLedger, loadLedger]);

  const filteredRows = useMemo(() => {
    const query = filterCustomer.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesCustomer =
        !query ||
        row.customerName.toLowerCase().includes(query) ||
        row.customerId.toString().includes(query);
      const matchesPayment = matchesLedgerPaymentFilter(row, {
        cash: showCash,
        outstanding: showOutstanding,
        credit: showCredit,
      });
      return matchesCustomer && matchesPayment;
    });
  }, [rows, filterCustomer, showCash, showOutstanding, showCredit]);

  const summary = useMemo(() => {
    const totalsByProduct: Record<number, number> = {};
    for (const p of productTypes) totalsByProduct[p.id] = 0;

    const financialTotals = computeFinancialTotals(
      filteredRows.map((r) => ({
        status: r.status,
        transactionKind: r.transactionKind,
        totalAmount: r.totalAmount,
        paid: r.paid,
      })),
      { includeTransferOut: true }
    );
    let totalBagsOut = 0;
    let totalBagsReturned = 0;

    for (const r of filteredRows) {
      totalBagsOut += r.bagsOut;
      totalBagsReturned += r.bagsReturned;

      for (const p of productTypes) {
        totalsByProduct[p.id] += r.quantities[p.id] || 0;
      }
    }

    return {
      totalsByProduct,
      grandTotal: financialTotals.netSales,
      totalPaid: financialTotals.netCash,
      totalUnpaid: financialTotals.outstandingDebt,
      refundBalance: financialTotals.refundBalance,
      totalBagsOut,
      totalBagsReturned,
      rowCount: filteredRows.length,
    };
  }, [filteredRows, productTypes]);

  const billOrderColumns = useMemo(() => {
    const fallback = {
      displayProducts: productTypes,
      primaryProducts: [] as ProductType[],
      otherProducts: [] as ProductType[],
    };
    if (!billOrderView) return fallback;

    const byId = new Map(productTypes.map((pt) => [pt.id, pt]));
    const { rows: billRows, extraItems } = buildExactBillRows(
      productTypes.map((pt) => ({
        productTypeId: pt.id,
        productName: pt.name,
      }))
    );

    const primaryProducts = billRows
      .map((row) => (row.item ? byId.get(row.item.productTypeId) : null))
      .filter((pt): pt is ProductType => Boolean(pt));

    const otherProducts = extraItems
      .map((item) => byId.get(item.productTypeId))
      .filter((pt): pt is ProductType => Boolean(pt));

    return {
      displayProducts: showOtherProductsInBillOrder
        ? [...primaryProducts, ...otherProducts]
        : primaryProducts,
      primaryProducts,
      otherProducts,
    };
  }, [billOrderView, productTypes, showOtherProductsInBillOrder]);

  const displayProductTypes = billOrderColumns.displayProducts;

  const openBillDetail = useCallback(async (id: number) => {
    setShowDetail(true);
    setLoadingDetail(true);
    setSelectedTx(null);
    try {
      const res = await fetch(`/api/transactions?id=${id}`);
      if (!res.ok) throw new Error("load_tx_detail_failed");
      const data: BillDetailTransaction = await res.json();
      setSelectedTx(data);
    } catch {
      setShowDetail(false);
      toast.error(`โหลดรายละเอียดบิล #${id} ไม่สำเร็จ`);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  function handlePrint() {
    window.print();
  }

  function handleExportCsv() {
    const headers: string[] = [
      "ลูกค้า",
      "เวลา",
      "ที่โหลด",
      ...displayProductTypes.map((pt) => pt.name),
      "ถุงออก",
      "คืนถุง",
      "สถานะ",
      "เงินสดรับ",
      "ยอดค้าง",
      "รวม",
    ];

    const bodyRows: Array<Array<string | number>> = filteredRows.map((row) => {
      const statusDisplay = getStatusDisplay(row);
      const { cashPaidText, creditOwedText, sumTotalText } = getLedgerMoneyDisplay(row);

      return [
        formatCustomerDisplay(row.customerId, row.customerName, showCustomerIdWithName),
        formatTime(row.saleTime),
        row.location || "",
        ...displayProductTypes.map((pt) =>
          row.quantities[pt.id] ? formatNumber(row.quantities[pt.id]) : ""
        ),
        row.bagsOut > 0 ? formatNumber(row.bagsOut) : "",
        row.bagsReturned > 0 ? formatNumber(row.bagsReturned) : "",
        statusDisplay.label,
        cashPaidText,
        creditOwedText,
        sumTotalText,
      ];
    });

    const totalsRow: Array<string | number> = [
      `รวม (${summary.rowCount} รายการ)`,
      "",
      "",
      ...displayProductTypes.map((pt) =>
        summary.totalsByProduct[pt.id] > 0
          ? formatNumber(summary.totalsByProduct[pt.id])
          : ""
      ),
      summary.totalBagsOut > 0 ? formatNumber(summary.totalBagsOut) : "",
      summary.totalBagsReturned > 0 ? formatNumber(summary.totalBagsReturned) : "",
      "",
      formatCurrency(summary.totalPaid),
      formatCurrency(summary.totalUnpaid),
      formatCurrency(summary.grandTotal),
    ];

    const refundRow: Array<string | number> = [
      "เครดิตฝั่งคืน",
      "",
      "",
      ...displayProductTypes.map(() => ""),
      "",
      "",
      "",
      "",
      summary.refundBalance > 0 ? formatCurrency(-summary.refundBalance) : "-",
      "",
    ];

    const rows: Array<Array<string | number>> = [
      ["สมุดรายวัน"],
      [`วันที่ ${formatThaiDate(ledgerDate)} | ${timeRangeLabel(startTime, endTime)}`],
      [],
      headers,
      ...bodyRows,
      totalsRow,
      refundRow,
    ];
    const csv = rows.map((row) => row.map((c) => csvEscape(c)).join(",")).join("\n");
    const exportStamp = getBangkokExportTimestamp();
    const fileName = `daily-ledger-${exportStamp.date}-${exportStamp.time}.csv`;
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  function applyFilters() {
    const nextLedgerDate = clampDailyLedgerDateForAccess(draftLedgerDate, sessionUser);
    setDraftLedgerDate(nextLedgerDate);
    setLedgerDate(nextLedgerDate);
    setStartTime(draftStartTime);
    setEndTime(draftEndTime);
    setFilterCustomer(draftFilterCustomer);
    setShowCash(draftShowCash);
    setShowOutstanding(draftShowOutstanding);
    setShowCredit(draftShowCredit);
  }

  function resetFilters() {
    const resetLedgerDate = clampDailyLedgerDateForAccess(initialLedgerDate, sessionUser);
    setDraftLedgerDate(resetLedgerDate);
    setDraftStartTime(initialStartTime);
    setDraftEndTime(initialEndTime);
    setDraftFilterCustomer("");
    setDraftShowCash(defaultPaymentFilters.cash);
    setDraftShowOutstanding(defaultPaymentFilters.outstanding);
    setDraftShowCredit(defaultPaymentFilters.credit);
    setLedgerDate(resetLedgerDate);
    setStartTime(initialStartTime);
    setEndTime(initialEndTime);
    setFilterCustomer("");
    setShowCash(defaultPaymentFilters.cash);
    setShowOutstanding(defaultPaymentFilters.outstanding);
    setShowCredit(defaultPaymentFilters.credit);
  }

  if (!authResolved) {
    return (
      <div className="w-full max-w-none min-w-0 flex items-center justify-center py-16">
        <p className="text-sm text-gray-500">กำลังโหลด...</p>
      </div>
    );
  }

  if (!canViewDailyLedger) {
    return null;
  }

  return (
    <div className="w-full max-w-none min-w-0 print:max-w-none invoice-print-root">
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 10mm;
          }

          .invoice-print-sheet {
            border: 0 !important;
          }

          .invoice-print-content {
            padding: 0 !important;
          }

          .invoice-print-root {
            width: 100% !important;
          }

          .invoice-print-table {
            width: 100% !important;
            table-layout: fixed !important;
            font-size: 12.6px !important;
            line-height: 1.18 !important;
          }

          .invoice-print-table th,
          .invoice-print-table td {
            font-size: 12.6px !important;
            line-height: 1.18 !important;
            padding: 2px 2px !important;
            vertical-align: middle !important;
          }

          .invoice-print-table tr {
            break-inside: avoid;
          }

          .invoice-print-customer {
            font-size: 10.2px !important;
            width: 31mm !important;
            max-width: 31mm !important;
            white-space: normal !important;
            word-break: break-word !important;
            line-height: 1.18 !important;
          }

          .invoice-print-table button {
            display: inline !important;
            padding: 0 !important;
            margin: 0 !important;
            border: 0 !important;
            background: transparent !important;
            color: #000 !important;
            font: inherit !important;
            text-decoration: none !important;
            box-shadow: none !important;
          }

          .invoice-print-time {
            width: 10mm !important;
          }

          .invoice-print-location {
            width: 11mm !important;
          }

          .invoice-print-hide-location {
            display: none !important;
          }

          .invoice-print-qty {
            width: 8.2mm !important;
          }

          .invoice-print-status-col {
            width: 10mm !important;
          }

          .invoice-print-money-col {
            width: 14mm !important;
          }

          .invoice-print-money {
            font-size: 14px !important;
            line-height: 1.05 !important;
            font-variant-numeric: tabular-nums;
          }

          .invoice-print-bottom-head {
            display: none !important;
          }
        }
      `}</style>
      <div className="print:hidden space-y-4 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 ui-scale-page-title">สมุดรายวัน</h1>
          {filteredRows.length > 0 && (
            <div className="flex items-center gap-2">
              <Button onClick={handleExportCsv} variant="outline" size="sm">
                CSV
              </Button>
              <Button onClick={handlePrint} variant="outline" size="sm">
                พิมพ์
              </Button>
              <Button
                onClick={() => {
                  setBillOrderView((prev) => !prev);
                  if (billOrderView) setShowOtherProductsInBillOrder(false);
                }}
                variant={billOrderView ? "default" : "outline"}
                size="sm"
              >
                {billOrderView ? "Normal Order" : "Bill Order"}
              </Button>
            </div>
          )}
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base ui-scale-section-title">ตัวกรองรายวัน</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label className="text-xs ui-scale-label">วันที่</Label>
                <Input
                  type="date"
                  value={draftLedgerDate}
                  min={isRestrictedRecentWindowUser ? recentWindow.yesterday : undefined}
                  max={isRestrictedRecentWindowUser ? recentWindow.today : undefined}
                  onChange={(e) =>
                    setDraftLedgerDate(
                      clampDailyLedgerDateForAccess(e.target.value, sessionUser)
                    )
                  }
                  className="h-9 w-40 text-sm"
                />
                {isRestrictedRecentWindowUser && (
                  <p className="mt-1 text-[11px] text-amber-700">
                    ผู้จัดการ Bearing ดูได้เฉพาะวันนี้และเมื่อวาน
                  </p>
                )}
              </div>

              <div>
                <Label className="text-xs ui-scale-label">เวลาเริ่ม</Label>
                <Input
                  type="time"
                  step={60}
                  value={draftStartTime}
                  onChange={(e) => setDraftStartTime(e.target.value)}
                  className="h-9 w-36 text-sm"
                />
              </div>

              <div>
                <Label className="text-xs ui-scale-label">เวลาสิ้นสุด</Label>
                <Input
                  type="time"
                  step={60}
                  value={draftEndTime}
                  onChange={(e) => setDraftEndTime(e.target.value)}
                  className="h-9 w-36 text-sm"
                />
              </div>

              <div>
                <Label className="text-xs ui-scale-label">ช่วงเวลา</Label>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <span className="text-sm text-gray-700">
                    {timeRangeLabel(draftStartTime, draftEndTime)}
                  </span>
                </div>
              </div>

              <div>
                <Label className="text-xs ui-scale-label">ค้นหาลูกค้า</Label>
                <Input
                  value={draftFilterCustomer}
                  onChange={(e) => setDraftFilterCustomer(e.target.value)}
                  placeholder="Customer name or #id"
                  className="h-9 w-56 text-sm"
                />
              </div>

              <div className="min-w-[240px]">
                <Label className="text-xs ui-scale-label">ประเภทการชำระ</Label>
                <div className="mt-2 flex flex-wrap items-center gap-4 rounded-md border border-gray-200 px-3 py-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={draftShowCash}
                      onChange={(e) => setDraftShowCash(e.target.checked)}
                    />
                    เงินสด
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={draftShowOutstanding}
                      onChange={(e) => setDraftShowOutstanding(e.target.checked)}
                    />
                    ยอดค้าง
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={draftShowCredit}
                      onChange={(e) => setDraftShowCredit(e.target.checked)}
                    />
                    เครดิต
                  </label>
                </div>
              </div>

              <Button onClick={applyFilters} disabled={loading} className="h-9">
                {loading ? "กำลังโหลด..." : "Apply"}
              </Button>
              <Button onClick={resetFilters} variant="outline" className="h-9">
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {loading && <div className="text-center py-8 text-gray-500 print:hidden">กำลังโหลดข้อมูล...</div>}

      {!loading && loadedOnce && rows.length === 0 && (
        <div className="text-center py-8 text-gray-500 print:hidden">
          ไม่มีรายการใน {formatThaiDate(ledgerDate)} ({timeRangeLabel(startTime, endTime)})
        </div>
      )}

      {!loading && loadedOnce && rows.length > 0 && filteredRows.length === 0 && (
        <div className="text-center py-8 text-gray-500 print:hidden">
          ไม่พบลูกค้าที่ตรงกับการค้นหา
        </div>
      )}

      {filteredRows.length > 0 && (
        <div className="w-full bg-white rounded-lg border border-gray-200 print:border-0 print:rounded-none invoice-print-sheet">
          <div className="p-6 print:p-4 invoice-print-content">
            <div className="text-center mb-4">
              <h2 className="text-2xl font-bold print:text-xl">สมุดรายวัน</h2>
              <p className="text-sm text-gray-600 mt-1 print:text-xs">
                วันที่ {formatThaiDate(ledgerDate)} | {timeRangeLabel(startTime, endTime)}
              </p>
            </div>

            <div className="w-full overflow-x-auto print:overflow-visible">
              {billOrderView && (
                <div className="mb-2 flex items-center gap-2 text-xs print:hidden">
                  <span className="text-gray-600">
                    โหมดตามบิล: ซอง, แพ็ค 20, หลอดใหญ่ 20กก., หลอดเล็ก โม่, หลอดใหญ่ โม่, หลอดเล็ก 20กก.
                  </span>
                  {billOrderColumns.otherProducts.length > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() =>
                        setShowOtherProductsInBillOrder((prev) => !prev)
                      }
                    >
                      {showOtherProductsInBillOrder
                        ? `ซ่อน Others (${billOrderColumns.otherProducts.length})`
                        : `แสดง Others (${billOrderColumns.otherProducts.length})`}
                    </Button>
                  )}
                </div>
              )}
              <table className="w-full min-w-max text-sm border-collapse print:text-[9px] invoice-print-table ui-scale-bill-table">
                <thead>
                  <tr className="border-b-2 border-gray-400">
                    <th className="text-left py-2 px-1 whitespace-nowrap invoice-print-customer">ลูกค้า</th>
                    <th className="text-left py-2 px-1 whitespace-nowrap invoice-print-time">เวลา</th>
                    <th className="text-center py-2 px-1 whitespace-nowrap invoice-print-location invoice-print-hide-location">ที่โหลด</th>
                    {displayProductTypes.map((pt, index) => (
                      <th key={pt.id} className="text-center py-2 px-1 whitespace-nowrap invoice-print-qty">
                        <span className="print:hidden">{pt.name}</span>
                        <span className="hidden print:inline">{getLedgerPrintProductLabel(pt.name, index)}</span>
                      </th>
                    ))}
                    <th className="text-center py-2 px-1 whitespace-nowrap invoice-print-qty">ถุงออก</th>
                    <th className="text-center py-2 px-1 whitespace-nowrap invoice-print-qty">คืนถุง</th>
                    <th className="text-center py-2 px-1 whitespace-nowrap invoice-print-status-col">สถานะ</th>
                    <th className="text-right py-2 px-1 whitespace-nowrap invoice-print-money-col">เงินสดรับ</th>
                    <th className="text-right py-2 px-1 whitespace-nowrap invoice-print-money-col">ยอดค้าง</th>
                    <th className="text-right py-2 px-1 whitespace-nowrap invoice-print-money-col">รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const statusDisplay = getStatusDisplay(row);
                    const { cashPaidText, creditOwedText, sumTotalText } = getLedgerMoneyDisplay(row);

                    return (
                      <tr
                        key={row.id}
                        className={`border-b border-gray-200 ${row.status === "unpaid" ? "bg-red-50 print:bg-transparent" : ""}`}
                      >
                        <td className="py-1.5 px-1 whitespace-nowrap text-xs font-medium invoice-print-customer">
                          {formatCustomerDisplay(
                            row.customerId,
                            row.customerName,
                            showCustomerIdWithName
                          )}
                        </td>
                        <td className="py-1.5 px-1 whitespace-nowrap text-xs invoice-print-time">{formatTime(row.saleTime)}</td>
                        <td className="py-1.5 px-1 text-center text-xs invoice-print-location invoice-print-hide-location">{row.location}</td>
                        {displayProductTypes.map((pt) => (
                          <td key={pt.id} className="py-1.5 px-1 text-center text-xs invoice-print-qty">
                            {row.quantities[pt.id] ? formatNumber(row.quantities[pt.id]) : ""}
                          </td>
                        ))}
                        <td className="py-1.5 px-1 text-center text-xs invoice-print-qty">
                          {row.bagsOut > 0 ? formatNumber(row.bagsOut) : ""}
                        </td>
                        <td className="py-1.5 px-1 text-center text-xs invoice-print-qty">
                          {row.bagsReturned > 0 ? formatNumber(row.bagsReturned) : ""}
                        </td>
                        <td className="py-1.5 px-1 text-center text-xs invoice-print-status-col">
                          <span className={statusDisplay.className}>{statusDisplay.label}</span>
                        </td>
                        <td className="py-1.5 px-1 text-right text-xs font-medium whitespace-nowrap invoice-print-money invoice-print-money-col">
                          {cashPaidText}
                        </td>
                        <td className="py-1.5 px-1 text-right text-xs font-medium whitespace-nowrap invoice-print-money invoice-print-money-col">
                          {creditOwedText}
                        </td>
                        <td className="py-1.5 px-1 text-right text-xs font-medium whitespace-nowrap invoice-print-money invoice-print-money-col">
                          <button
                            type="button"
                            className="text-black hover:underline underline-offset-2 print:no-underline"
                            onClick={() => void openBillDetail(row.id)}
                          >
                            {sumTotalText}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-400 font-bold bg-gray-50 print:bg-transparent">
                    <td className="py-2 px-1 text-sm print:hidden" colSpan={3}>
                      รวม ({summary.rowCount} รายการ)
                    </td>
                    <td className="hidden py-2 px-1 text-sm print:table-cell" colSpan={2}>
                      รวม ({summary.rowCount} รายการ)
                    </td>
                    {displayProductTypes.map((pt) => (
                      <td key={pt.id} className="py-2 px-1 text-center text-sm invoice-print-qty">
                        {summary.totalsByProduct[pt.id] > 0
                          ? formatNumber(summary.totalsByProduct[pt.id])
                          : ""}
                      </td>
                    ))}
                    <td className="py-2 px-1 text-center text-sm invoice-print-qty">
                      {summary.totalBagsOut > 0 ? formatNumber(summary.totalBagsOut) : ""}
                    </td>
                    <td className="py-2 px-1 text-center text-sm invoice-print-qty">
                      {summary.totalBagsReturned > 0 ? formatNumber(summary.totalBagsReturned) : ""}
                    </td>
                    <td className="py-2 px-1"></td>
                    <td className="py-2 px-1 text-right text-sm whitespace-nowrap invoice-print-money invoice-print-money-col">
                      {formatCurrency(summary.totalPaid)}
                    </td>
                    <td className="py-2 px-1 text-right text-sm whitespace-nowrap invoice-print-money invoice-print-money-col">
                      {formatCurrency(summary.totalUnpaid)}
                    </td>
                    <td className="py-2 px-1 text-right text-sm whitespace-nowrap invoice-print-money invoice-print-money-col">
                      {formatCurrency(summary.grandTotal)}
                    </td>
                  </tr>
                  <tr className="border-t-2 border-gray-300 bg-gray-50 print:bg-transparent invoice-print-bottom-head">
                    <td className="py-1.5 px-1 whitespace-nowrap text-[11px] font-medium invoice-print-customer">ลูกค้า</td>
                    <td className="py-1.5 px-1 whitespace-nowrap text-[11px] font-medium invoice-print-time">เวลา</td>
                    <td className="py-1.5 px-1 text-center whitespace-nowrap text-[11px] font-medium invoice-print-location invoice-print-hide-location">ที่โหลด</td>
                    {displayProductTypes.map((pt, index) => (
                      <td key={`bottom-h-${pt.id}`} className="py-1.5 px-1 text-center whitespace-nowrap text-[11px] font-medium invoice-print-qty">
                        <span className="print:hidden">{pt.name}</span>
                        <span className="hidden print:inline">{getLedgerPrintProductLabel(pt.name, index)}</span>
                      </td>
                    ))}
                    <td className="py-1.5 px-1 text-center whitespace-nowrap text-[11px] font-medium invoice-print-qty">ถุงออก</td>
                    <td className="py-1.5 px-1 text-center whitespace-nowrap text-[11px] font-medium invoice-print-qty">คืนถุง</td>
                    <td className="py-1.5 px-1 text-center whitespace-nowrap text-[11px] font-medium invoice-print-status-col">สถานะ</td>
                    <td className="py-1.5 px-1 text-right whitespace-nowrap text-[11px] font-medium invoice-print-money invoice-print-money-col">เงินสดรับ</td>
                    <td className="py-1.5 px-1 text-right whitespace-nowrap text-[11px] font-medium invoice-print-money invoice-print-money-col">ยอดค้าง</td>
                    <td className="py-1.5 px-1 text-right whitespace-nowrap text-[11px] font-medium invoice-print-money invoice-print-money-col">รวม</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 print:hidden">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500 ui-scale-summary-label">รายการทั้งหมด</p>
                <p className="text-lg font-bold ui-scale-summary-value">{summary.rowCount}</p>
              </div>
              <div className="bg-green-50 rounded-lg p-3">
                <p className="text-xs text-green-700 ui-scale-summary-label">เงินสดสุทธิ</p>
                <p className="text-lg font-bold text-green-700 ui-scale-summary-value">{formatCurrency(summary.totalPaid)}</p>
              </div>
              <div className="bg-red-50 rounded-lg p-3">
                <p className="text-xs text-red-600 ui-scale-summary-label">ค้างชำระ</p>
                <p className="text-lg font-bold text-red-600 ui-scale-summary-value">{formatCurrency(summary.totalUnpaid)}</p>
              </div>
              <div className="bg-blue-50 rounded-lg p-3">
                <p className="text-xs text-blue-700 ui-scale-summary-label">ยอดรวมช่วงที่เลือก</p>
                <p className="text-lg font-bold text-blue-700 ui-scale-summary-value">{formatCurrency(summary.grandTotal)}</p>
              </div>
              {summary.refundBalance > 0 && (
                <div className="bg-indigo-50 rounded-lg p-3 col-span-2 md:col-span-4">
                  <p className="text-xs text-indigo-700 ui-scale-summary-label">เครดิตฝั่งคืน</p>
                  <p className="text-lg font-bold text-indigo-700 ui-scale-summary-value">{formatCurrency(summary.refundBalance)}</p>
                </div>
              )}
            </div>

            <div className="hidden print:block mt-6 pt-4 border-t border-gray-300 text-xs text-center text-gray-500">
              <p>พิมพ์เมื่อ {formatThaiDate(todayISO())}</p>
            </div>
          </div>
        </div>
      )}

      {!loading && loadedOnce && rows.length > 0 && (
        <div className="mt-4 print:hidden flex flex-wrap gap-2">
          {filterCustomer.trim() ? (
            <Badge variant="outline">
              กรองลูกค้า: &quot;{filterCustomer.trim()}&quot;
            </Badge>
          ) : (
            <Badge variant="outline">แสดงข้อมูลทั้งหมดทุกลูกค้าในช่วงเวลาที่เลือก</Badge>
          )}
          {showCash && <Badge variant="outline">เงินสด</Badge>}
          {showOutstanding && <Badge variant="outline">ยอดค้าง</Badge>}
          {showCredit && <Badge variant="outline">เครดิต</Badge>}
        </div>
      )}

      <Dialog open={showDetail} onOpenChange={setShowDetail}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>รายละเอียดบิล #{selectedTx?.id ?? "-"}</DialogTitle>
          </DialogHeader>

          {loadingDetail && (
            <p className="text-sm text-gray-500 py-6 text-center">กำลังโหลดรายละเอียด...</p>
          )}

          {!loadingDetail && selectedTx && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm ui-scale-body">
                <div>
                  <strong>ลูกค้า:</strong>{" "}
                  {formatCustomerDisplay(
                    selectedTx.customer.id,
                    selectedTx.customer.name,
                    showCustomerIdWithName
                  )}
                </div>
                <div>
                  <strong>วันที่:</strong> {formatThaiDate(selectedTx.saleDate)}
                </div>
                <div>
                  <strong>เวลา:</strong> {selectedTx.saleTime}
                </div>
                <div>
                  <strong>สถานะ:</strong>{" "}
                  {selectedTx.status === "paid"
                    ? "ชำระ"
                    : selectedTx.status === "unpaid"
                      ? "ค้าง"
                      : selectedTx.status === "partial"
                        ? "บางส่วน"
                        : selectedTx.status === "voided"
                          ? "ยกเลิก"
                          : selectedTx.status}
                </div>
                {selectedTx.pool && (
                  <div>
                    <strong>ที่โหลด:</strong> {selectedTx.pool}-{selectedTx.row}
                  </div>
                )}
                {selectedTx.note && (
                  <div className="col-span-2">
                    <strong>หมายเหตุ:</strong> {selectedTx.note}
                  </div>
                )}
              </div>

              <div className="overflow-x-auto border rounded-md">
                <table className="w-full text-sm ui-scale-bill-table">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left py-2 px-2">สินค้า</th>
                      <th className="text-right py-2 px-2">จำนวน</th>
                      <th className="text-right py-2 px-2">ราคา</th>
                      <th className="text-right py-2 px-2">รวม</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedTx.items.map((item, idx) => (
                      <tr key={`${item.productType.id}-${idx}`} className="border-t">
                        <td className="py-2 px-2">{item.productType.name}</td>
                        <td className="py-2 px-2 text-right">{formatNumber(item.quantity)}</td>
                        <td className="py-2 px-2 text-right">{formatCurrency(item.unitPrice)}</td>
                        <td className="py-2 px-2 text-right">{formatCurrency(item.subtotal)}</td>
                      </tr>
                    ))}
                    <tr className="border-t font-semibold">
                      <td className="py-2 px-2" colSpan={3}>ยอดรวม</td>
                      <td className="py-2 px-2 text-right">
                        {formatCurrency(selectedTx.totalAmount)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {(() => {
                const detailTotals = computeFinancialTotals(
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
                  <div className="grid grid-cols-2 gap-3 text-sm border rounded-md p-3 ui-scale-body">
                    <div>
                      <p className="text-gray-500 text-xs">เงินสดสุทธิ</p>
                      <p className="font-semibold text-green-700">
                        {formatCurrency(detailTotals.netCash)}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs">ค้างชำระ</p>
                      <p className="font-semibold text-red-600">
                        {formatCurrency(detailTotals.outstandingDebt)}
                      </p>
                    </div>
                    {detailTotals.refundBalance > 0 && (
                      <div className="col-span-2">
                        <p className="text-gray-500 text-xs">เครดิตฝั่งคืน</p>
                        <p className="font-semibold text-indigo-700">
                          {formatCurrency(detailTotals.refundBalance)}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
