export interface SaleLaunchUrlParams {
  customerId: number;
  saleDate: string;
  saleTime: string;
  invoiceStartDate: string;
  invoiceEndDate: string;
  invoiceKinds: string;
  invoiceVatEnabled: boolean;
  invoiceSource: "new" | "draft";
  anchorTransactionId?: number | null;
  backdateMode?: boolean;
}

export function getInvoiceComposerDefaultDateRange(today: string): {
  startDate: string;
  endDate: string;
} {
  return { startDate: today, endDate: today };
}

export function addMinuteToSaleTime(value: string): string {
  const match = value.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return "08:00:00";

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  const seconds = match[3] ? Number.parseInt(match[3], 10) : 0;

  if (hours === 23 && minutes === 59) {
    return "23:59:59";
  }

  const baseSeconds = hours * 3600 + minutes * 60 + seconds;
  const nextSeconds = Math.min(baseSeconds + 60, 23 * 3600 + 59 * 60 + 59);
  const nextHours = Math.floor(nextSeconds / 3600);
  const nextMinutes = Math.floor((nextSeconds % 3600) / 60);
  const nextRemainderSeconds = nextSeconds % 60;

  return [
    String(nextHours).padStart(2, "0"),
    String(nextMinutes).padStart(2, "0"),
    String(nextRemainderSeconds).padStart(2, "0"),
  ].join(":");
}

export function buildSaleLaunchUrl(params: SaleLaunchUrlParams): string {
  const query = new URLSearchParams();
  query.set("customerId", String(params.customerId));
  query.set("saleDate", params.saleDate);
  query.set("saleTime", params.saleTime);
  query.set("returnTo", "invoice");
  query.set("invoiceStartDate", params.invoiceStartDate);
  query.set("invoiceEndDate", params.invoiceEndDate);
  query.set("invoiceKinds", params.invoiceKinds);
  query.set("invoiceVatEnabled", params.invoiceVatEnabled ? "1" : "0");
  query.set("invoiceSource", params.invoiceSource);
  if (params.anchorTransactionId) {
    query.set("anchorTransactionId", String(params.anchorTransactionId));
  }
  if (params.backdateMode) {
    query.set("backdateMode", "1");
  }
  return `/sale?${query.toString()}`;
}

export function getBackdatedInsertState(params: {
  selectedAnchorSaleDate?: string | null;
  invoiceEndDate: string;
  today: string;
  isAdmin: boolean;
}) {
  const targetSaleDate = params.selectedAnchorSaleDate || params.invoiceEndDate;
  const isBackdatedTarget = targetSaleDate < params.today;

  return {
    targetSaleDate,
    isBackdatedTarget,
    canLaunch: params.isAdmin && isBackdatedTarget,
  };
}
