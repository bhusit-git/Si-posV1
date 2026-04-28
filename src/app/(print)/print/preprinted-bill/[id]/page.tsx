"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { loadOfflinePrintPayload } from "@/lib/offline-print-payload";
import {
  buildPreprintedBillPrintModel,
  formatPreprintedBillAmount,
  formatPreprintedBillQty,
  PREPRINTED_BILL_COLUMNS,
  PREPRINTED_BILL_DERIVED,
  PREPRINTED_BILL_LAYOUT,
  PREPRINTED_BILL_MORE,
  type PreprintedBillSourceData,
} from "@/lib/preprinted-bill-print";
import {
  getActiveFactoryKeyFromCookie,
  readFactoryPrintLayoutOffset,
  resetFactoryPrintLayoutOffset,
  writeFactoryPrintLayoutOffset,
} from "@/lib/print-layout-settings";
import { resolveSavedPreprintedBillFields } from "@/lib/preprinted-bill-saved-layout";
import { startPrintWindowLifecycle } from "@/lib/print-window-lifecycle";

function getPathFromLocation(): string {
  if (typeof window === "undefined") return "";
  return window.location.pathname;
}

function toOffset(raw: string | null): number {
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function hasExplicitOffset(raw: string | null): boolean {
  return raw != null && raw.trim() !== "" && Number.isFinite(Number(raw));
}

export default function EpsonPreprintedBillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const simpleMode = searchParams.get("simple") === "1";
  const minimalMode = simpleMode || searchParams.get("minimal") === "1";
  const autoCloseMode = searchParams.get("autoclose") === "1";
  const calibrationMode = searchParams.get("calibration") === "1";
  const adjustMode = !minimalMode && searchParams.get("adjust") === "1";
  const savedLayoutMode = searchParams.get("layout") === "v2";
  const offlineToken = searchParams.get("offlineToken");
  const hideTotalsFromQuery = searchParams.get("hideTotals") === "1";
  const [activeFactoryKey, setActiveFactoryKey] = useState("default");

  const [manualOffsetX, setManualOffsetX] = useState(toOffset(searchParams.get("ox")));
  const [manualOffsetY, setManualOffsetY] = useState(toOffset(searchParams.get("oy")));

  useEffect(() => {
    const factoryKey = getActiveFactoryKeyFromCookie();
    const saved = readFactoryPrintLayoutOffset(factoryKey);
    const rawOx = searchParams.get("ox");
    const rawOy = searchParams.get("oy");

    setActiveFactoryKey(factoryKey);
    setManualOffsetX(hasExplicitOffset(rawOx) ? toOffset(rawOx) : saved.x);
    setManualOffsetY(hasExplicitOffset(rawOy) ? toOffset(rawOy) : saved.y);
  }, [searchParams]);

  const offsetX = PREPRINTED_BILL_LAYOUT.BASE_OFFSET_X_MM + manualOffsetX;
  const offsetY = PREPRINTED_BILL_LAYOUT.BASE_OFFSET_Y_MM + manualOffsetY;

  const [data, setData] = useState<PreprintedBillSourceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const offlineData = loadOfflinePrintPayload(offlineToken);
      if (offlineData) {
        if (!cancelled) {
          setData(offlineData);
          setLoading(false);
        }
        return;
      }
      try {
        const res = await fetch(`/api/transactions?id=${encodeURIComponent(id)}`);
        if (res.ok) {
          const tx: PreprintedBillSourceData = await res.json();
          if (!cancelled) setData(tx);
        } else if (!cancelled) {
          setData(null);
        }
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id, offlineToken]);

  const model = useMemo(
    () =>
      data
        ? buildPreprintedBillPrintModel(data, {
            hidePrintTotals: hideTotalsFromQuery || data.hidePrintTotals === true,
          })
        : null,
    [data, hideTotalsFromQuery]
  );
  const hidePrintTotals = model?.hidePrintTotals ?? false;
  const savedFields = useMemo(
    () =>
      model && savedLayoutMode
        ? resolveSavedPreprintedBillFields(model, activeFactoryKey)
        : [],
    [activeFactoryKey, model, savedLayoutMode]
  );

  function buildLayoutUrl(options?: { calibration?: boolean; adjust?: boolean }): string {
    const params = new URLSearchParams();
    if (options?.calibration) params.set("calibration", "1");
    if (options?.adjust) params.set("adjust", "1");
    if (simpleMode) params.set("simple", "1");
    if (searchParams.get("minimal") === "1") params.set("minimal", "1");
    if (autoCloseMode) params.set("autoclose", "1");
    if (hidePrintTotals) params.set("hideTotals", "1");
    if (savedLayoutMode) params.set("layout", "v2");
    params.set("ox", `${manualOffsetX.toFixed(2)}`);
    params.set("oy", `${manualOffsetY.toFixed(2)}`);
    if (offlineToken) params.set("offlineToken", offlineToken);
    return `${getPathFromLocation()}?${params.toString()}`;
  }

  function nudgeOffsets(dx: number, dy: number): void {
    setManualOffsetX((v) => Number((v + dx).toFixed(2)));
    setManualOffsetY((v) => Number((v + dy).toFixed(2)));
  }

  function saveFactoryOffsets(): void {
    writeFactoryPrintLayoutOffset(activeFactoryKey, {
      x: manualOffsetX,
      y: manualOffsetY,
    });
  }

  function resetFactoryOffsets(): void {
    const fallback = resetFactoryPrintLayoutOffset(activeFactoryKey);
    setManualOffsetX(fallback.x);
    setManualOffsetY(fallback.y);
  }

  useEffect(() => {
    if (!data || loading || adjustMode || calibrationMode) return;
    return startPrintWindowLifecycle(window, {
      autoClose: autoCloseMode,
    });
  }, [autoCloseMode, adjustMode, calibrationMode, data, loading]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">กำลังโหลดใบพิมพ์ Epson...</p>
      </div>
    );
  }

  if (!data || !model) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">ไม่พบบิล #{id}</p>
      </div>
    );
  }

  return (
    <div className="print-root max-w-[150mm] mx-auto p-4 font-[Courier_New,monospace] text-sm print:max-w-none print:mx-0 print:p-0">
      {!minimalMode && (
        <>
          <div className="print:hidden mb-4 flex gap-2 flex-wrap">
            <button
              onClick={() => window.print()}
              className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
            >
              {calibrationMode
                ? "พิมพ์เทสกริด"
                : savedLayoutMode
                  ? "พิมพ์บิล Epson 2"
                  : "พิมพ์บิล Epson"}
            </button>
            {!calibrationMode && (
              <button
                onClick={() =>
                  window.open(
                    buildLayoutUrl({ calibration: true, adjust: adjustMode }),
                    "_blank",
                    "width=1000,height=800"
                  )
                }
                className="px-4 py-2 bg-amber-500 text-white rounded text-sm hover:bg-amber-600"
              >
                พิมพ์ Calibration Grid
              </button>
            )}
            {calibrationMode && (
              <button
                onClick={() =>
                  window.open(
                    buildLayoutUrl({ adjust: adjustMode }),
                    "_blank",
                    "width=1000,height=800"
                  )
                }
                className="px-4 py-2 bg-gray-200 rounded text-sm hover:bg-gray-300"
              >
                เปิดหน้าบิลจริง
              </button>
            )}
            <button
              onClick={() =>
                window.open(
                  buildLayoutUrl({ calibration: false, adjust: !adjustMode }),
                  "_blank",
                  "width=1100,height=900"
                )
              }
              className={`px-4 py-2 rounded text-sm ${
                adjustMode ? "bg-green-600 text-white hover:bg-green-700" : "bg-gray-200 hover:bg-gray-300"
              }`}
            >
              {adjustMode ? "ปิดตัวปรับตำแหน่ง" : "เปิดตัวปรับตำแหน่ง"}
            </button>
            <button
              onClick={() => window.close()}
              className="px-4 py-2 bg-gray-200 rounded text-sm hover:bg-gray-300"
            >
              ปิด
            </button>
          </div>

          <div className="print:hidden mb-3 text-xs text-gray-600">
            ใช้ offset ได้ด้วย URL: <code>?ox=1&oy=-1</code> (หน่วย mm)
          </div>
        </>
      )}

      {!simpleMode && adjustMode && (
        <div className="print:hidden mb-3 border rounded-md p-3 text-xs space-y-3 bg-gray-50">
          <p className="font-semibold text-sm">Simple Bill Offset Adjuster</p>
          <p className="text-gray-600">
            ปรับเฉพาะ offset ทั้งบิล (ox/oy) และบันทึกแยกตามโรงงานปัจจุบัน
          </p>
          <div className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
            โรงงาน: {activeFactoryKey.toUpperCase()}
          </div>

          <div className="grid grid-cols-2 gap-2 max-w-[340px]">
            <label className="space-y-1">
              <span className="block text-gray-600">Offset X (mm)</span>
              <input
                type="number"
                step="0.5"
                value={manualOffsetX}
                onChange={(e) => setManualOffsetX(toOffset(e.target.value))}
                className="w-full border rounded px-2 py-1"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-gray-600">Offset Y (mm)</span>
              <input
                type="number"
                step="0.5"
                value={manualOffsetY}
                onChange={(e) => setManualOffsetY(toOffset(e.target.value))}
                className="w-full border rounded px-2 py-1"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={() => nudgeOffsets(-1, 0)} className="px-3 py-1.5 bg-gray-200 rounded hover:bg-gray-300">← 1mm</button>
            <button onClick={() => nudgeOffsets(1, 0)} className="px-3 py-1.5 bg-gray-200 rounded hover:bg-gray-300">→ 1mm</button>
            <button onClick={() => nudgeOffsets(0, -1)} className="px-3 py-1.5 bg-gray-200 rounded hover:bg-gray-300">↑ 1mm</button>
            <button onClick={() => nudgeOffsets(0, 1)} className="px-3 py-1.5 bg-gray-200 rounded hover:bg-gray-300">↓ 1mm</button>
            <button
              onClick={saveFactoryOffsets}
              className="px-3 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700"
            >
              บันทึกค่าโรงงานนี้
            </button>
            <button
              onClick={resetFactoryOffsets}
              className="px-3 py-1.5 bg-white border border-gray-300 rounded hover:bg-gray-100"
            >
              รีเซ็ตค่าโรงงานนี้
            </button>
            <button
              onClick={() => {
                saveFactoryOffsets();
                window.open(buildLayoutUrl({ calibration: false, adjust: true }), "_blank", "width=1100,height=900");
              }}
              className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              เปิดด้วยค่าใหม่
            </button>
          </div>
        </div>
      )}

      <div className={`sheet ${calibrationMode ? "calibration" : ""}`}>
        {calibrationMode && <div className="grid" />}

        <div className="overlay" style={{ transform: `translate(${offsetX}mm, ${offsetY}mm)` }}>
          {savedLayoutMode ? (
            savedFields
              .filter((field) => field.visible && field.text.trim().length > 0)
              .map((field) => (
                <div
                  key={field.id}
                  className={`field ${field.className ?? ""} ${
                    field.textAlign === "right" ? "right" : ""
                  } ${field.textAlign === "center" ? "center" : ""}`}
                  style={{
                    left: `${field.rect.xMm}mm`,
                    top: `${field.rect.yMm}mm`,
                    width: field.rect.widthMm != null ? `${field.rect.widthMm}mm` : undefined,
                  }}
                >
                  {field.text}
                </div>
              ))
          ) : (
            <>
              <div className="field" style={{ left: `${PREPRINTED_BILL_COLUMNS.COL_ITEM_X_MM}mm`, top: `${PREPRINTED_BILL_LAYOUT.CUSTOMER_Y_MM}mm` }}>
                {model.customerName}
              </div>
              <div className="field right" style={{ left: `${PREPRINTED_BILL_LAYOUT.CONTENT_LEFT_MM}mm`, top: `${PREPRINTED_BILL_LAYOUT.DATE_Y_MM}mm`, width: `${PREPRINTED_BILL_COLUMNS.DATE_BLOCK_WIDTH_MM}mm` }}>
                {model.formattedDate}
              </div>

              {model.itemRows.map((row, idx) => {
                const y = PREPRINTED_BILL_LAYOUT.ITEM_START_Y_MM + idx * PREPRINTED_BILL_LAYOUT.ROW_SPACING_MM;
                return (
                  <div key={`${row.item}-${idx}`}>
                    <div className="field num" style={{ left: `${PREPRINTED_BILL_COLUMNS.COL_QTY_X_MM}mm`, top: `${y}mm` }}>{formatPreprintedBillQty(row.qty)}</div>
                    <div className="field" style={{ left: `${PREPRINTED_BILL_COLUMNS.COL_ITEM_X_MM}mm`, top: `${y}mm`, width: `${PREPRINTED_BILL_DERIVED.ITEM_LABEL_WIDTH_MM}mm`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {""}
                    </div>
                    <div className="field right num" style={{ left: `${PREPRINTED_BILL_COLUMNS.COL_AMOUNT_X_MM}mm`, top: `${y}mm`, width: `${PREPRINTED_BILL_LAYOUT.COL_AMOUNT_WIDTH_MM}mm` }}>
                      {formatPreprintedBillAmount(row.amount)}
                    </div>
                  </div>
                );
              })}

              {model.bagRows.map((row, idx) => {
                const y = model.layout.bagStartY + idx * PREPRINTED_BILL_LAYOUT.ROW_SPACING_MM;
                return (
                  <div key={`${row.item}-${idx}`}>
                    {idx === 0 ? (
                      <>
                        <div className="field num" style={{ left: `${PREPRINTED_BILL_COLUMNS.COL_QTY_X_MM}mm`, top: `${y}mm` }}>
                          {formatPreprintedBillQty(row.qty)}
                        </div>
                        <div className="field" style={{ left: `${PREPRINTED_BILL_COLUMNS.COL_ITEM_X_MM}mm`, top: `${y}mm`, width: `${PREPRINTED_BILL_DERIVED.ITEM_LABEL_WIDTH_MM}mm`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {row.item}
                        </div>
                        <div className="field right num" style={{ left: `${PREPRINTED_BILL_COLUMNS.COL_AMOUNT_X_MM}mm`, top: `${y}mm`, width: `${PREPRINTED_BILL_LAYOUT.COL_AMOUNT_WIDTH_MM}mm` }}>
                          {formatPreprintedBillAmount(row.amount)}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="field" style={{ left: `${PREPRINTED_BILL_COLUMNS.COL_ITEM_X_MM + PREPRINTED_BILL_LAYOUT.BAG_SECTION_SHIFT_MM}mm`, top: `${y}mm`, width: `${PREPRINTED_BILL_MORE.BAG_ITEM_LABEL_WIDTH_MM}mm`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {""}
                        </div>
                        <div className="field right num" style={{ left: `${PREPRINTED_BILL_DERIVED.BAG_QTY_X_MM - PREPRINTED_BILL_LAYOUT.BAG_QTY_LEFT_SHIFT_MM + PREPRINTED_BILL_LAYOUT.BAG_SECTION_SHIFT_MM}mm`, top: `${y}mm`, width: `${PREPRINTED_BILL_LAYOUT.BAG_QTY_WIDTH_MM}mm` }}>
                          {formatPreprintedBillQty(row.qty)}
                        </div>
                        <div className="field right num" style={{ left: `${PREPRINTED_BILL_COLUMNS.COL_AMOUNT_X_MM}mm`, top: `${y}mm`, width: `${PREPRINTED_BILL_LAYOUT.COL_AMOUNT_WIDTH_MM}mm` }}>
                          {formatPreprintedBillAmount(row.amount)}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}

              <div className="field right num" style={{ left: `${PREPRINTED_BILL_COLUMNS.COL_AMOUNT_X_MM}mm`, top: `${model.layout.totalY}mm`, width: `${PREPRINTED_BILL_LAYOUT.COL_AMOUNT_WIDTH_MM}mm`, fontWeight: 700 }}>
                {formatPreprintedBillAmount(model.totalAmount, false)}
              </div>

              {model.partialPaidAmount != null && model.partialRemainingAmount != null && (
                <>
                  <div className="field partial-label" style={{ left: `${PREPRINTED_BILL_COLUMNS.COL_ITEM_X_MM}mm`, top: `${model.layout.partialPaidY}mm`, width: `${PREPRINTED_BILL_DERIVED.ITEM_LABEL_WIDTH_MM}mm` }}>
                    รับแล้ว
                  </div>
                  <div className="field right partial-num" style={{ left: `${PREPRINTED_BILL_COLUMNS.COL_AMOUNT_X_MM}mm`, top: `${model.layout.partialPaidY}mm`, width: `${PREPRINTED_BILL_LAYOUT.COL_AMOUNT_WIDTH_MM}mm` }}>
                    {formatPreprintedBillAmount(model.partialPaidAmount, false)}
                  </div>
                  <div className="field partial-label" style={{ left: `${PREPRINTED_BILL_COLUMNS.COL_ITEM_X_MM}mm`, top: `${model.layout.partialRemainingY}mm`, width: `${PREPRINTED_BILL_DERIVED.ITEM_LABEL_WIDTH_MM}mm` }}>
                    ค้างเหลือ
                  </div>
                  <div className="field right partial-num" style={{ left: `${PREPRINTED_BILL_COLUMNS.COL_AMOUNT_X_MM}mm`, top: `${model.layout.partialRemainingY}mm`, width: `${PREPRINTED_BILL_LAYOUT.COL_AMOUNT_WIDTH_MM}mm` }}>
                    {formatPreprintedBillAmount(model.partialRemainingAmount, false)}
                  </div>
                </>
              )}

              <div className="field num" style={{ left: `${PREPRINTED_BILL_COLUMNS.SIGN_LEFT_X_MM}mm`, top: `${model.layout.timeY}mm` }}>
                {model.timeText}
              </div>
            </>
          )}

          {calibrationMode && (
            <>
              <div className="guide" style={{ top: `${PREPRINTED_BILL_LAYOUT.CUSTOMER_Y_MM}mm` }}>customer/date @ 25mm</div>
              <div className="guide" style={{ top: `${PREPRINTED_BILL_LAYOUT.ITEM_START_Y_MM}mm` }}>items start @ 44mm</div>
              <div className="guide" style={{ top: `${model.layout.bagStartY}mm` }}>bags start (fixed after 6 product rows)</div>
              <div className="guide" style={{ top: `${model.layout.timeY}mm` }}>time</div>
              <div className="guide" style={{ top: `${model.layout.signY}mm` }}>signature</div>
            </>
          )}
        </div>
      </div>

      <style jsx>{`
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

        .grid {
          position: absolute;
          inset: 0;
          background-image:
            repeating-linear-gradient(to right, rgba(255, 0, 0, 0.14), rgba(255, 0, 0, 0.14) 0.2mm, transparent 0.2mm, transparent 5mm),
            repeating-linear-gradient(to bottom, rgba(0, 120, 255, 0.14), rgba(0, 120, 255, 0.14) 0.2mm, transparent 0.2mm, transparent 5mm);
        }

        .guide {
          position: absolute;
          left: 0;
          right: 0;
          border-top: 1px dashed #0b7285;
          color: #0b7285;
          font-size: 8px;
          padding-left: 1.5mm;
        }

        @media print {
          @page {
            size: ${PREPRINTED_BILL_LAYOUT.PAPER_WIDTH_MM}mm ${PREPRINTED_BILL_LAYOUT.PAPER_HEIGHT_MM}mm;
            margin: 0;
          }

          :global(html),
          :global(body) {
            margin: 0 !important;
            padding: 0 !important;
            width: ${PREPRINTED_BILL_LAYOUT.PAPER_WIDTH_MM}mm;
            height: auto !important;
            min-height: 0 !important;
            overflow: visible !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .print-root {
            margin: 0 !important;
            padding: 0 !important;
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
            page-break-before: auto;
            page-break-after: auto;
            break-before: auto;
            break-after: auto;
          }
        }
      `}</style>
    </div>
  );
}
