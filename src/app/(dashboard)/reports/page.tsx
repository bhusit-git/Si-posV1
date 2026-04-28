"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { captureClientEvent } from "@/lib/posthog-client";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatNumber, formatThaiDate, formatThaiMonth, formatShortMonth, todayISO } from "@/lib/thai-utils";
import type {
  BagUsageReportResponse,
  BagUsageReportRow,
  BagUsageSummary,
} from "@/lib/bag-usage-report";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  LineChart, Line, ComposedChart,
} from "recharts";

// ==================== Interfaces ====================
interface DailyRow { date: string; totalTransactions: number; totalAmount: number; }
interface ProductRow {
  productId: number; productName: string;
  totalQuantity: number; returnedQuantity: number; netQuantity: number;
  totalAmount: number; returnedAmount: number; netAmount: number;
}
interface CustomerRow { customerId: number; customerName: string; totalTransactions: number; totalAmount: number; }
interface CashRow {
  date: string; totalSales: number; totalPaid: number; totalOutstanding: number;
  outstandingDebt: number; refundBalance: number;
  paidCount: number; unpaidCount: number; partialCount: number;
}
interface PriceBreakdownRow {
  customerId: number; customerName: string; productId: number; productName: string;
  unitPrice: number; totalQuantity: number; totalAmount: number;
}
type BagUsageRow = BagUsageReportRow;
interface MonthlyRow {
  year: number; month: number;
  totalTransactions: number; totalAmount: number; totalPaid: number; totalOutstanding: number;
  outstandingDebt: number; refundBalance: number;
}
interface HistoryDailyRow {
  date: string; totalAmount: number; totalPaid: number; txCount: number; ma7?: number;
}
interface CustomerBehaviorRow {
  year: number; month: number;
  activeCustomers: number; newCustomers: number; totalAmount: number; avgPerCustomer: number;
}
interface TopCustomerRow {
  customerId: number; customerName: string; totalAmount: number; txCount: number;
  monthly: { year: number; month: number; amount: number }[];
}

// ==================== Date helpers ====================
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

// ==================== Number coercion helper ====================
// PostgreSQL COUNT/SUM return strings; ensure all numeric fields are actual numbers
function N(v: unknown): number {
  if (typeof v === "number") return v;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function formatSignedBagNumber(value: number): string {
  const formatted = formatNumber(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return "0";
}

function getBagChangeText(row: BagUsageRow): string {
  if (row.previousOut === 0) {
    return row.hasBigChange ? "ใหม่" : "ไม่มีฐานเทียบ";
  }
  const pct = Math.round(row.outDeltaPct ?? 0);
  const pctLabel = `${pct > 0 ? "+" : ""}${pct}%`;
  return `${formatSignedBagNumber(row.outDelta)} (${pctLabel})`;
}

function getBagChangeClassName(row: BagUsageRow): string {
  if (row.previousOut === 0) {
    return row.hasBigChange ? "text-amber-700 font-medium" : "text-gray-500";
  }
  if (row.outDelta > 0) {
    return row.hasBigChange ? "text-red-600 font-medium" : "text-gray-700";
  }
  if (row.outDelta < 0) {
    return row.hasBigChange ? "text-green-700 font-medium" : "text-gray-700";
  }
  return "text-gray-500";
}

type SortDirection = "asc" | "desc";
type DailySortKey = "date" | "totalTransactions" | "totalAmount";

const SORTABLE_TAB_LABELS: Record<string, string> = {
  daily: "ยอดรวม",
  monthly: "เดือน",
  byProduct: "ยอดสุทธิ",
  byCustomer: "ยอดรวม",
  cash: "ยอดขาย",
  priceBreakdown: "ยอดรวม",
  bagUsage: "ยอดสุทธิ",
};
const DAILY_SORT_LABELS: Record<DailySortKey, string> = {
  date: "วันที่",
  totalTransactions: "จำนวนบิล",
  totalAmount: "ยอดรวม",
};

function sortByNumeric<T>(
  rows: T[],
  getValue: (row: T) => number,
  direction: SortDirection
): T[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const diff = getValue(a) - getValue(b);
    if (diff === 0) return 0;
    return diff * factor;
  });
}

