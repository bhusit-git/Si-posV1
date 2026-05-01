"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, formatThaiDate, todayISO } from "@/lib/thai-utils";
import { toast } from "sonner";
import { PrintedBillCounter } from "@/components/printed-bill-counter";
import type {
  ProductType,
  Customer,
  SaleItem,
  TransactionWarning,
} from "@/lib/types";
import {
  cacheCustomers,
  getCachedCustomers,
  cacheCustomerPrices,
  getCachedCustomerPrices,
  type CachedCustomerPrice,
} from "@/lib/offline-store";
import {
  queueSale,
  getPendingCount,
  onPendingCountChange,
  startAutoSync,
  syncAll,
  generateClientId,
} from "@/lib/sync-engine";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TRANSFER_REF_REGEX } from "@/lib/transfer-utils";
import {
  getInvoiceCreditEligibilityState,
  isActiveInvoiceCreditCustomer,
} from "@/lib/invoice-credit-rollout";
import {
  buildBillRows,
  type SaleEntryViewMode,
} from "@/lib/sale-entry-view";
import {
  resolveEffectiveUnitPrice,
} from "@/lib/factory-profile";
import {
  INVOICE_CREDIT_LABEL,
  SHORT_TERM_CREDIT_LABEL,
  UNPAID_STATUS_LABEL,
} from "@/lib/customer-credit-labels";
import {
  analyticsSaleTypeThaiLabel,
  resolveAnalyticsSaleType,
  resolveSalePayment,
  type SalePaymentStatus,
} from "@/lib/sale-payment";
import {
  buildBagLedgerWrites,
  getBagBalanceFromEntries,
  summarizeSaleBagFlow,
} from "@/lib/bag-flow";
import {
  saveOfflinePrintPayload,
  type OfflinePrintPayload,
} from "@/lib/offline-print-payload";
import {
  clearPendingPrintedBillCounterUpdate,
  queuePendingPrintedBillCounterUpdate,
  readCachedPrintedBillCounter,
  readPendingPrintedBillCounterUpdate,
  writeCachedPrintedBillCounter,
} from "@/lib/printed-bill-counter-store";
import { openSalePrint, type SalePrintMode } from "@/lib/sale-print";
import { scheduleBackgroundTask } from "@/lib/client-scheduler";
import { setString } from "@/lib/client-safe-storage";
import {
  ensureOfflineReferenceCacheWarm,
  getOfflineReferenceCacheStatus,
} from "@/lib/offline-reference-cache";
import { applyFactorySalePricingPolicy } from "@/lib/sale-pricing-policy";
import {
  markSaleInteractive,
  markSaleReferenceReady,
  markSaleRouteMounted,
} from "@/lib/sale-readiness";
import {
  buildApiErrorDescription,
  buildClientDiagnostic,
  formatApiDiagnosticMeta,
  parseApiErrorResponse,
} from "@/lib/api-error-diagnostics";
import {
  buildDefaultTransferRef,
  buildInvoiceReturnUrl,
  getAvailableSaleEntryViewOptions,
  getBackdateMaxDate,
  getBangkokNowForPayload,
  isBuyBagProductName,
  isBillSlotProductName,
  isIsoDate,
  isIsoTime,
  isoDaysAgo,
  loadInitialPrintMode,
  loadInitialSaleEntryViewMode,
  normalizeSaleEntryViewModeForSession,
  normalizeTimeForApi,
  parseBagBalance,
  SALE_ENTRY_VIEW_MODE_KEY,
  sortProducts,
  type InvoiceReturnContext,
  withExactLine7ClientMarker,
  isTransferPresetProduct,
} from "./sale-page-utils";
import { incrementPrintedBillNumber } from "@/lib/bill-number";
import {
  markSaleContinuitySession,
  readSaleContinuitySession,
  readSaleContinuitySessionUser,
  resolveClientSaleFactoryKey,
} from "@/lib/sale-continuity";

const PendingSales = dynamic(() => import("@/components/pending-sales"), {
  loading: () => (
    <div className="min-h-10 rounded-md border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-400">
      Loading pending sales...
    </div>
  ),
});

const PwaInstallHint = dynamic(() => import("@/components/pwa-install-hint"), {
  loading: () => null,
});

interface TransactionPrecheckResponse {
  allowed: boolean;
  warnings: TransactionWarning[];
}

