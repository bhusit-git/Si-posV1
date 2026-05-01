"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Printer, Download, TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";
import { formatCurrency, formatNumber, formatThaiDate, todayISO } from "@/lib/thai-utils";
import {
  formatCustomerDisplay,
  useShowCustomerIdWithName,
} from "@/lib/customer-display";
import {
  ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar,
  ComposedChart, Area,
} from "recharts";

// ==================== Types ====================

interface DashboardData {
  today: {
    totalTransactions: number;
    totalAmount: number;
    paidAmount: number;
    receivableDelta?: number;
    outstandingDebt?: number;
    refundBalance?: number;
  };
  yesterday: { totalTransactions: number; totalAmount: number; paidAmount: number };
  outstanding: { totalOutstanding: number; customerCount: number };
  bagBalance: number;
  topProducts: { productName: string; totalQty: number; totalAmount: number }[];
  dailyTrend: { date: string; totalAmount: number; txCount: number }[];
  recentTx: {
    id: number; totalAmount: number; status: string; saleTime: string;
    customer: { id?: number | null; name: string };
    items: { productType: { name: string }; quantity: number }[];
  }[];
  topCustomers: { customerId: number; customerName: string; visitCount: number; totalSpend: number; lastVisit: string }[];
  productTrend: { date: string; productName: string; totalQty: number; totalAmount: number }[];
  hourlyDist: { hour: number; txCount: number; totalAmount: number }[];
  weeklySummary: { weekStart: string; totalAmount: number; txCount: number }[];
  todayReturns: { returnCount: number; returnAmount: number };
  todayVoids?: { voidCount: number; voidAmount: number };
  creditAging: { customerId: number; customerName: string; owed: number; oldestDate: string; ageBucket: string }[];
  userActivity: { userId: number; username: string; role: string; saleCount: number; saleTotal: number; voidCount: number; voidTotal: number }[];
  tomorrowForecast?: {
    targetDate: string;
    modelVersion: string;
    modelFamily?: string;
    dataEndDate?: string;
    confidence: "high" | "medium" | "low";
    keyDrivers: Array<{ feature?: string }>;
    signalCoverage?: {
      weather_forecast_fallback?: boolean;
      weather_forecast_source?: string;
      source_data_stale?: boolean;
    };
    total: {
      predictedUnits: number;
      predictedUnitsLower: number;
      predictedUnitsUpper: number;
      predictedRevenue: number;
      predictedRevenueLower: number;
      predictedRevenueUpper: number;
      confidence: "high" | "medium" | "low";
    } | null;
  } | null;
}

interface LoadingSummary {
  today: { totalOrders: number; loadedOrders: number; pendingOrders: number; otherOrders: number; completionPct: number };
}

const PRODUCT_COLORS = [
  "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

const BUCKET_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  "0-7":  { label: "0-7 วัน",  color: "text-green-700 dark:text-green-400",  bg: "bg-green-50 dark:bg-green-950",  border: "border-green-200 dark:border-green-800" },
  "8-14": { label: "8-14 วัน", color: "text-yellow-700 dark:text-yellow-400", bg: "bg-yellow-50 dark:bg-yellow-950", border: "border-yellow-200 dark:border-yellow-800" },
  "15-30":{ label: "15-30 วัน",color: "text-orange-700 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-950", border: "border-orange-200 dark:border-orange-800" },
  "30+":  { label: "30+ วัน",  color: "text-red-700 dark:text-red-400",       bg: "bg-red-50 dark:bg-red-950",       border: "border-red-200 dark:border-red-800" },
};

const ROLE_LABELS: Record<string, string> = {
  admin: "แอดมิน",
  office: "สำนักงาน",
  manager: "ผู้จัดการ",
  factory: "โรงงาน",
};

// ==================== Helpers ====================

function formatShortDate(dateStr: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDate();
  const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  return `${day} ${months[d.getMonth()]}`;
}

