import {
  summarizeBagLedgerEntries,
  type BagFlowSummary,
  type BagFlowItemLike,
  type BagLedgerEntryLike,
} from "@/lib/bag-flow";
import {
  analyticsSaleTypeThaiLabel,
  resolveAnalyticsSaleType,
} from "@/lib/sale-payment";
import {
  buildAnalyticsBaseProperties,
  type AnalyticsEventOrigin,
} from "@/lib/posthog-events";

export const SALE_ANALYTICS_SNAPSHOT_EVENT = "sale_analytics_snapshot";

export interface SaleAnalyticsMetrics {
  itemsCount: number;
  quantityTotal: number;
  bagsOut: number;
  bagsReturned: number;
  bagsBought: number;
}

interface SaleAnalyticsPropertiesInput {
  transactionId: number;
  customerId: number | null;
  totalAmount: number;
  paymentStatus: string;
  transactionType: string | null;
  transferRef: string | null;
  factoryKey: string;
  paidAmount?: number | null;
  outstandingAmount?: number | null;
  metrics: SaleAnalyticsMetrics;
  printedBillNumber?: number | null;
  billNumber?: string | null;
  internalReference?: string | null;
  saleDate?: string | null;
  saleTime?: string | null;
  isBackdated?: boolean;
  warningCount?: number;
  sourceSystem?: string | null;
  actorUserId?: number | null;
  actorRole?: string | null;
  eventOrigin?: AnalyticsEventOrigin;
  eventSource?: string;
}

function toPositiveNumber(value: unknown): number {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return 0;
  return numericValue;
}

export function countPositiveQuantityItems(
  items: Array<{ quantity?: number | null } | null | undefined> | null | undefined
): number {
  return (items || []).reduce((count, item) => {
    return count + (toPositiveNumber(item?.quantity) > 0 ? 1 : 0);
  }, 0);
}

export function sumPositiveItemQuantity(
  items: Array<{ quantity?: number | null } | null | undefined> | null | undefined
): number {
  return (items || []).reduce((quantityTotal, item) => {
    return quantityTotal + toPositiveNumber(item?.quantity);
  }, 0);
}

export function deriveLiveSaleAnalyticsMetrics(params: {
  items: BagFlowItemLike[] | null | undefined;
  saleBagSummary: Pick<BagFlowSummary, "bagsOut" | "bagsReturned" | "bagsBought">;
}): SaleAnalyticsMetrics {
  return {
    itemsCount: countPositiveQuantityItems(params.items),
    quantityTotal: sumPositiveItemQuantity(params.items),
    bagsOut: toPositiveNumber(params.saleBagSummary.bagsOut),
    bagsReturned: toPositiveNumber(params.saleBagSummary.bagsReturned),
    bagsBought: toPositiveNumber(params.saleBagSummary.bagsBought),
  };
}

export function deriveHistoricalSaleAnalyticsMetrics(params: {
  items: BagFlowItemLike[] | null | undefined;
  bagLedgerEntries: BagLedgerEntryLike[] | null | undefined;
}): SaleAnalyticsMetrics {
  const baggedItemSummary = (params.items || []).reduce(
    (summary, item) => {
      const quantity = toPositiveNumber(item?.quantity);
      if (quantity <= 0) return summary;
      if (item?.productType?.hasBag) summary.bagsOut += quantity;
      return summary;
    },
    { bagsOut: 0 }
  );
  const ledgerSummary = summarizeBagLedgerEntries(params.bagLedgerEntries);

  return {
    itemsCount: countPositiveQuantityItems(params.items),
    quantityTotal: sumPositiveItemQuantity(params.items),
    bagsOut: baggedItemSummary.bagsOut,
    bagsReturned: toPositiveNumber(ledgerSummary.bagsReturned),
    bagsBought: toPositiveNumber(ledgerSummary.bagsBought),
  };
}

export function buildSaleAnalyticsProperties(
  input: SaleAnalyticsPropertiesInput
): {
  schema_version: number;
  app: string;
  event_origin: AnalyticsEventOrigin;
  factory_key: string | null;
  actor_user_id: number | null;
  actor_role: string | null;
  transaction_id: number;
  customer_id: number | null;
  total_amount: number;
  paid_amount: number | null;
  outstanding_amount: number | null;
  payment_status: string;
  transaction_type: string | null;
  transfer_ref: string | null;
  sale_type: string;
  sale_type_th: string;
  items_count: number;
  quantity_total: number;
  bags_out: number;
  bags_returned: number;
  bags_bought: number;
  printed_bill_number: number | null;
  bill_number: string | null;
  internal_reference: string | null;
  sale_date: string | null;
  sale_time: string | null;
  is_backdated: boolean;
  warning_count: number;
  source_system: string | null;
  event_source?: string;
} {
  const saleType = resolveAnalyticsSaleType({
    transactionType: input.transactionType,
    paymentStatus: input.paymentStatus,
  });

  return {
    ...buildAnalyticsBaseProperties({
      eventOrigin: input.eventOrigin || "server",
      actorUserId: input.actorUserId ?? null,
      actorRole: input.actorRole ?? null,
      factoryKey: input.factoryKey,
    }),
    transaction_id: input.transactionId,
    customer_id: input.customerId,
    total_amount: Number(input.totalAmount || 0),
    paid_amount:
      input.paidAmount == null ? null : Number(input.paidAmount || 0),
    outstanding_amount:
      input.outstandingAmount == null ? null : Number(input.outstandingAmount || 0),
    payment_status: input.paymentStatus,
    transaction_type: input.transactionType,
    transfer_ref: input.transferRef,
    sale_type: saleType,
    sale_type_th: analyticsSaleTypeThaiLabel(saleType),
    items_count: input.metrics.itemsCount,
    quantity_total: input.metrics.quantityTotal,
    bags_out: input.metrics.bagsOut,
    bags_returned: input.metrics.bagsReturned,
    bags_bought: input.metrics.bagsBought,
    printed_bill_number: input.printedBillNumber ?? null,
    bill_number: input.billNumber ?? null,
    internal_reference: input.internalReference ?? null,
    sale_date: input.saleDate ?? null,
    sale_time: input.saleTime ?? null,
    is_backdated: input.isBackdated ?? false,
    warning_count: input.warningCount ?? 0,
    source_system: input.sourceSystem ?? null,
    ...(input.eventSource ? { event_source: input.eventSource } : {}),
  };
}

export function buildSaleAnalyticsSnapshotDistinctId(
  factoryKey: string,
  customerId: number | null | undefined
): string {
  return customerId != null
    ? `customer:${factoryKey}:${customerId}`
    : `customer:${factoryKey}:unknown`;
}

export function buildSaleAnalyticsSnapshotUuid(
  factoryKey: string,
  transactionId: number
): string {
  return `${SALE_ANALYTICS_SNAPSHOT_EVENT}-${factoryKey}-${transactionId}`;
}