export default function ReportsPage() {
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(todayISO);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [activeTab, setActiveTab] = useState("daily");
  const [sortDirectionByTab, setSortDirectionByTab] = useState<Record<string, SortDirection>>({
    daily: "desc",
    monthly: "desc",
    byProduct: "desc",
    byCustomer: "desc",
    cash: "desc",
    priceBreakdown: "desc",
    bagUsage: "desc",
  });
  const [dailySortKey, setDailySortKey] = useState<DailySortKey>("totalAmount");
  const [loading, setLoading] = useState(false);
  const [dailyData, setDailyData] = useState<DailyRow[]>([]);
  const [productData, setProductData] = useState<ProductRow[]>([]);
  const [customerData, setCustomerData] = useState<CustomerRow[]>([]);
  const [cashData, setCashData] = useState<CashRow[]>([]);
  const [priceData, setPriceData] = useState<PriceBreakdownRow[]>([]);
  const [bagUsageData, setBagUsageData] = useState<BagUsageRow[]>([]);
  const [bagUsageSummary, setBagUsageSummary] = useState<BagUsageSummary | null>(null);
  const [monthlyData, setMonthlyData] = useState<MonthlyRow[]>([]);
  const [historyDailyData, setHistoryDailyData] = useState<HistoryDailyRow[]>([]);
  const [customerBehaviorData, setCustomerBehaviorData] = useState<CustomerBehaviorRow[]>([]);
  const [topCustomersData, setTopCustomersData] = useState<TopCustomerRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Customer drill-down state
  const [drillCustomerId, setDrillCustomerId] = useState<number | null>(null);
  const [drillCustomerName, setDrillCustomerName] = useState("");
  const [drillMonth, setDrillMonth] = useState(() => new Date());
  const [drillTxList, setDrillTxList] = useState<{
    id: number; totalAmount: number; paid: number; status: string;
    saleDate: string; saleTime: string;
    items: { productType: { name: string }; quantity: number; unitPrice: number; subtotal: number }[];
  }[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);

  async function loadDrillData(customerId: number, month: Date) {
    setDrillLoading(true);
    try {
      const y = month.getFullYear();
      const m = month.getMonth();
      const s = `${y}-${String(m + 1).padStart(2, "0")}-01`;
      const lastDay = new Date(y, m + 1, 0).getDate();
      const e = `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      const res = await fetch(`/api/transactions?customerId=${customerId}&startDate=${s}&endDate=${e}`);
      const data = await res.json();
      setDrillTxList(Array.isArray(data) ? data : []);
    } catch {
      setDrillTxList([]);
    } finally {
      setDrillLoading(false);
    }
  }

  function openDrill(customerId: number, customerName: string) {
    const now = new Date();
    setDrillCustomerId(customerId);
    setDrillCustomerName(customerName);
    setDrillMonth(now);
    loadDrillData(customerId, now);
  }

  function navigateDrillMonth(delta: number) {
    setDrillMonth((prev) => {
      const next = new Date(prev.getFullYear(), prev.getMonth() + delta, 1);
      if (drillCustomerId) loadDrillData(drillCustomerId, next);
      return next;
    });
  }

  // Quick date shortcut
  const [activeQuick, setActiveQuick] = useState("thisMonth");

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
    setStartDate(toISO(s));
    setEndDate(toISO(e));
    setActiveQuick(key);
  }

  async function loadReport(type: string) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type, startDate, endDate });
      if (startTime) params.set("startTime", startTime);
      if (endTime) params.set("endTime", endTime);
      if (customerQuery.trim()) params.set("customerQuery", customerQuery.trim());
      const res = await fetch(`/api/reports?${params}`);
      const data = await res.json();

      // Coerce all numeric fields from the API (PostgreSQL returns strings for aggregates)
      if (type === "daily") {
        setDailyData(data.map((r: Record<string, unknown>) => ({
          date: r.date,
          totalTransactions: N(r.totalTransactions),
          totalAmount: N(r.totalAmount),
        })));
      } else if (type === "byProduct") {
        setProductData(data.map((r: Record<string, unknown>) => ({
          productId: N(r.productId),
          productName: r.productName,
          totalQuantity: N(r.totalQuantity),
          returnedQuantity: N(r.returnedQuantity),
          netQuantity: N(r.netQuantity),
          totalAmount: N(r.totalAmount),
          returnedAmount: N(r.returnedAmount),
          netAmount: N(r.netAmount),
        })));
      } else if (type === "byCustomer") {
        setCustomerData(data.map((r: Record<string, unknown>) => ({
          customerId: N(r.customerId),
          customerName: r.customerName,
          totalTransactions: N(r.totalTransactions),
          totalAmount: N(r.totalAmount),
        })));
      } else if (type === "cash") {
        setCashData(data.map((r: Record<string, unknown>) => ({
          date: r.date,
          totalSales: N(r.totalSales),
          totalPaid: N(r.totalPaid),
          totalOutstanding: N(r.totalOutstanding),
          outstandingDebt: N(r.outstandingDebt ?? r.totalOutstanding),
          refundBalance: N(r.refundBalance),
          paidCount: N(r.paidCount),
          unpaidCount: N(r.unpaidCount),
          partialCount: N(r.partialCount),
        })));
      } else if (type === "priceBreakdown") {
        setPriceData(data.map((r: Record<string, unknown>) => ({
          customerId: N(r.customerId),
          customerName: r.customerName,
          productId: N(r.productId),
          productName: r.productName,
          unitPrice: N(r.unitPrice),
          totalQuantity: N(r.totalQuantity),
          totalAmount: N(r.totalAmount),
        })));
      } else if (type === "bagUsage") {
        const bagUsageResponse = data as BagUsageReportResponse;
        const rows = Array.isArray(bagUsageResponse?.rows) ? bagUsageResponse.rows : [];
        setBagUsageData(rows.map((r) => ({
          customerId: N(r.customerId),
          customerName: r.customerName,
          phone: r.phone || null,
          totalOut: N(r.totalOut),
          totalReturn: N(r.totalReturn),
          totalAdjust: N(r.totalAdjust),
          netMovement: N(r.netMovement),
          previousOut: N(r.previousOut),
          outDelta: N(r.outDelta),
          outDeltaPct:
            r.outDeltaPct == null ? null : N(r.outDeltaPct),
          hasBigChange: Boolean(r.hasBigChange),
        })));

        const summary = bagUsageResponse?.summary;
        setBagUsageSummary(
          summary
            ? {
                weeklyOutflowTotal: N(summary.weeklyOutflowTotal),
                weeklyWindowStart: String(summary.weeklyWindowStart || ""),
                weeklyWindowEnd: String(summary.weeklyWindowEnd || ""),
                flaggedCustomerCount: N(summary.flaggedCustomerCount),
                totalOut: N(summary.totalOut),
                totalReturn: N(summary.totalReturn),
                totalAdjust: N(summary.totalAdjust),
                netMovement: N(summary.netMovement),
              }
            : null
        );
      } else if (type === "monthly") {
        setMonthlyData(data.map((r: Record<string, unknown>) => ({
          year: N(r.year),
          month: N(r.month),
          totalTransactions: N(r.totalTransactions),
          totalAmount: N(r.totalAmount),
          totalPaid: N(r.totalPaid),
          totalOutstanding: N(r.totalOutstanding),
          outstandingDebt: N(r.outstandingDebt ?? r.totalOutstanding),
          refundBalance: N(r.refundBalance),
        })));
      } else if (type === "history") {
        // History tab loads 3 endpoints in parallel
        await loadHistoryData();
        return; // already handled
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadHistoryData() {
    setHistoryLoading(true);
    try {
      const histStart = startDate;
      const histEnd = endDate;
      const [dailyRes, behaviorRes, topRes] = await Promise.all([
        fetch(`/api/reports?type=historyDaily&startDate=${histStart}&endDate=${histEnd}&customerQuery=${encodeURIComponent(customerQuery.trim())}`),
        fetch(`/api/reports?type=historyCustomerBehavior&startDate=${histStart}&endDate=${histEnd}&customerQuery=${encodeURIComponent(customerQuery.trim())}`),
        fetch(`/api/reports?type=historyTopCustomers&startDate=${histStart}&endDate=${histEnd}&customerQuery=${encodeURIComponent(customerQuery.trim())}`),
      ]);
      const [dailyRaw, behaviorRaw, topRaw] = await Promise.all([
        dailyRes.json(), behaviorRes.json(), topRes.json(),
      ]);
      processHistoryData(dailyRaw, behaviorRaw, topRaw);
    } finally {
      setHistoryLoading(false);
    }
  }

  function handleTabChange(tab: string) {
    setActiveTab(tab);
    if (tab === "history") {
      // Auto-expand date range to last 12 months for history if user hasn't changed dates
      const d12 = new Date();
      d12.setFullYear(d12.getFullYear() - 1);
      const longStart = d12.toISOString().split("T")[0];
      const longEnd = todayISO();
      // If current startDate is within last month (default), expand to 12 months
      const currentStart = new Date(startDate);
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
      if (currentStart >= oneMonthAgo) {
        setStartDate(longStart);
        setEndDate(longEnd);
        // Load with the expanded range
        setHistoryLoading(true);
        setLoading(true);
        const params1 = `startDate=${longStart}&endDate=${longEnd}&customerQuery=${encodeURIComponent(customerQuery.trim())}`;
        Promise.all([
          fetch(`/api/reports?type=historyDaily&${params1}`),
          fetch(`/api/reports?type=historyCustomerBehavior&${params1}`),
          fetch(`/api/reports?type=historyTopCustomers&${params1}`),
        ])
          .then(([r1, r2, r3]) => Promise.all([r1.json(), r2.json(), r3.json()]))
          .then(([dailyRaw, behaviorRaw, topRaw]) => {
            processHistoryData(dailyRaw, behaviorRaw, topRaw);
          })
          .finally(() => { setHistoryLoading(false); setLoading(false); });
        return;
      }
      loadReport(tab);
    } else {
      loadReport(tab);
    }
  }

  function processHistoryData(
    dailyRaw: Record<string, unknown>[],
    behaviorRaw: Record<string, unknown>[],
    topRaw: Record<string, unknown>[],
  ) {
    const daily: HistoryDailyRow[] = dailyRaw.map((r) => ({
      date: String(r.date),
      totalAmount: N(r.totalAmount),
      totalPaid: N(r.totalPaid),
      txCount: N(r.txCount),
    }));
    for (let i = 0; i < daily.length; i++) {
      const windowStart = Math.max(0, i - 6);
      let sum = 0;
      for (let j = windowStart; j <= i; j++) sum += daily[j].totalAmount;
      daily[i].ma7 = sum / (i - windowStart + 1);
    }
    setHistoryDailyData(daily);

    setCustomerBehaviorData(behaviorRaw.map((r) => {
      const active = N(r.activeCustomers);
      const total = N(r.totalAmount);
      return {
        year: N(r.year), month: N(r.month),
        activeCustomers: active, newCustomers: N(r.newCustomers),
        totalAmount: total, avgPerCustomer: active > 0 ? Math.round(total / active) : 0,
      };
    }));

    setTopCustomersData(topRaw.map((r) => ({
      customerId: N(r.customerId),
      customerName: String(r.customerName),
      totalAmount: N(r.totalAmount),
      txCount: N(r.txCount),
      monthly: Array.isArray(r.monthly)
        ? (r.monthly as Record<string, unknown>[]).map((m) => ({
            year: N(m.year), month: N(m.month), amount: N(m.amount),
          }))
        : [],
    })));
  }

  function handleSearch() {
    loadReport(activeTab);
  }

  function handleDailySort(nextKey: DailySortKey) {
    setSortDirectionByTab((prev) => {
      const currentDirection = prev.daily || "desc";
      const nextDirection: SortDirection =
        dailySortKey === nextKey ? (currentDirection === "asc" ? "desc" : "asc") : currentDirection;
      return { ...prev, daily: nextDirection };
    });
    setDailySortKey(nextKey);
  }

  const activeSortLabel = activeTab === "daily" ? DAILY_SORT_LABELS[dailySortKey] : SORTABLE_TAB_LABELS[activeTab];
  const activeSortDirection: SortDirection = sortDirectionByTab[activeTab] || "desc";
  const dailySortDirection: SortDirection = sortDirectionByTab.daily || "desc";

  const sortedDailyData = useMemo(
    () => [...dailyData].sort((a, b) => {
      const factor = dailySortDirection === "asc" ? 1 : -1;
      if (dailySortKey === "date") {
        return a.date.localeCompare(b.date) * factor;
      }
      if (dailySortKey === "totalTransactions") {
        const diff = a.totalTransactions - b.totalTransactions;
        if (diff !== 0) return diff * factor;
      } else {
        const diff = a.totalAmount - b.totalAmount;
        if (diff !== 0) return diff * factor;
      }
      return a.date.localeCompare(b.date) * -1;
    }),
    [dailyData, dailySortDirection, dailySortKey]
  );
  const sortedMonthlyData = useMemo(
    () => {
      const direction = sortDirectionByTab.monthly || "desc";
      const factor = direction === "asc" ? 1 : -1;
      return [...monthlyData].sort((a, b) => {
        const aKey = a.year * 100 + a.month;
        const bKey = b.year * 100 + b.month;
        const diff = aKey - bKey;
        if (diff === 0) return 0;
        return diff * factor;
      });
    },
    [monthlyData, sortDirectionByTab.monthly]
  );
  const sortedProductData = useMemo(
    () => sortByNumeric(productData, (r) => r.netAmount, sortDirectionByTab.byProduct || "desc"),
    [productData, sortDirectionByTab.byProduct]
  );
  const sortedCustomerData = useMemo(
    () => sortByNumeric(customerData, (r) => r.totalAmount, sortDirectionByTab.byCustomer || "desc"),
    [customerData, sortDirectionByTab.byCustomer]
  );
  const sortedCashData = useMemo(
    () => sortByNumeric(cashData, (r) => r.totalSales, sortDirectionByTab.cash || "desc"),
    [cashData, sortDirectionByTab.cash]
  );
  const sortedPriceData = useMemo(
    () => sortByNumeric(priceData, (r) => r.totalAmount, sortDirectionByTab.priceBreakdown || "desc"),
    [priceData, sortDirectionByTab.priceBreakdown]
  );
  const sortedBagUsageData = useMemo(
    () => sortByNumeric(bagUsageData, (r) => r.netMovement, sortDirectionByTab.bagUsage || "desc"),
    [bagUsageData, sortDirectionByTab.bagUsage]
  );

  // ==================== Computed totals ====================
  const dailyTotal = dailyData.reduce((s, r) => s + r.totalAmount, 0);
  const dailyTxTotal = dailyData.reduce((s, r) => s + r.totalTransactions, 0);

  const productTotalQty = productData.reduce((s, r) => s + r.totalQuantity, 0);
  const productReturnedQty = productData.reduce((s, r) => s + r.returnedQuantity, 0);
  const productNetQty = productData.reduce((s, r) => s + r.netQuantity, 0);
  const productTotalAmt = productData.reduce((s, r) => s + r.totalAmount, 0);
  const productReturnedAmt = productData.reduce((s, r) => s + r.returnedAmount, 0);
  const productNetAmt = productData.reduce((s, r) => s + r.netAmount, 0);

  const customerTotal = customerData.reduce((s, r) => s + r.totalAmount, 0);
  const customerTxTotal = customerData.reduce((s, r) => s + r.totalTransactions, 0);

  const cashTotalSales = cashData.reduce((s, r) => s + r.totalSales, 0);
  const cashTotalPaid = cashData.reduce((s, r) => s + r.totalPaid, 0);
  const cashTotalOutstanding = cashData.reduce((s, r) => s + r.outstandingDebt, 0);
  const cashTotalRefundBalance = cashData.reduce((s, r) => s + r.refundBalance, 0);

  const priceTotal = priceData.reduce((s, r) => s + r.totalAmount, 0);

  const bagUsagePreviousOutTotal = bagUsageData.reduce((sum, row) => sum + row.previousOut, 0);
  const bagUsageTotals = bagUsageSummary ?? {
    weeklyOutflowTotal: 0,
    weeklyWindowStart: "",
    weeklyWindowEnd: "",
    flaggedCustomerCount: 0,
    totalOut: bagUsageData.reduce((sum, row) => sum + row.totalOut, 0),
    totalReturn: bagUsageData.reduce((sum, row) => sum + row.totalReturn, 0),
    totalAdjust: bagUsageData.reduce((sum, row) => sum + row.totalAdjust, 0),
    netMovement: bagUsageData.reduce((sum, row) => sum + row.netMovement, 0),
  };

  const monthlyTotalAmt = monthlyData.reduce((s, r) => s + r.totalAmount, 0);
  const monthlyTotalPaid = monthlyData.reduce((s, r) => s + r.totalPaid, 0);
  const monthlyTotalOutstanding = monthlyData.reduce((s, r) => s + r.outstandingDebt, 0);
  const monthlyTotalRefundBalance = monthlyData.reduce((s, r) => s + r.refundBalance, 0);
  const monthlyTotalTx = monthlyData.reduce((s, r) => s + r.totalTransactions, 0);

  // ==================== Export helpers ====================
  const dateRangeSuffix = `${startDate}_${endDate}`;

  function getReportData(): { headers: string[]; rows: (string | number)[][]; sheetName: string; baseName: string } {
    if (activeTab === "daily") {
      return {
        headers: ["วันที่", "จำนวนบิล", "ยอดรวม"],
        rows: [
          ...sortedDailyData.map((r) => [r.date, r.totalTransactions, r.totalAmount]),
          ["รวมทั้งหมด", dailyTxTotal, dailyTotal],
        ],
        sheetName: "รายวัน",
        baseName: "daily-report",
      };
    } else if (activeTab === "byProduct") {
      return {
        headers: ["สินค้า", "ขาย", "คืน", "สุทธิ", "ยอดขาย", "ยอดคืน", "ยอดสุทธิ"],
        rows: [
          ...sortedProductData.map((r) => [r.productName, r.totalQuantity, r.returnedQuantity, r.netQuantity, r.totalAmount, r.returnedAmount, r.netAmount]),
          ["รวมทั้งหมด", productTotalQty, productReturnedQty, productNetQty, productTotalAmt, productReturnedAmt, productNetAmt],
        ],
        sheetName: "ตามสินค้า",
        baseName: "product-report",
      };
    } else if (activeTab === "byCustomer") {
      return {
        headers: ["ลูกค้า", "จำนวนบิล", "ยอดรวม"],
        rows: [
          ...sortedCustomerData.map((r) => [r.customerName, r.totalTransactions, r.totalAmount]),
          ["รวมทั้งหมด", customerTxTotal, customerTotal],
        ],
        sheetName: "ตามลูกค้า",
        baseName: "customer-report",
      };
    } else if (activeTab === "cash") {
      return {
        headers: ["วันที่", "ยอดขาย", "เงินสดรับ", "ค้างชำระ", "เครดิตฝั่งคืน", "ชำระแล้ว", "ค้าง", "บางส่วน"],
        rows: [
          ...sortedCashData.map((r) => [r.date, r.totalSales, r.totalPaid, r.outstandingDebt, r.refundBalance, r.paidCount, r.unpaidCount, r.partialCount]),
          ["รวมทั้งหมด", cashTotalSales, cashTotalPaid, cashTotalOutstanding, cashTotalRefundBalance, "", "", ""],
        ],
        sheetName: "เงินสด",
        baseName: "cash-report",
      };
    } else if (activeTab === "priceBreakdown") {
      return {
        headers: ["ลูกค้า", "สินค้า", "ราคา/หน่วย", "จำนวน", "ยอดรวม"],
        rows: [
          ...sortedPriceData.map((r) => [r.customerName, r.productName, r.unitPrice, r.totalQuantity, r.totalAmount]),
          ["รวมทั้งหมด", "", "", "", priceTotal],
        ],
        sheetName: "แยกตามราคา",
        baseName: "price-breakdown",
      };
    } else if (activeTab === "bagUsage") {
      return {
        headers: ["ลูกค้า", "โทรศัพท์", "ออก", "คืน", "ปรับ", "ออกช่วงก่อนหน้า", "ต่างออก", "ต่างออก(%)", "เปลี่ยนมาก", "ยอดสุทธิ"],
        rows: [
          ...sortedBagUsageData.map((r) => [
            r.customerName,
            r.phone || "",
            r.totalOut,
            r.totalReturn,
            r.totalAdjust,
            r.previousOut,
            r.outDelta,
            r.outDeltaPct == null ? "" : Math.round(r.outDeltaPct),
            r.hasBigChange ? "ใช่" : "",
            r.netMovement,
          ]),
          [
            "รวมทั้งหมด",
            "",
            bagUsageTotals.totalOut,
            bagUsageTotals.totalReturn,
            bagUsageTotals.totalAdjust,
            bagUsagePreviousOutTotal,
            "",
            "",
            bagUsageTotals.flaggedCustomerCount,
            bagUsageTotals.netMovement,
          ],
        ],
        sheetName: "การใช้ถุง",
        baseName: "bag-usage",
      };
    } else if (activeTab === "monthly") {
      return {
        headers: ["เดือน", "จำนวนบิล", "ยอดขาย", "เงินสดรับ", "ค้างชำระ", "เครดิตฝั่งคืน"],
        rows: [
          ...sortedMonthlyData.map((r) => [`${r.year}-${String(r.month).padStart(2, "0")}`, r.totalTransactions, r.totalAmount, r.totalPaid, r.outstandingDebt, r.refundBalance]),
          ["รวมทั้งหมด", monthlyTotalTx, monthlyTotalAmt, monthlyTotalPaid, monthlyTotalOutstanding, monthlyTotalRefundBalance],
        ],
        sheetName: "รายเดือน",
        baseName: "monthly-report",
      };
    } else {
      // history
      return {
        headers: ["วันที่", "ยอดขาย", "เงินสดรับ", "จำนวนบิล", "ค่าเฉลี่ย7วัน"],
        rows: historyDailyData.map((r) => [r.date, r.totalAmount, r.totalPaid, r.txCount, Math.round(r.ma7 || 0)]),
        sheetName: "ประวัติ",
        baseName: "history-daily",
      };
    }
  }

  function exportCSV() {
    const { headers, rows, baseName } = getReportData();
    const exportTime = new Date().toLocaleString("th-TH");
    let csv = `# ส่งออกเมื่อ: ${exportTime}\n# ช่วงเวลา: ${startDate} ถึง ${endDate}\n`;
    csv += headers.join(",") + "\n";
    csv += rows.map((r) => r.map((c) => typeof c === "string" && c.includes(",") ? `"${c}"` : c).join(",")).join("\n");

    const filename = `${baseName}-${dateRangeSuffix}.csv`;
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    // Track report exported event
    captureClientEvent("report_exported", {
      report_type: activeTab,
      export_format: "csv",
      date_range_start: startDate,
      date_range_end: endDate,
      rows_count: rows.length,
    });
  }

  function exportExcel() {
    const { headers, rows, sheetName, baseName } = getReportData();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    // Auto column width
    const colWidths = headers.map((h, i) => {
      const maxLen = Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length));
      return { wch: Math.min(maxLen + 4, 30) };
    });
    ws["!cols"] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    const filename = `${baseName}-${dateRangeSuffix}.xlsx`;
    XLSX.writeFile(wb, filename);

    // Track report exported event
    captureClientEvent("report_exported", {
      report_type: activeTab,
      export_format: "excel",
      date_range_start: startDate,
      date_range_end: endDate,
      rows_count: rows.length,
    });
  }

  function handlePrint() {
    window.print();
  }

  const PIE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

  // Top 10 customers for chart (respects current by-customer sort direction)
  const topCustomers = sortedCustomerData.slice(0, 10);

  return (
    <div className="max-w-7xl mx-auto">
      {/* Print header (hidden on screen, shown on print) */}
      <div className="hidden print:block mb-4">
        <h1 className="text-xl font-bold text-center">Super Ice (SI) - ระบบขายน้ำแข็ง</h1>
        <p className="text-center text-sm text-gray-600">
          รายงาน: {formatThaiDate(startDate)} - {formatThaiDate(endDate)}
          {startTime && ` (${startTime}`}{endTime && ` - ${endTime})`}
        </p>
      </div>

      <div className="flex items-center justify-between mb-4 md:mb-6 print:hidden flex-wrap gap-2">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">รายงาน</h1>
          <p className="text-xs md:text-sm text-gray-500">สรุปยอดขายตามช่วงเวลาที่เลือก</p>
        </div>
      </div>

      {/* Date filter */}
      <Card className="mb-6 print:hidden">
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
          {/* Date inputs + actions */}
          <div className="grid grid-cols-2 md:flex md:items-end gap-2 md:gap-4 md:flex-wrap">
            <div className="space-y-1">
              <Label className="text-xs md:text-sm">วันที่เริ่มต้น</Label>
              <Input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setActiveQuick(""); }} className="w-full md:w-44 h-9" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs md:text-sm">วันที่สิ้นสุด</Label>
              <Input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setActiveQuick(""); }} className="w-full md:w-44 h-9" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs md:text-sm">เวลาเริ่ม</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full md:w-32 h-9" placeholder="เช่น 06:00" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs md:text-sm">เวลาสิ้นสุด</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-full md:w-32 h-9" placeholder="เช่น 18:00" />
            </div>
            <div className="space-y-1 col-span-2 md:col-span-1">
              <Label className="text-xs md:text-sm">ลูกค้า</Label>
              <Input
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                className="w-full md:w-52 h-9"
                placeholder="Customer name, #id, or #101, #102"
              />
            </div>
            <div className="col-span-2 flex gap-2 flex-wrap">
              <Button onClick={handleSearch} disabled={loading} className="flex-1 md:flex-none h-9">{loading ? "กำลังโหลด..." : "ค้นหา"}</Button>
              <Button variant="outline" onClick={exportCSV} className="h-9 text-xs md:text-sm">CSV</Button>
              <Button variant="outline" onClick={exportExcel} className="h-9 text-xs md:text-sm">Excel</Button>
              <Button variant="outline" onClick={handlePrint} className="h-9 text-xs md:text-sm">พิมพ์</Button>
              {(startTime || endTime) && (
                <button
                  onClick={() => { setStartTime(""); setEndTime(""); }}
                  className="text-xs text-gray-400 hover:text-gray-600 underline"
                >
                  ล้างเวลา
                </button>
              )}
            </div>
            {activeSortLabel && (
              <div className="w-full flex items-center gap-2 flex-wrap pt-1">
                <span className="text-xs text-gray-500">เรียงตาม{activeSortLabel}</span>
                <Button
                  type="button"
                  size="sm"
                  variant={activeSortDirection === "desc" ? "default" : "outline"}
                  className="h-8 text-xs"
                  onClick={() => setSortDirectionByTab((prev) => ({ ...prev, [activeTab]: "desc" }))}
                >
                  มากไปน้อย
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={activeSortDirection === "asc" ? "default" : "outline"}
                  className="h-8 text-xs"
                  onClick={() => setSortDirectionByTab((prev) => ({ ...prev, [activeTab]: "asc" }))}
                >
                  น้อยไปมาก
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="print:hidden flex-wrap h-auto gap-1 overflow-x-auto">
          <TabsTrigger value="daily" className="text-xs md:text-sm">รายวัน</TabsTrigger>
          <TabsTrigger value="monthly" className="text-xs md:text-sm">รายเดือน</TabsTrigger>
          <TabsTrigger value="byProduct" className="text-xs md:text-sm">ตามสินค้า</TabsTrigger>
          <TabsTrigger value="byCustomer" className="text-xs md:text-sm">ตามลูกค้า</TabsTrigger>
          <TabsTrigger value="cash" className="text-xs md:text-sm">เงินสด</TabsTrigger>
          <TabsTrigger value="priceBreakdown" className="text-xs md:text-sm">แยกตามราคา</TabsTrigger>
          <TabsTrigger value="bagUsage" className="text-xs md:text-sm">การใช้ถุง</TabsTrigger>
          <TabsTrigger value="history" className="text-xs md:text-sm">ประวัติ</TabsTrigger>
        </TabsList>

        {/* ==================== Daily ==================== */}
        <TabsContent value="daily" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base">สรุปยอดขายรายวัน</CardTitle>
                {dailyData.length > 0 && (
                  <div className="text-sm text-gray-500">
                    รวม {formatNumber(dailyTxTotal)} บิล = <span className="font-bold text-blue-700">{formatCurrency(dailyTotal)} บาท</span>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {dailyData.length === 0 ? (
                <p className="text-center py-8 text-gray-500">กดค้นหาเพื่อดูรายงาน</p>
              ) : (
                <>
                <div className="mb-6 print:hidden w-full h-[180px] md:h-[250px]">
                  <ResponsiveContainer>
                    <BarChart data={[...dailyData].reverse()}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => formatThaiDate(v).replace(/\s*\d{4}$/, "")} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v) => formatCurrency(Number(v)) + " บาท"} labelFormatter={(v) => formatThaiDate(String(v))} />
                      <Bar dataKey="totalAmount" fill="#3b82f6" name="ยอดขาย" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <button
                          type="button"
                          className="font-medium hover:text-blue-700 transition-colors"
                          onClick={() => handleDailySort("date")}
                        >
                          วันที่ {dailySortKey === "date" ? (dailySortDirection === "asc" ? "↑" : "↓") : ""}
                        </button>
                      </TableHead>
                      <TableHead className="text-right">
                        <button
                          type="button"
                          className="w-full text-right font-medium hover:text-blue-700 transition-colors"
                          onClick={() => handleDailySort("totalTransactions")}
                        >
                          จำนวนบิล {dailySortKey === "totalTransactions" ? (dailySortDirection === "asc" ? "↑" : "↓") : ""}
                        </button>
                      </TableHead>
                      <TableHead className="text-right">
                        <button
                          type="button"
                          className="w-full text-right font-medium hover:text-blue-700 transition-colors"
                          onClick={() => handleDailySort("totalAmount")}
                        >
                          ยอดรวม {dailySortKey === "totalAmount" ? (dailySortDirection === "asc" ? "↑" : "↓") : ""}
                        </button>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedDailyData.map((r) => (
                      <TableRow key={r.date}>
                        <TableCell>{formatThaiDate(r.date)}</TableCell>
                        <TableCell className="text-right">{formatNumber(r.totalTransactions)}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(r.totalAmount)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-bold bg-gray-50">
                      <TableCell>รวมทั้งหมด</TableCell>
                      <TableCell className="text-right">{formatNumber(dailyTxTotal)}</TableCell>
                      <TableCell className="text-right text-blue-700">{formatCurrency(dailyTotal)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== Monthly ==================== */}
        <TabsContent value="monthly" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base">สรุปยอดขายรายเดือน</CardTitle>
                {monthlyData.length > 0 && (
                  <div className="flex gap-4 text-sm flex-wrap">
                    <span>รวม {formatNumber(monthlyTotalTx)} บิล</span>
                    <span>ยอดขาย: <strong className="text-blue-700">{formatCurrency(monthlyTotalAmt)}</strong></span>
                    <span>รับ: <strong className="text-green-700">{formatCurrency(monthlyTotalPaid)}</strong></span>
                    <span>ค้าง: <strong className="text-red-600">{formatCurrency(monthlyTotalOutstanding)}</strong></span>
                    <span>คืน: <strong className="text-indigo-700">{formatCurrency(monthlyTotalRefundBalance)}</strong></span>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {monthlyData.length === 0 ? (
                <p className="text-center py-8 text-gray-500">กดค้นหาเพื่อดูรายงาน</p>
              ) : (
                <>
                <div className="mb-6 print:hidden w-full h-[200px] md:h-[300px]">
                  <ResponsiveContainer>
                    <BarChart data={sortedMonthlyData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="month"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(_, idx) => {
                          const r = sortedMonthlyData[idx];
                          return r ? formatShortMonth(`${r.year}-${String(r.month).padStart(2, "0")}`) : "";
                        }}
                      />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                      <Tooltip
                        formatter={(v, name) => [
                          formatCurrency(Number(v)) + " บาท",
                          name === "totalAmount"
                            ? "ยอดขาย"
                            : name === "totalPaid"
                              ? "เงินสดรับ"
                              : name === "totalOutstanding"
                                ? "ค้างชำระ"
                                : "เครดิตฝั่งคืน",
                        ]}
                        labelFormatter={(_, payload) => {
                          if (payload && payload[0]) {
                            const r = payload[0].payload as MonthlyRow;
                            return formatThaiMonth(`${r.year}-${String(r.month).padStart(2, "0")}`);
                          }
                          return "";
                        }}
                      />
                      <Legend
                        formatter={(value) =>
                          value === "totalAmount"
                            ? "ยอดขาย"
                            : value === "totalPaid"
                              ? "เงินสดรับ"
                              : value === "totalOutstanding"
                                ? "ค้างชำระ"
                                : "เครดิตฝั่งคืน"
                        }
                      />
                      <Bar dataKey="totalAmount" fill="#3b82f6" name="totalAmount" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="totalPaid" fill="#10b981" name="totalPaid" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="totalOutstanding" fill="#ef4444" name="totalOutstanding" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="refundBalance" fill="#6366f1" name="refundBalance" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Print-only monthly report header */}
                <div className="hidden print:block mb-4 border-b pb-2">
                  <h2 className="text-lg font-bold text-center">รายงานสรุปยอดขายรายเดือน</h2>
                  <p className="text-center text-sm">
                    ช่วงเวลา: {formatThaiDate(startDate)} - {formatThaiDate(endDate)}
                  </p>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>เดือน</TableHead>
                      <TableHead className="text-right">จำนวนบิล</TableHead>
                      <TableHead className="text-right">ยอดขาย</TableHead>
                      <TableHead className="text-right">เงินสดรับ</TableHead>
                      <TableHead className="text-right">ค้างชำระ</TableHead>
                      <TableHead className="text-right">เครดิตฝั่งคืน</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedMonthlyData.map((r) => (
                      <TableRow key={`${r.year}-${r.month}`}>
                        <TableCell className="font-medium">{formatThaiMonth(`${r.year}-${String(r.month).padStart(2, "0")}`)}</TableCell>
                        <TableCell className="text-right">{formatNumber(r.totalTransactions)}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(r.totalAmount)}</TableCell>
                        <TableCell className="text-right font-medium text-green-700">{formatCurrency(r.totalPaid)}</TableCell>
                        <TableCell className="text-right font-medium text-red-600">
                          {r.outstandingDebt > 0 ? formatCurrency(r.outstandingDebt) : "-"}
                        </TableCell>
                        <TableCell className="text-right font-medium text-indigo-700">
                          {r.refundBalance > 0 ? formatCurrency(r.refundBalance) : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-bold bg-gray-50">
                      <TableCell>รวมทั้งหมด</TableCell>
                      <TableCell className="text-right">{formatNumber(monthlyTotalTx)}</TableCell>
                      <TableCell className="text-right text-blue-700">{formatCurrency(monthlyTotalAmt)}</TableCell>
                      <TableCell className="text-right text-green-700">{formatCurrency(monthlyTotalPaid)}</TableCell>
                      <TableCell className="text-right text-red-600">{formatCurrency(monthlyTotalOutstanding)}</TableCell>
                      <TableCell className="text-right text-indigo-700">{formatCurrency(monthlyTotalRefundBalance)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== By Product ==================== */}
        <TabsContent value="byProduct" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base">ยอดขายตามสินค้า</CardTitle>
                {productData.length > 0 && (
                  <div className="text-sm font-bold text-blue-700">รวมสุทธิ {formatCurrency(productNetAmt)} บาท</div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {productData.length === 0 ? (
                <p className="text-center py-8 text-gray-500">กดค้นหาเพื่อดูรายงาน</p>
              ) : (
                <>
                <div className="mb-6 print:hidden w-full h-[200px] md:h-[280px]">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={sortedProductData.filter((p) => p.netAmount > 0)}
                        dataKey="netAmount"
                        nameKey="productName"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                        labelLine={true}
                      >
                        {sortedProductData.filter((p) => p.netAmount > 0).map((_, idx) => (
                          <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => formatCurrency(Number(v)) + " บาท"} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>สินค้า</TableHead>
                        <TableHead className="text-right">ขาย</TableHead>
                        <TableHead className="text-right">คืน</TableHead>
                        <TableHead className="text-right">สุทธิ</TableHead>
                        <TableHead className="text-right">ยอดขาย</TableHead>
                        <TableHead className="text-right">ยอดคืน</TableHead>
                        <TableHead className="text-right">ยอดสุทธิ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedProductData.map((r) => (
                        <TableRow key={r.productId}>
                          <TableCell className="font-medium">{r.productName}</TableCell>
                          <TableCell className="text-right">{formatNumber(r.totalQuantity)}</TableCell>
                          <TableCell className="text-right text-red-600">{r.returnedQuantity > 0 ? formatNumber(r.returnedQuantity) : "-"}</TableCell>
                          <TableCell className="text-right font-medium">{formatNumber(r.netQuantity)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(r.totalAmount)}</TableCell>
                          <TableCell className="text-right text-red-600">{r.returnedAmount > 0 ? formatCurrency(r.returnedAmount) : "-"}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(r.netAmount)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-bold bg-gray-50">
                        <TableCell>รวมทั้งหมด</TableCell>
                        <TableCell className="text-right">{formatNumber(productTotalQty)}</TableCell>
                        <TableCell className="text-right text-red-600">{formatNumber(productReturnedQty)}</TableCell>
                        <TableCell className="text-right">{formatNumber(productNetQty)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(productTotalAmt)}</TableCell>
                        <TableCell className="text-right text-red-600">{formatCurrency(productReturnedAmt)}</TableCell>
                        <TableCell className="text-right text-blue-700">{formatCurrency(productNetAmt)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== By Customer ==================== */}
        <TabsContent value="byCustomer" className="mt-4">
          {drillCustomerId ? (() => {
            // ---- Drill-down view ----
            const activeDrill = drillTxList.filter((t) => t.status !== "voided");
            const drillTotalAmt = activeDrill.reduce((s, t) => s + t.totalAmount, 0);
            const drillTotalTx = activeDrill.length;
            const drillTotalUnits = activeDrill.reduce((s, t) => s + t.items.reduce((ss, i) => ss + i.quantity, 0), 0);
            const drillAvg = drillTotalTx > 0 ? drillTotalAmt / drillTotalTx : 0;

            // Daily aggregation for chart
            const dailyMap: Record<string, { date: string; amount: number; units: number }> = {};
            for (const tx of activeDrill) {
              if (!dailyMap[tx.saleDate]) dailyMap[tx.saleDate] = { date: tx.saleDate, amount: 0, units: 0 };
              dailyMap[tx.saleDate].amount += tx.totalAmount;
              dailyMap[tx.saleDate].units += tx.items.reduce((s, i) => s + i.quantity, 0);
            }
            const dailySorted = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

            // 5-day moving average
            const chartData = dailySorted.map((d, i) => {
              const window = dailySorted.slice(Math.max(0, i - 4), i + 1);
              const ma5Amt = window.reduce((s, w) => s + w.amount, 0) / window.length;
              const ma5Units = window.reduce((s, w) => s + w.units, 0) / window.length;
              return { ...d, ma5Amt: Math.round(ma5Amt), ma5Units: Math.round(ma5Units * 10) / 10, label: d.date.slice(8) };
            });

            const monthLabel = formatThaiMonth(`${drillMonth.getFullYear()}-${String(drillMonth.getMonth() + 1).padStart(2, "0")}`);

            const statusLabel: Record<string, string> = { paid: "ชำระ", unpaid: "ค้าง", partial: "บางส่วน", voided: "ยกเลิก" };

            return (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setDrillCustomerId(null)}
                      className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                      กลับ
                    </button>
                    <CardTitle className="text-base">{drillCustomerName}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Summary cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-white rounded-lg border p-3">
                      <p className="text-xs text-gray-500">จำนวนบิล</p>
                      <p className="text-lg font-bold">{formatNumber(drillTotalTx)}</p>
                    </div>
                    <div className="bg-white rounded-lg border p-3">
                      <p className="text-xs text-gray-500">ยอดรวม</p>
                      <p className="text-lg font-bold text-blue-700">{formatCurrency(drillTotalAmt)}</p>
                    </div>
                    <div className="bg-white rounded-lg border p-3">
                      <p className="text-xs text-gray-500">จำนวนรวม</p>
                      <p className="text-lg font-bold">{formatNumber(drillTotalUnits)} <span className="text-sm font-normal text-gray-400">หน่วย</span></p>
                    </div>
                    <div className="bg-white rounded-lg border p-3">
                      <p className="text-xs text-gray-500">เฉลี่ย/บิล</p>
                      <p className="text-lg font-bold">{formatCurrency(drillAvg)}</p>
                    </div>
                  </div>

                  {/* 5-day MA trendline chart */}
                  {chartData.length > 1 && (
                    <div className="print:hidden w-full h-[180px] md:h-[220px]">
                      <ResponsiveContainer>
                        <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                          <YAxis yAxisId="left" tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
                          <Tooltip
                            formatter={(v, name) => {
                              const val = Number(v) || 0;
                              if (name === "MA5 หน่วย") return `${val} หน่วย`;
                              return formatCurrency(val) + " บาท";
                            }}
                            labelFormatter={(l) => `วันที่ ${l}`}
                          />
                          <Bar yAxisId="left" dataKey="amount" fill="#c4b5fd" name="ยอดขาย" radius={[2, 2, 0, 0]} />
                          <Line yAxisId="left" type="monotone" dataKey="ma5Amt" stroke="#ef4444" strokeWidth={2} dot={false} name="MA5 ยอด" />
                          <Line yAxisId="right" type="monotone" dataKey="ma5Units" stroke="#3b82f6" strokeWidth={2} dot={false} name="MA5 หน่วย" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* Month navigator */}
                  <div className="flex items-center justify-center gap-4 py-2">
                    <button
                      onClick={() => navigateDrillMonth(-1)}
                      className="p-1.5 rounded-lg border hover:bg-gray-100 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>
                    <span className="text-sm font-bold text-gray-800 min-w-[180px] text-center">{monthLabel}</span>
                    <button
                      onClick={() => navigateDrillMonth(1)}
                      className="p-1.5 rounded-lg border hover:bg-gray-100 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                  </div>

                  {/* Transaction table */}
                  {drillLoading ? (
                    <p className="text-center py-6 text-gray-500 text-sm">กำลังโหลด...</p>
                  ) : drillTxList.length === 0 ? (
                    <p className="text-center py-6 text-gray-400 text-sm">ไม่มีรายการในเดือนนี้</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>วันที่</TableHead>
                          <TableHead>เวลา</TableHead>
                          <TableHead>รายการ</TableHead>
                          <TableHead className="text-right">ยอด</TableHead>
                          <TableHead>สถานะ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {drillTxList.map((tx) => {
                          const isVoided = tx.status === "voided";
                          const itemSummary = tx.items.map((i) => `${i.productType.name} x${i.quantity}`).join(", ");
                          return (
                            <TableRow key={tx.id} className={isVoided ? "opacity-50" : ""}>
                              <TableCell className="text-sm whitespace-nowrap">{formatThaiDate(tx.saleDate)}</TableCell>
                              <TableCell className="text-sm">{tx.saleTime?.slice(0, 5)}</TableCell>
                              <TableCell className="text-sm text-gray-600 max-w-[200px] truncate" title={itemSummary}>{itemSummary || "-"}</TableCell>
                              <TableCell className="text-right text-sm font-medium">
                                {isVoided ? <span className="line-through text-gray-400">{formatCurrency(tx.totalAmount)}</span> : formatCurrency(tx.totalAmount)}
                              </TableCell>
                              <TableCell>
                                <Badge variant={tx.status === "paid" ? "secondary" : tx.status === "voided" ? "outline" : "destructive"} className="text-[10px]">
                                  {statusLabel[tx.status] || tx.status}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            );
          })() : (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base">ยอดขายตามลูกค้า</CardTitle>
                {customerData.length > 0 && (
                  <div className="text-sm text-gray-500">
                    {formatNumber(customerData.length)} ราย | รวม <span className="font-bold text-blue-700">{formatCurrency(customerTotal)} บาท</span>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {customerData.length === 0 ? (
                <p className="text-center py-8 text-gray-500">กดค้นหาเพื่อดูรายงาน</p>
              ) : (
                <>
                {/* Top customers chart */}
                {topCustomers.length > 0 && (
                  <div className="mb-6 print:hidden w-full" style={{ height: Math.max(180, topCustomers.length * 30) }}>
                    <ResponsiveContainer>
                      <BarChart data={topCustomers} layout="vertical" margin={{ left: 80 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                        <YAxis type="category" dataKey="customerName" tick={{ fontSize: 11 }} width={80} />
                        <Tooltip formatter={(v) => formatCurrency(Number(v)) + " บาท"} />
                        <Bar dataKey="totalAmount" fill="#8b5cf6" name="ยอดขาย" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ลูกค้า</TableHead>
                      <TableHead className="text-right">จำนวนบิล</TableHead>
                      <TableHead className="text-right">ยอดรวม</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedCustomerData.map((r) => (
                      <TableRow
                        key={r.customerId}
                        className="cursor-pointer hover:bg-blue-50 transition-colors"
                        onClick={() => openDrill(r.customerId, r.customerName)}
                      >
                        <TableCell className="font-medium text-blue-700 hover:underline">{r.customerName}</TableCell>
                        <TableCell className="text-right">{formatNumber(r.totalTransactions)}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(r.totalAmount)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-bold bg-gray-50">
                      <TableCell>รวมทั้งหมด</TableCell>
                      <TableCell className="text-right">{formatNumber(customerTxTotal)}</TableCell>
                      <TableCell className="text-right text-blue-700">{formatCurrency(customerTotal)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                </>
              )}
            </CardContent>
          </Card>
          )}
        </TabsContent>

        {/* ==================== Cash Reconciliation ==================== */}
        <TabsContent value="cash" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base">สรุปเงินสดที่ได้รับ</CardTitle>
                {cashData.length > 0 && (
                  <div className="flex gap-4 text-sm flex-wrap">
                    <span>ยอดขาย: <strong className="text-blue-700">{formatCurrency(cashTotalSales)}</strong></span>
                    <span>เงินสดรับ: <strong className="text-green-700">{formatCurrency(cashTotalPaid)}</strong></span>
                    <span>ค้างชำระ: <strong className="text-red-600">{formatCurrency(cashTotalOutstanding)}</strong></span>
                    <span>เครดิตฝั่งคืน: <strong className="text-indigo-700">{formatCurrency(cashTotalRefundBalance)}</strong></span>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {cashData.length === 0 ? (
                <p className="text-center py-8 text-gray-500">กดค้นหาเพื่อดูรายงาน</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>วันที่</TableHead>
                        <TableHead className="text-right">ยอดขาย</TableHead>
                        <TableHead className="text-right">เงินสดรับ</TableHead>
                        <TableHead className="text-right">ค้างชำระ</TableHead>
                        <TableHead className="text-right">เครดิตฝั่งคืน</TableHead>
                        <TableHead className="text-center">ชำระแล้ว</TableHead>
                        <TableHead className="text-center">ค้าง</TableHead>
                        <TableHead className="text-center">บางส่วน</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedCashData.map((r) => (
                        <TableRow key={r.date}>
                          <TableCell>{formatThaiDate(r.date)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(r.totalSales)}</TableCell>
                          <TableCell className="text-right font-medium text-green-700">{formatCurrency(r.totalPaid)}</TableCell>
                          <TableCell className="text-right font-medium text-red-600">
                            {r.outstandingDebt > 0 ? formatCurrency(r.outstandingDebt) : "-"}
                          </TableCell>
                          <TableCell className="text-right font-medium text-indigo-700">
                            {r.refundBalance > 0 ? formatCurrency(r.refundBalance) : "-"}
                          </TableCell>
                          <TableCell className="text-center">{r.paidCount}</TableCell>
                          <TableCell className="text-center">
                            {r.unpaidCount > 0 ? <Badge variant="destructive">{r.unpaidCount}</Badge> : "-"}
                          </TableCell>
                          <TableCell className="text-center">
                            {r.partialCount > 0 ? <Badge variant="secondary">{r.partialCount}</Badge> : "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-bold bg-gray-50">
                        <TableCell>รวมทั้งหมด</TableCell>
                        <TableCell className="text-right text-blue-700">{formatCurrency(cashTotalSales)}</TableCell>
                        <TableCell className="text-right text-green-700">{formatCurrency(cashTotalPaid)}</TableCell>
                        <TableCell className="text-right text-red-600">{formatCurrency(cashTotalOutstanding)}</TableCell>
                        <TableCell className="text-right text-indigo-700">{formatCurrency(cashTotalRefundBalance)}</TableCell>
                        <TableCell colSpan={3}></TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== Price Breakdown ==================== */}
        <TabsContent value="priceBreakdown" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base">สรุปการขายแยกตามราคา</CardTitle>
                {priceData.length > 0 && (
                  <div className="text-sm font-bold text-blue-700">รวม {formatCurrency(priceTotal)} บาท</div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {priceData.length === 0 ? (
                <p className="text-center py-8 text-gray-500">กดค้นหาเพื่อดูรายงาน</p>
              ) : (
                <div className="max-h-[600px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ลูกค้า</TableHead>
                        <TableHead>สินค้า</TableHead>
                        <TableHead className="text-right">ราคา/หน่วย</TableHead>
                        <TableHead className="text-right">จำนวน</TableHead>
                        <TableHead className="text-right">ยอดรวม</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedPriceData.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{r.customerName}</TableCell>
                          <TableCell>{r.productName}</TableCell>
                          <TableCell className="text-right">{formatCurrency(r.unitPrice)}</TableCell>
                          <TableCell className="text-right">{formatNumber(r.totalQuantity)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(r.totalAmount)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-bold bg-gray-50">
                        <TableCell colSpan={4}>รวมทั้งหมด</TableCell>
                        <TableCell className="text-right text-blue-700">{formatCurrency(priceTotal)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== Bag Usage ==================== */}
        <TabsContent value="bagUsage" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base">รายงานการใช้ถุง</CardTitle>
                {bagUsageSummary && (
                  <div className="flex items-center gap-2 flex-wrap text-sm text-gray-500">
                    <span>
                      {bagUsageData.length} รายการ | ยอดสุทธิ:{" "}
                      <span className="font-bold text-orange-600">
                        {formatNumber(bagUsageTotals.netMovement)} ใบ
                      </span>
                    </span>
                    <Badge variant="secondary" className="font-normal">
                      7 วันล่าสุดออก {formatNumber(bagUsageTotals.weeklyOutflowTotal)} ใบ
                    </Badge>
                    {bagUsageTotals.weeklyWindowStart && bagUsageTotals.weeklyWindowEnd && (
                      <span className="text-xs text-gray-400">
                        {formatThaiDate(bagUsageTotals.weeklyWindowStart)} - {formatThaiDate(bagUsageTotals.weeklyWindowEnd)}
                      </span>
                    )}
                    <Badge
                      variant={bagUsageTotals.flaggedCustomerCount > 0 ? "destructive" : "outline"}
                      className="font-normal"
                    >
                      เปลี่ยนมาก {formatNumber(bagUsageTotals.flaggedCustomerCount)} ราย
                    </Badge>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {bagUsageData.length === 0 ? (
                <p className="text-center py-8 text-gray-500">
                  {bagUsageSummary ? "ไม่พบข้อมูลถุงในช่วงที่เลือก" : "กดค้นหาเพื่อดูรายงาน"}
                </p>
              ) : (
                <div className="max-h-[600px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ลูกค้า</TableHead>
                        <TableHead>โทรศัพท์</TableHead>
                        <TableHead className="text-right">ออก</TableHead>
                        <TableHead className="text-right">คืน</TableHead>
                        <TableHead className="text-right">ปรับ</TableHead>
                        <TableHead className="text-right">ออกก่อนหน้า</TableHead>
                        <TableHead className="text-right">เปลี่ยนแปลง</TableHead>
                        <TableHead className="text-right">ยอดสุทธิ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedBagUsageData.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span>{r.customerName}</span>
                              {r.hasBigChange && (
                                <Badge
                                  variant="outline"
                                  className="border-amber-200 bg-amber-50 text-amber-700"
                                >
                                  เปลี่ยนมาก
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-gray-500">{r.phone || "-"}</TableCell>
                          <TableCell className="text-right text-red-600">{r.totalOut > 0 ? `+${formatNumber(r.totalOut)}` : "-"}</TableCell>
                          <TableCell className="text-right text-green-600">{r.totalReturn > 0 ? `-${formatNumber(r.totalReturn)}` : "-"}</TableCell>
                          <TableCell className="text-right text-gray-600">{r.totalAdjust !== 0 ? formatSignedBagNumber(r.totalAdjust) : "-"}</TableCell>
                          <TableCell className="text-right text-gray-600">{r.previousOut > 0 ? formatNumber(r.previousOut) : "-"}</TableCell>
                          <TableCell className={`text-right ${getBagChangeClassName(r)}`}>{getBagChangeText(r)}</TableCell>
                          <TableCell className="text-right font-medium">
                            <span className={r.netMovement > 0 ? "text-orange-600" : r.netMovement < 0 ? "text-green-600" : ""}>
                              {formatNumber(r.netMovement)}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-bold bg-gray-50">
                        <TableCell colSpan={2}>รวมทั้งหมด</TableCell>
                        <TableCell className="text-right text-red-600">{formatNumber(bagUsageTotals.totalOut)}</TableCell>
                        <TableCell className="text-right text-green-600">{formatNumber(bagUsageTotals.totalReturn)}</TableCell>
                        <TableCell className="text-right">{bagUsageTotals.totalAdjust !== 0 ? formatSignedBagNumber(bagUsageTotals.totalAdjust) : "-"}</TableCell>
                        <TableCell className="text-right text-gray-600">{bagUsagePreviousOutTotal > 0 ? formatNumber(bagUsagePreviousOutTotal) : "-"}</TableCell>
                        <TableCell className="text-right text-amber-700">
                          {bagUsageTotals.flaggedCustomerCount > 0 ? `${formatNumber(bagUsageTotals.flaggedCustomerCount)} ราย` : "-"}
                        </TableCell>
                        <TableCell className="text-right text-orange-600">{formatNumber(bagUsageTotals.netMovement)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== History / Long-Term Analytics ==================== */}
        <TabsContent value="history" className="mt-4 space-y-6">
          {(historyLoading || loading) && (
            <div className="text-center py-12 text-gray-500">กำลังโหลดข้อมูลประวัติ...</div>
          )}

          {!historyLoading && !loading && historyDailyData.length === 0 && (
            <Card>
              <CardContent className="py-12">
                <p className="text-center text-gray-500">กดค้นหาเพื่อดูข้อมูลประวัติระยะยาว (แนะนำเลือกช่วงเวลา 6-24 เดือน)</p>
              </CardContent>
            </Card>
          )}

          {/* Section 1: Revenue Trendline with 7-Day Moving Average */}
          {historyDailyData.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-base">แนวโน้มรายได้รายวัน (เส้นค่าเฉลี่ย 7 วัน)</CardTitle>
                  <div className="text-sm text-gray-500">
                    {formatNumber(historyDailyData.length)} วัน |
                    เฉลี่ย <span className="font-bold text-blue-700">
                      {formatCurrency(historyDailyData.reduce((s, r) => s + r.totalAmount, 0) / historyDailyData.length)}
                    </span> บาท/วัน
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="print:hidden w-full h-[220px] md:h-[350px]">
                  <ResponsiveContainer>
                    <LineChart data={historyDailyData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v) => {
                          const d = new Date(v);
                          return d.getDate() === 1 ? formatShortMonth(v) : "";
                        }}
                        interval={0}
                        minTickGap={40}
                      />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                      <Tooltip
                        formatter={(v, name) => [
                          formatCurrency(Number(v)) + " บาท",
                          name === "totalAmount" ? "ยอดขาย" : "ค่าเฉลี่ย 7 วัน",
                        ]}
                        labelFormatter={(v) => formatThaiDate(String(v))}
                      />
                      <Legend formatter={(v) => v === "totalAmount" ? "ยอดขายรายวัน" : "ค่าเฉลี่ย 7 วัน"} />
                      <Line
                        type="monotone"
                        dataKey="totalAmount"
                        stroke="#93c5fd"
                        strokeWidth={1}
                        dot={false}
                        name="totalAmount"
                      />
                      <Line
                        type="monotone"
                        dataKey="ma7"
                        stroke="#2563eb"
                        strokeWidth={2.5}
                        dot={false}
                        name="ma7"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Section 2: Customer Behavior Over Time */}
          {customerBehaviorData.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-base">พฤติกรรมลูกค้ารายเดือน</CardTitle>
                  <div className="text-sm text-gray-500">
                    ลูกค้าเฉลี่ย/เดือน:{" "}
                    <span className="font-bold text-purple-700">
                      {formatNumber(Math.round(customerBehaviorData.reduce((s, r) => s + r.activeCustomers, 0) / customerBehaviorData.length))} ราย
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="print:hidden w-full h-[220px] md:h-[350px]">
                  <ResponsiveContainer>
                    <ComposedChart data={customerBehaviorData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="month"
                        tick={{ fontSize: 10 }}
                        tickFormatter={(_, idx) => {
                          const r = customerBehaviorData[idx];
                          return r ? formatShortMonth(`${r.year}-${String(r.month).padStart(2, "0")}`) : "";
                        }}
                      />
                      <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                      <Tooltip
                        formatter={(v, name) => {
                          const val = Number(v);
                          if (name === "activeCustomers") return [formatNumber(val) + " ราย", "ลูกค้าที่ซื้อ"];
                          if (name === "newCustomers") return [formatNumber(val) + " ราย", "ลูกค้าใหม่"];
                          if (name === "avgPerCustomer") return [formatCurrency(val) + " บาท", "เฉลี่ย/ราย"];
                          return [val, name];
                        }}
                        labelFormatter={(_, payload) => {
                          if (payload && payload[0]) {
                            const r = payload[0].payload as CustomerBehaviorRow;
                            return formatThaiMonth(`${r.year}-${String(r.month).padStart(2, "0")}`);
                          }
                          return "";
                        }}
                      />
                      <Legend
                        formatter={(v) =>
                          v === "activeCustomers" ? "ลูกค้าที่ซื้อ" : v === "newCustomers" ? "ลูกค้าใหม่" : "ยอดเฉลี่ย/ราย"
                        }
                      />
                      <Bar yAxisId="left" dataKey="activeCustomers" fill="#8b5cf6" name="activeCustomers" radius={[4, 4, 0, 0]} />
                      <Bar yAxisId="left" dataKey="newCustomers" fill="#f59e0b" name="newCustomers" radius={[4, 4, 0, 0]} />
                      <Line yAxisId="right" type="monotone" dataKey="avgPerCustomer" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} name="avgPerCustomer" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* Data table below chart */}
                <div className="mt-4 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>เดือน</TableHead>
                        <TableHead className="text-right">ลูกค้าที่ซื้อ</TableHead>
                        <TableHead className="text-right">ลูกค้าใหม่</TableHead>
                        <TableHead className="text-right">ยอดขาย</TableHead>
                        <TableHead className="text-right">เฉลี่ย/ราย</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {customerBehaviorData.map((r) => (
                        <TableRow key={`${r.year}-${r.month}`}>
                          <TableCell className="font-medium">
                            {formatShortMonth(`${r.year}-${String(r.month).padStart(2, "0")}`)}
                          </TableCell>
                          <TableCell className="text-right">{formatNumber(r.activeCustomers)}</TableCell>
                          <TableCell className="text-right">
                            {r.newCustomers > 0 ? (
                              <Badge variant="secondary">{r.newCustomers}</Badge>
                            ) : "-"}
                          </TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(r.totalAmount)}</TableCell>
                          <TableCell className="text-right text-purple-700">{formatCurrency(r.avgPerCustomer)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Section 3: Top 10 Customer Trends */}
          {topCustomersData.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">ลูกค้ายอดสูงสุด 10 อันดับ (แนวโน้มรายเดือน)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">#</TableHead>
                        <TableHead>ลูกค้า</TableHead>
                        <TableHead className="text-right">ยอดรวม</TableHead>
                        <TableHead className="text-right">จำนวนบิล</TableHead>
                        <TableHead className="text-right">เฉลี่ย/บิล</TableHead>
                        <TableHead className="w-36">แนวโน้ม</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topCustomersData.map((c, idx) => (
                        <TableRow key={c.customerId}>
                          <TableCell className="font-bold text-gray-400">{idx + 1}</TableCell>
                          <TableCell className="font-medium">{c.customerName}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(c.totalAmount)}</TableCell>
                          <TableCell className="text-right">{formatNumber(c.txCount)}</TableCell>
                          <TableCell className="text-right text-gray-600">
                            {c.txCount > 0 ? formatCurrency(c.totalAmount / c.txCount) : "-"}
                          </TableCell>
                          <TableCell>
                            {c.monthly.length > 1 ? (
                              <div style={{ width: 130, height: 32 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                  <LineChart data={c.monthly} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                                    <Line
                                      type="monotone"
                                      dataKey="amount"
                                      stroke="#3b82f6"
                                      strokeWidth={1.5}
                                      dot={false}
                                    />
                                  </LineChart>
                                </ResponsiveContainer>
                              </div>
                            ) : (
                              <span className="text-xs text-gray-400">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