function formatWeekLabel(weekStart: string): string {
  const start = new Date(weekStart + "T00:00:00");
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${start.getDate()}/${start.getMonth() + 1} - ${end.getDate()}/${end.getMonth() + 1}`;
}

function formatDateISO(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shiftISODate(baseDate: string, offsetDays: number): string {
  const date = new Date(`${baseDate}T00:00:00`);
  date.setDate(date.getDate() + offsetDays);
  return formatDateISO(date);
}

function confidenceBadgeClass(confidence: "high" | "medium" | "low"): string {
  if (confidence === "high") return "bg-green-100 text-green-700 border-green-300";
  if (confidence === "medium") return "bg-yellow-100 text-yellow-700 border-yellow-300";
  return "bg-red-100 text-red-700 border-red-300";
}

function DeltaIndicator({ current, previous, invert }: { current: number; previous: number; invert?: boolean }) {
  if (previous === 0 && current === 0) return <span className="text-[10px] text-gray-400 flex items-center gap-0.5"><Minus size={10} /> เมื่อวาน: 0</span>;
  if (previous === 0) return <span className="text-[10px] text-green-600 dark:text-green-400 flex items-center gap-0.5"><TrendingUp size={10} /> ใหม่วันนี้</span>;
  const pct = ((current - previous) / previous) * 100;
  const isUp = pct > 0;
  const isGood = invert ? !isUp : isUp;
  if (Math.abs(pct) < 0.5) return <span className="text-[10px] text-gray-400 flex items-center gap-0.5"><Minus size={10} /> เท่าเมื่อวาน</span>;
  return (
    <span className={`text-[10px] flex items-center gap-0.5 ${isGood ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
      {isUp ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      {isUp ? "+" : ""}{pct.toFixed(0)}% vs เมื่อวาน
    </span>
  );
}

// ==================== Component ====================

export default function DashboardPage() {
  const router = useRouter();
  const showCustomerIdWithName = useShowCustomerIdWithName();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState<LoadingSummary | null>(null);
  const [trendView, setTrendView] = useState<"daily" | "weekly">("daily");
  const [salesWindowView, setSalesWindowView] = useState<"daily" | "weekly">("daily");
  const [canViewDashboard, setCanViewDashboard] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => (r.ok ? r.json() : null))
      .then((session) => {
        if (session?.role === "admin" || session?.role === "office") {
          setCanViewDashboard(true);
          setAuthChecked(true);
          return;
        }
        if (session?.role === "manager") {
          router.replace("/modules");
          return;
        }
        if (session?.role === "factory") {
          router.replace("/display");
          return;
        }
        router.replace("/");
      })
      .catch(() => router.replace("/"));
  }, [router]);

  useEffect(() => {
    if (!canViewDashboard) return;

    fetch("/api/dashboard")
      .then((r) => { if (!r.ok) throw new Error("API error"); return r.json(); })
      .then((d) => { setData(d); setLoading(false); })
      .catch((err) => { console.error("Dashboard load error:", err); setLoading(false); });

    fetch("/api/display?mode=summary")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setLoadingStatus(d); })
      .catch(() => {});
  }, [canViewDashboard]);

  if (!authChecked) {
    return (
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">แดชบอร์ด</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[...Array(4)].map((_, i) => (
            <Card key={i}><CardContent className="pt-6"><Skeleton className="h-4 w-24 mb-2" /><Skeleton className="h-8 w-32 mb-1" /><Skeleton className="h-3 w-20" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">แดชบอร์ด</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[...Array(4)].map((_, i) => (
            <Card key={i}><CardContent className="pt-6"><Skeleton className="h-4 w-24 mb-2" /><Skeleton className="h-8 w-32 mb-1" /><Skeleton className="h-3 w-20" /></CardContent></Card>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2"><Card><CardContent className="pt-6"><Skeleton className="h-64 w-full" /></CardContent></Card></div>
          <Card><CardContent className="pt-6"><Skeleton className="h-64 w-full" /></CardContent></Card>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">แดชบอร์ด</h1>
        <p className="text-center py-16 text-gray-500">ไม่สามารถโหลดข้อมูลได้</p>
      </div>
    );
  }

  // Prepare product trend data for multi-line chart
  const productTotals = data.productTrend.reduce<Record<string, number>>((acc, row) => {
    acc[row.productName] = (acc[row.productName] || 0) + Number(row.totalAmount || 0);
    return acc;
  }, {});
  const productNames = [...new Set(data.productTrend.map((d) => d.productName))]
    .sort((a, b) => (productTotals[b] || 0) - (productTotals[a] || 0) || a.localeCompare(b, "th"));
  const trendDates = [...new Set(data.productTrend.map((d) => d.date))].sort();
  const productTrendByDate = data.productTrend.reduce<Record<string, Record<string, number>>>((acc, row) => {
    if (!acc[row.date]) acc[row.date] = {};
    acc[row.date][row.productName] = Number(row.totalAmount || 0);
    return acc;
  }, {});
  const productLineData = trendDates.map((date) => {
    const row: Record<string, number | string> = { date: formatShortDate(date) };
    for (const pName of productNames) {
      row[pName] = productTrendByDate[date]?.[pName] || 0;
    }
    return row;
  });

  // Prepare hourly data (fill in missing hours)
  const hourlyData = Array.from({ length: 24 }, (_, h) => {
    const match = data.hourlyDist.find((d) => d.hour === h);
    return { hour: `${String(h).padStart(2, "0")}:00`, txCount: match?.txCount || 0, totalAmount: match?.totalAmount || 0 };
  });
  const hourlyChartData = [...hourlyData, { hour: "24:00", txCount: 0, totalAmount: 0 }];
  const dailyTrendByDate = data.dailyTrend.reduce<Record<string, { txCount: number; totalAmount: number }>>((acc, row) => {
    acc[row.date] = {
      txCount: Number(row.txCount || 0),
      totalAmount: Number(row.totalAmount || 0),
    };
    return acc;
  }, {});
  const weeklySalesChartData = Array.from({ length: 7 }, (_, index) => {
    const date = shiftISODate(todayISO(), index - 6);
    const match = dailyTrendByDate[date];
    return {
      label: formatShortDate(date),
      txCount: match?.txCount || 0,
      totalAmount: match?.totalAmount || 0,
    };
  });
  const salesWindowChartData = salesWindowView === "daily"
    ? hourlyChartData.map((row) => ({ label: row.hour, txCount: row.txCount, totalAmount: row.totalAmount }))
    : weeklySalesChartData;
  const salesWindowLabel = salesWindowView === "daily" ? "00:00 - 24:00" : "7 วันล่าสุด";

  // Prepare trend chart data (daily or weekly)
  const trendChartData = trendView === "daily"
    ? data.dailyTrend.map((d) => ({ label: formatShortDate(d.date), amount: d.totalAmount, count: d.txCount }))
    : data.weeklySummary.map((d) => ({ label: formatWeekLabel(d.weekStart), amount: d.totalAmount, count: d.txCount }));

  // Reconciliation calculations
  const todayCredit =
    data.today.outstandingDebt ??
    Math.max((data.today.receivableDelta ?? data.today.totalAmount - data.today.paidAmount), 0);
  const todayRefundBalance =
    data.today.refundBalance ??
    Math.max(-(data.today.receivableDelta ?? data.today.totalAmount - data.today.paidAmount), 0);

  // Credit aging bucket totals
  const agingBuckets = (data.creditAging || []).reduce<Record<string, number>>((acc, c) => {
    acc[c.ageBucket] = (acc[c.ageBucket] || 0) + c.owed;
    return acc;
  }, {});

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">แดชบอร์ด</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{formatThaiDate(todayISO())}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
            title="พิมพ์สรุป"
          >
            <Printer size={14} /> พิมพ์
          </button>
          <button
            onClick={() => {
              if (!data) return;
              const ws = XLSX.utils.aoa_to_sheet([
                ["สรุปวันนี้", formatThaiDate(todayISO())],
                [], ["ยอดขาย", data.today.totalAmount], ["จำนวนบิล", data.today.totalTransactions],
                ["เงินสดรับ", data.today.paidAmount], ["ค้างชำระวันนี้", todayCredit],
                ["เครดิตฝั่งคืนวันนี้", todayRefundBalance],
                ["ยอดคืนวันนี้", data.todayReturns.returnAmount],
                ["ยอดยกเลิกวันนี้", data.todayVoids?.voidAmount || 0],
                ["ค้างชำระรวม", data.outstanding.totalOutstanding],
              ]);
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, "สรุปวันนี้");
              XLSX.writeFile(wb, `summary-${todayISO()}.xlsx`);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
            title="ส่งออก Excel"
          >
            <Download size={14} /> Excel
          </button>
        </div>
      </div>

      {/* KPI Cards with Yesterday Comparison */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">ยอดขายวันนี้</div>
            <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">{formatCurrency(data.today.totalAmount)}</div>
            <div className="text-xs text-gray-400 mt-0.5">{formatNumber(data.today.totalTransactions)} บิล</div>
            <div className="mt-1">
              <DeltaIndicator current={Number(data.today.totalAmount)} previous={Number(data.yesterday.totalAmount)} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">เงินสดรับวันนี้</div>
            <div className="text-2xl font-bold text-green-700 dark:text-green-400">{formatCurrency(data.today.paidAmount)}</div>
            <div className="text-xs text-gray-400 mt-0.5">จากยอดขาย {formatCurrency(data.today.totalAmount)}</div>
            <div className="mt-1">
              <DeltaIndicator current={Number(data.today.paidAmount)} previous={Number(data.yesterday.paidAmount)} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">ยอดค้างชำระรวม</div>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">{formatCurrency(data.outstanding.totalOutstanding)}</div>
            <div className="text-xs text-gray-400 mt-0.5">{formatNumber(data.outstanding.customerCount)} ลูกค้า</div>
            <div className="mt-1">
              {(data.creditAging || []).some((c) => c.ageBucket === "30+") && (
                <span className="text-[10px] text-red-500 flex items-center gap-0.5">
                  <AlertTriangle size={10} /> มีค้างเกิน 30 วัน
                </span>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">ถุงค้างรวม</div>
            <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{formatNumber(data.bagBalance)}</div>
            <div className="text-xs text-gray-400 mt-0.5">ใบ (ทั้งหมด)</div>
          </CardContent>
        </Card>
      </div>

      {/* Tomorrow Forecast */}
      {data.tomorrowForecast?.total && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base">พยากรณ์พรุ่งนี้</CardTitle>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={confidenceBadgeClass(data.tomorrowForecast.total.confidence)}
                >
                  ความมั่นใจ {data.tomorrowForecast.total.confidence.toUpperCase()}
                </Badge>
                <span className="text-xs text-gray-500">
                  รุ่น {data.tomorrowForecast.modelVersion}
                  {data.tomorrowForecast.modelFamily ? ` · ${data.tomorrowForecast.modelFamily}` : ""}
                </span>
              </div>
            </div>
            <p className="text-xs text-gray-500">
              วันที่เป้าหมาย {formatThaiDate(data.tomorrowForecast.targetDate)}
            </p>
            {data.tomorrowForecast.dataEndDate && (
              <p className="text-[11px] text-gray-500">
                ข้อมูลล่าสุดถึง {formatThaiDate(data.tomorrowForecast.dataEndDate)}
                {data.tomorrowForecast.signalCoverage?.weather_forecast_fallback ? " · ใช้ weather fallback" : ""}
                {data.tomorrowForecast.signalCoverage?.source_data_stale ? " · ข้อมูลต้นทางเริ่มเก่า" : ""}
              </p>
            )}
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border rounded-md p-3">
                <div className="text-xs text-gray-500 mb-1">รายได้คาดการณ์</div>
                <div className="text-2xl font-bold text-blue-700">
                  {formatCurrency(data.tomorrowForecast.total.predictedRevenue)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  ช่วงคาดการณ์ {formatCurrency(data.tomorrowForecast.total.predictedRevenueLower)} -{" "}
                  {formatCurrency(data.tomorrowForecast.total.predictedRevenueUpper)}
                </div>
              </div>
              <div className="border rounded-md p-3">
                <div className="text-xs text-gray-500 mb-1">ปริมาณคาดการณ์</div>
                <div className="text-2xl font-bold text-green-700">
                  {formatNumber(data.tomorrowForecast.total.predictedUnits)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  ช่วงคาดการณ์ {formatNumber(data.tomorrowForecast.total.predictedUnitsLower)} -{" "}
                  {formatNumber(data.tomorrowForecast.total.predictedUnitsUpper)}
                </div>
              </div>
            </div>
            {(data.tomorrowForecast.keyDrivers || []).length > 0 && (
              <div className="mt-3">
                <div className="text-xs text-gray-500 mb-1">ตัวแปรหลัก</div>
                <div className="flex flex-wrap gap-1.5">
                  {data.tomorrowForecast.keyDrivers.slice(0, 5).map((driver, idx) => (
                    <Badge key={idx} variant="outline" className="text-[10px]">
                      {driver.feature || "feature"}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Loading Status */}
      {loadingStatus && (
        <Card className="mb-6">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">สถานะโหลดวันนี้</span>
                {loadingStatus.today.pendingOrders > 0 && (
                  <Badge variant="outline" className="text-orange-600 border-orange-300 text-[10px]">
                    {loadingStatus.today.pendingOrders} รอโหลด
                  </Badge>
                )}
              </div>
              <Link href="/display/summary" className="text-xs text-blue-600 hover:underline">ดูรายละเอียด</Link>
            </div>
            <div className="grid grid-cols-4 gap-3 mb-3">
              <div className="text-center">
                <div className="text-lg font-bold text-gray-800 dark:text-gray-100">{loadingStatus.today.totalOrders}</div>
                <div className="text-[10px] text-gray-500">ทั้งหมด</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-green-600">{loadingStatus.today.loadedOrders}</div>
                <div className="text-[10px] text-gray-500">โหลดแล้ว</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-orange-500">{loadingStatus.today.pendingOrders}</div>
                <div className="text-[10px] text-gray-500">รอโหลด</div>
              </div>
              <div className="text-center">
                <div className={`text-lg font-bold ${loadingStatus.today.completionPct >= 80 ? "text-green-600" : loadingStatus.today.completionPct >= 50 ? "text-yellow-600" : "text-orange-500"}`}>
                  {loadingStatus.today.completionPct}%
                </div>
                <div className="text-[10px] text-gray-500">สำเร็จ</div>
              </div>
            </div>
            <div className="w-full h-2.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${loadingStatus.today.completionPct >= 80 ? "bg-green-500" : loadingStatus.today.completionPct >= 50 ? "bg-yellow-500" : "bg-orange-500"}`}
                style={{ width: `${loadingStatus.today.completionPct}%` }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Middle Section: Charts + Products */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mb-6">
        {/* Left 2/3: Trend charts */}
        <div className="md:col-span-2 space-y-4">
          {/* Daily/Weekly Trend */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  {trendView === "daily" ? "ยอดขาย 7 วันล่าสุด" : "ยอดขายรายสัปดาห์ (6 เดือน)"}
                </CardTitle>
                <div className="flex gap-1">
                  <Button variant={trendView === "daily" ? "default" : "outline"} size="sm" className="text-xs h-7 px-2.5" onClick={() => setTrendView("daily")}>7 วัน</Button>
                  <Button variant={trendView === "weekly" ? "default" : "outline"} size="sm" className="text-xs h-7 px-2.5" onClick={() => setTrendView("weekly")}>6 เดือน</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {trendChartData.length === 0 ? (
                <p className="text-center py-8 text-gray-400 text-sm">ยังไม่มีข้อมูล</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={trendChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={20} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                    <Tooltip
                      formatter={(value: number | undefined, name?: string) => [
                        name === "amount" ? formatCurrency(value ?? 0) : `${value ?? 0} บิล`,
                        name === "amount" ? "ยอดขาย" : "จำนวนบิล",
                      ]}
                      labelStyle={{ fontWeight: 600 }}
                    />
                    <Area type="monotone" dataKey="amount" fill="#dbeafe" stroke="#3b82f6" strokeWidth={2} />
                    <Bar dataKey="count" fill="#93c5fd" opacity={0.5} barSize={20} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Sales by Product Line Chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">ยอดขายตามสินค้า (7 วัน)</CardTitle>
            </CardHeader>
            <CardContent>
              {productLineData.length === 0 ? (
                <p className="text-center py-8 text-gray-400 text-sm">ยังไม่มีข้อมูล</p>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={productLineData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                    <Tooltip formatter={(value: number | undefined) => formatCurrency(value ?? 0)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {productNames.map((name, i) => (
                      <Line key={name} type="monotone" dataKey={name} stroke={PRODUCT_COLORS[i % PRODUCT_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Hourly Distribution */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <CardTitle className="text-base">
                    ช่วงเวลาขาย {salesWindowView === "daily" ? "(วันนี้)" : "(รายสัปดาห์)"}
                  </CardTitle>
                  <div className="flex gap-1">
                    <Button
                      variant={salesWindowView === "daily" ? "default" : "outline"}
                      size="sm"
                      className="text-xs h-7 px-2.5"
                      onClick={() => setSalesWindowView("daily")}
                    >
                      วันนี้
                    </Button>
                    <Button
                      variant={salesWindowView === "weekly" ? "default" : "outline"}
                      size="sm"
                      className="text-xs h-7 px-2.5"
                      onClick={() => setSalesWindowView("weekly")}
                    >
                      สัปดาห์
                    </Button>
                  </div>
                </div>
                <span className="text-xs text-gray-500">{salesWindowLabel}</span>
              </div>
            </CardHeader>
            <CardContent>
              {salesWindowChartData.every((item) => item.txCount === 0) ? (
                <p className="text-center py-4 text-gray-400 text-sm">ยังไม่มีข้อมูล</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={salesWindowChartData} margin={{ top: 5, right: 8, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: salesWindowView === "daily" ? 9 : 10 }}
                      interval={1}
                    />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip
                      formatter={(value: number | undefined, name?: string) => [
                        name === "txCount" ? `${value ?? 0} บิล` : formatCurrency(value ?? 0),
                        name === "txCount" ? "จำนวนบิล" : "ยอดขาย",
                      ]}
                    />
                    <Bar dataKey="txCount" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right 1/3: Products + Recent + User Activity */}
        <div className="space-y-4">
          {/* Top Products Today */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">สินค้าขายดีวันนี้</CardTitle>
            </CardHeader>
            <CardContent>
              {data.topProducts.length === 0 ? (
                <p className="text-center py-4 text-gray-400 text-sm">ยังไม่มีข้อมูล</p>
              ) : (
                <div className="space-y-2.5">
                  {data.topProducts.map((p, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold ${
                          i === 0 ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300" :
                          i === 1 ? "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" :
                          i === 2 ? "bg-orange-50 text-orange-600 dark:bg-orange-900 dark:text-orange-300" :
                          "bg-gray-50 text-gray-400 dark:bg-gray-800 dark:text-gray-500"
                        }`}>{i + 1}</span>
                        <div>
                          <div className="text-sm font-medium">{p.productName}</div>
                          <div className="text-xs text-gray-400">{formatNumber(p.totalQty)} หน่วย</div>
                        </div>
                      </div>
                      <div className="text-sm font-bold text-blue-700 dark:text-blue-400">{formatCurrency(p.totalAmount)}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Transactions */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">รายการล่าสุดวันนี้</CardTitle>
                <Link href="/transactions" className="text-xs text-blue-600 hover:underline">ดูทั้งหมด</Link>
              </div>
            </CardHeader>
            <CardContent>
              {data.recentTx.length === 0 ? (
                <p className="text-center py-4 text-gray-400 text-sm">ยังไม่มีรายการวันนี้</p>
              ) : (
                <div className="space-y-2">
                  {data.recentTx.map((tx) => (
                    <div key={tx.id} className="flex items-center justify-between py-1.5 border-b border-gray-50 dark:border-gray-800 last:border-0">
                      <div>
                        <span className="font-medium text-sm">
                          {formatCustomerDisplay(
                            tx.customer.id,
                            tx.customer.name,
                            showCustomerIdWithName
                          )}
                        </span>
                        <span className="text-xs text-gray-400 ml-2">#{tx.id} {tx.saleTime?.slice(0, 5)}</span>
                        <div className="flex gap-1 mt-0.5">
                          {tx.items.slice(0, 2).map((item, i) => (
                            <Badge key={i} variant="outline" className="text-[10px] py-0">{item.productType.name} x{item.quantity}</Badge>
                          ))}
                          {tx.items.length > 2 && <span className="text-[10px] text-gray-400">+{tx.items.length - 2}</span>}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-sm">{formatCurrency(tx.totalAmount)}</div>
                        {tx.status === "unpaid" && <Badge variant="destructive" className="text-[10px]">ค้าง</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* User Activity Today */}
          {(data.userActivity || []).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">กิจกรรมผู้ใช้วันนี้</CardTitle>
                  <Link href="/audit" className="text-xs text-blue-600 hover:underline">บันทึกระบบ</Link>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.userActivity.map((u) => {
                    const voidRate = u.saleCount > 0 ? (u.voidCount / (u.saleCount + u.voidCount)) * 100 : 0;
                    const hasWarning = voidRate > 10;
                    return (
                      <div key={u.userId} className="flex items-center justify-between py-1.5 border-b border-gray-50 dark:border-gray-800 last:border-0">
                        <div className="flex items-center gap-2">
                          {hasWarning && <AlertTriangle size={12} className="text-red-500 shrink-0" />}
                          <div>
                            <span className="font-medium text-sm">{u.username}</span>
                            <Badge variant="outline" className="text-[10px] ml-1.5 py-0">{ROLE_LABELS[u.role] || u.role}</Badge>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm">
                            <span className="font-bold">{u.saleCount}</span>
                            <span className="text-gray-400 text-xs"> ขาย</span>
                            {u.voidCount > 0 && (
                              <>
                                <span className="text-red-500 font-bold ml-2">{u.voidCount}</span>
                                <span className="text-red-400 text-xs"> ยกเลิก</span>
                              </>
                            )}
                          </div>
                          <div className="text-xs text-gray-400">{formatCurrency(u.saleTotal)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Top 10 Customers (last 30 days) */}
      <Card className="mb-6">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">ลูกค้าที่ซื้อบ่อย (30 วันล่าสุด)</CardTitle>
            <Link href="/customers" className="text-xs text-blue-600 hover:underline">ดูทั้งหมด</Link>
          </div>
        </CardHeader>
        <CardContent>
          {data.topCustomers.length === 0 ? (
            <p className="text-center py-4 text-gray-400 text-sm">ยังไม่มีข้อมูล</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b dark:border-gray-800">
                    <th className="pb-2 pr-3 font-medium w-10">#</th>
                    <th className="pb-2 pr-3 font-medium">ลูกค้า</th>
                    <th className="pb-2 pr-3 font-medium text-center">จำนวนครั้ง</th>
                    <th className="pb-2 pr-3 font-medium text-right">ยอดรวม</th>
                    <th className="pb-2 font-medium text-right">มาล่าสุด</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topCustomers.map((c, i) => (
                    <tr key={c.customerId} className="border-b border-gray-50 dark:border-gray-800 last:border-0">
                      <td className="py-2 pr-3">
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                          i === 0 ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300" :
                          i === 1 ? "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" :
                          i === 2 ? "bg-orange-50 text-orange-600 dark:bg-orange-900 dark:text-orange-300" :
                          "text-gray-400"
                        }`}>{i + 1}</span>
                      </td>
                      <td className="py-2 pr-3 font-medium">{c.customerName}</td>
                      <td className="py-2 pr-3 text-center">
                        <Badge variant="outline" className="text-xs">{c.visitCount} ครั้ง</Badge>
                      </td>
                      <td className="py-2 pr-3 text-right font-bold text-blue-700 dark:text-blue-400">
                        {formatCurrency(c.totalSpend)}
                      </td>
                      <td className="py-2 text-right text-xs text-gray-400">
                        {formatShortDate(c.lastVisit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Credit Aging Card */}
      {(data.creditAging || []).length > 0 && (
        <Card className="mb-6 border-2 border-red-100 dark:border-red-900">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base text-red-800 dark:text-red-300">อายุหนี้ค้างชำระ</CardTitle>
              <Link href="/invoice?tab=credit" className="text-xs text-blue-600 hover:underline">ดูทั้งหมด</Link>
            </div>
          </CardHeader>
          <CardContent>
            {/* Bucket summary pills */}
            <div className="flex flex-wrap gap-2 mb-4">
              {(["0-7", "8-14", "15-30", "30+"] as const).map((bucket) => {
                const cfg = BUCKET_CONFIG[bucket];
                const amount = agingBuckets[bucket] || 0;
                if (amount === 0) return null;
                return (
                  <div key={bucket} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium ${cfg.bg} ${cfg.border} ${cfg.color}`}>
                    <span>{cfg.label}</span>
                    <span className="font-bold">{formatCurrency(amount)}</span>
                  </div>
                );
              })}
            </div>
            {/* Customer table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b dark:border-gray-800">
                    <th className="pb-2 pr-3 font-medium">ลูกค้า</th>
                    <th className="pb-2 pr-3 font-medium text-right">ยอดค้าง</th>
                    <th className="pb-2 pr-3 font-medium text-right">บิลเก่าสุด</th>
                    <th className="pb-2 font-medium text-center">อายุ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.creditAging.map((c) => {
                    const cfg = BUCKET_CONFIG[c.ageBucket] || BUCKET_CONFIG["30+"];
                    return (
                      <tr key={c.customerId} className="border-b border-gray-50 dark:border-gray-800 last:border-0">
                        <td className="py-2 pr-3 font-medium">{c.customerName}</td>
                        <td className="py-2 pr-3 text-right font-bold text-red-600 dark:text-red-400">{formatCurrency(c.owed)}</td>
                        <td className="py-2 pr-3 text-right text-xs text-gray-400">{formatShortDate(c.oldestDate)}</td>
                        <td className="py-2 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium border ${cfg.bg} ${cfg.border} ${cfg.color}`}>
                            {cfg.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Reconciliation Summary */}
      <Card className="border-2 border-blue-200 dark:border-blue-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-blue-800 dark:text-blue-300">สรุปยอดประจำวัน (สำหรับตรวจสอบ)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            <div className="text-center p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">ยอดสุทธิวันนี้</div>
              <div className="text-xl md:text-2xl font-bold text-blue-700 dark:text-blue-400">{formatCurrency(data.today.totalAmount)}</div>
              <div className="text-xs text-gray-400 mt-0.5">{formatNumber(data.today.totalTransactions)} บิล</div>
            </div>
            <div className="text-center p-3 bg-green-50 dark:bg-green-950 rounded-lg">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">เงินสดรับ</div>
              <div className="text-xl md:text-2xl font-bold text-green-700 dark:text-green-400">{formatCurrency(data.today.paidAmount)}</div>
              <div className="text-xs text-gray-400 mt-0.5">ชำระเงินสด</div>
            </div>
            <div className="text-center p-3 bg-orange-50 dark:bg-orange-950 rounded-lg">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">ขายเชื่อวันนี้</div>
              <div className="text-xl md:text-2xl font-bold text-orange-600 dark:text-orange-400">{formatCurrency(todayCredit)}</div>
              <div className="text-xs text-gray-400 mt-0.5">หนี้คงค้างเท่านั้น</div>
            </div>
            <div className="text-center p-3 bg-red-50 dark:bg-red-950 rounded-lg">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">ยอดคืน</div>
              <div className="text-xl md:text-2xl font-bold text-red-600 dark:text-red-400">{formatCurrency(data.todayReturns.returnAmount)}</div>
              <div className="text-xs text-gray-400 mt-0.5">{data.todayReturns.returnCount} รายการ</div>
            </div>
            <div className="text-center p-3 bg-rose-50 dark:bg-rose-950 rounded-lg">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">ยอดยกเลิก</div>
              <div className="text-xl md:text-2xl font-bold text-rose-600 dark:text-rose-400">
                {formatCurrency(data.todayVoids?.voidAmount || 0)}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">{data.todayVoids?.voidCount || 0} รายการ</div>
            </div>
            <div className="text-center p-3 bg-purple-50 dark:bg-purple-950 rounded-lg">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">เครดิตฝั่งคืน</div>
              <div className="text-xl md:text-2xl font-bold text-purple-700 dark:text-purple-400">
                {formatCurrency(todayRefundBalance)}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">เงินคืน/ยอดติดลบ</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
