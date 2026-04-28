import type { Customer, ProductType } from "@/lib/types";
import { compareProductsByDisplayOrder } from "@/lib/product-order";
import {
  cacheCustomerPriceMatrix,
  cacheCustomers,
  cacheProducts,
  getCachedCustomers,
  getCachedProducts,
  type CachedCustomerPrice,
} from "@/lib/offline-store";
import { resolveClientSaleFactoryKey } from "@/lib/sale-continuity";

interface CustomerPriceMatrixResponse {
  matrix?: Array<{
    customerId?: unknown;
    prices?: Record<string, unknown>;
  }>;
}

export interface OfflineReferenceCacheWarmResult {
  activeProducts: ProductType[];
  customerCount: number;
  priceMatrixRowCount: number;
  usedCachedReferences: boolean;
}

export interface OfflineReferenceCacheStatus {
  factoryKey: string | null;
  hasProducts: boolean;
  hasCustomers: boolean;
  lastPreparedAt: string | null;
  ready: boolean;
}

const REFERENCE_READY_PREFIX = "superice-sale-reference-ready";

function readinessKey(factoryKey: string): string {
  return `${REFERENCE_READY_PREFIX}:${factoryKey}`;
}

function writeReadinessMarker(factoryKey: string | null): void {
  if (!factoryKey || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(readinessKey(factoryKey), new Date().toISOString());
  } catch {
    // Best effort only.
  }
}

function readReadinessMarker(factoryKey: string | null): string | null {
  if (!factoryKey || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(readinessKey(factoryKey));
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

function normalizePriceMatrix(
  data: CustomerPriceMatrixResponse
): Array<{ customerId: number; prices: CachedCustomerPrice[] }> {
  if (!Array.isArray(data.matrix)) return [];

  return data.matrix
    .map((row) => {
      const customerId =
        typeof row.customerId === "number" && Number.isInteger(row.customerId)
          ? row.customerId
          : null;
      if (!customerId) return null;

      const prices = Object.entries(row.prices || {}).flatMap(([productTypeId, unitPrice]) => {
        const parsedProductTypeId = Number.parseInt(productTypeId, 10);
        const normalizedUnitPrice =
          typeof unitPrice === "number"
            ? unitPrice
            : typeof unitPrice === "string"
              ? Number.parseFloat(unitPrice)
              : Number.NaN;
        if (!Number.isInteger(parsedProductTypeId) || !Number.isFinite(normalizedUnitPrice)) {
          return [];
        }
        return [{
          productTypeId: parsedProductTypeId,
          unitPrice: normalizedUnitPrice,
          bagDeposit: 0,
        }];
      });

      return { customerId, prices };
    })
    .filter((row): row is { customerId: number; prices: CachedCustomerPrice[] } => !!row);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }
  return (await response.json()) as T;
}

async function warmOfflineReferenceCache(): Promise<OfflineReferenceCacheWarmResult> {
  const activeFactoryKey = resolveClientSaleFactoryKey();
  const [productsResult, customersResult, pricesResult] = await Promise.allSettled([
    fetchJson<ProductType[]>("/api/products"),
    fetchJson<Customer[]>("/api/customers?search="),
    fetchJson<CustomerPriceMatrixResponse>("/api/customers/prices?search="),
  ]);

  let activeProducts: ProductType[] = [];
  let usedCachedReferences = false;
  if (productsResult.status === "fulfilled") {
    activeProducts = productsResult.value
      .filter((product) => product.isActive)
      .sort(compareProductsByDisplayOrder);
    if (activeProducts.length > 0) {
      await cacheProducts(activeProducts, activeFactoryKey);
    }
  } else {
    const cachedProducts = await getCachedProducts(activeFactoryKey);
    if (cachedProducts && cachedProducts.length > 0) {
      activeProducts = cachedProducts
        .filter((product) => product.isActive)
        .sort(compareProductsByDisplayOrder);
      usedCachedReferences = true;
    } else {
      throw productsResult.reason;
    }
  }

  let customerCount = 0;
  if (customersResult.status === "fulfilled" && customersResult.value.length > 0) {
    customerCount = customersResult.value.length;
    await cacheCustomers(customersResult.value, activeFactoryKey);
  }

  let priceMatrixRowCount = 0;
  if (pricesResult.status === "fulfilled") {
    const normalizedRows = normalizePriceMatrix(pricesResult.value);
    if (normalizedRows.length > 0) {
      priceMatrixRowCount = normalizedRows.length;
      await cacheCustomerPriceMatrix(normalizedRows, activeFactoryKey);
    }
  }

  if (activeProducts.length > 0 && customerCount > 0) {
    writeReadinessMarker(activeFactoryKey);
  }

  return {
    activeProducts,
    customerCount,
    priceMatrixRowCount,
    usedCachedReferences,
  };
}

let inFlightWarmPromise: Promise<OfflineReferenceCacheWarmResult> | null = null;

export async function refreshOfflineReferenceCache(): Promise<OfflineReferenceCacheWarmResult> {
  return warmOfflineReferenceCache();
}

export async function getOfflineReferenceCacheStatus(
  factoryKey?: string | null
): Promise<OfflineReferenceCacheStatus> {
  const resolvedFactoryKey = factoryKey ?? resolveClientSaleFactoryKey();
  const [products, customers] = await Promise.all([
    getCachedProducts(resolvedFactoryKey),
    getCachedCustomers("", resolvedFactoryKey),
  ]);
  const existingPreparedAt = readReadinessMarker(resolvedFactoryKey);
  const hasProducts = Boolean(products?.length);
  const hasCustomers = Boolean(customers?.length);
  const ready = hasProducts && hasCustomers;
  if (ready && !existingPreparedAt) {
    writeReadinessMarker(resolvedFactoryKey);
  }
  const lastPreparedAt = readReadinessMarker(resolvedFactoryKey);
  return {
    factoryKey: resolvedFactoryKey,
    hasProducts,
    hasCustomers,
    lastPreparedAt,
    ready,
  };
}

export function ensureOfflineReferenceCacheWarm(): Promise<OfflineReferenceCacheWarmResult> {
  if (!inFlightWarmPromise) {
    inFlightWarmPromise = warmOfflineReferenceCache().finally(() => {
      inFlightWarmPromise = null;
    });
  }

  return inFlightWarmPromise;
}

export function __resetOfflineReferenceCacheWarmForTests(): void {
  inFlightWarmPromise = null;
}