export default function SalePage() {
  const searchParams = useSearchParams();
  const [saleMode, setSaleMode] = useState<"sale" | "transfer_out">("sale");
  const [products, setProducts] = useState<ProductType[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedCustomerPrices, setSelectedCustomerPrices] = useState<CachedCustomerPrice[]>([]);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [bagReturnQty, setBagReturnQty] = useState(0);
  const [customerBagBalance, setCustomerBagBalance] = useState(0);
  const [loadingLocation, setLoadingLocation] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<SalePaymentStatus>("paid");
  const [partialPaidInput, setPartialPaidInput] = useState("");
  const [showCustomerList, setShowCustomerList] = useState(false);
  const [highlightedCustomerIndex, setHighlightedCustomerIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [lastSale, setLastSale] = useState<{ id: number; total: number; status: string; transactionType?: string; printToken?: string | null } | null>(null);
  const [addProductId, setAddProductId] = useState("");
  const [exactExtraProductId, setExactExtraProductId] = useState("");
  const [printMode, setPrintMode] = useState<SalePrintMode>(() => loadInitialPrintMode());
  const [saleEntryViewMode, setSaleEntryViewMode] = useState<SaleEntryViewMode>(() => loadInitialSaleEntryViewMode());
  const [hidePrintTotals, setHidePrintTotals] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [canSyncNow, setCanSyncNow] = useState(false);
  const [canSellLocally, setCanSellLocally] = useState(false);
  const [continuityWarning, setContinuityWarning] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [transferRef, setTransferRef] = useState(() =>
    buildDefaultTransferRef(getBangkokNowForPayload().saleDate)
  );
  const [sessionRole, setSessionRole] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return readSaleContinuitySession()?.role ?? null;
  });
  const [sessionFactoryKey, setSessionFactoryKey] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return resolveClientSaleFactoryKey();
  });
  const [nextBillNumber, setNextBillNumber] = useState<number | null>(null);
  const [loadingBillCounter, setLoadingBillCounter] = useState(false);
  const [savingBillCounter, setSavingBillCounter] = useState(false);
  const [backdatedEntry, setBackdatedEntry] = useState(false);
  const [backdateDate, setBackdateDate] = useState(() => getBangkokNowForPayload().saleDate);
  const [backdateTime, setBackdateTime] = useState(() => getBangkokNowForPayload().saleTime);
  const [backdateReason, setBackdateReason] = useState("");
  const [invoiceReturnContext, setInvoiceReturnContext] = useState<InvoiceReturnContext | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const invoicePrefillCustomerIdRef = useRef<number | null>(null);
  const highlightedCustomerRef = useRef<HTMLButtonElement>(null);
  const previousGrandTotalRef = useRef(0);
  const saleRouteMountedRef = useRef(false);
  const saleReferenceReadyRef = useRef(false);
  const saleInteractiveRef = useRef(false);
  const isAdmin = sessionRole === "admin";
  const saleAccessEnabled = canSyncNow || canSellLocally;
  const canUseEpsonPrintTools =
    sessionRole === "admin" || sessionRole === "office";

  // ---- Online/offline detection ----
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // ---- Auto-sync engine lifecycle ----
  useEffect(() => {
    const unsub = onPendingCountChange(setPendingCount);
    let stopSync = () => {};
    const cancelBackground = scheduleBackgroundTask(async () => {
      setPendingCount(await getPendingCount());
      stopSync = startAutoSync();
    }, 250);

    return () => {
      unsub();
      cancelBackground();
      stopSync();
    };
  }, []);

  // ---- Session role ----
  useEffect(() => {
    const cancel = scheduleBackgroundTask(async () => {
      const fallbackUser = readSaleContinuitySessionUser();
      const fallbackFactoryKey = resolveClientSaleFactoryKey();
      try {
        const [authResponse, factoryResponse] = await Promise.all([
          fetch("/api/auth"),
          fetch("/api/factory"),
        ]);
        const data = authResponse.ok ? await authResponse.json() : null;
        const factoryData = factoryResponse.ok ? await factoryResponse.json() : null;
        if (data && typeof data?.role === "string" && typeof data?.username === "string") {
          const nextFactoryKey =
            typeof data?.factoryKey === "string" && data.factoryKey.length > 0
              ? data.factoryKey
              : typeof factoryData?.current === "string" && factoryData.current.length > 0
                ? factoryData.current
                : resolveClientSaleFactoryKey();
          setSessionRole(data.role);
          setSessionFactoryKey(nextFactoryKey);
          setCanSyncNow(true);
          setContinuityWarning(null);
          markSaleContinuitySession({
            username: data.username,
            role: data.role,
            factoryKey: nextFactoryKey,
          });
          return;
        }
        if (fallbackUser) {
          setSessionRole(fallbackUser.role);
          setSessionFactoryKey(fallbackFactoryKey);
          setCanSyncNow(false);
          setContinuityWarning("ขายต่อได้จากข้อมูลในเครื่อง แต่ต้องล็อกอินออนไลน์ก่อนจึงจะซิงก์รายการได้");
          return;
        }
        setSessionRole(null);
        setSessionFactoryKey(fallbackFactoryKey);
        setCanSyncNow(false);
        setContinuityWarning(null);
      } catch {
        if (fallbackUser) {
          setSessionRole(fallbackUser.role);
          setSessionFactoryKey(fallbackFactoryKey);
          setCanSyncNow(false);
          setContinuityWarning("ขายต่อได้จากข้อมูลในเครื่อง แต่ต้องล็อกอินออนไลน์ก่อนจึงจะซิงก์รายการได้");
          return;
        }
        setSessionRole(null);
        setSessionFactoryKey(fallbackFactoryKey);
        setCanSyncNow(false);
        setContinuityWarning(null);
      }
    }, 200);

    return cancel;
  }, [isOnline]);

  const applyBillCounterState = useCallback((factoryKey: string, nextNumber: number) => {
    setNextBillNumber(nextNumber);
    writeCachedPrintedBillCounter(factoryKey, nextNumber);
  }, []);

  const syncPendingBillCounterUpdate = useCallback(async (factoryKey: string) => {
    const pending = readPendingPrintedBillCounterUpdate(factoryKey);
    if (!pending || !canSyncNow) return null;

    const res = await fetch("/api/bill-counter", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nextBillNumber: pending.nextBillNumber,
        sourcePage: pending.sourcePage,
      }),
    });
    if (!res.ok) {
      throw new Error("sync_bill_counter_failed");
    }

    const data = await res.json();
    if (typeof data?.nextBillNumber === "number") {
      applyBillCounterState(factoryKey, data.nextBillNumber);
    }
    clearPendingPrintedBillCounterUpdate(factoryKey);
    return data;
  }, [applyBillCounterState, canSyncNow]);

  const loadBillCounter = useCallback(async () => {
    if (!sessionFactoryKey) return;

    setLoadingBillCounter(true);
    const cachedValue = readCachedPrintedBillCounter(sessionFactoryKey);
    if (cachedValue !== null) {
      setNextBillNumber(cachedValue);
    }

    if (!canSyncNow) {
      setLoadingBillCounter(false);
      return;
    }

    try {
      await syncPendingBillCounterUpdate(sessionFactoryKey);
      const res = await fetch("/api/bill-counter");
      if (!res.ok) throw new Error("load_bill_counter_failed");
      const data = await res.json();
      if (typeof data?.nextBillNumber === "number") {
        applyBillCounterState(sessionFactoryKey, data.nextBillNumber);
      }
    } catch {
      if (cachedValue === null) {
        setNextBillNumber(1);
      }
    } finally {
      setLoadingBillCounter(false);
    }
  }, [applyBillCounterState, canSyncNow, sessionFactoryKey, syncPendingBillCounterUpdate]);

  useEffect(() => {
    void loadBillCounter();
  }, [loadBillCounter, isOnline]);

  const handleBillCounterCommit = useCallback(async (requestedNextBillNumber: number) => {
    if (!sessionFactoryKey) return;

    if (!canSyncNow) {
      applyBillCounterState(sessionFactoryKey, requestedNextBillNumber);
      queuePendingPrintedBillCounterUpdate(sessionFactoryKey, requestedNextBillNumber, "sale");
      toast.info("บันทึกเลขบิลไว้ในเครื่องแล้ว ระบบจะซิงก์เข้า audit เมื่อกลับมาออนไลน์");
      return;
    }

    setSavingBillCounter(true);
    try {
      const res = await fetch("/api/bill-counter", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nextBillNumber: requestedNextBillNumber,
          sourcePage: "sale",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(typeof data?.error === "string" ? data.error : "save_bill_counter_failed");
      }
      const data = await res.json();
      if (typeof data?.nextBillNumber === "number") {
        applyBillCounterState(sessionFactoryKey, data.nextBillNumber);
      }
      clearPendingPrintedBillCounterUpdate(sessionFactoryKey);
      toast.success("อัปเดตเลขบิลถัดไปแล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "อัปเดตเลขบิลไม่สำเร็จ");
      void loadBillCounter();
    } finally {
      setSavingBillCounter(false);
    }
  }, [applyBillCounterState, canSyncNow, loadBillCounter, sessionFactoryKey]);

  useEffect(() => {
    if (!isAdmin) {
      setBackdatedEntry(false);
      setBackdateReason("");
    }
  }, [isAdmin]);

  useEffect(() => {
    const returnToInvoice = searchParams.get("returnTo") === "invoice";
    const customerId = Number.parseInt(searchParams.get("customerId") || "", 10);
    const invoiceStartDate = searchParams.get("invoiceStartDate");
    const invoiceEndDate = searchParams.get("invoiceEndDate");

    if (
      !returnToInvoice ||
      !Number.isFinite(customerId) ||
      customerId <= 0 ||
      !isIsoDate(invoiceStartDate) ||
      !isIsoDate(invoiceEndDate)
    ) {
      setInvoiceReturnContext(null);
      return;
    }

    const saleDate = searchParams.get("saleDate");
    const saleTime = searchParams.get("saleTime");
    const anchorTransactionId = Number.parseInt(searchParams.get("anchorTransactionId") || "", 10);
    const nextContext: InvoiceReturnContext = {
      customerId,
      saleDate: isIsoDate(saleDate) ? saleDate : null,
      saleTime: isIsoTime(saleTime) ? normalizeTimeForApi(saleTime) : null,
      invoiceStartDate,
      invoiceEndDate,
      invoiceKinds: searchParams.get("invoiceKinds") || "sale,return,transfer_out,adjustment",
      invoiceVatEnabled: searchParams.get("invoiceVatEnabled") === "1",
      invoiceSource: searchParams.get("invoiceSource") === "draft" ? "draft" : "new",
      anchorTransactionId:
        Number.isFinite(anchorTransactionId) && anchorTransactionId > 0 ? anchorTransactionId : null,
      backdateMode: searchParams.get("backdateMode") === "1",
    };
    setInvoiceReturnContext(nextContext);
  }, [searchParams]);

  useEffect(() => {
    if (!invoiceReturnContext) return;

    if (invoiceReturnContext.saleDate) {
      setBackdateDate(invoiceReturnContext.saleDate);
    }
    if (invoiceReturnContext.saleTime) {
      setBackdateTime(invoiceReturnContext.saleTime);
    }

    const shouldEnableBackdate =
      isAdmin &&
      ((invoiceReturnContext.saleDate ? invoiceReturnContext.saleDate < todayISO() : false) ||
        invoiceReturnContext.backdateMode);

    if (shouldEnableBackdate) {
      setBackdatedEntry(true);
    }
  }, [invoiceReturnContext, isAdmin]);

  useEffect(() => {
    setString("superice-print-mode", printMode);
  }, [printMode]);

  useEffect(() => {
    setString(SALE_ENTRY_VIEW_MODE_KEY, saleEntryViewMode);
  }, [saleEntryViewMode]);

  useEffect(() => {
    if (saleRouteMountedRef.current) return;
    saleRouteMountedRef.current = true;
    markSaleRouteMounted();
  }, []);

  // When we come back online, auto-sync and notify
  useEffect(() => {
    if (canSyncNow && pendingCount > 0) {
      const cancel = scheduleBackgroundTask(async () => {
        const result = await syncAll();
        if (result.success > 0) {
          toast.success(`ส่งรายการสำเร็จ ${result.success} รายการ`);
          setPendingCount(await getPendingCount());
        }
      }, 250);
      return cancel;
    }
  }, [canSyncNow, pendingCount]);

  // ---- First-load reference preload: products + full customers + full price matrix ----
  useEffect(() => {
    let cancelled = false;
    const continuityUser = readSaleContinuitySessionUser();

    void getOfflineReferenceCacheStatus(sessionFactoryKey)
      .then(async (status) => {
        if (cancelled) return null;
        setCanSellLocally(Boolean(continuityUser && status.factoryKey && status.ready));
        if (!canSyncNow && !status.ready) {
          return null;
        }
        return await ensureOfflineReferenceCacheWarm();
      })
      .then(async (result) => {
        if (cancelled) return;
        if (!result) return;

        setProducts(result.activeProducts);
        if (result.usedCachedReferences) {
          toast.info("โหลดข้อมูลอ้างอิงจากแคช (ออฟไลน์)");
        }

        const readinessBase = {
          used_cached_references: result.usedCachedReferences,
          online: typeof window === "undefined" ? true : window.navigator.onLine,
          product_count: result.activeProducts.length,
          customer_count: result.customerCount,
          price_matrix_row_count: result.priceMatrixRowCount,
        };

        if (!saleReferenceReadyRef.current) {
          saleReferenceReadyRef.current = true;
          const referenceMetrics = markSaleReferenceReady();
          const readinessEvent = {
            ...readinessBase,
            sale_reference_ready_ms: referenceMetrics.saleReferenceReadyMs,
            login_to_sale_interactive_ms: referenceMetrics.loginToSaleInteractiveMs,
            sale_bootstrap_ms: referenceMetrics.saleBootstrapMs,
          };
          console.info("[sale-readiness] reference-ready", readinessEvent);
          captureClientEvent("sale_reference_ready", readinessEvent);
        }

        if (result.activeProducts.length > 0 && !saleInteractiveRef.current) {
          requestAnimationFrame(() => {
            if (cancelled || saleInteractiveRef.current) return;
            saleInteractiveRef.current = true;
            const interactiveMetrics = markSaleInteractive();
            const interactiveEvent = {
              ...readinessBase,
              sale_reference_ready_ms: interactiveMetrics.saleReferenceReadyMs,
              login_to_sale_interactive_ms: interactiveMetrics.loginToSaleInteractiveMs,
              sale_bootstrap_ms: interactiveMetrics.saleBootstrapMs,
            };
            console.info("[sale-readiness] interactive", interactiveEvent);
            captureClientEvent("sale_screen_interactive", interactiveEvent);
          });
        }

        const nextStatus = await getOfflineReferenceCacheStatus(sessionFactoryKey);
        if (!cancelled) {
          setCanSellLocally(Boolean(continuityUser && nextStatus.factoryKey && nextStatus.ready));
        }
      })
      .catch(() => {
        if (cancelled) return;
        if (canSyncNow) {
          toast.error("ไม่สามารถโหลดสินค้าได้");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canSyncNow, sessionFactoryKey]);

  const searchCustomers = useCallback(async (query: string) => {
    if (!saleAccessEnabled) {
      setCustomers([]);
      return;
    }
    const onlyTransferCustomers = saleMode === "transfer_out";
    const applyModeFilter = (list: Customer[]) =>
      onlyTransferCustomers ? list.filter((c) => isActiveInvoiceCreditCustomer(c)) : list;
    try {
      const res = await fetch(
        `/api/customers?search=${encodeURIComponent(query)}&limit=20&includeBagBalance=0`
      );
      if (!res.ok) {
        throw new Error(`customer_search_${res.status}`);
      }
      const data = await res.json();
      const nextCustomers = Array.isArray(data) ? data : [];
      setCustomers(applyModeFilter(nextCustomers));
      // Merge search results into offline cache so full list is never replaced.
      if (nextCustomers.length > 0) {
        await cacheCustomers(nextCustomers, sessionFactoryKey);
      }
    } catch {
      // Offline — search in cached customers
      const cached = await getCachedCustomers(query, sessionFactoryKey);
      if (cached) {
        setCustomers(applyModeFilter(cached));
      }
    }
  }, [saleAccessEnabled, saleMode, sessionFactoryKey]);

  useEffect(() => {
    if (searchQuery.length > 0) {
      void getCachedCustomers(searchQuery, sessionFactoryKey).then((cached) => {
        if (!saleAccessEnabled) return;
        const onlyTransferCustomers = saleMode === "transfer_out";
        const applyModeFilter = (list: Customer[]) =>
          onlyTransferCustomers ? list.filter((c) => isActiveInvoiceCreditCustomer(c)) : list;
        if (cached) {
          setCustomers(applyModeFilter(cached));
          return;
        }
        setCustomers([]);
      });
      const timer = setTimeout(() => searchCustomers(searchQuery), 200);
      return () => clearTimeout(timer);
    } else {
      setCustomers([]);
    }
  }, [saleAccessEnabled, saleMode, searchQuery, searchCustomers, sessionFactoryKey]);

  // Reset highlight when customer list changes
  useEffect(() => {
    if (customers.length > 0) setHighlightedCustomerIndex(0);
  }, [customers]);

  // Scroll highlighted customer into view when navigating with arrows
  useEffect(() => {
    if (showCustomerList && customers.length > 0) {
      highlightedCustomerRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [highlightedCustomerIndex, showCustomerList, customers.length]);

  const loadAllCustomersForDropdown = useCallback(async () => {
    if (!saleAccessEnabled) {
      setCustomers([]);
      return;
    }
    const onlyTransferCustomers = saleMode === "transfer_out";
    const applyModeFilter = (list: Customer[]) =>
      onlyTransferCustomers ? list.filter((c) => isActiveInvoiceCreditCustomer(c)) : list;
    try {
      const res = await fetch("/api/customers?search=");
      if (!res.ok) {
        throw new Error(`customer_list_${res.status}`);
      }
      const data = await res.json();
      const sorted = Array.isArray(data)
        ? [...data].sort((a: Customer, b: Customer) => (a.name || "").localeCompare(b.name || "", "th"))
        : [];
      setCustomers(applyModeFilter(sorted));
      if (sorted.length > 0) await cacheCustomers(sorted, sessionFactoryKey);
    } catch {
      const cached = await getCachedCustomers("", sessionFactoryKey);
      if (cached && cached.length > 0) {
        const sorted = [...cached].sort((a, b) => (a.name || "").localeCompare(b.name || "", "th"));
        setCustomers(applyModeFilter(sorted));
      }
    }
  }, [saleAccessEnabled, saleMode, sessionFactoryKey]);

  useEffect(() => {
    if (saleMode === "transfer_out") {
      setPaymentStatus("paid");
      if (!transferRef) setTransferRef(buildDefaultTransferRef(getBangkokNowForPayload().saleDate));
      setCustomers((prev) => prev.filter((c) => isActiveInvoiceCreditCustomer(c)));
      if (selectedCustomer && !isActiveInvoiceCreditCustomer(selectedCustomer)) {
        setSelectedCustomer(null);
        setSelectedCustomerPrices([]);
        setItems([]);
        setBagReturnQty(0);
        setCustomerBagBalance(0);
      }
    }
  }, [saleMode, selectedCustomer, transferRef]);

  const buildPricedItems = useCallback((prices: CachedCustomerPrice[], productList: ProductType[]): SaleItem[] => {
    const productById = new Map(productList.map((product) => [product.id, product]));
    const pricedItems: SaleItem[] = [];
    for (const cp of prices) {
      if (cp.unitPrice <= 0) continue;
      const pt = productList.find((p) => p.id === cp.productTypeId);
      if (!pt || !pt.isActive) continue;
      pricedItems.push({
        productTypeId: pt.id,
        productName: pt.name,
        catalogCode: pt.catalogCode ?? null,
        hasBag: pt.hasBag,
        decreasesBag: pt.decreasesBag ?? false,
        quantity: 0,
        unitPrice: cp.unitPrice,
        baseUnitPrice: cp.unitPrice,
        subtotal: 0,
        isAdded: false,
      });
    }
    pricedItems.sort((a, b) => {
      const aProduct = productById.get(a.productTypeId);
      const bProduct = productById.get(b.productTypeId);
      if (aProduct && bProduct) return sortProducts(aProduct, bProduct);
      if (aProduct) return -1;
      if (bProduct) return 1;
      return a.productName.localeCompare(b.productName, "th");
    });
    return pricedItems;
  }, []);

  const buildTransferItems = useCallback((_prices: CachedCustomerPrice[], productList: ProductType[]): SaleItem[] => {
    const priceByProductId = new Map(_prices.map((price) => [price.productTypeId, price.unitPrice]));
    const activeProducts = [...productList].filter((p) => p.isActive);
    const presetProducts = activeProducts.filter((p) => isTransferPresetProduct(p.name));
    const preloadProducts = presetProducts.length > 0 ? presetProducts : activeProducts;
    return preloadProducts
      .sort(sortProducts)
      .map((pt) => ({
        productTypeId: pt.id,
        productName: pt.name,
        catalogCode: pt.catalogCode ?? null,
        hasBag: pt.hasBag,
        decreasesBag: pt.decreasesBag ?? false,
        quantity: 0,
        unitPrice: priceByProductId.get(pt.id) ?? 0,
        baseUnitPrice: priceByProductId.get(pt.id) ?? 0,
        subtotal: 0,
        isAdded: false,
      }));
  }, []);

  // If customer prices arrive before product list, rebuild items once products are ready.
  useEffect(() => {
    if (!selectedCustomer) return;
    if (products.length === 0 || selectedCustomerPrices.length === 0) return;
    setItems((prev) => {
      if (prev.length > 0) return prev;
      return saleMode === "transfer_out"
        ? buildTransferItems(selectedCustomerPrices, products)
        : buildPricedItems(selectedCustomerPrices, products);
    });
  }, [selectedCustomer, selectedCustomerPrices, products, buildPricedItems, buildTransferItems, saleMode]);

  useEffect(() => {
    if (!selectedCustomer || products.length === 0) return;
    const nextItems = saleMode === "transfer_out"
      ? buildTransferItems(selectedCustomerPrices, products)
      : buildPricedItems(selectedCustomerPrices, products);
    setItems(nextItems);
    setBagReturnQty(0);
  }, [saleMode, selectedCustomer, products, selectedCustomerPrices, buildPricedItems, buildTransferItems]);

  const selectCustomer = useCallback(async (customer: Customer) => {
    if (!saleAccessEnabled) return;
    setSelectedCustomer(customer);
    setSelectedCustomerPrices([]);
    setShowCustomerList(false);
    setSearchQuery(customer.name);
    setPaymentStatus(saleMode === "transfer_out" ? "paid" : customer.credit ? "unpaid" : "paid");
    setPartialPaidInput("");
    setCustomerBagBalance(parseBagBalance(customer.bagBalance));

    let prices: CachedCustomerPrice[] = [];

    try {
      const res = await fetch(`/api/customers?id=${customer.id}`);
      if (!res.ok) {
        throw new Error(`customer_detail_${res.status}`);
      }
      const data = await res.json();
      prices = data.prices || [];
      // Cache prices for offline use
      if (prices.length > 0) {
        await cacheCustomerPrices(customer.id, prices, sessionFactoryKey);
      }
    } catch {
      // Offline — try cached prices
      const cached = await getCachedCustomerPrices(customer.id, sessionFactoryKey);
      if (cached) {
        prices = cached;
        toast.info("โหลดราคาจากแคช (ออฟไลน์)");
      }
    }

    setSelectedCustomerPrices(prices);
    // Only show products that have a price > 0 for this customer
    const pricedItems = saleMode === "transfer_out"
      ? buildTransferItems(prices, products)
      : buildPricedItems(prices, products);
    setItems(pricedItems);
    setBagReturnQty(0);
    setAddProductId("");
    setExactExtraProductId("");

    // Fetch customer bag balance
    try {
      const bagRes = await fetch(`/api/bags?customerId=${customer.id}`);
      const bagEntries = await bagRes.json();
      const balance = Array.isArray(bagEntries) ? getBagBalanceFromEntries(bagEntries) : 0;
      setCustomerBagBalance(balance);
    } catch {
      setCustomerBagBalance(parseBagBalance(customer.bagBalance));
    }
  }, [buildPricedItems, buildTransferItems, products, saleAccessEnabled, saleMode, sessionFactoryKey]);

  useEffect(() => {
    if (!invoiceReturnContext) return;
    if (selectedCustomer?.id === invoiceReturnContext.customerId) {
      invoicePrefillCustomerIdRef.current = invoiceReturnContext.customerId;
      return;
    }
    if (invoicePrefillCustomerIdRef.current === invoiceReturnContext.customerId) return;

    let cancelled = false;
      void fetch(`/api/customers?id=${invoiceReturnContext.customerId}`)
        .then((r) => {
          if (!r.ok) throw new Error(`invoice_customer_${r.status}`);
          return r.json();
        })
        .then((data) => {
          if (cancelled || !data?.id) return;
          invoicePrefillCustomerIdRef.current = invoiceReturnContext.customerId;
          return selectCustomer(data as Customer);
        })
        .catch(async () => {
          const cached = await getCachedCustomers("", sessionFactoryKey);
          const customer = cached?.find((entry) => entry.id === invoiceReturnContext.customerId);
          if (cancelled || !customer) {
            invoicePrefillCustomerIdRef.current = null;
            return;
          }
          invoicePrefillCustomerIdRef.current = invoiceReturnContext.customerId;
          await selectCustomer(customer);
        });

    return () => {
      cancelled = true;
    };
  }, [invoiceReturnContext, selectedCustomer?.id, selectCustomer, sessionFactoryKey]);

  const saleEntryViewOptions = useMemo(
    () => getAvailableSaleEntryViewOptions(sessionRole, sessionFactoryKey),
    [sessionFactoryKey, sessionRole]
  );
  const isBillStyleView =
    saleEntryViewMode === "exact_bill" || saleEntryViewMode === "bearing_bill";
  const activeBillSlotMode: Exclude<SaleEntryViewMode, "default"> =
    saleEntryViewMode === "bearing_bill" ? "bearing_bill" : "exact_bill";
  const matchesBillSlotProduct = useCallback(
    (productName: string) => isBillSlotProductName(productName, activeBillSlotMode),
    [activeBillSlotMode]
  );
  const resolveSaleItemUnitPrice = useCallback(
    (item: Pick<SaleItem, "productTypeId" | "catalogCode" | "baseUnitPrice" | "unitPrice">, qty: number) =>
      resolveEffectiveUnitPrice({
        factoryKey: sessionFactoryKey,
        customerId: selectedCustomer?.id,
        productTypeId: item.productTypeId,
        productCatalogCode: item.catalogCode ?? null,
        quantity: qty,
        baseUnitPrice:
          typeof item.baseUnitPrice === "number" ? item.baseUnitPrice : item.unitPrice,
      }),
    [selectedCustomer?.id, sessionFactoryKey]
  );
  const selectedCustomerPriceByProductId = useMemo(
    () => new Map(selectedCustomerPrices.map((price) => [price.productTypeId, price.unitPrice])),
    [selectedCustomerPrices]
  );
  const pricingEvaluation = useMemo(
    () =>
      applyFactorySalePricingPolicy({
        factoryKey: sessionFactoryKey,
        customerId: selectedCustomer?.id,
        items,
        baseUnitPriceByProductTypeId: selectedCustomerPriceByProductId,
      }),
    [items, selectedCustomer?.id, selectedCustomerPriceByProductId, sessionFactoryKey]
  );
  const effectiveItems = pricingEvaluation.items;
  const effectiveItemByProductTypeId = useMemo(
    () => new Map(effectiveItems.map((item) => [item.productTypeId, item])),
    [effectiveItems]
  );
  const exactBillLayout = useMemo(
    () => buildBillRows(effectiveItems, activeBillSlotMode),
    [effectiveItems, activeBillSlotMode]
  );
  const exactBillRows = exactBillLayout.rows;
  const exactLine7Candidates = useMemo(
    () =>
      products
        .filter((p) => p.isActive && !matchesBillSlotProduct(p.name))
        .sort((a, b) => {
          const aBuyBag = isBuyBagProductName(a.name) ? 0 : 1;
          const bBuyBag = isBuyBagProductName(b.name) ? 0 : 1;
          if (aBuyBag !== bBuyBag) return aBuyBag - bBuyBag;
          return sortProducts(a, b);
        }),
    [matchesBillSlotProduct, products]
  );
  const exactLine7Items = useMemo(
    () => items.filter((item) => !matchesBillSlotProduct(item.productName)),
    [items, matchesBillSlotProduct]
  );
  const exactSelectedLine7Item = useMemo(() => {
    const selectedId = Number.parseInt(exactExtraProductId, 10);
    if (Number.isFinite(selectedId)) {
      const selected = exactLine7Items.find((item) => item.productTypeId === selectedId);
      if (selected) return selected;
    }
    const byQty = exactLine7Items.find((item) => item.quantity > 0);
    if (byQty) return byQty;
    const buyBagItem = exactLine7Items.find((item) => isBuyBagProductName(item.productName));
    if (buyBagItem) return buyBagItem;
    return exactLine7Items[0] || null;
  }, [exactLine7Items, exactExtraProductId]);
  const effectiveExactSelectedLine7Item = useMemo(() => {
    if (!exactSelectedLine7Item) return null;
    return effectiveItemByProductTypeId.get(exactSelectedLine7Item.productTypeId) ?? exactSelectedLine7Item;
  }, [effectiveItemByProductTypeId, exactSelectedLine7Item]);
  const exactLine7ProductTypeId =
    saleEntryViewMode === "exact_bill" ? exactSelectedLine7Item?.productTypeId ?? null : null;

  const selectExactLine7Product = useCallback((productId: string) => {
    if (!isBillStyleView) return;
    const selectedId = Number.parseInt(productId, 10);
    if (!Number.isFinite(selectedId)) return;
    const selectedProduct = products.find((p) => p.id === selectedId);
    if (!selectedProduct || matchesBillSlotProduct(selectedProduct.name)) return;

    setItems((prev) => {
      const hasSelected = prev.some((item) => item.productTypeId === selectedId);
      const next = hasSelected
        ? prev
        : [
            ...prev,
            {
              productTypeId: selectedProduct.id,
              productName: selectedProduct.name,
              catalogCode: selectedProduct.catalogCode ?? null,
              hasBag: selectedProduct.hasBag,
              decreasesBag: selectedProduct.decreasesBag ?? false,
              quantity: 0,
              unitPrice: 0,
              baseUnitPrice: 0,
              subtotal: 0,
              isAdded: true,
            } as SaleItem,
          ];

      return next.map((item) => {
        if (item.productTypeId === selectedId) return item;
        if (matchesBillSlotProduct(item.productName)) return item;
        if (item.quantity === 0 && item.subtotal === 0) return item;
        return { ...item, quantity: 0, subtotal: 0 };
      });
    });
    setExactExtraProductId(productId);
  }, [isBillStyleView, matchesBillSlotProduct, products]);

  useEffect(() => {
    if (!isBillStyleView) {
      if (exactExtraProductId) setExactExtraProductId("");
      return;
    }
    if (exactLine7Candidates.length === 0) {
      if (exactExtraProductId) setExactExtraProductId("");
      return;
    }
    if (
      exactExtraProductId &&
      exactLine7Candidates.some((item) => String(item.id) === exactExtraProductId)
    ) {
      return;
    }
    const defaultCandidate =
      exactLine7Candidates.find((item) => isBuyBagProductName(item.name)) ||
      exactLine7Candidates[0];
    if (defaultCandidate) {
      selectExactLine7Product(String(defaultCandidate.id));
    }
  }, [isBillStyleView, exactLine7Candidates, exactExtraProductId, selectExactLine7Product]);

  useEffect(() => {
    const normalizedMode = normalizeSaleEntryViewModeForSession(
      saleEntryViewMode,
      sessionRole,
      sessionFactoryKey
    );
    if (normalizedMode !== saleEntryViewMode) {
      setSaleEntryViewMode(normalizedMode);
    }
  }, [saleEntryViewMode, sessionFactoryKey, sessionRole]);

  // Products available to add (active, not already in items).
  const availableToAdd = products.filter((p) => {
    if (items.some((i) => i.productTypeId === p.id)) return false;
    if (isBillStyleView) return false;
    if (!p.isActive) return false;
    return true;
  });

  function handleAddProduct() {
    if (!addProductId) return;
    const pt = products.find((p) => p.id === parseInt(addProductId));
    if (!pt) return;

    setItems((prev) => [
      ...prev,
      {
        productTypeId: pt.id,
        productName: pt.name,
        catalogCode: pt.catalogCode ?? null,
        hasBag: pt.hasBag,
        decreasesBag: pt.decreasesBag ?? false,
        quantity: 0,
        unitPrice: 0,
        baseUnitPrice: 0,
        subtotal: 0,
        isAdded: true,
      },
    ]);
    setAddProductId("");
  }

  function removeAddedItem(productTypeId: number) {
    setItems((prev) => prev.filter((i) => i.productTypeId !== productTypeId));
  }

  function updateItemQuantity(productTypeId: number, qty: number) {
    setItems((prev) =>
      prev.map((item) =>
        item.productTypeId === productTypeId
          ? (() => {
              const unitPrice = resolveSaleItemUnitPrice(item, qty);
              return { ...item, quantity: qty, unitPrice, subtotal: qty * unitPrice };
            })()
          : item
      )
    );
  }

  function updateAddedItemPrice(productTypeId: number, price: number) {
    setItems((prev) =>
      prev.map((item) =>
        item.productTypeId === productTypeId && item.isAdded
          ? { ...item, unitPrice: price, baseUnitPrice: price, subtotal: item.quantity * price }
          : item
      )
    );
  }

  const grandTotal = pricingEvaluation.effectiveSubtotal;
  const isTransferMode = saleMode === "transfer_out";
  const hasSaleItems = effectiveItems.some((i) => i.quantity > 0);
  const hasBagReturn = bagReturnQty > 0;
  const canUsePartialPayment = !isTransferMode && !!selectedCustomer?.credit;
  const parsedPartialPaid = partialPaidInput.trim()
    ? Number.parseFloat(partialPaidInput)
    : null;
  const paymentResolution = resolveSalePayment({
    paymentStatus,
    grandTotal,
    hasSaleItems,
    isTransferMode,
    partialPaidAmount: parsedPartialPaid,
  });
  const transferReady = !isTransferMode || (
    !!selectedCustomer &&
    isActiveInvoiceCreditCustomer(selectedCustomer) &&
    TRANSFER_REF_REGEX.test(transferRef.trim().toUpperCase()) &&
    (hasSaleItems || hasBagReturn)
  );
  const canSubmitSale =
    saleAccessEnabled &&
    !!selectedCustomer &&
    (hasSaleItems || hasBagReturn) &&
    !saving &&
    transferReady &&
    paymentResolution.isValid;
  const backdateMinDate = isoDaysAgo(30);
  const backdateMaxDate = getBackdateMaxDate();

  useEffect(() => {
    if (!canUsePartialPayment && paymentStatus === "partial") {
      setPaymentStatus(selectedCustomer?.credit && !isTransferMode ? "unpaid" : "paid");
      setPartialPaidInput("");
    }
  }, [canUsePartialPayment, isTransferMode, paymentStatus, selectedCustomer?.credit]);

  useEffect(() => {
    if (paymentStatus !== "partial") {
      previousGrandTotalRef.current = grandTotal;
      return;
    }

    if (previousGrandTotalRef.current !== grandTotal && partialPaidInput.trim()) {
      const currentPartialPaid = Number.parseFloat(partialPaidInput);
      if (
        !Number.isFinite(currentPartialPaid) ||
        currentPartialPaid <= 0 ||
        currentPartialPaid >= grandTotal
      ) {
        setPartialPaidInput("");
      }
    }

    previousGrandTotalRef.current = grandTotal;
  }, [grandTotal, partialPaidInput, paymentStatus]);

  // Keyboard shortcuts: Arrow keys + Enter (numpad) for nav; F2=search, Escape=clear, Enter (not in input)=save
  useEffect(() => {
    function getFocusableSaleNavElements(): HTMLElement[] {
      const elements = Array.from(
        document.querySelectorAll<HTMLElement>("[data-sale-nav]")
      );
      return elements.filter((el) => {
        const asControl = el as HTMLInputElement | HTMLButtonElement | HTMLSelectElement;
        if (asControl.disabled) return false;
        if (el.getAttribute("aria-disabled") === "true") return false;
        if (el.tabIndex < 0) return false;

        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return false;
        return el.getClientRects().length > 0;
      });
    }

    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const tag = target?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        handleClear();
        return;
      }

      // Customer dropdown: when list is open and focus is on search, Arrow Up/Down navigate list, Enter selects (single or highlighted)
      if (target === searchRef.current && showCustomerList && customers.length > 0) {
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
          const idx = highlightedCustomerIndex >= 0 && highlightedCustomerIndex < customers.length ? highlightedCustomerIndex : 0;
          selectCustomer(customers[idx]);
          setShowCustomerList(false);
          return;
        }
      }

      // Arrow keys + Tab + Enter: move focus between sale-nav elements
      const navKeys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Enter", "Tab"];
      if (navKeys.includes(e.key)) {
        const current = target.matches("[data-sale-nav]")
          ? target
          : target.closest<HTMLElement>("[data-sale-nav]");
        if (!current) return;

        const list = getFocusableSaleNavElements();
        const idx = list.indexOf(current);
        if (idx === -1) return;

        if (e.key === "Enter" && !isInput) {
          // Enter on a button (e.g. Save) — let default happen (click)
          return;
        }
        if (e.key === "Enter" && isInput) {
          e.preventDefault();
          // Numpad or main Enter in an input: go to next field (wrap).
          const next = list[idx + 1] ?? list[0];
          next?.focus();
          if (next instanceof HTMLInputElement && "select" in next) next.select?.();
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          const nextIdx = e.shiftKey
            ? (idx - 1 + list.length) % list.length
            : (idx + 1) % list.length;
          const next = list[nextIdx];
          next?.focus();
          if (next instanceof HTMLInputElement && "select" in next) next.select?.();
          return;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowRight") {
          e.preventDefault();
          const next = list[idx + 1] ?? list[0];
          next.focus();
          if (next instanceof HTMLInputElement && "select" in next) next.select?.();
          return;
        }
        if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
          e.preventDefault();
          const prev = list[idx - 1] ?? list[list.length - 1];
          prev.focus();
          if (prev instanceof HTMLInputElement && "select" in prev) prev.select?.();
          return;
        }
      }

      // Enter to save — only when not focused on an input/button in the nav list
      if (e.key === "Enter" && !isInput && canSubmitSale) {
        e.preventDefault();
        handleSave();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSubmitSale, items, bagReturnQty, paymentStatus, loadingLocation, showCustomerList, customers, highlightedCustomerIndex]);
  const totalBagsOut = items.filter((i) => i.hasBag).reduce((sum, i) => sum + i.quantity, 0);
  const totalBagsDecrease = items.filter((i) => i.decreasesBag).reduce((sum, i) => sum + i.quantity, 0);
  const totalBagsReturn = bagReturnQty;

  async function handleSave() {
    if (!selectedCustomer) return;
    if (!hasSaleItems && !hasBagReturn) return;

    setSaving(true);
    try {
      const normalizedTransferRef = transferRef.trim().toUpperCase();
      if (isTransferMode) {
        if (!isActiveInvoiceCreditCustomer(selectedCustomer)) {
          toast.error(`ลูกค้านี้ยังไม่อยู่ในสถานะ${INVOICE_CREDIT_LABEL}`);
          return;
        }
        if (!TRANSFER_REF_REGEX.test(normalizedTransferRef)) {
          toast.error("รหัสโอนไม่ถูกต้อง", {
            description: "ใช้รูปแบบ TRF-YYYYMMDD-###",
          });
          return;
        }
      }

      const canonicalBagProduct = products.find((p) => p.hasBag);
      if (hasBagReturn && !canonicalBagProduct) {
        toast.error("ไม่พบประเภทสินค้าที่รองรับการคืนถุง");
        return;
      }

      if (paymentStatus === "partial" && !paymentResolution.isValid) {
        toast.error("กรอกยอดรับวันนี้ให้ถูกต้อง", {
          description: "ยอดรับวันนี้ต้องมากกว่า 0 และน้อยกว่ายอดรวม",
        });
        return;
      }

      const effectivePaymentStatus = paymentResolution.effectiveStatus;

      // Collect new prices to save (added items that have a price and quantity)
      const newPrices = items
        .filter((i) => i.isAdded && i.unitPrice > 0)
        .map((i) => ({
          productTypeId: i.productTypeId,
          unitPrice: i.unitPrice,
        }));

      // Parse bay only (1-6). Keep pool/col as null.
      let parsedBay: number | null = null;
      const trimmedBay = loadingLocation.trim();
      if (trimmedBay.length > 0) {
        if (!/^\d+$/.test(trimmedBay)) {
          toast.error("ช่องจอดไม่ถูกต้อง", {
            description: "กรอกเลขช่องจอด 1-6 หรือเว้นว่าง",
          });
          return;
        }
        const bay = Number.parseInt(trimmedBay, 10);
        if (!Number.isInteger(bay) || bay < 1 || bay > 6) {
          toast.error("ช่องจอดไม่ถูกต้อง", {
            description: "กรอกเลขช่องจอด 1-6 หรือเว้นว่าง",
          });
          return;
        }
        parsedBay = bay;
      }

      const bangkokNow = getBangkokNowForPayload();
      const launchPrefillSaleDate = invoiceReturnContext?.saleDate;
      const launchPrefillSaleTime = invoiceReturnContext?.saleTime;
      const effectiveSaleDate =
        isAdmin && backdatedEntry
          ? backdateDate
          : launchPrefillSaleDate || bangkokNow.saleDate;
      const effectiveSaleTime =
        isAdmin && backdatedEntry
          ? normalizeTimeForApi(backdateTime)
          : launchPrefillSaleTime || bangkokNow.saleTime;
      const effectiveBackdateReason =
        isAdmin && backdatedEntry && backdateReason.trim().length > 0
          ? backdateReason.trim()
          : undefined;

      const baseClientId = isTransferMode
        ? `transfer-${normalizedTransferRef}-${generateClientId()}`
        : generateClientId();
      const fallbackOfflineBillNumber =
        nextBillNumber ??
        (sessionFactoryKey ? readCachedPrintedBillCounter(sessionFactoryKey) : null) ??
        1;
      const requestedBillNumber =
        nextBillNumber ??
        (sessionFactoryKey ? readCachedPrintedBillCounter(sessionFactoryKey) : null) ??
        undefined;
      const baseSalePayload = {
        clientId: withExactLine7ClientMarker(baseClientId, exactLine7ProductTypeId),
        customerId: selectedCustomer.id,
        items: effectiveItems
          .filter((i) => i.quantity > 0)
          .map((i) => ({
            productTypeId: i.productTypeId,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          })),
        status: effectivePaymentStatus,
        paid: paymentResolution.payloadPaid,
        transactionType: isTransferMode ? "transfer_out" : "sale",
        transferRef: isTransferMode ? normalizedTransferRef : undefined,
        pool: null,
        row: parsedBay,
        col: null,
        saleDate: effectiveSaleDate,
        saleTime: effectiveSaleTime,
        backdateReason: effectiveBackdateReason,
        fulfillment: "pending",
        billNumber: requestedBillNumber,
        bagReturns: hasBagReturn && canonicalBagProduct
          ? [{ productTypeId: canonicalBagProduct.id, quantity: bagReturnQty }]
          : [],
        newPrices,
      };
      const salePayload =
        canSyncNow
          ? baseSalePayload
          : {
              ...baseSalePayload,
              billNumber: fallbackOfflineBillNumber,
            };

      const savedItems = effectiveItems
        .filter((i) => i.quantity > 0)
        .map((i) => {
          const unitPrice = i.unitPrice;
          return {
            productTypeId: i.productTypeId,
            quantity: i.quantity,
            unitPrice,
            subtotal: i.quantity * unitPrice,
            productType: {
              name: i.productName,
              hasBag: !!i.hasBag,
              decreasesBag: !!i.decreasesBag,
            },
          };
        });
      const saleBagSummary = summarizeSaleBagFlow({
        items: savedItems,
        manualBagReturnQty: bagReturnQty,
      });
      const printBagLedgerEntries: OfflinePrintPayload["bagLedgerEntries"] = buildBagLedgerWrites(
        saleBagSummary
      );
      const nextBagBalance = customerBagBalance + saleBagSummary.balanceDelta;
      const computedTotalForPrint = savedItems.reduce((sum, item) => sum + item.subtotal, 0);
      const computedStatusForPrint: "paid" | "unpaid" | "partial" = effectivePaymentStatus;
      const computedPaidForPrint = paymentResolution.printPaid;
      const queueSaleForLater = async (reason: "continuity" | "network") => {
        const queuedBillNumber = fallbackOfflineBillNumber;
        const queuedPayload = salePayload.billNumber === undefined
          ? { ...salePayload, billNumber: queuedBillNumber }
          : salePayload;
        let queued;
        try {
          queued = await queueSale({
            payload: queuedPayload,
            customerName: selectedCustomer.name,
            total: grandTotal,
            factoryKey: sessionFactoryKey,
          });
        } catch (queueError) {
          console.error("[sale.submit.offline-queue-failed]", {
            reason,
            queueError,
          });
          toast.error("บันทึกไม่สำเร็จ", {
            description:
              "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ และไม่สามารถบันทึกสำรองไว้ในเครื่องได้ กรุณาลองใหม่อีกครั้ง",
          });
          return;
        }
        if (sessionFactoryKey) {
          applyBillCounterState(sessionFactoryKey, incrementPrintedBillNumber(queuedBillNumber));
        }
        const transactionType = isTransferMode ? "transfer_out" : "sale";
        const saleType = resolveAnalyticsSaleType({
          transactionType,
          paymentStatus: paymentResolution.effectiveStatus,
        });
        const count = await getPendingCount();
        setPendingCount(count);
        setCanSyncNow(false);
        setContinuityWarning("ขายต่อได้จากข้อมูลในเครื่อง แต่ต้องล็อกอินออนไลน์ก่อนจึงจะซิงก์รายการได้");

        captureClientEvent("sale_queued_offline", {
          customer_id: selectedCustomer.id,
          factory_key: sessionFactoryKey,
          total_amount: grandTotal,
          payment_status: paymentResolution.effectiveStatus,
          transaction_type: transactionType,
          sale_type: saleType,
          sale_type_th: analyticsSaleTypeThaiLabel(saleType),
          transfer_ref: isTransferMode ? normalizedTransferRef : null,
          items_count: items.filter((i) => i.quantity > 0).length,
          pending_count: count,
        });

        toast.warning(
          reason === "continuity" ? "บันทึกขายในเครื่อง" : "บันทึกออฟไลน์",
          {
            description: isTransferMode
              ? `${selectedCustomer.name} - ${INVOICE_CREDIT_LABEL} ${normalizedTransferRef} จะส่งอัตโนมัติเมื่อกลับมาออนไลน์`
              : hasSaleItems
                ? paymentResolution.effectiveStatus === "partial"
                  ? `${selectedCustomer.name} - รับแล้ว ${formatCurrency(paymentResolution.printPaid)} / ค้าง ${formatCurrency(paymentResolution.remainingAmount)} จะส่งอัตโนมัติเมื่อกลับมาออนไลน์`
                  : `${selectedCustomer.name} - ${formatCurrency(grandTotal)} บาท จะส่งอัตโนมัติเมื่อกลับมาออนไลน์`
                : `${selectedCustomer.name} - คืนถุง ${bagReturnQty} ใบ จะส่งอัตโนมัติเมื่อกลับมาออนไลน์`,
            duration: 5000,
          }
        );
        if (isAdmin && backdatedEntry) {
          toast.info("รายการย้อนหลังจะถูกตรวจสอบนโยบายอีกครั้งตอนซิงก์ขึ้นเซิร์ฟเวอร์");
        }
        if (invoiceReturnContext) {
          toast.info("รายการถูกเก็บออฟไลน์ ยังไม่กลับไปอัปเดตใบวางบิลจนกว่าจะซิงก์สำเร็จ");
        }

        const offlinePrintPayload: OfflinePrintPayload = {
          id: Number.parseInt(queued.clientId.split("-")[0], 10) || Date.now(),
          clientId: salePayload.clientId,
          transactionKind: isTransferMode ? "transfer_out" : "sale",
          saleDate: effectiveSaleDate,
          saleTime: effectiveSaleTime,
          totalAmount: computedTotalForPrint,
          paid: computedPaidForPrint,
          status: computedStatusForPrint,
          pool: null,
          row: parsedBay,
          col: null,
          bagBalanceBefore: customerBagBalance,
          bagBalanceAfter: nextBagBalance,
          hidePrintTotals,
          customer: {
            id: selectedCustomer.id,
            name: selectedCustomer.name,
          },
          items: savedItems,
          bagLedgerEntries: printBagLedgerEntries,
        };
        const offlinePrintToken = saveOfflinePrintPayload(offlinePrintPayload);
        try {
          triggerPrint(offlinePrintPayload.id, printMode, {
            offlineToken: offlinePrintToken,
            offlinePayload: offlinePrintPayload,
          });
        } catch (error) {
          console.warn("[sale] offline print trigger failed", error);
          toast.error("พิมพ์ไม่สำเร็จ", {
            description: "บันทึกออฟไลน์สำเร็จแล้ว แต่เปิดหน้าพิมพ์ไม่ได้",
          });
        }

        resetAfterSale();
        focusCustomerSearch();
      };

      if (!canSyncNow) {
        await queueSaleForLater("continuity");
        return;
      }

      try {
        if (isAdmin && backdatedEntry && canSyncNow) {
          const precheckRes = await fetch("/api/transactions/precheck", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              customerId: selectedCustomer.id,
              saleDate: effectiveSaleDate,
              saleTime: effectiveSaleTime,
              backdateReason: effectiveBackdateReason,
            }),
          });
          if (!precheckRes.ok) {
            const errPayload = parseApiErrorResponse(
              await precheckRes.json().catch(() => null)
            );
            const requestId = errPayload?.requestId || precheckRes.headers.get("x-request-id") || null;
            const enrichedPayload = errPayload || (requestId
              ? {
                  error: "ไม่สามารถตรวจสอบรายการย้อนหลังได้",
                  requestId,
                }
              : null);
            const errMsg = buildApiErrorDescription(
              enrichedPayload,
              "ไม่สามารถตรวจสอบรายการย้อนหลังได้"
            );
            console.error("[sale.precheck.failed]", {
              status: precheckRes.status,
              statusText: precheckRes.statusText,
              requestId,
              diagnostic: enrichedPayload?.diagnostic || null,
              response: enrichedPayload,
            });
            const errCode = enrichedPayload?.diagnostic?.code;
            toast.error(
              errCode ? `เกิดข้อผิดพลาด [${errCode}]` : "เกิดข้อผิดพลาด",
              { description: errMsg }
            );
            return;
          }
          const precheckData = (await precheckRes.json()) as TransactionPrecheckResponse;
          if (Array.isArray(precheckData.warnings) && precheckData.warnings.length > 0) {
            const warningSummary = precheckData.warnings
              .map((w) => `- ${w.message}`)
              .join("\n");
            const confirmed = window.confirm(
              `พบคำเตือนก่อนบันทึก:\n${warningSummary}\n\nยืนยันบันทึกรายการย้อนหลังต่อหรือไม่?`
            );
            if (!confirmed) return;
          }
        }

        const res = await fetch("/api/transactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(salePayload),
        });

        if (res.ok) {
          const data = await res.json();
          const savedTransferRef = isTransferMode
            ? data.transferRef || normalizedTransferRef
            : null;

          if (sessionFactoryKey && typeof data?.nextBillNumber === "number") {
            applyBillCounterState(sessionFactoryKey, data.nextBillNumber);
          }

          toast.success(
            `บันทึกสำเร็จ #${data.id}`,
            isTransferMode
              ? {
                  description: `${INVOICE_CREDIT_LABEL} ${savedTransferRef}`,
                }
              : hasSaleItems
              ? {
                  description:
                    data.status === "partial"
                      ? `${formatCurrency(data.totalAmount)} บาท (รับแล้ว ${formatCurrency(paymentResolution.printPaid)} / ค้าง ${formatCurrency(paymentResolution.remainingAmount)})`
                      : `${formatCurrency(data.totalAmount)} บาท${data.status === "unpaid" ? ` (${UNPAID_STATUS_LABEL})` : ""}`,
                }
              : {
                  description: `คืนถุง ${bagReturnQty} ใบ`,
                }
          );
          if (Array.isArray(data.warnings) && data.warnings.length > 0) {
            toast.warning("บันทึกพร้อมคำเตือน", {
              description: data.warnings.map((w: TransactionWarning) => w.message).join(" | "),
            });
          }

          const onlinePrintToken =
            printMode !== "none"
              ? saveOfflinePrintPayload({
                  id: data.id,
                  clientId: salePayload.clientId,
                  transactionKind: data.transactionType || (isTransferMode ? "transfer_out" : "sale"),
                  saleDate: effectiveSaleDate,
                  saleTime: effectiveSaleTime,
                  totalAmount: Number(data.totalAmount) || computedTotalForPrint,
                  paid: data.status === "paid"
                    ? Number(data.totalAmount) || computedTotalForPrint
                    : computedPaidForPrint,
                  status:
                    data.status === "paid" || data.status === "unpaid" || data.status === "partial"
                      ? data.status
                      : computedStatusForPrint,
                  pool: null,
                  row: parsedBay,
                  col: null,
                  bagBalanceBefore: customerBagBalance,
                  bagBalanceAfter: nextBagBalance,
                  hidePrintTotals,
                  customer: {
                    id: selectedCustomer.id,
                    name: selectedCustomer.name,
                  },
                  items: savedItems,
                  bagLedgerEntries: printBagLedgerEntries,
                })
              : null;

          setLastSale({
            id: data.id,
            total: data.totalAmount,
            status: data.status,
            transactionType: data.transactionType || (isTransferMode ? "transfer_out" : "sale"),
            printToken: onlinePrintToken,
          });

          try {
            triggerPrint(data.id, printMode, { offlineToken: onlinePrintToken });
          } catch (error) {
            console.warn("[sale] print trigger failed after successful save", error);
            toast.error("พิมพ์ไม่สำเร็จ", {
              description: "บันทึกขายสำเร็จแล้ว แต่เปิดหน้าพิมพ์ไม่ได้",
            });
          }

          if (invoiceReturnContext) {
            window.location.assign(buildInvoiceReturnUrl(invoiceReturnContext, data.id));
            return;
          }

          resetAfterSale();
          focusCustomerSearch();
        } else {
          if (res.status === 401 || res.status === 403) {
            setCanSyncNow(false);
            setContinuityWarning("ขายต่อได้จากข้อมูลในเครื่อง แต่ต้องล็อกอินออนไลน์ก่อนจึงจะซิงก์รายการได้");
            await queueSaleForLater("continuity");
            return;
          }
          // Server returned an error -- show it but don't queue (it's a business logic error, not network)
          const errPayload = parseApiErrorResponse(await res.json().catch(() => null));
          const requestId = errPayload?.requestId || res.headers.get("x-request-id") || null;
          const enrichedPayload = errPayload || (requestId
            ? {
                error: "บันทึกไม่สำเร็จ",
                requestId,
              }
            : null);
          const errMsg = buildApiErrorDescription(enrichedPayload, "บันทึกไม่สำเร็จ");
          console.error("[sale.submit.failed]", {
            status: res.status,
            statusText: res.statusText,
            requestId,
            diagnostic: enrichedPayload?.diagnostic || null,
            response: enrichedPayload,
          });
          const errCode = enrichedPayload?.diagnostic?.code;
          toast.error(
            errCode ? `บันทึกไม่สำเร็จ [${errCode}]` : "เกิดข้อผิดพลาด",
            { description: errMsg }
          );
        }
      } catch (error) {
        // Network error — queue sale for later sync
        const diagnostic = buildClientDiagnostic({
          category: "network.request",
          code: "NET-REQUEST-1000",
          source: "sale.submit",
          operation: "offline-queue-fallback",
          title: "Request could not reach the server",
          hint: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ระบบจะพักรายการไว้เพื่อซิงก์ภายหลัง",
          retryable: true,
        });
        console.warn("[sale.submit.network-fallback]", {
          diagnostic,
          meta: formatApiDiagnosticMeta({
            error: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้",
            diagnostic,
          }),
          error,
        });
        await queueSaleForLater("network");
      }
    } finally {
      setSaving(false);
    }
  }

  function focusCustomerSearch() {
    window.requestAnimationFrame(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    });
  }

  function resetAfterSale() {
    setSelectedCustomer(null);
    setSelectedCustomerPrices([]);
    setSearchQuery("");
    setCustomers([]);
    setShowCustomerList(false);
    setHighlightedCustomerIndex(0);
    setItems([]);
    setBagReturnQty(0);
    setCustomerBagBalance(0);
    setLoadingLocation("");
    setAddProductId("");
    setExactExtraProductId("");
    setPaymentStatus("paid");
    setPartialPaidInput("");
    setTransferRef(buildDefaultTransferRef(getBangkokNowForPayload().saleDate));
    setHidePrintTotals(false);
    setBackdatedEntry(false);
    setBackdateDate(getBangkokNowForPayload().saleDate);
    setBackdateTime(getBangkokNowForPayload().saleTime);
    setBackdateReason("");
  }

  function handleClear() {
    setSelectedCustomer(null);
    setSelectedCustomerPrices([]);
    setSearchQuery("");
    setItems([]);
    setBagReturnQty(0);
    setCustomerBagBalance(0);
    setLoadingLocation("");
    setPaymentStatus("paid");
    setPartialPaidInput("");
    setLastSale(null);
    setAddProductId("");
    setExactExtraProductId("");
    setTransferRef(buildDefaultTransferRef(getBangkokNowForPayload().saleDate));
    setHidePrintTotals(false);
    setBackdatedEntry(false);
    setBackdateDate(getBangkokNowForPayload().saleDate);
    setBackdateTime(getBangkokNowForPayload().saleTime);
    setBackdateReason("");
    searchRef.current?.focus();
  }

  function triggerPrint(
    saleId: number,
    mode: SalePrintMode,
    options?: {
      offlineToken?: string | null;
      offlinePayload?: OfflinePrintPayload | null;
    }
  ) {
    openSalePrint({
      saleId,
      mode,
      offlineToken: options?.offlineToken,
      hidePrintTotals,
      sessionRole,
      canUseEpsonPrintTools,
      offlinePayload: options?.offlinePayload,
    });
  }

  function handlePrint() {
    if (!lastSale || printMode === "none") return;
    triggerPrint(lastSale.id, printMode, { offlineToken: lastSale.printToken });
  }

  function updatePrintMode(mode: SalePrintMode) {
    setPrintMode(mode);
  }

  function updateSaleEntryViewMode(mode: SaleEntryViewMode) {
    setSaleEntryViewMode(mode);
  }

  return (
    <div className="w-full pb-28 md:pb-0 xl:h-[calc(100vh-3rem)] 2xl:h-[calc(100vh-3.5rem)] xl:overflow-hidden xl:flex xl:flex-col xl:text-[15px]">
      <div className="flex items-start justify-between mb-0.5 xl:mb-0.5 gap-2 shrink-0">
        <h1 className="text-xl md:text-2xl xl:text-3xl font-bold text-gray-900 ui-scale-page-title">ขายน้ำแข็ง</h1>
        <div className="text-right">
          <p className="text-xs md:text-sm text-gray-500 ui-scale-page-subtitle">{formatThaiDate(todayISO())}</p>
          <div className="mt-0.5 inline-flex items-center gap-1.5" title={isOnline ? "ออนไลน์" : "ออฟไลน์"}>
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isOnline ? "bg-green-500" : "bg-red-500 animate-pulse"
              }`}
            />
            <span className={`text-xs font-medium ${isOnline ? "text-green-600" : "text-red-600"}`}>
              {isOnline ? "ออนไลน์" : "ออฟไลน์"}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 mb-1 xl:mb-0.5 flex-wrap shrink-0">
        <PendingSales
          pendingCount={pendingCount}
          canSyncNow={canSyncNow}
          onSynced={() => getPendingCount().then(setPendingCount)}
        />
        {lastSale && (
          <div className="flex gap-2 items-center">
            <Badge
              variant={lastSale.status === "unpaid" ? "destructive" : lastSale.status === "partial" ? "outline" : "secondary"}
              className="text-sm px-2 py-1"
            >
              #{lastSale.id} = {formatCurrency(lastSale.total)}
              {lastSale.transactionType === "transfer_out" && ` (${INVOICE_CREDIT_LABEL})`}
              {lastSale.status === "unpaid" && ` (${SHORT_TERM_CREDIT_LABEL})`}
              {lastSale.status === "partial" && " (บางส่วน)"}
            </Badge>
            <Button variant="outline" size="sm" onClick={handlePrint} disabled={printMode === "none"}>
              พิมพ์
            </Button>
          </div>
        )}
      </div>

      <PwaInstallHint />

      {!canSellLocally && !canSyncNow ? (
        <Card className="mb-2 border-amber-200 bg-amber-50 shrink-0">
          <CardContent className="px-4 py-3 text-sm text-amber-900">
            ต้องล็อกอินออนไลน์และเตรียมข้อมูลเครื่องนี้ก่อน จึงจะขายต่อแบบออฟไลน์ได้
          </CardContent>
        </Card>
      ) : null}

      {canSellLocally && continuityWarning ? (
        <Card className="mb-2 border-blue-200 bg-blue-50 shrink-0">
          <CardContent className="px-4 py-3 text-sm text-blue-900">
            {continuityWarning}
          </CardContent>
        </Card>
      ) : null}

      {invoiceReturnContext && (
        <Card className="mb-1.5 xl:mb-1 py-2 gap-1 shrink-0 border-blue-200 bg-blue-50/60">
          <CardContent className="px-4 py-0">
            <div className="flex flex-wrap items-center gap-2 text-sm text-blue-900">
              <Badge variant="outline" className="border-blue-300 bg-white text-blue-700">
                มาจากใบวางบิล
              </Badge>
              <span>
                จะกลับไปช่วงวันที่ {invoiceReturnContext.invoiceStartDate} - {invoiceReturnContext.invoiceEndDate}
              </span>
              {invoiceReturnContext.saleDate && (
                <span>
                  วันที่/เวลาเริ่มต้น {invoiceReturnContext.saleDate} {invoiceReturnContext.saleTime?.slice(0, 5) || ""}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mb-1.5 xl:mb-1 py-2 gap-1 shrink-0">
        <CardContent className="px-4">
          <div className="flex flex-wrap items-start gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-gray-600 ui-scale-body">โหมด:</span>
              <Button
                variant={saleMode === "sale" ? "default" : "outline"}
                size="sm"
                onClick={() => setSaleMode("sale")}
              >
                ขายปกติ
              </Button>
              <Button
                variant={saleMode === "transfer_out" ? "default" : "outline"}
                size="sm"
                onClick={() => setSaleMode("transfer_out")}
              >
                {INVOICE_CREDIT_LABEL}
              </Button>
              {saleMode === "transfer_out" && (
                <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                  ใช้เฉพาะลูกค้าที่มีสถานะ{INVOICE_CREDIT_LABEL} และพิมพ์ลูกค้าแบบไม่แสดงราคา
                </span>
              )}
              <span className="ml-2 text-sm font-medium text-gray-600 ui-scale-body">มุมมอง:</span>
              {saleEntryViewOptions.map((option) => (
                <Button
                  key={option.mode}
                  variant={saleEntryViewMode === option.mode ? "default" : "outline"}
                  size="sm"
                  onClick={() => updateSaleEntryViewMode(option.mode)}
                >
                  {option.label}
                </Button>
              ))}
              <PrintedBillCounter
                value={nextBillNumber}
                loading={loadingBillCounter}
                saving={savingBillCounter}
                onCommit={handleBillCounterCommit}
              />
            </div>

            {isAdmin && (
              <div className="ml-auto flex flex-wrap items-end justify-end gap-2">
                <Button
                  variant={backdatedEntry ? "default" : "outline"}
                  size="sm"
                  onClick={() => setBackdatedEntry((prev) => !prev)}
                >
                  บันทึกรายการย้อนหลัง
                </Button>

                {backdatedEntry && (
                  <>
                    <div className="space-y-1">
                      <Label htmlFor="backdate-date" className="text-xs text-gray-600 ui-scale-label">วันที่ย้อนหลัง</Label>
                      <Input
                        id="backdate-date"
                        type="date"
                        value={backdateDate}
                        min={backdateMinDate}
                        max={backdateMaxDate}
                        onChange={(e) => setBackdateDate(e.target.value)}
                        className="h-8 w-[165px]"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="backdate-time" className="text-xs text-gray-600 ui-scale-label">เวลา</Label>
                      <Input
                        id="backdate-time"
                        type="time"
                        step={1}
                        value={backdateTime}
                        onChange={(e) => setBackdateTime(e.target.value)}
                        className="h-8 w-[120px]"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="backdate-reason" className="text-xs text-gray-600 ui-scale-label">เหตุผล</Label>
                      <Input
                        id="backdate-reason"
                        value={backdateReason}
                        maxLength={500}
                        onChange={(e) => setBackdateReason(e.target.value)}
                        placeholder="ไม่บังคับ"
                        className="h-8 w-[240px]"
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          {isAdmin && backdatedEntry && (
            <p className="mt-2 text-xs text-gray-500 text-right">
              ระบบอนุญาตย้อนหลังได้ไม่เกิน 30 วัน และจะเตือนก่อนบันทึกหากตรงช่วงใบวางบิลที่ออกแล้ว
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] gap-2 xl:gap-1.5 xl:flex-1 xl:min-h-0">
        <div className="space-y-2 xl:space-y-1.5 xl:min-h-0 xl:flex xl:flex-col">
          {/* Customer Selection */}
          <Card className="py-2 gap-1">
            <CardHeader className="pb-1.5 px-4">
              <CardTitle className="text-base xl:text-lg ui-scale-section-title">เลือกลูกค้า</CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <div className="relative">
                <div className="flex gap-1">
                <Input
                  ref={searchRef}
                  data-sale-nav
                  inputMode="numeric"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setShowCustomerList(true);
                    if (!e.target.value) {
                      setSelectedCustomer(null);
                      setSelectedCustomerPrices([]);
                      setItems([]);
                      setBagReturnQty(0);
                      setCustomerBagBalance(0);
                      setPaymentStatus("paid");
                      setPartialPaidInput("");
                    }
                  }}
                  onFocus={() => {
                    if (searchQuery) setShowCustomerList(true);
                  }}
                  placeholder={
                    saleMode === "transfer_out"
                      ? `พิมพ์ลูกค้าที่มีสถานะ${INVOICE_CREDIT_LABEL}`
                      : "พิมพ์ชื่อหรือรหัสลูกค้า..."
                  }
                  className="flex-1"
                  autoFocus
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
                      loadAllCustomersForDropdown();
                      setHighlightedCustomerIndex(0);
                      searchRef.current?.focus();
                    }
                  }}
                  aria-expanded={showCustomerList}
                  aria-label={showCustomerList ? "ปิดรายชื่อลูกค้า" : "เปิดรายชื่อลูกค้า (เรียง ก-ฮ)"}
                  title={showCustomerList ? "ปิดรายชื่อลูกค้า" : "เปิดรายชื่อลูกค้า (เรียง ก-ฮ)"}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={showCustomerList ? "rotate-180" : ""}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </Button>
                </div>
              {showCustomerList && (
                <div className="absolute z-50 w-full mt-1 left-0 right-0 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {customers.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-gray-500">
                      {saleMode === "transfer_out"
                        ? `ไม่พบลูกค้าที่มีสถานะ${INVOICE_CREDIT_LABEL}`
                        : "ไม่พบลูกค้าที่ค้นหา"}
                    </div>
                  ) : (
                    customers.map((c, i) => (
                      <button
                        key={c.id}
                        ref={i === highlightedCustomerIndex ? highlightedCustomerRef : undefined}
                        type="button"
                        className={`w-full text-left px-4 py-3 md:py-2 flex justify-between items-center hover:bg-blue-50 dark:hover:bg-blue-900/20 ${i === highlightedCustomerIndex ? "bg-blue-100 dark:bg-blue-900/30" : ""}`}
                        onClick={() => selectCustomer(c)}
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
                <div className="mt-1 flex items-center gap-2">
                  <Badge>{selectedCustomer.name}</Badge>
                  {getInvoiceCreditEligibilityState(selectedCustomer) === "saved" && (
                    <Badge variant="secondary">{INVOICE_CREDIT_LABEL}</Badge>
                  )}
                  {selectedCustomer.credit && (
                    <Badge variant="destructive">{SHORT_TERM_CREDIT_LABEL}</Badge>
                  )}
                  <Button variant="ghost" size="sm" className="ml-auto text-xs xl:text-sm h-8" onClick={handleClear}>
                    เปลี่ยนลูกค้า
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Sale Items */}
          {selectedCustomer && (
            <Card className="py-2 gap-2 xl:flex-1 xl:min-h-0 xl:flex xl:flex-col">
              <CardHeader className="pb-2 px-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base xl:text-lg ui-scale-section-title">รายการสินค้า</CardTitle>
                  <span className="text-xs text-gray-400">
                    {isBillStyleView ? "6 ช่อง + บรรทัดที่ 7" : `${items.length} รายการ`}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="px-4 xl:min-h-0 xl:overflow-y-auto">
                <div className="space-y-3">
                  <div className="grid grid-cols-12 gap-2 text-xs xl:text-sm font-semibold text-gray-500 px-1 ui-scale-body">
                    <div className="col-span-5 md:col-span-4">สินค้า</div>
                    <div className="hidden md:block md:col-span-2 text-right">ราคา</div>
                    <div className="col-span-4 md:col-span-3 text-center">จำนวน</div>
                    <div className="col-span-3 text-right">รวม</div>
                  </div>
                  <Separator />

                  {items.length === 0 && !isBillStyleView && (
                    <p className="text-center py-4 text-gray-400 text-sm">ลูกค้านี้ยังไม่มีราคาสินค้า — เพิ่มสินค้าด้านล่าง</p>
                  )}

                  {!isBillStyleView && items.map((item) => {
                    const effectiveItem = effectiveItemByProductTypeId.get(item.productTypeId) ?? item;
                    return (
                    <div key={item.productTypeId} className="grid grid-cols-12 gap-2 items-center ui-scale-body">
                      <div className="col-span-5 md:col-span-4">
                        <span className="text-sm xl:text-base font-medium">{item.productName}</span>
                        {item.hasBag && <span className="ml-1 text-xs text-blue-500 hidden md:inline">(มีถุง)</span>}
                        {item.decreasesBag && <span className="ml-1 text-xs text-green-600 hidden md:inline">(ลดถุง)</span>}
                        {item.isAdded && (
                          <button
                            onClick={() => removeAddedItem(item.productTypeId)}
                            className="ml-1 text-xs text-red-400 hover:text-red-600"
                            title="ลบ"
                          >
                            x
                          </button>
                        )}
                      </div>
                      <div className="hidden md:block md:col-span-2 text-right">
                        {item.isAdded ? (
                          <Input
                            type="number"
                            data-sale-nav
                            inputMode="numeric"
                            className="text-right text-sm xl:text-base h-8"
                            value={item.unitPrice || ""}
                            onChange={(e) => updateAddedItemPrice(item.productTypeId, parseFloat(e.target.value) || 0)}
                            placeholder="ราคา"
                            min={0}
                          />
                        ) : (
                          <span className="text-sm xl:text-base font-medium text-gray-700">
                            {formatCurrency(effectiveItem.unitPrice)}
                          </span>
                        )}
                      </div>
                      <div className="col-span-4 md:col-span-3">
                        <Input
                          type="number"
                          data-sale-nav
                          inputMode="numeric"
                          className="text-center text-sm xl:text-base h-10 md:h-8"
                          value={item.quantity || ""}
                          min={0}
                          onChange={(e) => updateItemQuantity(item.productTypeId, parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div className="col-span-3 text-right text-sm xl:text-base font-medium">
                        {effectiveItem.subtotal > 0 ? formatCurrency(effectiveItem.subtotal) : "-"}
                      </div>
                    </div>
                    );
                  })}

                  {isBillStyleView && exactBillRows.map(({ slot, item }) => (
                    <div key={slot.key} className="grid grid-cols-12 gap-2 items-center ui-scale-body">
                      <div className="col-span-5 md:col-span-4">
                        <span className="text-sm xl:text-base font-medium">{slot.label}</span>
                        {item?.hasBag && <span className="ml-1 text-xs text-blue-500 hidden md:inline">(มีถุง)</span>}
                        {item?.decreasesBag && <span className="ml-1 text-xs text-green-600 hidden md:inline">(ลดถุง)</span>}
                        {item?.isAdded && (
                          <button
                            onClick={() => removeAddedItem(item.productTypeId)}
                            className="ml-1 text-xs text-red-400 hover:text-red-600"
                            title="ลบ"
                          >
                            x
                          </button>
                        )}
                        {!item && <span className="ml-1 text-xs text-gray-400 hidden md:inline">(ยังไม่ตั้งราคา)</span>}
                      </div>
                      <div className="hidden md:block md:col-span-2 text-right">
                        {!item ? (
                          <span className="text-sm xl:text-base font-medium text-gray-400">-</span>
                        ) : (
                          <span className="text-sm xl:text-base font-medium text-gray-700">
                            {formatCurrency(item.unitPrice)}
                          </span>
                        )}
                      </div>
                      <div className="col-span-4 md:col-span-3">
                        <Input
                          type="number"
                          data-sale-nav
                          inputMode="numeric"
                          className="text-center text-sm xl:text-base h-10 md:h-8"
                          value={item?.quantity || ""}
                          min={0}
                          disabled={!item}
                          onChange={(e) => {
                            if (!item) return;
                            updateItemQuantity(item.productTypeId, parseFloat(e.target.value) || 0);
                          }}
                        />
                      </div>
                      <div className="col-span-3 text-right text-sm xl:text-base font-medium">
                        {item && item.subtotal > 0 ? formatCurrency(item.subtotal) : "-"}
                      </div>
                    </div>
                  ))}

                  {isBillStyleView && (
                    <>
                      <Separator />
                      <div className="text-xs xl:text-sm font-semibold text-gray-500 px-1 ui-scale-body">
                        บรรทัดที่ 7 (ค่าเริ่มต้น: ซื้อกระสอบ)
                      </div>
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-gray-500 shrink-0 ui-scale-label">เลือกรายการ</Label>
                        <Select
                          value={exactSelectedLine7Item ? String(exactSelectedLine7Item.productTypeId) : ""}
                          onValueChange={selectExactLine7Product}
                        >
                          <SelectTrigger className="h-9 text-xs">
                            <SelectValue placeholder="เลือกบรรทัดที่ 7" />
                          </SelectTrigger>
                          <SelectContent>
                            {exactLine7Candidates.map((item) => (
                              <SelectItem key={item.id} value={String(item.id)}>
                                {item.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {exactSelectedLine7Item && effectiveExactSelectedLine7Item ? (
                        <div key={exactSelectedLine7Item.productTypeId} className="grid grid-cols-12 gap-2 items-center ui-scale-body">
                          <div className="col-span-5 md:col-span-4">
                            <span className="text-sm xl:text-base font-medium">{exactSelectedLine7Item.productName}</span>
                            {exactSelectedLine7Item.hasBag && <span className="ml-1 text-xs text-blue-500 hidden md:inline">(มีถุง)</span>}
                            {exactSelectedLine7Item.decreasesBag && <span className="ml-1 text-xs text-green-600 hidden md:inline">(ลดถุง)</span>}
                            {exactSelectedLine7Item.isAdded && (
                              <button
                                onClick={() => removeAddedItem(exactSelectedLine7Item.productTypeId)}
                                className="ml-1 text-xs text-red-400 hover:text-red-600"
                                title="ลบ"
                              >
                                x
                              </button>
                            )}
                          </div>
                          <div className="hidden md:block md:col-span-2 text-right">
                            {exactSelectedLine7Item.isAdded ? (
                              <Input
                                type="number"
                                data-sale-nav
                                inputMode="numeric"
                                className="text-right text-sm xl:text-base h-8"
                                value={exactSelectedLine7Item.unitPrice || ""}
                                onChange={(e) => updateAddedItemPrice(exactSelectedLine7Item.productTypeId, parseFloat(e.target.value) || 0)}
                                placeholder="ราคา"
                                min={0}
                              />
                            ) : (
                              <span className="text-sm xl:text-base font-medium text-gray-700">
                                {formatCurrency(effectiveExactSelectedLine7Item.unitPrice)}
                              </span>
                            )}
                          </div>
                          <div className="col-span-4 md:col-span-3">
                            <Input
                              type="number"
                              data-sale-nav
                              inputMode="numeric"
                              className="text-center text-sm xl:text-base h-10 md:h-8"
                              value={exactSelectedLine7Item.quantity || ""}
                              min={0}
                              onChange={(e) => updateItemQuantity(exactSelectedLine7Item.productTypeId, parseFloat(e.target.value) || 0)}
                            />
                          </div>
                          <div className="col-span-3 text-right text-sm xl:text-base font-medium">
                            {effectiveExactSelectedLine7Item.subtotal > 0 ? formatCurrency(effectiveExactSelectedLine7Item.subtotal) : "-"}
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 px-1">ไม่พบบรรทัดที่ 7 สำหรับลูกค้านี้</p>
                      )}
                    </>
                  )}

                  {/* Add product button */}
                  {availableToAdd.length > 0 && (
                    <>
                      <Separator />
                      <div className="flex items-center gap-2">
                        <Select value={addProductId} onValueChange={setAddProductId}>
                          <SelectTrigger className="flex-1 h-10 md:h-8 text-sm">
                            <SelectValue placeholder="เพิ่มสินค้าอื่น..." />
                          </SelectTrigger>
                          <SelectContent>
                            {availableToAdd.map((p) => (
                              <SelectItem key={p.id} value={p.id.toString()}>
                                {p.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button size="sm" variant="outline" onClick={handleAddProduct} disabled={!addProductId}>
                          เพิ่ม
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Bag Returns */}
          {selectedCustomer && items.some((i) => i.hasBag) && (
            <Card className="py-3 gap-2">
              <CardContent className="px-4">
                <div className="flex items-center gap-3 md:gap-4 flex-wrap md:flex-nowrap ui-scale-body">
                  <CardTitle className="text-base xl:text-lg shrink-0 ui-scale-section-title">คืนถุง</CardTitle>
                  {customerBagBalance > 0 ? (
                    <span className="text-xs font-medium text-orange-600 bg-orange-50 px-2 py-0.5 rounded shrink-0">
                      ค้าง {customerBagBalance} ใบ
                    </span>
                  ) : (
                    <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded shrink-0">
                      ไม่มีค้าง
                    </span>
                  )}
                  <Label className="text-sm xl:text-base shrink-0 md:ml-auto ui-scale-label">จำนวนถุงคืน</Label>
                  <Input
                    type="number"
                    data-sale-nav
                    inputMode="numeric"
                    className="h-10 md:h-8 text-sm xl:text-base w-24"
                    value={bagReturnQty || ""}
                    min={0}
                    onChange={(e) => setBagReturnQty(parseInt(e.target.value) || 0)}
                    placeholder="0"
                  />
                  <span className="text-xs text-gray-500 shrink-0">ใบ</span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column (desktop) / below items (mobile) */}
        <div className="space-y-2 xl:space-y-1.5 xl:min-h-0 xl:flex xl:flex-col">
          {/* Payment Status */}
          <Card className="shrink-0 py-2 gap-2">
            <CardHeader className="pb-1 px-3.5">
              <CardTitle className="text-base xl:text-lg ui-scale-section-title">สถานะการชำระ</CardTitle>
            </CardHeader>
            <CardContent className="px-3.5">
              <div className="flex gap-1.5">
                <Button
                  variant={paymentStatus === "paid" ? "default" : "outline"}
                  size="sm"
                  className="flex-1 h-9 md:h-8 xl:text-sm"
                  onClick={() => {
                    setPaymentStatus("paid");
                    setPartialPaidInput("");
                  }}
                  disabled={isTransferMode}
                >
                  ชำระแล้ว
                </Button>
                <Button
                  variant={paymentStatus === "unpaid" ? "destructive" : "outline"}
                  size="sm"
                  className="flex-1 h-9 md:h-8 xl:text-sm"
                  onClick={() => {
                    setPaymentStatus("unpaid");
                    setPartialPaidInput("");
                  }}
                  disabled={isTransferMode}
                >
                  {UNPAID_STATUS_LABEL}
                </Button>
                {canUsePartialPayment && (
                  <Button
                    variant={paymentStatus === "partial" ? "secondary" : "outline"}
                    size="sm"
                    className="flex-1 h-9 md:h-8 xl:text-sm"
                    onClick={() => setPaymentStatus("partial")}
                    disabled={isTransferMode}
                  >
                    บางส่วน
                  </Button>
                )}
              </div>
              {canUsePartialPayment && paymentStatus === "partial" && (
                <div className="mt-2 space-y-1">
                  <Label htmlFor="partial-paid" className="text-xs text-gray-600 ui-scale-label">
                    ยอดรับวันนี้
                  </Label>
                  <Input
                    id="partial-paid"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={grandTotal > 0 ? grandTotal : undefined}
                    step="0.01"
                    value={partialPaidInput}
                    onChange={(e) => setPartialPaidInput(e.target.value)}
                    placeholder="0.00"
                    className="h-9 md:h-8 text-sm xl:text-sm"
                  />
                  <p className={`text-xs ${paymentResolution.isValid ? "text-gray-500" : "text-red-600"} ui-scale-page-subtitle`}>
                    {paymentResolution.isValid
                      ? `ค้างเหลือ ${formatCurrency(paymentResolution.remainingAmount)}`
                      : "ยอดรับวันนี้ต้องมากกว่า 0 และน้อยกว่ายอดรวม"}
                  </p>
                </div>
              )}
              {isTransferMode && (
                <p className="text-[11px] text-gray-500 mt-1.5 ui-scale-page-subtitle">โหมด{INVOICE_CREDIT_LABEL}จะบันทึกเป็นชำระแล้วเสมอ และซ่อนราคาบนใบพิมพ์ลูกค้า</p>
              )}
            </CardContent>
          </Card>

          {/* Summary */}
          <Card className="shrink-0 py-2 gap-2 xl:flex-1 xl:min-h-0 xl:flex xl:flex-col">
            <CardHeader className="pb-1 px-3.5">
              <CardTitle className="text-base xl:text-lg ui-scale-section-title">สรุปยอด</CardTitle>
            </CardHeader>
            <CardContent className="px-3.5 space-y-2 xl:min-h-0 xl:overflow-y-auto">
              {effectiveItems
                .filter((i) => i.quantity > 0)
                .map((i) => (
                  <div key={i.productTypeId} className="flex justify-between text-sm xl:text-base ui-scale-body">
                    <span>{i.productName} x{i.quantity}</span>
                    <span>{formatCurrency(i.subtotal)}</span>
                  </div>
                ))}
              {effectiveItems.some((i) => i.quantity > 0) && <Separator />}
              <div className="flex justify-between text-lg xl:text-2xl font-bold ui-scale-summary-value">
                <span>รวมทั้งหมด</span>
                <span className="text-blue-700">{formatCurrency(grandTotal)} บาท</span>
              </div>
              {pricingEvaluation.applied && pricingEvaluation.discountAmount > 0 && (
                <div className="text-xs xl:text-sm text-green-700 font-medium ui-scale-body">
                  ส่วนลดบิลแบริ่งเกิน 1,500 บาท: -{formatCurrency(pricingEvaluation.discountAmount)}
                </div>
              )}
              {paymentStatus === "partial" && hasSaleItems && grandTotal > 0 && (
                <div className="space-y-1 border-t pt-2 text-sm xl:text-base ui-scale-body">
                  <div className="flex justify-between">
                    <span>รับวันนี้</span>
                    <span className="font-medium text-green-700">
                      {paymentResolution.isValid ? formatCurrency(paymentResolution.printPaid) : "-"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>ค้างเหลือ</span>
                    <span className="font-medium text-red-600">
                      {paymentResolution.isValid ? formatCurrency(paymentResolution.remainingAmount) : formatCurrency(grandTotal)}
                    </span>
                  </div>
                </div>
              )}
              {isTransferMode && grandTotal > 0 && (
                <div className="text-sm xl:text-base text-blue-700 font-medium ui-scale-body">
                  โหมด{INVOICE_CREDIT_LABEL} {TRANSFER_REF_REGEX.test(transferRef.trim().toUpperCase()) ? `(${transferRef.trim().toUpperCase()})` : ""} พิมพ์ลูกค้าไม่แสดงราคา
                </div>
              )}
              {paymentStatus === "unpaid" && grandTotal > 0 && (
                <div className="text-sm xl:text-base text-red-600 font-medium ui-scale-body">
                  สถานะ: {UNPAID_STATUS_LABEL}
                </div>
              )}
              {paymentStatus === "partial" && grandTotal > 0 && (
                <div className="text-sm xl:text-base text-amber-700 font-medium ui-scale-body">
                  สถานะ: บางส่วน
                </div>
              )}
              {(totalBagsOut > 0 || totalBagsReturn > 0 || totalBagsDecrease > 0) && (
                <div className="text-sm xl:text-base space-y-0.5 mt-1 border-t pt-1 ui-scale-body">
                  {totalBagsOut > 0 && (
                    <div className="flex justify-between text-red-600">
                      <span>ถุงออก</span>
                      <span>+{totalBagsOut} ใบ</span>
                    </div>
                  )}
                  {totalBagsReturn > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span>ถุงคืน</span>
                      <span>-{totalBagsReturn} ใบ</span>
                    </div>
                  )}
                  {totalBagsDecrease > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span>ซื้อกระสอบ</span>
                      <span>-{totalBagsDecrease} ใบ</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-orange-600 border-t pt-0.5">
                    <span>ถุงค้าง</span>
                    <span>{customerBagBalance + totalBagsOut - totalBagsReturn - totalBagsDecrease} ใบ</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Actions -- desktop inline, mobile hidden (sticky bar below) */}
          <div className="hidden md:block space-y-1 shrink-0">
            <Button
              data-sale-nav
              className="w-full h-9"
              onClick={handleSave}
              disabled={!canSubmitSale}
            >
              {saving ? "กำลังบันทึก..." : "บันทึกรายการ"}
            </Button>
            <Button variant="outline" className="w-full h-9" onClick={handleClear}>
              ล้างข้อมูล
            </Button>
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <span className="text-[11px] text-gray-500 shrink-0">โหมดพิมพ์</span>
              <Select value={printMode} onValueChange={(value) => updatePrintMode(value as SalePrintMode)}>
                <SelectTrigger className="h-8 w-[142px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Print</SelectItem>
                  <SelectItem value="receipt">Receipt Print</SelectItem>
                  <SelectItem value="epson">Epson Print</SelectItem>
                  <SelectItem value="epson_v2">Epson Print 2</SelectItem>
                  <SelectItem value="epson_test">Epson Test Print</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 pt-0.5 text-[11px] text-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hidePrintTotals}
                onChange={(e) => setHidePrintTotals(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span>ซ่อนยอดบนใบพิมพ์ลูกค้า</span>
            </label>
            <div className="hidden 2xl:flex items-center justify-center gap-2 pt-0.5 text-[11px] text-gray-400">
              <span className="space-x-3">
                <span><kbd className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">Enter</kbd> บันทึก</span>
                <span><kbd className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">Esc</kbd> ล้าง</span>
                <span><kbd className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">F2</kbd> ค้นหา</span>
              </span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-gray-400 hover:text-gray-600" title="คีย์ลัด" aria-label="คีย์ลัด">
                    ?
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-3 text-sm" align="center" side="top">
                  <div className="space-y-1.5 font-medium text-gray-900">คีย์ลัด</div>
                  <ul className="mt-2 space-y-1 text-xs text-gray-600">
                    <li><kbd className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">F2</kbd> ค้นหาลูกค้า</li>
                    <li><kbd className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">Enter</kbd> บันทึก / ถัดไป (ในช่อง)</li>
                    <li><kbd className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">Esc</kbd> ล้างข้อมูล</li>
                    <li><kbd className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">ลูกศร</kbd> เลื่อนระหว่างช่อง</li>
                  </ul>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile sticky bottom bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] px-4 py-3 print:hidden" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0.75rem))" }}>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hidePrintTotals}
              onChange={(e) => setHidePrintTotals(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <span>ซ่อนยอดบนใบพิมพ์ลูกค้า</span>
          </label>
          <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="text-xs text-gray-500 ui-scale-summary-label">ยอดรวม</div>
            <div className="text-lg font-bold text-gray-900 ui-scale-summary-value">{formatCurrency(grandTotal)} <span className="text-sm font-normal">บาท</span></div>
          </div>
          <div className="min-w-[140px]">
            <Select value={printMode} onValueChange={(value) => updatePrintMode(value as SalePrintMode)}>
              <SelectTrigger className="h-10 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Print</SelectItem>
                <SelectItem value="receipt">Receipt Print</SelectItem>
                <SelectItem value="epson">Epson Print</SelectItem>
                <SelectItem value="epson_v2">Epson Print 2</SelectItem>
                <SelectItem value="epson_test">Epson Test Print</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            data-sale-nav
            size="lg"
            className="h-12 px-6 text-base"
            onClick={handleSave}
            disabled={!canSubmitSale}
          >
            {saving ? "บันทึก..." : "บันทึก"}
          </Button>
        </div>
        </div>
      </div>
    </div>
  );
}
