import { summarizeBagLedgerEntries } from "@/lib/bag-flow";

export interface PreprintedSourceItem {
  productTypeId?: number | null;
  quantity: number;
  unitPrice?: number | null;
  subtotal?: number | null;
  productType?: {
    name?: string | null;
    hasBag?: boolean;
    decreasesBag?: boolean;
  } | null;
}

export interface PreprintedSourceBagEntry {
  type?: string | null;
  quantity?: number | null;
  note?: string | null;
}

export interface PreprintedBillLineModel {
  line1BlockIceQty: number;
  line2Pack20Qty: number;
  line3LargeTube20KgQty: number;
  line4SmallTubeCrushedQty: number;
  line5LargeTubeCrushedQty: number;
  line6SmallTube20KgQty: number;
  line7BuyBagsQty: number;
  line8BagsOutQty: number;
  line9BagsReturnQty: number;
  line10NetBagQty: number;
  line1BlockIceAmount: number;
  line2Pack20Amount: number;
  line3LargeTube20KgAmount: number;
  line4SmallTubeCrushedAmount: number;
  line5LargeTubeCrushedAmount: number;
  line6SmallTube20KgAmount: number;
  line7BuyBagsAmount: number;
  line7DisplayLabel: string;
  line7DisplayQty: number;
  line7DisplayAmount: number;
  extraDetails: Array<{ label: string; quantity: number; amount: number }>;
  extraDetailText: string;
}

const ALIASES = {
  blockIce: ["ซอง", "น้ำแข็งซอง", "blockice", "block ice"],
  pack20: ["แพ็ค20", "pack20", "pack 20"],
  large20: ["หลอดใหญ่20กก.", "หลอดใหญ่20กก", "largetube20kg", "large tube 20kg"],
  smallCrushed: ["หลอดดล็กโม่", "หลอดเล็กโม่", "smalltubecrushed", "small tube crushed"],
  largeCrushed: ["หลอดใหญ่โม่", "largetubecrushed", "large tube crushed"],
  small20: ["หลอดดล็ก20กก.", "หลอดดล็ก20กก", "หลอดเล็ก20กก.", "หลอดเล็ก20กก", "smalltube20kg", "small tube 20kg"],
  buyBagsTracked: ["ซื้อกระสอบ", "buybags", "buy bags"],
  pack10: ["แพ็ค10", "pack10", "pack 10"],
  buyBagsUntracked: ["ซื้อกระสอบไม่ติดตาม", "buybagsnottracked", "buy bags untracked"],
  shipping: ["ค่าขนส่ง", "shipping"],
  installment: ["ค่าผ่อน", "installment"],
  bagPack: ["ถุงแพ็คใส", "bagpack", "bag pack"],
};

