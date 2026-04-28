export const BUY_BAGS_LEDGER_NOTE = "ซื้อกระสอบ";

export type BagLedgerEntryType = "out" | "return" | "adjust";

export interface BagLedgerEntryLike {
  type?: string | null;
  quantity?: number | null;
  note?: string | null;
}

export interface BagFlowItemLike {
  quantity?: number | null;
  productType?: {
    hasBag?: boolean | null;
    decreasesBag?: boolean | null;
  } | null;
}

export interface BagFlowSummary {
  bagsOut: number;
  bagsReturned: number;
  bagsBought: number;
  bagAdjustDelta: number;
  balanceDelta: number;
}

export interface BagDisplayQuantities {
  bagsOut: number;
  bagsReturned: number;
}

export interface BagLedgerWrite {
  type: BagLedgerEntryType;
  quantity: number;
  note: string | null;
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeNote(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase().replace(/\s+/g, "");
}

export function isBuyBagsLedgerNote(note: string | null | undefined): boolean {
  return normalizeNote(note) === normalizeNote(BUY_BAGS_LEDGER_NOTE);
}

export function getBagEntryBalanceDelta(entry: BagLedgerEntryLike): number {
  const quantity = toNumber(entry.quantity);
  if ((entry.type || "").toLowerCase() === "out") return Math.max(0, quantity);
  if ((entry.type || "").toLowerCase() === "return") return -Math.max(0, quantity);
  if ((entry.type || "").toLowerCase() === "adjust") return quantity;
  return 0;
}

export function summarizeBagLedgerEntries(
  entries: BagLedgerEntryLike[] | null | undefined
): BagFlowSummary {
  let bagsOut = 0;
  let bagsReturned = 0;
  let bagsBought = 0;
  let bagAdjustDelta = 0;

  for (const entry of entries || []) {
    const type = (entry.type || "").toLowerCase();
    const quantity = toNumber(entry.quantity);
    if (type === "out") {
      bagsOut += Math.max(0, quantity);
      continue;
    }
    if (type === "return") {
      if (isBuyBagsLedgerNote(entry.note)) bagsBought += Math.max(0, quantity);
      else bagsReturned += Math.max(0, quantity);
      continue;
    }
    if (type === "adjust") {
      bagAdjustDelta += quantity;
    }
  }

  return {
    bagsOut,
    bagsReturned,
    bagsBought,
    bagAdjustDelta,
    balanceDelta: bagsOut - bagsReturned - bagsBought + bagAdjustDelta,
  };
}

export function getBagBalanceFromEntries(
  entries: BagLedgerEntryLike[] | null | undefined
): number {
  return summarizeBagLedgerEntries(entries).balanceDelta;
}

export function getBagDisplayQuantities(
  summary: Pick<BagFlowSummary, "bagsOut" | "bagsReturned" | "bagsBought" | "bagAdjustDelta">
): BagDisplayQuantities {
  const bagsOut = Math.max(0, toNumber(summary.bagsOut));
  const bagsReturned = Math.max(0, toNumber(summary.bagsReturned));
  const bagsBought = Math.max(0, toNumber(summary.bagsBought));
  const bagAdjustDelta = toNumber(summary.bagAdjustDelta);

  return {
    bagsOut: bagsOut + bagAdjustDelta,
    bagsReturned: bagsReturned + bagsBought,
  };
}

export function summarizeSaleBagFlow(params: {
  items: BagFlowItemLike[] | null | undefined;
  manualBagReturnQty?: number | null;
}): BagFlowSummary {
  let bagsOut = 0;
  let bagsBought = 0;

  for (const item of params.items || []) {
    const quantity = Math.max(0, toNumber(item.quantity));
    if (quantity <= 0) continue;
    if (item.productType?.hasBag) bagsOut += quantity;
    if (item.productType?.decreasesBag) bagsBought += quantity;
  }

  const bagsReturned = Math.max(0, toNumber(params.manualBagReturnQty));
  return {
    bagsOut,
    bagsReturned,
    bagsBought,
    bagAdjustDelta: 0,
    balanceDelta: bagsOut - bagsReturned - bagsBought,
  };
}

export function summarizeRefundBagFlow(params: {
  items: BagFlowItemLike[] | null | undefined;
  manualBagReturnQty?: number | null;
}): BagFlowSummary {
  let bagAdjustDelta = 0;

  for (const item of params.items || []) {
    const quantity = Math.max(0, toNumber(item.quantity));
    if (quantity <= 0) continue;
    if (item.productType?.hasBag) bagAdjustDelta -= quantity;
    if (item.productType?.decreasesBag) bagAdjustDelta += quantity;
  }

  const bagsReturned = Math.max(0, toNumber(params.manualBagReturnQty));
  return {
    bagsOut: 0,
    bagsReturned,
    bagsBought: 0,
    bagAdjustDelta,
    balanceDelta: bagAdjustDelta - bagsReturned,
  };
}

export function buildBagLedgerWrites(summary: BagFlowSummary, params?: {
  adjustNote?: string | null;
  manualReturnNote?: string | null;
}): BagLedgerWrite[] {
  const writes: BagLedgerWrite[] = [];

  if (summary.bagsOut > 0) {
    writes.push({ type: "out", quantity: summary.bagsOut, note: null });
  }
  if (summary.bagsBought > 0) {
    writes.push({
      type: "return",
      quantity: summary.bagsBought,
      note: BUY_BAGS_LEDGER_NOTE,
    });
  }
  if (summary.bagsReturned > 0) {
    writes.push({
      type: "return",
      quantity: summary.bagsReturned,
      note: params?.manualReturnNote ?? null,
    });
  }
  if (summary.bagAdjustDelta !== 0) {
    writes.push({
      type: "adjust",
      quantity: summary.bagAdjustDelta,
      note: params?.adjustNote ?? null,
    });
  }

  return writes;
}

export function buildRefundBagAdjustNote(originalBill: number | null | undefined): string {
  return originalBill ? `ยกเลิกบิล #${originalBill}` : "ยกเลิกบิล";
}

export function reverseBagLedgerEntry(entry: BagLedgerEntryLike): {
  type: BagLedgerEntryType;
  quantity: number;
} {
  const type = (entry.type || "").toLowerCase();
  const quantity = toNumber(entry.quantity);
  if (type === "out") {
    return { type: "return", quantity: Math.max(0, quantity) };
  }
  if (type === "return") {
    return { type: "out", quantity: Math.max(0, quantity) };
  }
  return { type: "adjust", quantity: -quantity };
}

export function withRunningBagBalance<T extends BagLedgerEntryLike>(
  entries: T[]
): Array<T & { runningBalance: number; balanceDelta: number }> {
  const reversed = [...entries].reverse();
  let runningBalance = 0;
  const mapped = reversed.map((entry) => {
    const balanceDelta = getBagEntryBalanceDelta(entry);
    runningBalance += balanceDelta;
    return { ...entry, runningBalance, balanceDelta };
  });
  return mapped.reverse();
}
