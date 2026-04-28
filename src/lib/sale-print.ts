import { openOfflineEpsonPrintWindow } from "@/lib/offline-epson-print";
import { printUrlInHiddenFrame } from "@/lib/hidden-print-frame";
import type { OfflinePrintPayload } from "@/lib/offline-print-payload";

export type SalePrintMode =
  | "none"
  | "receipt"
  | "epson"
  | "epson_v2"
  | "epson_test";

export interface OpenSalePrintOptions {
  saleId: number;
  mode: SalePrintMode;
  offlineToken?: string | null;
  hidePrintTotals?: boolean;
  sessionRole?: string | null;
  canUseEpsonPrintTools: boolean;
  offlinePayload?: OfflinePrintPayload | null;
}

export function openSalePrint({
  saleId,
  mode,
  offlineToken,
  hidePrintTotals,
  sessionRole,
  canUseEpsonPrintTools,
  offlinePayload,
}: OpenSalePrintOptions): HTMLIFrameElement | Window | null {
  if (mode === "none" || typeof window === "undefined") return null;

  const minimal = sessionRole === "manager";
  const autoclose = true;

  if (mode === "receipt") {
    const params = new URLSearchParams();
    if (offlineToken) params.set("offlineToken", offlineToken);
    if (hidePrintTotals) params.set("hideTotals", "1");
    if (autoclose) params.set("autoclose", "1");
    if (minimal) {
      params.set("minimal", "1");
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    const url = `/print/receipt/${saleId}${suffix}`;
    return printUrlInHiddenFrame(url) ?? window.open(url, "_blank", "width=400,height=600");
  }

  if ((mode === "epson" || mode === "epson_v2") && offlinePayload) {
    return openOfflineEpsonPrintWindow(offlinePayload, {
      hideTotals: hidePrintTotals,
      minimal,
      autoclose,
      simple: !canUseEpsonPrintTools,
      useSavedLayout: mode === "epson_v2",
    });
  }

  const params = new URLSearchParams();
  if (offlineToken) params.set("offlineToken", offlineToken);
  if (hidePrintTotals) params.set("hideTotals", "1");
  if (autoclose) params.set("autoclose", "1");
  if (minimal) {
    params.set("minimal", "1");
  }
  if (!canUseEpsonPrintTools) {
    params.set("simple", "1");
  }
  if (mode === "epson_v2") {
    params.set("layout", "v2");
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  if (mode === "epson_test") {
    const editorParams = new URLSearchParams();
    if (offlineToken) editorParams.set("offlineToken", offlineToken);
    if (hidePrintTotals) editorParams.set("hideTotals", "1");
    const editorSuffix = editorParams.size > 0 ? `?${editorParams.toString()}` : "";
    const editorUrl = `/print/preprinted-bill-test/${saleId}${editorSuffix}`;
    return window.open(editorUrl, "_blank", "width=1400,height=980");
  }

  const url = `/print/preprinted-bill/${saleId}${suffix}`;
  return printUrlInHiddenFrame(url) ?? window.open(url, "_blank", "width=900,height=700");
}
