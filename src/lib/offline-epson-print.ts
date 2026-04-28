import {
  buildPreprintedBillPrintModel,
  formatPreprintedBillAmount,
  formatPreprintedBillQty,
  PREPRINTED_BILL_COLUMNS,
  PREPRINTED_BILL_DERIVED,
  PREPRINTED_BILL_LAYOUT,
  PREPRINTED_BILL_MORE,
} from "@/lib/preprinted-bill-print";
import {
  getActiveFactoryKeyFromCookie,
  readFactoryPrintLayoutOffset,
} from "@/lib/print-layout-settings";
import { resolveSavedPreprintedBillFields } from "@/lib/preprinted-bill-saved-layout";
import { printHtmlInHiddenFrame } from "@/lib/hidden-print-frame";
import { buildPrintLifecycleScript } from "@/lib/print-window-lifecycle";
import type { OfflinePrintPayload } from "@/lib/offline-print-payload";

export interface OfflineEpsonPrintOptions {
  hideTotals?: boolean;
  minimal?: boolean;
  autoclose?: boolean;
  simple?: boolean;
  useSavedLayout?: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderItemRowsHtml(model: ReturnType<typeof buildPreprintedBillPrintModel>): string {
  return model.itemRows
    .map((row, idx) => {
      const y =
        PREPRINTED_BILL_LAYOUT.ITEM_START_Y_MM + idx * PREPRINTED_BILL_LAYOUT.ROW_SPACING_MM;
      return `
        <div class="field num" style="left:${PREPRINTED_BILL_COLUMNS.COL_QTY_X_MM}mm;top:${y}mm">${escapeHtml(
          formatPreprintedBillQty(row.qty)
        )}</div>
        <div class="field" style="left:${PREPRINTED_BILL_COLUMNS.COL_ITEM_X_MM}mm;top:${y}mm;width:${PREPRINTED_BILL_DERIVED.ITEM_LABEL_WIDTH_MM}mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>
        <div class="field right num" style="left:${PREPRINTED_BILL_COLUMNS.COL_AMOUNT_X_MM}mm;top:${y}mm;width:${PREPRINTED_BILL_LAYOUT.COL_AMOUNT_WIDTH_MM}mm">${escapeHtml(
          formatPreprintedBillAmount(row.amount)
        )}</div>
      `;
    })
    .join("");
}

function renderBagRowsHtml(model: ReturnType<typeof buildPreprintedBillPrintModel>): string {
  return model.bagRows
    .map((row, idx) => {
      const y = model.layout.bagStartY + idx * PREPRINTED_BILL_LAYOUT.ROW_SPACING_MM;
      if (idx === 0) {
        return `
          <div class="field num" style="left:${PREPRINTED_BILL_COLUMNS.COL_QTY_X_MM}mm;top:${y}mm">${escapeHtml(
            formatPreprintedBillQty(row.qty)
          )}</div>
          <div class="field" style="left:${PREPRINTED_BILL_COLUMNS.COL_ITEM_X_MM}mm;top:${y}mm;width:${PREPRINTED_BILL_DERIVED.ITEM_LABEL_WIDTH_MM}mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(
            row.item
          )}</div>
          <div class="field right num" style="left:${PREPRINTED_BILL_COLUMNS.COL_AMOUNT_X_MM}mm;top:${y}mm;width:${PREPRINTED_BILL_LAYOUT.COL_AMOUNT_WIDTH_MM}mm">${escapeHtml(
            formatPreprintedBillAmount(row.amount)
          )}</div>
        `;
      }

      return `
        <div class="field" style="left:${PREPRINTED_BILL_COLUMNS.COL_ITEM_X_MM + PREPRINTED_BILL_LAYOUT.BAG_SECTION_SHIFT_MM}mm;top:${y}mm;width:${PREPRINTED_BILL_MORE.BAG_ITEM_LABEL_WIDTH_MM}mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>
        <div class="field right num" style="left:${PREPRINTED_BILL_DERIVED.BAG_QTY_X_MM - PREPRINTED_BILL_LAYOUT.BAG_QTY_LEFT_SHIFT_MM + PREPRINTED_BILL_LAYOUT.BAG_SECTION_SHIFT_MM}mm;top:${y}mm;width:${PREPRINTED_BILL_LAYOUT.BAG_QTY_WIDTH_MM}mm">${escapeHtml(
          formatPreprintedBillQty(row.qty)
        )}</div>
        <div class="field right num" style="left:${PREPRINTED_BILL_COLUMNS.COL_AMOUNT_X_MM}mm;top:${y}mm;width:${PREPRINTED_BILL_LAYOUT.COL_AMOUNT_WIDTH_MM}mm">${escapeHtml(
          formatPreprintedBillAmount(row.amount)
        )}</div>
      `;
    })
    .join("");
}

function renderSavedFieldsHtml(
  model: ReturnType<typeof buildPreprintedBillPrintModel>,
  factoryKey: string
): string {
  return resolveSavedPreprintedBillFields(model, factoryKey)
    .filter((field) => field.visible && field.text.trim().length > 0)
    .map((field) => {
      const classNames = [
        "field",
        field.className ?? "",
        field.textAlign === "right" ? "right" : "",
        field.textAlign === "center" ? "center" : "",
      ]
        .filter(Boolean)
        .join(" ");

      return `<div class="${classNames}" style="left:${field.rect.xMm}mm;top:${field.rect.yMm}mm${
        field.rect.widthMm != null ? `;width:${field.rect.widthMm}mm` : ""
      }">${escapeHtml(field.text)}</div>`;
    })
    .join("");
}

export function buildOfflineEpsonPrintHtml(
  payload: OfflinePrintPayload,
  options: OfflineEpsonPrintOptions = {}
): string {
  const factoryKey = getActiveFactoryKeyFromCookie();
  const savedOffset = readFactoryPrintLayoutOffset(factoryKey);
  const model = buildPreprintedBillPrintModel(payload, {
    hidePrintTotals: options.hideTotals,
  });
  const offsetX = PREPRINTED_BILL_LAYOUT.BASE_OFFSET_X_MM + savedOffset.x;
  const offsetY = PREPRINTED_BILL_LAYOUT.BASE_OFFSET_Y_MM + savedOffset.y;
  const showToolbar = !options.minimal;
  const printTitle = options.useSavedLayout ? "บิล Epson 2" : "บิล Epson";
  const printButtonLabel = options.useSavedLayout ? "พิมพ์บิล Epson 2" : "พิมพ์บิล Epson";

  const toolbarHtml = showToolbar
    ? `
      <div class="toolbar no-print">
        <button onclick="window.print()">${printButtonLabel}</button>
        <button class="secondary" onclick="window.close()">ปิด</button>
      </div>
      ${
        options.simple
          ? ""
          : '<div class="helper no-print">ใช้ค่า offset โรงงานปัจจุบันจากเครื่องนี้อัตโนมัติ</div>'
      }
    `
    : "";

  const partialHtml =
    model.partialPaidAmount != null && model.partialRemainingAmount != null
      ? `
        <div class="field partial-label" style="left:${PREPRINTED_BILL_COLUMNS.COL_ITEM_X_MM}mm;top:${model.layout.partialPaidY}mm;width:${PREPRINTED_BILL_DERIVED.ITEM_LABEL_WIDTH_MM}mm">รับแล้ว</div>
        <div class="field right partial-num" style="left:${PREPRINTED_BILL_COLUMNS.COL_AMOUNT_X_MM}mm;top:${model.layout.partialPaidY}mm;width:${PREPRINTED_BILL_LAYOUT.COL_AMOUNT_WIDTH_MM}mm">${escapeHtml(
          formatPreprintedBillAmount(model.partialPaidAmount, false)
        )}</div>
        <div class="field partial-label" style="left:${PREPRINTED_BILL_COLUMNS.COL_ITEM_X_MM}mm;top:${model.layout.partialRemainingY}mm;width:${PREPRINTED_BILL_DERIVED.ITEM_LABEL_WIDTH_MM}mm">ค้างเหลือ</div>
        <div class="field right partial-num" style="left:${PREPRINTED_BILL_COLUMNS.COL_AMOUNT_X_MM}mm;top:${model.layout.partialRemainingY}mm;width:${PREPRINTED_BILL_LAYOUT.COL_AMOUNT_WIDTH_MM}mm">${escapeHtml(
          formatPreprintedBillAmount(model.partialRemainingAmount, false)
        )}</div>
      `
      : "";

  const bodyHtml = options.useSavedLayout
    ? renderSavedFieldsHtml(model, factoryKey)
    : `
          <div class="field" style="left:${PREPRINTED_BILL_COLUMNS.COL_ITEM_X_MM}mm;top:${PREPRINTED_BILL_LAYOUT.CUSTOMER_Y_MM}mm">${escapeHtml(
            model.customerName
          )}</div>
          <div class="field right" style="left:${PREPRINTED_BILL_LAYOUT.CONTENT_LEFT_MM}mm;top:${PREPRINTED_BILL_LAYOUT.DATE_Y_MM}mm;width:${PREPRINTED_BILL_COLUMNS.DATE_BLOCK_WIDTH_MM}mm">${escapeHtml(
            model.formattedDate
          )}</div>
          ${renderItemRowsHtml(model)}
          ${renderBagRowsHtml(model)}
          <div class="field right num" style="left:${PREPRINTED_BILL_COLUMNS.COL_AMOUNT_X_MM}mm;top:${model.layout.totalY}mm;width:${PREPRINTED_BILL_LAYOUT.COL_AMOUNT_WIDTH_MM}mm;font-weight:700">${escapeHtml(
            formatPreprintedBillAmount(model.totalAmount, false)
          )}</div>
          ${partialHtml}
          <div class="field num" style="left:${PREPRINTED_BILL_COLUMNS.SIGN_LEFT_X_MM}mm;top:${model.layout.timeY}mm">${escapeHtml(
            model.timeText
          )}</div>
        `;

  const lifecycleScript = buildPrintLifecycleScript({
    autoClose: options.autoclose,
  });

  return `<!doctype html>
<html lang="th">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${printTitle} #${payload.id}</title>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: #fff;
        color: #111;
        font-family: "Courier New", monospace;
      }
      body {
        padding: ${showToolbar ? "16px" : "0"};
      }
      .toolbar {
        margin-bottom: 16px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .toolbar button {
        border: 0;
        border-radius: 6px;
        padding: 8px 14px;
        cursor: pointer;
        background: #2563eb;
        color: #fff;
      }
      .toolbar button.secondary {
        background: #e5e7eb;
        color: #111827;
      }
      .helper {
        margin-bottom: 12px;
        color: #4b5563;
        font-size: 12px;
      }
      .print-root {
        max-width: 150mm;
        margin: 0 auto;
      }
      .sheet {
        position: relative;
        width: ${PREPRINTED_BILL_LAYOUT.PAPER_WIDTH_MM}mm;
        height: ${PREPRINTED_BILL_LAYOUT.PAPER_HEIGHT_MM}mm;
        box-sizing: border-box;
        margin: 0 auto;
        border: 1px solid #222;
        background: #fff;
        overflow: hidden;
      }
      .overlay {
        position: absolute;
        inset: 0;
        transform: translate(${offsetX}mm, ${offsetY}mm);
      }
      .field {
        position: absolute;
        font-size: 12.5px;
        line-height: 1.05;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .customer-field {
        font-size: 16.5px;
        line-height: 1;
        font-weight: 700;
      }
      .return-flag-field {
        font-size: 18px;
        line-height: 1;
        font-weight: 700;
        letter-spacing: 0.4px;
      }
      .date-field {
        font-size: 13.5px;
        line-height: 1;
        font-weight: 700;
        letter-spacing: 0;
      }
      .factory-name-field {
        font-size: 18px;
        line-height: 1;
        font-weight: 700;
        letter-spacing: 0.4px;
      }
      .line7-label-field {
        font-size: 14px;
        line-height: 1.05;
      }
      .num {
        font-size: 16.5px;
        font-weight: 700;
        letter-spacing: 0.1px;
        overflow: visible;
        text-overflow: clip;
      }
      .right {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .center {
        text-align: center;
      }
      .partial-label {
        font-size: 10px;
        line-height: 1;
      }
      .partial-num {
        font-size: 10px;
        line-height: 1;
        font-weight: 700;
        overflow: visible;
        text-overflow: clip;
      }
      @media print {
        @page {
          size: ${PREPRINTED_BILL_LAYOUT.PAPER_WIDTH_MM}mm ${PREPRINTED_BILL_LAYOUT.PAPER_HEIGHT_MM}mm;
          margin: 0;
        }
        html, body {
          width: ${PREPRINTED_BILL_LAYOUT.PAPER_WIDTH_MM}mm;
          height: auto !important;
          min-height: 0 !important;
          overflow: visible !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        body {
          padding: 0 !important;
        }
        .print-root {
          margin: 0 !important;
          width: ${PREPRINTED_BILL_LAYOUT.PAPER_WIDTH_MM}mm;
          height: auto !important;
          min-height: 0 !important;
          overflow: hidden !important;
        }
        .sheet {
          border: 0;
          margin: 0 !important;
          width: ${PREPRINTED_BILL_LAYOUT.PAPER_WIDTH_MM}mm;
          height: ${PREPRINTED_BILL_LAYOUT.PAPER_HEIGHT_MM}mm;
        }
        .no-print {
          display: none !important;
        }
      }
    </style>
  </head>
  <body>
    ${toolbarHtml}
    <div class="print-root">
      <div class="sheet">
        <div class="overlay">
          ${bodyHtml}
        </div>
      </div>
    </div>
    <script>
      ${lifecycleScript}
    </script>
  </body>
</html>`;
}

export function openOfflineEpsonPrintWindow(
  payload: OfflinePrintPayload,
  options: OfflineEpsonPrintOptions = {}
): HTMLIFrameElement | Window | null {
  if (typeof window === "undefined") return null;

  const html = buildOfflineEpsonPrintHtml(payload, options);
  const iframe = printHtmlInHiddenFrame(html);
  if (iframe) return iframe;

  const popup = window.open("", "_blank", "width=900,height=700");
  if (!popup) return null;
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  return popup;
}
