"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { formatCurrency, formatThaiDate, nowTimeISO, todayISO } from "@/lib/thai-utils";
import { allowDuplicateInvoiceIssueOverride } from "@/lib/config/invoice-duplicates";
import {
  formatCustomerDisplay,
  useShowCustomerIdWithName,
} from "@/lib/customer-display";
import { generateIdempotencyKey } from "@/lib/idempotency-client";
import {
  INVOICE_CREDIT_LABEL,
  SHORT_TERM_CREDIT_LABEL,
} from "@/lib/customer-credit-labels";
import { getBagDisplayQuantities } from "@/lib/bag-flow";
import { computeFinancialTotals } from "@/lib/financial-totals";
import {
  addMinuteToSaleTime,
  buildSaleLaunchUrl,
  getBackdatedInsertState,
  getInvoiceComposerDefaultDateRange,
} from "@/lib/invoice-sale-launch";
import { supportsFactoryFeature } from "@/lib/factory-profile";
import CreditPage from "../credit/page";
import TransfersPage from "../transfers/page";

type BillKind = "sale" | "return" | "transfer_out" | "adjustment";
type InvoiceStatus = "draft" | "issued" | "paid" | "void";
type InvoiceDisplayStatus = InvoiceStatus | "partially_paid";
type PaymentMethod = "cash" | "bank_transfer" | "cheque" | "other";
type InvoiceListStatusFilter = "all" | InvoiceStatus | "partially_paid";
type InvoicePageTab = "generated" | "new" | "credit" | "bearingDiscounts" | "transfers";

interface CustomerOption {
  id: number;
  name: string;
}

interface PreviewProductColumn {
  id: number;
  name: string;
}

interface PreviewRow {
  transactionId: number;
  customerName: string;
  saleDate: string;
  saleTime: string;
  location: string;
  kind: BillKind;
  transactionStatus: "paid" | "unpaid" | "partial" | "voided";
  quantities: Record<number, number>;
  bagsOut: number;
  bagsReturned: number;
  bagsBought: number;
  bagAdjustDelta: number;
  cashPaid: number;
  creditOwed: number;
  refundBalance: number;
  sumTotal: number;
}

interface PreviewResponse {
  customer: { id: number; name: string; phone?: string | null };
  productColumns: PreviewProductColumn[];
  rows: PreviewRow[];
  totals: {
    totalsByProduct: Record<number, number>;
    totalCashPaid: number;
    totalCreditOwed: number;
    totalRefundBalance: number;
    totalSum: number;
    totalBagsOut: number;
    totalBagsReturned: number;
    kindCounts: Record<BillKind, number>;
    rowCount: number;
  };
}

interface InvoiceListRow {
  id: number;
  invoiceNo: string | null;
  customerId: number;
  customerName: string;
  periodStart: string;
  periodEnd: string;
  status: InvoiceStatus;
  displayStatus: InvoiceDisplayStatus;
  grandTotal: number;
  paidTotal: number;
  outstandingTotal: number;
  issueDate: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

interface InvoiceListResponse {
  rows: InvoiceListRow[];
  meta: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

interface BearingDiscountReportResponse {
  factoryKey: string;
  startDate: string;
  endDate: string;
  rowCount: number;
  grandTotalDiscount: number;
  rows: Array<{
    transactionId: number;
    billNumber: string;
    customerId: number | null;
    customerName: string | null;
    saleDate: string;
    saleTime: string | null;
    originalSubtotal: number;
    discountAmount: number;
    finalSubtotal: number;
  }>;
  dailyTotals: Array<{
    saleDate: string;
    discountAmount: number;
    rowCount: number;
  }>;
}

interface InvoiceDetail {
  invoice: {
    id: number;
    invoiceNo: string | null;
    status: InvoiceStatus;
    displayStatus: InvoiceDisplayStatus;
    periodStart: string;
    periodEnd: string;
    vatEnabled: boolean;
    vatRate: number;
    subtotal: number;
    vatAmount: number;
    grandTotal: number;
    paidTotal: number;
    outstandingTotal: number;
    notes: string | null;
    voidReason: string | null;
    generatedAt: string;
    sentAt: string | null;
    paidAt: string | null;
    issueDate: string | null;
    dueDate: string | null;
  };
  customer: { id: number; name: string; phone?: string | null } | null;
  payments: Array<{
    id: number;
    paidAt: string;
    amount: number;
    method: PaymentMethod;
    note: string | null;
    createdBy: number | null;
  }>;
  timeline: Array<{
    event: string;
    at: string;
    userId: number | null;
    userName?: string | null;
    isCurrentUser?: boolean;
    detail?: string | null;
  }>;
  lines: Array<{
    id: number;
    transactionId: number;
    lineType?: BillKind;
    saleDate: string;
    saleTime: string;
    amount: number;
    transactionStatus: "paid" | "unpaid" | "partial" | "voided" | null;
    snapshot?: {
      customerName?: string;
      saleDate?: string;
      saleTime?: string;
      location?: string;
      transactionStatus?: string;
      bagsOut?: number;
      bagsReturned?: number;
      cashPaid?: number;
      creditOwed?: number;
      refundBalance?: number;
      sumTotal?: number;
    } | null;
  }>;
}

const NAV_PAGE_LIMIT = 30;
const FIXED_VAT_RATE = 0.07;

const BILL_KIND_OPTIONS: Array<{ key: BillKind; label: string }> = [
  { key: "sale", label: "Sale" },
  { key: "return", label: "Return" },
  { key: "transfer_out", label: INVOICE_CREDIT_LABEL },
  { key: "adjustment", label: "Adjustment" },
];

const NAV_STATUS_OPTIONS: Array<{ key: InvoiceListStatusFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "issued", label: "Sent" },
  { key: "partially_paid", label: "Partially Paid" },
  { key: "paid", label: "Paid" },
  { key: "void", label: "Void" },
];

const DEFAULT_KIND_FILTER: Record<BillKind, boolean> = {
  sale: true,
  return: true,
  transfer_out: true,
  adjustment: true,
};

const DISPLAY_STATUS_LABEL: Record<InvoiceDisplayStatus, string> = {
  draft: "Draft",
  issued: "Sent",
  partially_paid: "Partially Paid",
  paid: "Paid",
  void: "Void",
};

const DISPLAY_STATUS_CLASSES: Record<InvoiceDisplayStatus, string> = {
  draft: "bg-gray-100 text-gray-700 border-gray-200",
  issued: "bg-blue-100 text-blue-700 border-blue-200",
  partially_paid: "bg-amber-100 text-amber-700 border-amber-200",
  paid: "bg-green-100 text-green-700 border-green-200",
  void: "bg-red-100 text-red-700 border-red-200",
};

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatTime(value: string): string {
  return value?.slice(0, 5) || "-";
}

function formatTimelineUser(entry: {
  userId: number | null;
  userName?: string | null;
  isCurrentUser?: boolean;
}): string {
  if (entry.isCurrentUser) return entry.userName ? `${entry.userName} (You)` : "You";
  if (entry.userName) return entry.userName;
  if (entry.userId != null) return `user#${entry.userId}`;
  return "-";
}

function kindCsv(kindFilter: Record<BillKind, boolean>): string {
  return BILL_KIND_OPTIONS.filter((k) => kindFilter[k.key]).map((k) => k.key).join(",");
}

function parseKindFilter(csv: string | null | undefined): Record<BillKind, boolean> {
  const next: Record<BillKind, boolean> = {
    sale: false,
    return: false,
    transfer_out: false,
    adjustment: false,
  };
  const rawValues = `${csv || ""}`
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean) as BillKind[];

  for (const value of rawValues) {
    if (value in next) {
      next[value] = true;
    }
  }

  return Object.values(next).some(Boolean) ? next : { ...DEFAULT_KIND_FILTER };
}

function inferDraftKindFilter(detail: InvoiceDetail | null): Record<BillKind, boolean> {
  if (!detail) return { ...DEFAULT_KIND_FILTER };
  const next: Record<BillKind, boolean> = {
    sale: false,
    return: false,
    transfer_out: false,
    adjustment: false,
  };

  for (const line of detail.lines) {
    if (line.lineType && line.lineType in next) {
      next[line.lineType] = true;
    }
  }

  return Object.values(next).some(Boolean) ? next : { ...DEFAULT_KIND_FILTER };
}

function statusBadge(status: InvoiceDisplayStatus) {
  return (
    <Badge variant="outline" className={DISPLAY_STATUS_CLASSES[status]}>
      {DISPLAY_STATUS_LABEL[status]}
    </Badge>
  );
}

