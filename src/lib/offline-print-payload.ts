export type OfflinePrintBagType = "out" | "return" | "adjust";
export type OfflinePrintTransactionKind =
  | "sale"
  | "transfer_out"
  | "return"
  | "adjustment";

export interface OfflinePrintPayload {
  id: number;
  clientId?: string | null;
  transactionKind?: OfflinePrintTransactionKind | null;
  saleDate: string;
  saleTime: string;
  totalAmount: number;
  paid: number;
  status: "paid" | "unpaid" | "partial";
  pool: number | null;
  row: number | null;
  col: number | null;
  bagBalanceBefore?: number;
  bagBalanceAfter?: number;
  hidePrintTotals?: boolean;
  customer: { id: number; name: string };
  items: {
    productTypeId: number;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    productType: {
      name: string;
      hasBag: boolean;
      decreasesBag: boolean;
    };
  }[];
  bagLedgerEntries: {
    type: OfflinePrintBagType;
    quantity: number;
    note: string | null;
  }[];
}

export const OFFLINE_PRINT_PREFIX = "superice-offline-print:";

export function saveOfflinePrintPayload(payload: OfflinePrintPayload): string | null {
  if (typeof window === "undefined") return null;

  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    localStorage.setItem(`${OFFLINE_PRINT_PREFIX}${token}`, JSON.stringify(payload));
    return token;
  } catch {
    return null;
  }
}

export function loadOfflinePrintPayload(token: string | null): OfflinePrintPayload | null {
  if (!token || typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(`${OFFLINE_PRINT_PREFIX}${token}`);
    if (!raw) return null;
    return JSON.parse(raw) as OfflinePrintPayload;
  } catch {
    return null;
  }
}