function normalizeName(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function toQty(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toAmount(item: PreprintedSourceItem): number {
  const subtotal = Number(item.subtotal);
  if (Number.isFinite(subtotal)) return Math.abs(subtotal);
  const qty = Math.abs(toQty(item.quantity));
  const unitPrice = Number(item.unitPrice);
  if (Number.isFinite(unitPrice)) return Math.abs(unitPrice) * qty;
  return 0;
}

function isAlias(name: string, candidates: string[]): boolean {
  return candidates.some((candidate) => name === normalizeName(candidate));
}

function formatQty(value: number): string {
  if (Number.isInteger(value)) return `${value}`;
  return value.toFixed(2).replace(/\.00$/, "");
}

function formatAmount(value: number): string {
  return value.toFixed(2);
}

function increment(
  bucket: Map<string, { label: string; quantity: number; amount: number }>,
  label: string,
  qty: number,
  amount: number,
): void {
  if (qty <= 0 && amount <= 0) return;
  const current = bucket.get(label);
  if (!current) {
    bucket.set(label, { label, quantity: qty, amount });
    return;
  }
  current.quantity += qty;
  current.amount += amount;
}

export function mapTransactionToPreprintedBill(params: {
  items: PreprintedSourceItem[];
  bagLedgerEntries?: PreprintedSourceBagEntry[] | null;
  exactLine7ProductTypeId?: number | null;
  exactLine7ProductName?: string | null;
  bagBalanceAfter?: number | null;
}): PreprintedBillLineModel {
  const items = Array.isArray(params.items) ? params.items : [];
  const bagLedgerEntries = Array.isArray(params.bagLedgerEntries) ? params.bagLedgerEntries : [];

  let line1BlockIceQty = 0;
  let line2Pack20Qty = 0;
  let line3LargeTube20KgQty = 0;
  let line4SmallTubeCrushedQty = 0;
  let line5LargeTubeCrushedQty = 0;
  let line6SmallTube20KgQty = 0;

  let line1BlockIceAmount = 0;
  let line2Pack20Amount = 0;
  let line3LargeTube20KgAmount = 0;
  let line4SmallTubeCrushedAmount = 0;
  let line5LargeTubeCrushedAmount = 0;
  let line6SmallTube20KgAmount = 0;

  let line7BuyBagsQtyByName = 0;
  let line7BuyBagsAmountByName = 0;
  let line7BuyBagsQtyByFlag = 0;
  let line7BuyBagsAmountByFlag = 0;

  let bagsOutFallback = 0;

  const extras = new Map<string, { label: string; quantity: number; amount: number }>();

  for (const item of items) {
    const signedQty = toQty(item.quantity);
    const quantity = Math.abs(signedQty);
    if (quantity <= 0) continue;

    const amount = toAmount(item);

    if (item.productType?.decreasesBag && signedQty > 0) {
      line7BuyBagsQtyByFlag += signedQty;
      line7BuyBagsAmountByFlag += amount;
    }

    if (item.productType?.hasBag && signedQty > 0) {
      bagsOutFallback += signedQty;
    }

    const rawName = item.productType?.name || "";
    const name = normalizeName(rawName);

    if (isAlias(name, ALIASES.blockIce)) {
      line1BlockIceQty += quantity;
      line1BlockIceAmount += amount;
      continue;
    }
    if (isAlias(name, ALIASES.pack20)) {
      line2Pack20Qty += quantity;
      line2Pack20Amount += amount;
      continue;
    }
    if (isAlias(name, ALIASES.large20)) {
      line3LargeTube20KgQty += quantity;
      line3LargeTube20KgAmount += amount;
      continue;
    }
    if (isAlias(name, ALIASES.smallCrushed)) {
      line4SmallTubeCrushedQty += quantity;
      line4SmallTubeCrushedAmount += amount;
      continue;
    }
    if (isAlias(name, ALIASES.largeCrushed)) {
      line5LargeTubeCrushedQty += quantity;
      line5LargeTubeCrushedAmount += amount;
      continue;
    }
    if (isAlias(name, ALIASES.small20)) {
      line6SmallTube20KgQty += quantity;
      line6SmallTube20KgAmount += amount;
      continue;
    }
    if (isAlias(name, ALIASES.buyBagsTracked)) {
      line7BuyBagsQtyByName += quantity;
      line7BuyBagsAmountByName += amount;
      continue;
    }
    if (isAlias(name, ALIASES.pack10)) {
      increment(extras, "แพ็ค 10", quantity, amount);
      continue;
    }
    if (isAlias(name, ALIASES.buyBagsUntracked)) {
      increment(extras, "ซื้อกระสอบ ไม่ติดตาม", quantity, amount);
      continue;
    }
    if (isAlias(name, ALIASES.shipping)) {
      increment(extras, "ค่าขนส่ง", quantity, amount);
      continue;
    }
    if (isAlias(name, ALIASES.installment)) {
      increment(extras, "ค่าผ่อน", quantity, amount);
      continue;
    }
    if (isAlias(name, ALIASES.bagPack)) {
      increment(extras, "ถุงแพ็คใส", quantity, amount);
      continue;
    }

    increment(extras, rawName || "อื่นๆ", quantity, amount);
  }

  const ledgerBagSummary = summarizeBagLedgerEntries(bagLedgerEntries);
  const line7BuyBagsQty = Math.max(
    line7BuyBagsQtyByName,
    line7BuyBagsQtyByFlag,
    ledgerBagSummary.bagsBought
  );
  let line7BuyBagsAmount = 0;
  if (
    line7BuyBagsQtyByName >= line7BuyBagsQtyByFlag &&
    line7BuyBagsQtyByName >= ledgerBagSummary.bagsBought
  ) {
    line7BuyBagsAmount = line7BuyBagsAmountByName;
  } else if (line7BuyBagsQtyByFlag >= ledgerBagSummary.bagsBought) {
    line7BuyBagsAmount = line7BuyBagsAmountByFlag;
  }

  const line8BagsOutQty = ledgerBagSummary.bagsOut > 0 ? ledgerBagSummary.bagsOut : bagsOutFallback;
  const line9BagsReturnQty = ledgerBagSummary.bagsReturned;
  const computedNetBagQty = line8BagsOutQty - line9BagsReturnQty - line7BuyBagsQty;
  const line10NetBagQty = Number.isFinite(Number(params.bagBalanceAfter))
    ? toQty(params.bagBalanceAfter)
    : computedNetBagQty;

  let line7DisplayLabel = "ซื้อกระสอบ";
  let line7DisplayQty = line7BuyBagsQty;
  let line7DisplayAmount = line7BuyBagsAmount;
  const exactLine7ProductTypeId = Number(params.exactLine7ProductTypeId);
  const exactLine7ProductName = (params.exactLine7ProductName || "").trim();
  if (Number.isFinite(exactLine7ProductTypeId) && exactLine7ProductTypeId > 0) {
    if (exactLine7ProductName) line7DisplayLabel = exactLine7ProductName;
    const line7Item = items.find(
      (item) => Number(item.productTypeId) === exactLine7ProductTypeId
    );
    if (line7Item) {
      line7DisplayLabel = line7Item.productType?.name?.trim() || line7DisplayLabel;
      line7DisplayQty = Math.abs(toQty(line7Item.quantity));
      line7DisplayAmount = toAmount(line7Item);
    }
  }

  const extraDetails = Array.from(extras.values()).filter((entry) => entry.quantity > 0 || entry.amount > 0);
  const extraDetailText = extraDetails
    .map((entry) => {
      if (entry.amount > 0) {
        return `${entry.label} ${formatQty(entry.quantity)} (${formatAmount(entry.amount)})`;
      }
      return `${entry.label} ${formatQty(entry.quantity)}`;
    })
    .join(", ");

  return {
    line1BlockIceQty,
    line2Pack20Qty,
    line3LargeTube20KgQty,
    line4SmallTubeCrushedQty,
    line5LargeTubeCrushedQty,
    line6SmallTube20KgQty,
    line7BuyBagsQty,
    line8BagsOutQty,
    line9BagsReturnQty,
    line10NetBagQty,
    line1BlockIceAmount,
    line2Pack20Amount,
    line3LargeTube20KgAmount,
    line4SmallTubeCrushedAmount,
    line5LargeTubeCrushedAmount,
    line6SmallTube20KgAmount,
    line7BuyBagsAmount,
    line7DisplayLabel,
    line7DisplayQty,
    line7DisplayAmount,
    extraDetails,
    extraDetailText,
  };
}