function paymentStatusBadge(invoice: InvoiceDetail["invoice"]) {
  if (invoice.status === "void") {
    return (
      <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
        ยกเลิกแล้ว
      </Badge>
    );
  }
  if (invoice.outstandingTotal <= 0) {
    return (
      <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">
        ชำระครบ
      </Badge>
    );
  }
  if (invoice.paidTotal > 0) {
    return (
      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
        ชำระบางส่วน
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-gray-200 bg-gray-50 text-gray-700">
      ยังไม่ชำระ
    </Badge>
  );
}

export default function InvoiceWorkspacePage() {
  const showCustomerIdWithName = useShowCustomerIdWithName();
  const searchParams = useSearchParams();
  const initialCustomerId = searchParams.get("customerId");
  const isMountedRef = useRef(true);
  const autoRefreshSignatureRef = useRef<string | null>(null);
  const requestedAnchorTransactionIdRef = useRef<number | null>(null);
  const defaultDateRange = getInvoiceComposerDefaultDateRange(todayISO());

  const [customerQuery, setCustomerQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);

  const [startDate, setStartDate] = useState(defaultDateRange.startDate);
  const [endDate, setEndDate] = useState(defaultDateRange.endDate);
  const [kindFilter, setKindFilter] = useState<Record<BillKind, boolean>>(DEFAULT_KIND_FILTER);
  const [vatEnabled, setVatEnabled] = useState(false);

  const [loadingPreview, setLoadingPreview] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<Set<number>>(new Set());
  const [selectedAnchorTransactionId, setSelectedAnchorTransactionId] = useState<number | null>(null);
  const [sessionRole, setSessionRole] = useState<string | null>(null);
  const [pendingAutoRefresh, setPendingAutoRefresh] = useState<{
    customerId: number;
    startDate: string;
    endDate: string;
    invoiceKinds: string;
    vatEnabled: boolean;
    invoiceSource: "new" | "draft";
    createdTransactionId: number | null;
    anchorTransactionId: number | null;
  } | null>(null);

  const [invoiceDetail, setInvoiceDetail] = useState<InvoiceDetail | null>(null);
  const [activeInvoiceId, setActiveInvoiceId] = useState<number | null>(null);
  const activeInvoiceIdRef = useRef<number | null>(null);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [processingAction, setProcessingAction] = useState(false);

  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");

  const [activeTab, setActiveTab] = useState<InvoicePageTab>("generated");
  const [activeFactoryKey, setActiveFactoryKey] = useState<string | null>(null);
  const [navQuery, setNavQuery] = useState("");
  const [navStatus, setNavStatus] = useState<InvoiceListStatusFilter>("all");
  const [navDateFrom, setNavDateFrom] = useState("");
  const [navDateTo, setNavDateTo] = useState("");
  const [appliedNavQuery, setAppliedNavQuery] = useState("");
  const [appliedNavStatus, setAppliedNavStatus] = useState<InvoiceListStatusFilter>("all");
  const [appliedNavDateFrom, setAppliedNavDateFrom] = useState("");
  const [appliedNavDateTo, setAppliedNavDateTo] = useState("");
  const [invoiceRows, setInvoiceRows] = useState<InvoiceListRow[]>([]);
  const [invoiceMeta, setInvoiceMeta] = useState({
    total: 0,
    limit: NAV_PAGE_LIMIT,
    offset: 0,
    hasMore: false,
  });
  const [loadingNavigator, setLoadingNavigator] = useState(false);
  const [loadingMoreNavigator, setLoadingMoreNavigator] = useState(false);
  const [bearingDiscountStartDate, setBearingDiscountStartDate] = useState(todayISO());
  const [bearingDiscountEndDate, setBearingDiscountEndDate] = useState(todayISO());
  const [bearingDiscountReport, setBearingDiscountReport] = useState<BearingDiscountReportResponse | null>(null);
  const [loadingBearingDiscounts, setLoadingBearingDiscounts] = useState(false);
  const isAdmin = sessionRole === "admin";
  const showBearingDiscountsTab = supportsFactoryFeature(
    activeFactoryKey,
    "bearingDiscountsReport"
  );

  const loadInvoice = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/invoices/${id}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "load_invoice_failed");
      }
      const data = (await res.json()) as InvoiceDetail;
      setInvoiceDetail(data);
      setActiveInvoiceId(id);
      activeInvoiceIdRef.current = id;
      setPaymentAmount(data.invoice.outstandingTotal > 0 ? `${data.invoice.outstandingTotal}` : "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load invoice");
    }
  }, []);

  const loadNavigator = useCallback(async (options?: {
    append?: boolean;
    offset?: number;
    preferId?: number | null;
    autoSelectFirst?: boolean;
  }) => {
    const append = options?.append === true;
    const nextOffset = options?.offset ?? 0;

    if (append) setLoadingMoreNavigator(true);
    else setLoadingNavigator(true);

    try {
      const params = new URLSearchParams();
      params.set("limit", String(NAV_PAGE_LIMIT));
      params.set("offset", String(nextOffset));
      if (appliedNavQuery.trim()) params.set("q", appliedNavQuery.trim());
      if (appliedNavStatus !== "all") params.set("status", appliedNavStatus);
      if (appliedNavDateFrom) params.set("dateFrom", appliedNavDateFrom);
      if (appliedNavDateTo) params.set("dateTo", appliedNavDateTo);

      const res = await fetch(`/api/invoices?${params.toString()}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "load_invoices_failed");
      }

      const data = (await res.json()) as InvoiceListResponse;
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      const meta = data?.meta || {
        total: rows.length,
        limit: NAV_PAGE_LIMIT,
        offset: nextOffset,
        hasMore: false,
      };

      if (append) {
        setInvoiceRows((prev) => [...prev, ...rows]);
      } else {
        setInvoiceRows(rows);
      }
      setInvoiceMeta({
        total: Number(meta.total || 0),
        limit: Number(meta.limit || NAV_PAGE_LIMIT),
        offset: Number(meta.offset || 0),
        hasMore: Boolean(meta.hasMore),
      });

      if (append) return;

      const merged = rows;
      const preferId = options?.preferId || null;
      if (preferId && merged.some((row) => row.id === preferId)) {
        if (activeInvoiceIdRef.current !== preferId) {
          await loadInvoice(preferId);
        }
        return;
      }

      if (activeInvoiceIdRef.current && merged.some((row) => row.id === activeInvoiceIdRef.current)) {
        return;
      }

      if (options?.autoSelectFirst && merged.length > 0) {
        await loadInvoice(merged[0].id);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load invoices");
    } finally {
      if (append) setLoadingMoreNavigator(false);
      else setLoadingNavigator(false);
    }
  }, [loadInvoice, appliedNavDateFrom, appliedNavDateTo, appliedNavQuery, appliedNavStatus]);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setSessionRole(typeof data?.role === "string" ? data.role : null))
      .catch(() => setSessionRole(null));
  }, []);

  useEffect(() => {
    fetch("/api/factory")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const current = typeof data?.current === "string" ? data.current : null;
        setActiveFactoryKey(current);
      })
      .catch(() => setActiveFactoryKey(null));
  }, []);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!initialCustomerId) return;
    fetch(`/api/customers?id=${encodeURIComponent(initialCustomerId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.id) return;
        const selected = { id: data.id as number, name: data.name as string };
        setSelectedCustomer(selected);
        setCustomerQuery(selected.name);
      })
      .catch(() => {});
  }, [initialCustomerId]);

  useEffect(() => {
    const rawTab = (searchParams.get("tab") || "").toLowerCase();
    if (
      rawTab === "new" ||
      rawTab === "credit" ||
      rawTab === "bearingdiscounts" ||
      rawTab === "transfers" ||
      rawTab === "generated"
    ) {
      setActiveTab(rawTab === "bearingdiscounts" ? "bearingDiscounts" : rawTab as InvoicePageTab);
    }

    const nextStartDate = searchParams.get("startDate");
    if (nextStartDate) setStartDate(nextStartDate);

    const nextEndDate = searchParams.get("endDate");
    if (nextEndDate) setEndDate(nextEndDate);

    const nextKinds = searchParams.get("invoiceKinds");
    if (nextKinds) setKindFilter(parseKindFilter(nextKinds));

    const nextVatEnabled = searchParams.get("vatEnabled");
    if (nextVatEnabled === "0" || nextVatEnabled === "1") {
      setVatEnabled(nextVatEnabled === "1");
    }

    const refreshPreview = searchParams.get("refreshPreview") === "1";
    if (!refreshPreview) return;

    const customerId = Number.parseInt(searchParams.get("customerId") || "", 10);
    if (!Number.isFinite(customerId) || customerId <= 0) return;

    const anchorTransactionId = Number.parseInt(searchParams.get("anchorTransactionId") || "", 10);
    requestedAnchorTransactionIdRef.current =
      Number.isFinite(anchorTransactionId) && anchorTransactionId > 0 ? anchorTransactionId : null;

    const createdTransactionId = Number.parseInt(searchParams.get("createdTransactionId") || "", 10);
    const invoiceSource = searchParams.get("invoiceSource") === "draft" ? "draft" : "new";
    const invoiceKinds = nextKinds || kindCsv(DEFAULT_KIND_FILTER);
    const resolvedStartDate = nextStartDate || todayISO();
    const resolvedEndDate = nextEndDate || todayISO();
    const signature = [
      customerId,
      resolvedStartDate,
      resolvedEndDate,
      invoiceKinds,
      nextVatEnabled === "1" ? "1" : "0",
      createdTransactionId,
      anchorTransactionId,
      invoiceSource,
    ].join("|");

    if (autoRefreshSignatureRef.current === signature) return;
    autoRefreshSignatureRef.current = signature;

    setPendingAutoRefresh({
      customerId,
      startDate: resolvedStartDate,
      endDate: resolvedEndDate,
      invoiceKinds,
      vatEnabled: nextVatEnabled === "1",
      invoiceSource,
      createdTransactionId:
        Number.isFinite(createdTransactionId) && createdTransactionId > 0 ? createdTransactionId : null,
      anchorTransactionId:
        Number.isFinite(anchorTransactionId) && anchorTransactionId > 0 ? anchorTransactionId : null,
    });
  }, [searchParams]);

  useEffect(() => {
    if (activeFactoryKey && !showBearingDiscountsTab && activeTab === "bearingDiscounts") {
      setActiveTab("generated");
    }
  }, [activeFactoryKey, activeTab, showBearingDiscountsTab]);

  useEffect(() => {
    const q = customerQuery.trim();
    if (!q || (selectedCustomer && q === selectedCustomer.name)) {
      setCustomerOptions([]);
      return;
    }
    const timer = setTimeout(() => {
      fetch(`/api/customers?search=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((rows: CustomerOption[]) => setCustomerOptions(rows.slice(0, 8)))
        .catch(() => setCustomerOptions([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [customerQuery, selectedCustomer]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadNavigator({
        append: false,
        offset: 0,
        autoSelectFirst: true,
      });
    }, 250);

    return () => clearTimeout(timer);
  }, [loadNavigator]);

  useEffect(() => {
    function onInvoiceCreated(event: Event) {
      const customEvent = event as CustomEvent<{ id?: number | null }>;
      const invoiceId = Number(customEvent.detail?.id || 0);
      void loadNavigator({
        append: false,
        offset: 0,
        preferId: invoiceId > 0 ? invoiceId : null,
        autoSelectFirst: true,
      });
    }

    window.addEventListener("invoice-created", onInvoiceCreated as EventListener);
    return () => {
      window.removeEventListener("invoice-created", onInvoiceCreated as EventListener);
    };
  }, [loadNavigator]);

  const loadPreview = useCallback(async () => {
    if (!selectedCustomer) {
      toast.error("Select a customer first");
      return false;
    }
    if (!startDate || !endDate || startDate > endDate) {
      toast.error("Invalid date range");
      return false;
    }

    setLoadingPreview(true);
    try {
      const kinds = kindCsv(kindFilter);
      const res = await fetch(
        `/api/invoices/preview?customerId=${selectedCustomer.id}&startDate=${startDate}&endDate=${endDate}&includeKinds=${encodeURIComponent(kinds)}`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "preview_failed");
      }
      const data = (await res.json()) as PreviewResponse;
      setPreview(data);
      setSelectedTransactionIds(new Set(data.rows.map((r) => r.transactionId)));
      setSelectedAnchorTransactionId((prev) => {
        const requestedAnchor = requestedAnchorTransactionIdRef.current;
        if (requestedAnchor && data.rows.some((row) => row.transactionId === requestedAnchor)) {
          return requestedAnchor;
        }
        if (prev && data.rows.some((row) => row.transactionId === prev)) {
          return prev;
        }
        return null;
      });
      requestedAnchorTransactionIdRef.current = null;
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load preview");
      return false;
    } finally {
      setLoadingPreview(false);
    }
  }, [selectedCustomer, startDate, endDate, kindFilter]);

  const selectedAnchorRow = useMemo(() => {
    if (!preview || !selectedAnchorTransactionId) return null;
    return preview.rows.find((row) => row.transactionId === selectedAnchorTransactionId) || null;
  }, [preview, selectedAnchorTransactionId]);

  const backdatedInsertState = useMemo(
    () =>
      getBackdatedInsertState({
        selectedAnchorSaleDate: selectedAnchorRow?.saleDate || null,
        invoiceEndDate: endDate,
        today: todayISO(),
        isAdmin,
      }),
    [selectedAnchorRow, endDate, isAdmin]
  );

  const selectedRows = useMemo(() => {
    if (!preview) return [];
    return preview.rows.filter((row) => selectedTransactionIds.has(row.transactionId));
  }, [preview, selectedTransactionIds]);

  const selectedTotals = useMemo(() => {
    if (!preview) {
      return {
        totalsByProduct: {} as Record<number, number>,
        totalCashPaid: 0,
        totalCreditOwed: 0,
        totalRefundBalance: 0,
        totalSum: 0,
        totalBagsOut: 0,
        totalBagsReturned: 0,
        kindCounts: { sale: 0, return: 0, transfer_out: 0, adjustment: 0 } as Record<BillKind, number>,
        rowCount: 0,
      };
    }

    const totalsByProduct: Record<number, number> = {};
    for (const col of preview.productColumns) totalsByProduct[col.id] = 0;
    const kindCounts: Record<BillKind, number> = {
      sale: 0,
      return: 0,
      transfer_out: 0,
      adjustment: 0,
    };

    const financialTotals = computeFinancialTotals(
      selectedRows.map((row) => ({
        status: row.transactionStatus,
        transactionKind: row.kind,
        totalAmount: row.sumTotal,
        paid: row.cashPaid,
      })),
      { includeTransferOut: true }
    );
    let totalBagsOut = 0;
    let totalBagsReturned = 0;

    for (const row of selectedRows) {
      const bagDisplay = getBagDisplayQuantities(row);
      kindCounts[row.kind] += 1;
      totalBagsOut += bagDisplay.bagsOut;
      totalBagsReturned += bagDisplay.bagsReturned;
      for (const col of preview.productColumns) {
        totalsByProduct[col.id] += row.quantities[col.id] || 0;
      }
    }

    return {
      totalsByProduct,
      totalCashPaid: financialTotals.netCash,
      totalCreditOwed: financialTotals.outstandingDebt,
      totalRefundBalance: financialTotals.refundBalance,
      totalSum: financialTotals.netSales,
      totalBagsOut,
      totalBagsReturned,
      kindCounts,
      rowCount: selectedRows.length,
    };
  }, [preview, selectedRows]);

  const selectedVatAmount = useMemo(() => {
    return vatEnabled ? selectedTotals.totalSum * FIXED_VAT_RATE : 0;
  }, [selectedTotals.totalSum, vatEnabled]);

  const selectedGrandTotal = useMemo(() => {
    return selectedTotals.totalSum + selectedVatAmount;
  }, [selectedTotals.totalSum, selectedVatAmount]);

  useEffect(() => {
    if (!pendingAutoRefresh || !selectedCustomer) return;
    if (selectedCustomer.id !== pendingAutoRefresh.customerId) return;
    if (startDate !== pendingAutoRefresh.startDate || endDate !== pendingAutoRefresh.endDate) return;
    if (kindCsv(kindFilter) !== pendingAutoRefresh.invoiceKinds) return;
    if (vatEnabled !== pendingAutoRefresh.vatEnabled) return;

    let cancelled = false;
    void (async () => {
      const loaded = await loadPreview();
      if (!loaded || cancelled || !isMountedRef.current) return;
      if (pendingAutoRefresh.invoiceSource === "draft") {
        toast.success("เพิ่มรายการแล้ว กรุณาสร้าง draft ใหม่เพื่อรวมรายการล่าสุด");
      } else {
        toast.success("เพิ่มรายการแล้ว อัปเดตตัวอย่างใบวางบิลแล้ว");
      }
      setPendingAutoRefresh(null);
      setActiveTab("new");
    })();

    return () => {
      cancelled = true;
    };
  }, [pendingAutoRefresh, selectedCustomer, startDate, endDate, kindFilter, vatEnabled, loadPreview]);

  const launchSaleFromComposer = useCallback((options?: {
    useAnchor?: boolean;
    invoiceSource?: "new" | "draft";
    customerId?: number;
    invoiceStartDate?: string;
    invoiceEndDate?: string;
    invoiceKinds?: string;
    invoiceVatEnabled?: boolean;
    anchorTransactionId?: number | null;
    saleDate?: string;
    saleTime?: string;
  }) => {
    if (!selectedCustomer && !options?.customerId) {
      toast.error("เลือกลูกค้าก่อน");
      return;
    }
    if (!preview && options?.invoiceSource !== "draft") {
      toast.error("โหลด preview ก่อนเพิ่มรายการ");
      return;
    }

    const useAnchor = options?.useAnchor === true;
    if (useAnchor && !selectedAnchorRow) {
      toast.error("เลือกบรรทัดที่ต้องการแทรกก่อน");
      return;
    }

    const invoiceCustomerId = options?.customerId || selectedCustomer?.id;
    if (!invoiceCustomerId) return;

    const invoiceStartDate = options?.invoiceStartDate || startDate;
    const invoiceEndDate = options?.invoiceEndDate || endDate;
    const invoiceKinds = options?.invoiceKinds || kindCsv(kindFilter);
    const invoiceVatEnabled = options?.invoiceVatEnabled ?? vatEnabled;
    const anchorTransactionId = options?.anchorTransactionId ?? selectedAnchorRow?.transactionId ?? null;

    const defaultSaleDate = options?.saleDate || selectedAnchorRow?.saleDate || invoiceEndDate;
    if (defaultSaleDate < todayISO() && !isAdmin) {
      toast.error("เฉพาะ admin เท่านั้นสำหรับรายการย้อนหลัง");
      return;
    }
    const defaultSaleTime =
      options?.saleTime ||
      (selectedAnchorRow ? addMinuteToSaleTime(selectedAnchorRow.saleTime) : defaultSaleDate === todayISO() ? nowTimeISO() : "08:00:00");

    const href = buildSaleLaunchUrl({
      customerId: invoiceCustomerId,
      saleDate: defaultSaleDate,
      saleTime: defaultSaleTime,
      invoiceStartDate,
      invoiceEndDate,
      invoiceKinds,
      invoiceVatEnabled,
      invoiceSource: options?.invoiceSource || "new",
      anchorTransactionId: useAnchor ? anchorTransactionId : options?.anchorTransactionId ?? null,
      backdateMode: isAdmin && defaultSaleDate < todayISO(),
    });

    window.location.assign(href);
  }, [selectedCustomer, preview, selectedAnchorRow, startDate, endDate, kindFilter, vatEnabled, isAdmin]);

  const launchSaleFromDraftInvoice = useCallback(() => {
    if (!invoiceDetail?.customer) {
      toast.error("ไม่พบข้อมูลลูกค้าของใบวางบิล");
      return;
    }

    const inferredKinds = inferDraftKindFilter(invoiceDetail);
    launchSaleFromComposer({
      invoiceSource: "draft",
      customerId: invoiceDetail.customer.id,
      invoiceStartDate: invoiceDetail.invoice.periodStart,
      invoiceEndDate: invoiceDetail.invoice.periodEnd,
      invoiceKinds: kindCsv(inferredKinds),
      invoiceVatEnabled: invoiceDetail.invoice.vatEnabled,
    });
  }, [invoiceDetail, launchSaleFromComposer]);

  async function createDraftInvoice() {
    if (!preview || !selectedCustomer) {
      toast.error("Load preview first");
      return;
    }
    if (selectedTransactionIds.size === 0) {
      toast.error("Select at least one row");
      return;
    }

    const previewWindow = window.open("", "_blank");
    setCreatingDraft(true);
    try {
      const idempotencyKey = generateIdempotencyKey("invoice.create");
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          customerId: selectedCustomer.id,
          periodStart: startDate,
          periodEnd: endDate,
          includeKinds: BILL_KIND_OPTIONS.filter((k) => kindFilter[k.key]).map((k) => k.key),
          selectedTransactionIds: Array.from(selectedTransactionIds),
          vatEnabled,
          vatRate: FIXED_VAT_RATE,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "create_draft_failed");
      }
      toast.success(`Draft invoice #${data.id} created`);
      const printUrl = `/print/invoice/generated/${data.id}`;
      if (previewWindow && !previewWindow.closed) {
        previewWindow.location.href = printUrl;
      } else {
        window.open(printUrl, "_blank");
      }
      setActiveTab("generated");
      await loadInvoice(data.id);
      await loadNavigator({ append: false, offset: 0, preferId: data.id, autoSelectFirst: true });
    } catch (error) {
      if (previewWindow && !previewWindow.closed) {
        previewWindow.close();
      }
      toast.error(error instanceof Error ? error.message : "Failed to create draft invoice");
    } finally {
      setCreatingDraft(false);
    }
  }

  async function issueInvoice(allowDuplicateActiveInvoice = false) {
    if (!invoiceDetail) return;
    setProcessingAction(true);
    try {
      const duplicateIssueOverrideEnabled = allowDuplicateInvoiceIssueOverride();
      const idempotencyKey = generateIdempotencyKey("invoice.issue");
      const res = await fetch(`/api/invoices/${invoiceDetail.invoice.id}/issue`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          allowDuplicateActiveInvoice:
            duplicateIssueOverrideEnabled && allowDuplicateActiveInvoice,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (
          duplicateIssueOverrideEnabled &&
          res.status === 409 &&
          data?.error === "Some transactions already exist in an active invoice" &&
          !allowDuplicateActiveInvoice
        ) {
          const conflicts: Array<{
            invoiceId: number;
            invoiceNo?: string | null;
          }> = Array.isArray(data?.conflicts) ? data.conflicts : [];
          const conflictSummary = Array.from(
            new Set(
              conflicts.map((conflict) =>
                conflict?.invoiceNo
                  ? `${conflict.invoiceNo} (invoice #${conflict.invoiceId})`
                  : `invoice #${conflict.invoiceId}`
              )
            )
          );
          const detailText =
            conflictSummary.length > 0
              ? `รายการนี้มีอยู่ในใบวางบิลที่ออกแล้ว: ${conflictSummary.join(", ")}`
              : "รายการนี้มีอยู่ในใบวางบิลที่ออกแล้ว";
          const confirmed = window.confirm(
            `${detailText}\n\nหากยืนยัน ระบบจะออกใบวางบิลนี้ต่อแม้มีรายการซ้ำกับใบก่อนหน้า`
          );
          if (confirmed) {
            await issueInvoice(true);
          }
          return;
        }
        throw new Error(data?.error || "issue_failed");
      }
      toast.success("Invoice marked as sent");
      await loadInvoice(invoiceDetail.invoice.id);
      await loadNavigator({ append: false, offset: 0, preferId: invoiceDetail.invoice.id, autoSelectFirst: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to issue invoice");
    } finally {
      setProcessingAction(false);
    }
  }

  async function payInvoice(amount: number) {
    if (!invoiceDetail) return;
    setProcessingAction(true);
    try {
      const idempotencyKey = generateIdempotencyKey("invoice.pay");
      const res = await fetch(`/api/invoices/${invoiceDetail.invoice.id}/pay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          amount,
          method: paymentMethod,
          note: "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "pay_failed");
      toast.success("Payment recorded");
      await loadInvoice(invoiceDetail.invoice.id);
      await loadNavigator({ append: false, offset: 0, preferId: invoiceDetail.invoice.id, autoSelectFirst: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to record payment");
    } finally {
      setProcessingAction(false);
    }
  }

  async function voidInvoice() {
    if (!invoiceDetail) return;
    const reason = window.prompt("Void reason:");
    if (!reason || !reason.trim()) return;

    setProcessingAction(true);
    try {
      const idempotencyKey = generateIdempotencyKey("invoice.void");
      const res = await fetch(`/api/invoices/${invoiceDetail.invoice.id}/void`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "void_failed");
      toast.success("Invoice voided");
      await loadInvoice(invoiceDetail.invoice.id);
      await loadNavigator({ append: false, offset: 0, preferId: invoiceDetail.invoice.id, autoSelectFirst: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to void invoice");
    } finally {
      setProcessingAction(false);
    }
  }

  function applyNavigatorFilters() {
    setAppliedNavQuery(navQuery);
    setAppliedNavStatus(navStatus);
    setAppliedNavDateFrom(navDateFrom);
    setAppliedNavDateTo(navDateTo);
  }

  function resetNavigatorFilters() {
    setNavQuery("");
    setNavStatus("all");
    setNavDateFrom("");
    setNavDateTo("");
    setAppliedNavQuery("");
    setAppliedNavStatus("all");
    setAppliedNavDateFrom("");
    setAppliedNavDateTo("");
  }

  const loadBearingDiscountReport = useCallback(async () => {
    if (!bearingDiscountStartDate || !bearingDiscountEndDate || bearingDiscountStartDate > bearingDiscountEndDate) {
      toast.error("Invalid date range");
      return;
    }

    setLoadingBearingDiscounts(true);
    try {
      const params = new URLSearchParams({
        startDate: bearingDiscountStartDate,
        endDate: bearingDiscountEndDate,
      });
      const res = await fetch(`/api/invoices/bearing-discounts?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "load_bearing_discounts_failed");
      }
      setBearingDiscountReport(data as BearingDiscountReportResponse);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load Bearing discounts");
      setBearingDiscountReport(null);
    } finally {
      setLoadingBearingDiscounts(false);
    }
  }, [bearingDiscountStartDate, bearingDiscountEndDate]);

  useEffect(() => {
    if (activeTab !== "bearingDiscounts" || !showBearingDiscountsTab) return;
    void loadBearingDiscountReport();
  }, [activeTab, showBearingDiscountsTab, loadBearingDiscountReport]);

  function openGeneratedInvoicePdf(invoiceId: number) {
    toast.info("ใช้คำสั่ง Save as PDF ในหน้าพิมพ์เพื่อสร้างไฟล์ PDF");
    window.open(`/print/invoice/generated/${invoiceId}`, "_blank");
  }

  const canIssueSelectedInvoice = invoiceDetail?.invoice.status === "draft";
  const canPaySelectedInvoice = Boolean(
    invoiceDetail &&
      invoiceDetail.invoice.status !== "void" &&
      invoiceDetail.invoice.outstandingTotal > 0
  );
  const selectedPaymentAmount = invoiceDetail
    ? Number(paymentAmount) > 0
      ? Number(paymentAmount)
      : invoiceDetail.invoice.outstandingTotal
    : 0;
  const sentStepActive = Boolean(
    invoiceDetail &&
      invoiceDetail.invoice.status !== "draft" &&
      invoiceDetail.invoice.status !== "void"
  );
  const paidStepActive = Boolean(
    invoiceDetail &&
      invoiceDetail.invoice.status !== "void" &&
      invoiceDetail.invoice.outstandingTotal <= 0
  );

  return (
    <div className="w-full max-w-none space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-gray-900 ui-scale-page-title">วางบิล</h1>
          <Badge variant="outline">แยกรายการพร้อมสถานะเอกสาร</Badge>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b pb-2">
        <Button
          type="button"
          variant={activeTab === "generated" ? "default" : "outline"}
          onClick={() => setActiveTab("generated")}
        >
          ใบวางบิลที่สร้างแล้ว
        </Button>
        <Button
          type="button"
          variant={activeTab === "new" ? "default" : "outline"}
          onClick={() => setActiveTab("new")}
        >
          สร้างใบวางบิล
        </Button>
        <Button
          type="button"
          variant={activeTab === "credit" ? "default" : "outline"}
          onClick={() => setActiveTab("credit")}
        >
          {SHORT_TERM_CREDIT_LABEL}
        </Button>
        <Button
          type="button"
          variant={activeTab === "transfers" ? "default" : "outline"}
          onClick={() => setActiveTab("transfers")}
        >
          {INVOICE_CREDIT_LABEL}
        </Button>
        {showBearingDiscountsTab && (
          <Button
            type="button"
            variant={activeTab === "bearingDiscounts" ? "default" : "outline"}
            onClick={() => setActiveTab("bearingDiscounts")}
          >
            Bearing Discounts
          </Button>
        )}
      </div>

      {activeTab === "generated" ? (
        <div className="space-y-4">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="space-y-4 pb-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="space-y-1">
                  <CardTitle className="text-xl font-semibold text-gray-900 ui-scale-section-title">
                    รายการใบวางบิลทั้งหมด
                  </CardTitle>
                  <p className="text-sm text-gray-500">
                    ตารางด้านบนใช้เลือกใบวางบิล ส่วนแผงด้านล่างใช้ติดตามสถานะและจัดการเอกสาร
                  </p>
                </div>
                <Button type="button" onClick={() => setActiveTab("new")}>
                  สร้างใบวางบิล
                </Button>
              </div>

              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 p-4">
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                        ค้นหา
                      </Label>
                      <Input
                        className="h-10 border-gray-200 bg-white shadow-none"
                        placeholder="ค้นหาเลขที่ใบวางบิล ชื่อลูกค้า หรือ #101, #102"
                        value={navQuery}
                        onChange={(e) => setNavQuery(e.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            applyNavigatorFilters();
                          }
                        }}
                      />
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {NAV_STATUS_OPTIONS.map((option) => (
                        <Button
                          key={option.key}
                          type="button"
                          variant={navStatus === option.key ? "secondary" : "ghost"}
                          size="sm"
                          className={`h-8 rounded-full px-3 text-xs ${
                            navStatus === option.key
                              ? "border border-gray-200 bg-white text-gray-900 shadow-sm"
                              : "text-gray-500 hover:text-gray-900"
                          }`}
                          onClick={() => {
                            setNavStatus(option.key);
                            setAppliedNavStatus(option.key);
                          }}
                        >
                          {option.label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label className="text-[11px] font-medium text-gray-500">จากวันที่</Label>
                      <Input
                        className="mt-1 h-10 border-gray-200 bg-white shadow-none"
                        type="date"
                        value={navDateFrom}
                        onChange={(e) => setNavDateFrom(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label className="text-[11px] font-medium text-gray-500">ถึงวันที่</Label>
                      <Input
                        className="mt-1 h-10 border-gray-200 bg-white shadow-none"
                        type="date"
                        value={navDateTo}
                        onChange={(e) => setNavDateTo(e.target.value)}
                      />
                    </div>
                    <div className="sm:col-span-2 flex items-center justify-end gap-2 pt-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs text-gray-600"
                        onClick={resetNavigatorFilters}
                      >
                        ล้างค่า
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 px-3 text-xs bg-white"
                        onClick={applyNavigatorFilters}
                      >
                        ใช้งาน
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-gray-500 ui-scale-body">
                <span>แสดง {invoiceRows.length} / {invoiceMeta.total}</span>
                {loadingNavigator && <span>กำลังโหลด...</span>}
              </div>
            </CardHeader>

            <CardContent className="pt-0">
              <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
                <div className="max-h-[44vh] overflow-auto">
                  <Table className="min-w-[1040px]">
                    <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur supports-[backdrop-filter]:bg-slate-50/80">
                      <TableRow className="border-b border-gray-200 hover:bg-transparent">
                        <TableHead className="h-11 px-4 text-[11px] uppercase tracking-wide text-gray-500">Invoice No.</TableHead>
                        <TableHead className="h-11 px-4 text-[11px] uppercase tracking-wide text-gray-500">Customer</TableHead>
                        <TableHead className="h-11 px-4 text-[11px] uppercase tracking-wide text-gray-500">Billing Period</TableHead>
                        <TableHead className="h-11 px-4 text-[11px] uppercase tracking-wide text-gray-500">Status</TableHead>
                        <TableHead className="h-11 px-4 text-right text-[11px] uppercase tracking-wide text-gray-500">Total</TableHead>
                        <TableHead className="h-11 px-4 text-right text-[11px] uppercase tracking-wide text-gray-500">Paid</TableHead>
                        <TableHead className="h-11 px-4 text-right text-[11px] uppercase tracking-wide text-gray-500">Outstanding</TableHead>
                        <TableHead className="h-11 px-4 text-[11px] uppercase tracking-wide text-gray-500">Issue Date</TableHead>
                        <TableHead className="h-11 px-4 text-[11px] uppercase tracking-wide text-gray-500">Updated</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {!loadingNavigator && invoiceRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={9} className="px-4 py-8 text-center text-sm text-gray-500">
                            ไม่พบใบวางบิลตามเงื่อนไขที่เลือก
                          </TableCell>
                        </TableRow>
                      ) : (
                        invoiceRows.map((row) => {
                          const isActive = row.id === activeInvoiceId;
                          return (
                            <TableRow
                              key={row.id}
                              data-state={isActive ? "selected" : undefined}
                              aria-selected={isActive}
                              className={`cursor-pointer border-b border-gray-100 ${
                                isActive
                                  ? "bg-blue-50/80 ring-1 ring-inset ring-blue-200"
                                  : "bg-white hover:bg-slate-50"
                              }`}
                              onClick={() => void loadInvoice(row.id)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  void loadInvoice(row.id);
                                }
                              }}
                              tabIndex={0}
                            >
                              <TableCell className="px-4 py-3">
                                <div className="font-semibold text-gray-900">
                                  {row.invoiceNo || `Draft #${row.id}`}
                                </div>
                                <div className="mt-1 text-xs text-gray-500">ลูกค้า #{row.customerId}</div>
                              </TableCell>
                              <TableCell className="px-4 py-3">
                                <div className="font-medium text-gray-900">{row.customerName}</div>
                              </TableCell>
                              <TableCell className="px-4 py-3 text-sm text-gray-600">
                                {formatThaiDate(row.periodStart)} - {formatThaiDate(row.periodEnd)}
                              </TableCell>
                              <TableCell className="px-4 py-3">
                                <div className="flex flex-wrap gap-2">
                                  {statusBadge(row.displayStatus)}
                                </div>
                              </TableCell>
                              <TableCell className="px-4 py-3 text-right font-semibold text-gray-900">
                                {formatCurrency(row.grandTotal)}
                              </TableCell>
                              <TableCell className="px-4 py-3 text-right text-gray-700">
                                {formatCurrency(row.paidTotal)}
                              </TableCell>
                              <TableCell className={`px-4 py-3 text-right font-semibold ${
                                row.outstandingTotal > 0 ? "text-red-600" : "text-gray-900"
                              }`}>
                                {formatCurrency(row.outstandingTotal)}
                              </TableCell>
                              <TableCell className="px-4 py-3 text-sm text-gray-600">
                                {row.issueDate ? formatThaiDate(row.issueDate) : "-"}
                              </TableCell>
                              <TableCell className="px-4 py-3 text-sm text-gray-600">
                                {formatDateTime(row.updatedAt)}
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {invoiceMeta.hasMore && (
                <div className="mt-4">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={loadingMoreNavigator}
                    onClick={() =>
                      void loadNavigator({
                        append: true,
                        offset: invoiceRows.length,
                        autoSelectFirst: false,
                      })
                    }
                  >
                    {loadingMoreNavigator ? "กำลังโหลด..." : "โหลดเพิ่ม"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm lg:sticky lg:bottom-3">
            <CardContent className="p-2.5 md:p-3">
              {!invoiceDetail ? (
                <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-500">
                  เลือกใบวางบิลจากตารางด้านบนเพื่อดู workflow สรุปข้อมูล และปุ่มจัดการ
                </div>
              ) : (
                <div className="grid gap-2.5 xl:grid-cols-[200px_minmax(0,1fr)_300px]">
                  <section className="rounded-lg border border-slate-200 bg-slate-50/85 p-2.5">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-gray-900">Workflow</p>
                      <p className="text-[11px] leading-4 text-gray-500">
                        ปุ่มหลักสำหรับเลื่อนใบวางบิลจาก draft ไป sent และ paid
                      </p>
                    </div>

                    <div className="mt-2.5 grid gap-2">
                      <Button
                        type="button"
                        variant={invoiceDetail.invoice.status === "draft" ? "default" : "outline"}
                        className={`h-auto min-h-12 justify-between rounded-lg px-3 py-2 text-left ${
                          invoiceDetail.invoice.status === "draft"
                            ? "bg-slate-900 text-white hover:bg-slate-900"
                            : "border-slate-200 bg-white text-slate-700"
                        } pointer-events-none`}
                      >
                        <span>
                          <span className="block text-sm font-semibold">Draft</span>
                          <span className="mt-1 block text-xs opacity-80">พร้อมแก้ไขรายการ</span>
                        </span>
                        <span className="text-xs uppercase tracking-wide opacity-80">
                          {invoiceDetail.invoice.status === "draft" ? "Current" : "Saved"}
                        </span>
                      </Button>

                      <Button
                        type="button"
                        variant={sentStepActive ? "default" : "outline"}
                        className={`h-auto min-h-12 justify-between rounded-lg px-3 py-2 text-left ${
                          sentStepActive
                            ? "bg-blue-600 text-white hover:bg-blue-600"
                            : "border-blue-200 bg-white text-blue-700 hover:bg-blue-50"
                        }`}
                        onClick={() => void issueInvoice()}
                        disabled={!canIssueSelectedInvoice || processingAction}
                      >
                        <span>
                          <span className="block text-sm font-semibold">Sent</span>
                          <span className="mt-1 block text-xs opacity-80">ส่งใบวางบิลให้ลูกค้า</span>
                        </span>
                        <span className="text-xs uppercase tracking-wide opacity-80">
                          {canIssueSelectedInvoice ? "Ready" : sentStepActive ? "Done" : "Locked"}
                        </span>
                      </Button>

                      <Button
                        type="button"
                        variant={paidStepActive ? "default" : "outline"}
                        className={`h-auto min-h-12 justify-between rounded-lg px-3 py-2 text-left ${
                          paidStepActive
                            ? "bg-emerald-600 text-white hover:bg-emerald-600"
                            : "border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50"
                        }`}
                        onClick={() => void payInvoice(selectedPaymentAmount)}
                        disabled={!canPaySelectedInvoice || processingAction}
                      >
                        <span>
                          <span className="block text-sm font-semibold">Paid</span>
                          <span className="mt-1 block text-xs opacity-80">บันทึกการชำระทันที</span>
                        </span>
                        <span className="text-xs uppercase tracking-wide opacity-80">
                          {paidStepActive ? "Done" : canPaySelectedInvoice ? "Pay now" : "Closed"}
                        </span>
                      </Button>
                    </div>
                  </section>

                  <section className="rounded-lg border border-gray-200 bg-white p-2.5 min-w-0">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {statusBadge(invoiceDetail.invoice.displayStatus)}
                          {paymentStatusBadge(invoiceDetail.invoice)}
                        </div>
                        <p className="text-[11px] text-gray-500">ข้อมูลหลักของใบวางบิลที่เลือกอยู่ตอนนี้</p>
                      </div>
                      <div className="text-left sm:text-right">
                        <p className="text-xs uppercase tracking-wide text-gray-500">ยอดรวมสุทธิ</p>
                        <p className="mt-1 text-2xl font-semibold text-gray-950 xl:text-3xl">
                          {formatCurrency(invoiceDetail.invoice.grandTotal)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-2.5 rounded-lg border border-gray-200 bg-gray-50/70 p-2.5">
                      <div className="grid gap-2 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.8fr)_minmax(0,1.4fr)] md:items-start">
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-gray-500">Invoice</p>
                          <p className="mt-1.5 text-base font-semibold text-gray-900">
                            {invoiceDetail.invoice.invoiceNo || `Draft #${invoiceDetail.invoice.id}`}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-gray-500">Customer</p>
                          <p className="mt-1.5 text-base font-semibold leading-snug text-gray-900">
                            {invoiceDetail.customer
                              ? formatCustomerDisplay(
                                  invoiceDetail.customer.id,
                                  invoiceDetail.customer.name,
                                  showCustomerIdWithName
                                )
                            : "-"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-gray-500">Billing Period</p>
                          <p className="mt-1.5 text-base font-semibold text-gray-900">
                            {formatThaiDate(invoiceDetail.invoice.periodStart)} - {formatThaiDate(invoiceDetail.invoice.periodEnd)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-2.5 grid gap-2.5 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.95fr)] lg:items-stretch">
                      <div className="space-y-2">
                        <div className="grid gap-2 md:grid-cols-[132px_minmax(0,1fr)_140px] md:items-center">
                          <Label className="text-[11px] font-medium uppercase tracking-wide text-gray-500 md:pb-0.5">
                            จำนวนเงินที่ชำระ
                          </Label>
                          <Input
                            className="h-12 rounded-lg border-gray-200 bg-white shadow-none"
                            type="number"
                            min={0}
                            step={0.01}
                            value={paymentAmount}
                            onChange={(e) => setPaymentAmount(e.target.value)}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            className="h-12 rounded-lg border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                            onClick={() => void payInvoice(selectedPaymentAmount)}
                            disabled={!canPaySelectedInvoice || processingAction}
                          >
                            Paid
                          </Button>
                        </div>
                        <div className="grid gap-2 md:grid-cols-[132px_minmax(0,1fr)] md:items-center">
                          <Label className="text-[11px] font-medium uppercase tracking-wide text-gray-500 md:pb-0.5">
                            วิธีชำระเงิน
                          </Label>
                          <select
                            className="h-12 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm shadow-none"
                            value={paymentMethod}
                            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                          >
                            <option value="cash">เงินสด</option>
                            <option value="bank_transfer">โอนเงิน</option>
                            <option value="cheque">เช็ค</option>
                            <option value="other">อื่นๆ</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid h-full gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
                        <div className={`grid h-full gap-2 ${invoiceDetail.invoice.status === "draft" && invoiceDetail.customer ? "sm:grid-cols-2" : "grid-cols-1"}`}>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-full min-h-[5.5rem] justify-start rounded-lg bg-white px-4 text-left"
                            onClick={() => openGeneratedInvoicePdf(invoiceDetail.invoice.id)}
                          >
                            พิมพ์ / PDF
                          </Button>
                          {invoiceDetail.invoice.status === "draft" && invoiceDetail.customer && (
                            <Button
                              type="button"
                              variant="outline"
                              className="h-full min-h-[5.5rem] justify-start rounded-lg bg-white px-4 text-left"
                              onClick={launchSaleFromDraftInvoice}
                            >
                              เพิ่มรายการ
                            </Button>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-full min-h-[5.5rem] rounded-lg border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700"
                          onClick={() => void voidInvoice()}
                          disabled={invoiceDetail.invoice.status === "void" || processingAction}
                        >
                          ยกเลิก
                        </Button>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-lg border border-gray-200 bg-slate-50/80 p-2.5">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-gray-900">Recent Activity</p>
                      <p className="text-[11px] leading-4 text-gray-500">
                        สรุปเหตุการณ์ล่าสุดของเอกสารนี้
                      </p>
                    </div>

                    <div className="mt-2.5 flex items-center justify-between gap-3">
                      <div className="flex flex-wrap gap-2">
                        {statusBadge(invoiceDetail.invoice.displayStatus)}
                        {paymentStatusBadge(invoiceDetail.invoice)}
                      </div>
                      <span className="text-[11px] uppercase tracking-wide text-gray-400">
                        {invoiceDetail.timeline.length} รายการ
                      </span>
                    </div>

                    <div className="mt-2.5 space-y-2">
                      {invoiceDetail.timeline.slice(0, 4).map((event, idx) => (
                        <div
                          key={`${event.event}-${idx}`}
                          className="rounded-lg border border-white/80 bg-white px-2.5 py-1.5"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900">{event.event}</p>
                              <p className="text-xs text-gray-500">
                                {formatTimelineUser(event)} • {formatDateTime(event.at)}
                              </p>
                            </div>
                            <p className="max-w-[40%] text-right text-sm text-gray-600">
                              {event.detail || "-"}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : activeTab === "new" ? (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base ui-scale-section-title">ตัวกรองการสร้างใบวางบิล</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-2 relative">
                  <Label className="text-xs ui-scale-label">ลูกค้า</Label>
                  <Input
                    placeholder="ค้นหาชื่อลูกค้าหรือ #id"
                    value={customerQuery}
                    onChange={(e) => {
                      setCustomerQuery(e.target.value);
                      setSelectedCustomer(null);
                    }}
                  />
                  {customerOptions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-white border rounded-md shadow z-10 max-h-64 overflow-auto">
                      {customerOptions.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                          onClick={() => {
                            setSelectedCustomer(c);
                            setCustomerQuery(c.name);
                            setCustomerOptions([]);
                          }}
                        >
                          {c.name} <span className="text-gray-500">#{c.id}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <Label className="text-xs ui-scale-label">Start Date</Label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs ui-scale-label">End Date</Label>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                {BILL_KIND_OPTIONS.map((kind) => (
                  <label key={kind.key} className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={kindFilter[kind.key]}
                      onChange={(e) =>
                        setKindFilter((prev) => ({ ...prev, [kind.key]: e.target.checked }))
                      }
                    />
                    {kind.label}
                  </label>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => setKindFilter(DEFAULT_KIND_FILTER)}>
                  Select All Types
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={vatEnabled} onChange={(e) => setVatEnabled(e.target.checked)} />
                  VAT (+7%)
                </label>
                <span className="text-sm text-gray-500">When enabled, invoice total = subtotal + 7% VAT.</span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void loadPreview()} disabled={loadingPreview}>
                  {loadingPreview ? "Loading..." : "Preview"}
                </Button>
                {selectedCustomer && (
                  <Badge variant="secondary">
                    {selectedCustomer.name} #{selectedCustomer.id}
                  </Badge>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSelectedTransactionIds(new Set(preview?.rows.map((r) => r.transactionId) || []))}
                  disabled={!preview}
                >
                  Select All Rows
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSelectedTransactionIds(new Set())}
                  disabled={!preview}
                >
                  Clear Selection
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => launchSaleFromComposer({ useAnchor: Boolean(selectedAnchorRow) })}
                  disabled={!preview || !selectedCustomer || !backdatedInsertState.canLaunch}
                >
                  เพิ่มรายการย้อนหลัง
                </Button>
                <Button onClick={() => void createDraftInvoice()} disabled={!preview || creatingDraft}>
                  {creatingDraft ? "Generating Preview..." : "Generate Draft + Print Preview"}
                </Button>
              </div>
              {selectedAnchorRow && (
                <p className="text-sm text-gray-600">
                  แทรกหลังรายการ #{selectedAnchorRow.transactionId} วันที่ {selectedAnchorRow.saleDate} เวลา{" "}
                  {formatTime(selectedAnchorRow.saleTime)}
                </p>
              )}
              {backdatedInsertState.isBackdatedTarget && !isAdmin && (
                <p className="text-sm text-gray-600">
                  การเพิ่มรายการย้อนหลังจากหน้าวางบิลใช้สิทธิ์ admin เท่านั้น
                </p>
              )}
            </CardContent>
          </Card>

          {preview && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-9 gap-3">
                <Card><CardContent className="p-3"><p className="text-xs text-gray-500 ui-scale-summary-label">รายการที่เลือก</p><p className="text-lg font-bold ui-scale-summary-value">{selectedTotals.rowCount}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs text-gray-500 ui-scale-summary-label">ขาย</p><p className="text-lg font-bold ui-scale-summary-value">{selectedTotals.kindCounts.sale}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs text-gray-500 ui-scale-summary-label">คืน</p><p className="text-lg font-bold ui-scale-summary-value">{selectedTotals.kindCounts.return}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs text-gray-500 ui-scale-summary-label">{INVOICE_CREDIT_LABEL}</p><p className="text-lg font-bold ui-scale-summary-value">{selectedTotals.kindCounts.transfer_out}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs text-gray-500 ui-scale-summary-label">ยอดเครดิต</p><p className="text-lg font-bold text-red-600 ui-scale-summary-value">{formatCurrency(selectedTotals.totalCreditOwed)}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs text-gray-500 ui-scale-summary-label">เครดิตฝั่งคืน</p><p className="text-lg font-bold text-indigo-700 ui-scale-summary-value">{formatCurrency(selectedTotals.totalRefundBalance)}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs text-gray-500 ui-scale-summary-label">ยอดก่อนภาษี</p><p className="text-lg font-bold text-blue-700 ui-scale-summary-value">{formatCurrency(selectedTotals.totalSum)}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs text-gray-500 ui-scale-summary-label">VAT 7%</p><p className="text-lg font-bold text-amber-700 ui-scale-summary-value">{formatCurrency(selectedVatAmount)}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs text-gray-500 ui-scale-summary-label">ยอดรวมสุทธิ</p><p className="text-lg font-bold text-emerald-700 ui-scale-summary-value">{formatCurrency(selectedGrandTotal)}</p></CardContent></Card>
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base ui-scale-section-title">ตัวอย่างแยกรายการ</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse ui-scale-bill-table">
                      <thead>
                        <tr className="border-b">
                          <th className="py-2 px-1 text-center">แทรกหลัง</th>
                          <th className="py-2 px-1 text-center">✓</th>
                          <th className="py-2 px-1 text-left">ลูกค้า</th>
                          <th className="py-2 px-1 text-left">เวลา</th>
                          <th className="py-2 px-1 text-center">ที่โหลด</th>
                          {preview.productColumns.map((col) => (
                            <th key={col.id} className="py-2 px-1 text-center whitespace-nowrap">{col.name}</th>
                          ))}
                          <th className="py-2 px-1 text-center">ถุงออก</th>
                          <th className="py-2 px-1 text-center">คืนถุง</th>
                          <th className="py-2 px-1 text-center">สถานะ</th>
                          <th className="py-2 px-1 text-right">เงินสดรับ</th>
                          <th className="py-2 px-1 text-right">ยอดเครดิต</th>
                          <th className="py-2 px-1 text-right">เครดิตฝั่งคืน</th>
                          <th className="py-2 px-1 text-right">รวม</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((row) => {
                          const selected = selectedTransactionIds.has(row.transactionId);
                          const anchored = selectedAnchorTransactionId === row.transactionId;
                          const bagDisplay = getBagDisplayQuantities(row);
                          return (
                            <tr
                              key={row.transactionId}
                              className={`border-b ${anchored ? "bg-blue-50/70" : ""}`}
                            >
                              <td className="py-1 px-1 text-center">
                                <button
                                  type="button"
                                  className={`inline-flex h-7 min-w-7 items-center justify-center rounded border px-2 text-xs ${
                                    anchored
                                      ? "border-blue-500 bg-blue-600 text-white"
                                      : "border-gray-300 bg-white text-gray-700"
                                  }`}
                                  onClick={() =>
                                    setSelectedAnchorTransactionId((prev) =>
                                      prev === row.transactionId ? null : row.transactionId
                                    )
                                  }
                                >
                                  {anchored ? "เลือก" : "แทรก"}
                                </button>
                              </td>
                              <td className="py-1 px-1 text-center">
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={(e) => {
                                    setSelectedTransactionIds((prev) => {
                                      const next = new Set(prev);
                                      if (e.target.checked) next.add(row.transactionId);
                                      else next.delete(row.transactionId);
                                      return next;
                                    });
                                  }}
                                />
                              </td>
                              <td className="py-1 px-1 whitespace-nowrap">
                                {formatCustomerDisplay(
                                  preview.customer.id,
                                  row.customerName,
                                  showCustomerIdWithName
                                )}
                              </td>
                              <td className="py-1 px-1 whitespace-nowrap">{row.saleDate} {formatTime(row.saleTime)}</td>
                              <td className="py-1 px-1 text-center">{row.location}</td>
                              {preview.productColumns.map((col) => (
                                <td key={col.id} className="py-1 px-1 text-center">{row.quantities[col.id] || ""}</td>
                              ))}
                              <td className="py-1 px-1 text-center">{bagDisplay.bagsOut || ""}</td>
                              <td className="py-1 px-1 text-center">{bagDisplay.bagsReturned || ""}</td>
                              <td className="py-1 px-1 text-center">
                                <span className="text-xs">{row.transactionStatus}</span>
                              </td>
                              <td className="py-1 px-1 text-right">{formatCurrency(row.cashPaid)}</td>
                              <td className="py-1 px-1 text-right">{formatCurrency(row.creditOwed)}</td>
                              <td className="py-1 px-1 text-right">{row.refundBalance > 0 ? formatCurrency(row.refundBalance) : "-"}</td>
                              <td className="py-1 px-1 text-right">{formatCurrency(row.sumTotal)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 font-semibold bg-gray-50">
                          <td className="py-2 px-1"></td>
                          <td className="py-2 px-1" colSpan={4}>
                            Totals ({selectedTotals.rowCount})
                          </td>
                          {preview.productColumns.map((col) => (
                            <td key={col.id} className="py-2 px-1 text-center">{selectedTotals.totalsByProduct[col.id] || ""}</td>
                          ))}
                          <td className="py-2 px-1 text-center">{selectedTotals.totalBagsOut || ""}</td>
                          <td className="py-2 px-1 text-center">{selectedTotals.totalBagsReturned || ""}</td>
                          <td className="py-2 px-1"></td>
                          <td className="py-2 px-1 text-right">{formatCurrency(selectedTotals.totalCashPaid)}</td>
                          <td className="py-2 px-1 text-right">{formatCurrency(selectedTotals.totalCreditOwed)}</td>
                          <td className="py-2 px-1 text-right">{formatCurrency(selectedTotals.totalRefundBalance)}</td>
                          <td className="py-2 px-1 text-right">{formatCurrency(selectedTotals.totalSum)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      ) : activeTab === "bearingDiscounts" ? (
        <div className="space-y-4 pt-1">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base ui-scale-section-title">Bearing Discounts</CardTitle>
              <p className="text-sm text-gray-500">
                Exact discounts recorded from new Bearing sales. Historical bills before this feature are not included.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <Label className="text-xs ui-scale-label">Start Date</Label>
                  <Input
                    type="date"
                    value={bearingDiscountStartDate}
                    onChange={(e) => setBearingDiscountStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs ui-scale-label">End Date</Label>
                  <Input
                    type="date"
                    value={bearingDiscountEndDate}
                    onChange={(e) => setBearingDiscountEndDate(e.target.value)}
                  />
                </div>
                <Button type="button" onClick={() => void loadBearingDiscountReport()} disabled={loadingBearingDiscounts}>
                  {loadingBearingDiscounts ? "Loading..." : "Load Discounts"}
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Card><CardContent className="p-3"><p className="text-xs text-gray-500 ui-scale-summary-label">Bills</p><p className="text-lg font-bold ui-scale-summary-value">{bearingDiscountReport?.rowCount || 0}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs text-gray-500 ui-scale-summary-label">Total Discounts</p><p className="text-lg font-bold text-emerald-700 ui-scale-summary-value">{formatCurrency(bearingDiscountReport?.grandTotalDiscount || 0)}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs text-gray-500 ui-scale-summary-label">Date Range</p><p className="text-lg font-bold ui-scale-summary-value">{formatThaiDate(bearingDiscountStartDate)} - {formatThaiDate(bearingDiscountEndDate)}</p></CardContent></Card>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base ui-scale-section-title">Daily Discount Totals</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse ui-scale-bill-table">
                  <thead>
                    <tr className="border-b">
                      <th className="py-2 px-1 text-left">Date</th>
                      <th className="py-2 px-1 text-right">Bills</th>
                      <th className="py-2 px-1 text-right">Discount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(bearingDiscountReport?.dailyTotals || []).map((row) => (
                      <tr key={row.saleDate} className="border-b">
                        <td className="py-2 px-1">{formatThaiDate(row.saleDate)}</td>
                        <td className="py-2 px-1 text-right">{row.rowCount}</td>
                        <td className="py-2 px-1 text-right font-semibold text-emerald-700">{formatCurrency(row.discountAmount)}</td>
                      </tr>
                    ))}
                    {bearingDiscountReport && bearingDiscountReport.dailyTotals.length === 0 && (
                      <tr>
                        <td className="py-4 px-1 text-sm text-gray-500" colSpan={3}>
                          No Bearing discounts found for this date range.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base ui-scale-section-title">Discounted Bills</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse ui-scale-bill-table">
                  <thead>
                    <tr className="border-b">
                      <th className="py-2 px-1 text-left">Bill</th>
                      <th className="py-2 px-1 text-left">Customer</th>
                      <th className="py-2 px-1 text-left">Original Bill Date</th>
                      <th className="py-2 px-1 text-right">Original Price</th>
                      <th className="py-2 px-1 text-right">Discount</th>
                      <th className="py-2 px-1 text-right">Final Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(bearingDiscountReport?.rows || []).map((row) => (
                      <tr key={row.transactionId} className="border-b">
                        <td className="py-2 px-1 font-medium">{row.billNumber}</td>
                        <td className="py-2 px-1">
                          {row.customerName
                            ? formatCustomerDisplay(row.customerId, row.customerName, showCustomerIdWithName)
                            : row.customerId
                              ? `#${row.customerId}`
                              : "-"}
                        </td>
                        <td className="py-2 px-1 whitespace-nowrap">
                          {formatThaiDate(row.saleDate)} {row.saleTime ? formatTime(row.saleTime) : ""}
                        </td>
                        <td className="py-2 px-1 text-right">{formatCurrency(row.originalSubtotal)}</td>
                        <td className="py-2 px-1 text-right font-semibold text-emerald-700">{formatCurrency(row.discountAmount)}</td>
                        <td className="py-2 px-1 text-right">{formatCurrency(row.finalSubtotal)}</td>
                      </tr>
                    ))}
                    {bearingDiscountReport && bearingDiscountReport.rows.length === 0 && (
                      <tr>
                        <td className="py-4 px-1 text-sm text-gray-500" colSpan={6}>
                          No discounted bills found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : activeTab === "credit" ? (
        <div className="pt-1">
          <CreditPage />
        </div>
      ) : (
        <div className="pt-1">
          <TransfersPage />
        </div>
      )}
    </div>
  );
}
