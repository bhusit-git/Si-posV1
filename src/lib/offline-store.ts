/**
 * Offline data cache using IndexedDB (via idb-keyval).
 *
 * Caches products, customers, and per-customer prices so the Sale page
 * can function during brief internet outages.
 */
import { get, set, del, keys } from "idb-keyval";
import type { ProductType, Customer, CustomerPrice } from "@/lib/types";
import { parseCustomerQuery } from "@/lib/filter-utils";
import { resolveClientSaleFactoryKey } from "@/lib/sale-continuity";

// ---- Keys ----
const KEY_PRODUCTS = "products";
const KEY_PRODUCTS_AT = "products:at";
const KEY_CUSTOMERS = "customers";
const KEY_CUSTOMERS_AT = "customers:at";
const PRICE_PREFIX = "prices:";
const LEGACY_KEY_PRODUCTS = "cache:products";
const LEGACY_KEY_PRODUCTS_AT = "cache:products:at";
const LEGACY_KEY_CUSTOMERS = "cache:customers";
const LEGACY_KEY_CUSTOMERS_AT = "cache:customers:at";
const LEGACY_PRICE_PREFIX = "cache:prices:";

// Stale threshold (1 hour) -- data is still usable but will be refreshed when online
const STALE_MS = 60 * 60 * 1000;

export type CachedCustomerPrice = Pick<
  CustomerPrice,
  "productTypeId" | "unitPrice" | "bagDeposit"
>;

function mergeCustomers(existing: Customer[], incoming: Customer[]): Customer[] {
  const merged = new Map<number, Customer>();
  for (const customer of existing) {
    merged.set(customer.id, customer);
  }
  for (const customer of incoming) {
    const previous = merged.get(customer.id);
    merged.set(customer.id, previous ? { ...previous, ...customer } : customer);
  }
  return Array.from(merged.values());
}

function getActiveFactoryKey(factoryKey?: string | null): string {
  return factoryKey ?? resolveClientSaleFactoryKey() ?? "default";
}

function scopedCacheKey(key: string, factoryKey?: string | null): string {
  return `cache:${getActiveFactoryKey(factoryKey)}:${key}`;
}

async function getScopedValue<T>(
  key: string,
  legacyKey?: string,
  factoryKey?: string | null
): Promise<T | null> {
  const scopedValue = await get<T>(scopedCacheKey(key, factoryKey));
  if (scopedValue != null) return scopedValue;
  if (!legacyKey) return null;
  return (await get<T>(legacyKey)) ?? null;
}

function priceCacheKey(customerId: number, factoryKey?: string | null): string {
  return scopedCacheKey(`${PRICE_PREFIX}${customerId}`, factoryKey);
}

// ==================== Products ====================

export async function cacheProducts(
  data: ProductType[],
  factoryKey?: string | null
): Promise<void> {
  await set(scopedCacheKey(KEY_PRODUCTS, factoryKey), data);
  await set(scopedCacheKey(KEY_PRODUCTS_AT, factoryKey), Date.now());
}

export async function getCachedProducts(factoryKey?: string | null): Promise<ProductType[] | null> {
  return await getScopedValue<ProductType[]>(KEY_PRODUCTS, LEGACY_KEY_PRODUCTS, factoryKey);
}

export async function isProductsCacheStale(factoryKey?: string | null): Promise<boolean> {
  const at = await getScopedValue<number>(KEY_PRODUCTS_AT, LEGACY_KEY_PRODUCTS_AT, factoryKey);
  if (!at) return true;
  return Date.now() - at > STALE_MS;
}

// ==================== Customers ====================

export async function cacheCustomers(
  data: Customer[],
  factoryKey?: string | null
): Promise<void> {
  const existing =
    (await getScopedValue<Customer[]>(KEY_CUSTOMERS, LEGACY_KEY_CUSTOMERS, factoryKey)) ?? [];
  await set(scopedCacheKey(KEY_CUSTOMERS, factoryKey), mergeCustomers(existing, data));
  await set(scopedCacheKey(KEY_CUSTOMERS_AT, factoryKey), Date.now());
}

export async function getCachedCustomers(
  search?: string,
  factoryKey?: string | null
): Promise<Customer[] | null> {
  const all = await getScopedValue<Customer[]>(KEY_CUSTOMERS, LEGACY_KEY_CUSTOMERS, factoryKey);
  if (!all) return null;
  if (!search || search.trim() === "") return all;
  const parsedSearch = parseCustomerQuery(search);
  if (parsedSearch.customerIds.length > 0) {
    return all.filter((customer) => parsedSearch.customerIds.includes(customer.id));
  }
  const q = parsedSearch.customerNameQuery || "";
  return all.filter(
    (c) =>
      c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q))
  );
}

export async function isCustomersCacheStale(factoryKey?: string | null): Promise<boolean> {
  const at = await getScopedValue<number>(
    KEY_CUSTOMERS_AT,
    LEGACY_KEY_CUSTOMERS_AT,
    factoryKey
  );
  if (!at) return true;
  return Date.now() - at > STALE_MS;
}

// ==================== Customer Prices ====================

export async function cacheCustomerPrices(
  customerId: number,
  prices: CachedCustomerPrice[],
  factoryKey?: string | null
): Promise<void> {
  await set(priceCacheKey(customerId, factoryKey), prices);
}

export async function cacheCustomerPriceMatrix(
  rows: Array<{ customerId: number; prices: CachedCustomerPrice[] }>,
  factoryKey?: string | null
): Promise<void> {
  for (const row of rows) {
    await cacheCustomerPrices(row.customerId, row.prices, factoryKey);
  }
}

export async function getCachedCustomerPrices(
  customerId: number,
  factoryKey?: string | null
): Promise<CachedCustomerPrice[] | null> {
  return await getScopedValue<CachedCustomerPrice[]>(
    `${PRICE_PREFIX}${customerId}`,
    `${LEGACY_PRICE_PREFIX}${customerId}`,
    factoryKey
  );
}

// ==================== Utilities ====================

/** Clear all cached data (e.g. on logout) */
export async function clearOfflineCache(factoryKey?: string | null): Promise<void> {
  const allKeys = await keys();
  const cachePrefix = `cache:${getActiveFactoryKey(factoryKey)}:`;
  for (const k of allKeys) {
    if (typeof k === "string" && k.startsWith(cachePrefix)) {
      await del(k);
    }
  }
}
