"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { loadOfflinePrintPayload } from "@/lib/offline-print-payload";
import {
  buildPreprintedBillPrintModel,
  PREPRINTED_BILL_LAYOUT,
  type PreprintedBillSourceData,
} from "@/lib/preprinted-bill-print";
import {
  PREPRINTED_BILL_TEST_FIELD_SPECS,
  PREPRINTED_BILL_TEST_LAYOUT_SCOPE,
} from "@/lib/preprinted-bill-test-layout";
import {
  readFactoryPrintFieldLayout,
  resolvePrintFieldSpec,
  writeFactoryPrintFieldLayout,
  type FactoryPrintFieldLayout,
  type PrintFieldOverride,
} from "@/lib/print-field-layout";
import {
  getActiveFactoryKeyFromCookie,
  readFactoryPrintLayoutOffset,
  resetFactoryPrintLayoutOffset,
  writeFactoryPrintLayoutOffset,
} from "@/lib/print-layout-settings";
import { formatCompactPrintDate } from "@/lib/preprinted-bill-date-format";
import { getFactoryPrintLabel } from "@/lib/factory-profile";

function toOffset(raw: string | null): number {
  if (!raw) return 0;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function hasExplicitOffset(raw: string | null): boolean {
  return raw != null && raw.trim() !== "" && Number.isFinite(Number(raw));
}

function roundMm(value: number): number {
  return Number(value.toFixed(2));
}

function estimateEditorWidthMm(text: string, fallback = 14): number {
  const trimmed = text.trim();
  if (!trimmed) return fallback;
  return Math.min(Math.max(trimmed.length * 2.6, fallback), 34);
}

export default function EpsonPreprintedBillTestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const offlineToken = searchParams.get("offlineToken");
  const hideTotalsFromQuery = searchParams.get("hideTotals") === "1";

  const [activeFactoryKey, setActiveFactoryKey] = useState("default");
  const [manualOffsetX, setManualOffsetX] = useState(toOffset(searchParams.get("ox")));
  const [manualOffsetY, setManualOffsetY] = useState(toOffset(searchParams.get("oy")));
  const [draftFieldLayout, setDraftFieldLayout] = useState<FactoryPrintFieldLayout>({});
  const [activeFieldId, setActiveFieldId] = useState("");
  const [dragStatus, setDragStatus] = useState<{
    fieldId: string;
    dxMm: number;
    dyMm: number;
  } | null>(null);
  const [data, setData] = useState<PreprintedBillSourceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveNotice, setSaveNotice] = useState("");

  const sheetRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    fieldId: string;
    startClientX: number;
    startClientY: number;
    startDxMm: number;
    startDyMm: number;
    pxPerMmX: number;
    pxPerMmY: number;
  } | null>(null);

  useEffect(() => {
    const factoryKey = getActiveFactoryKeyFromCookie();
    const savedOffsets = readFactoryPrintLayoutOffset(factoryKey);
    const savedFieldLayout = readFactoryPrintFieldLayout(
      PREPRINTED_BILL_TEST_LAYOUT_SCOPE,
      factoryKey
    );
    const rawOx = searchParams.get("ox");
    const rawOy = searchParams.get("oy");

    setActiveFactoryKey(factoryKey);
    setManualOffsetX(hasExplicitOffset(rawOx) ? toOffset(rawOx) : savedOffsets.x);
    setManualOffsetY(hasExplicitOffset(rawOy) ? toOffset(rawOy) : savedOffsets.y);
    setDraftFieldLayout(savedFieldLayout);
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
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
          const transaction: PreprintedBillSourceData = await res.json();
          if (!cancelled) setData(transaction);
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

  useEffect(() => {
    if (!saveNotice) return;
    const handle = window.setTimeout(() => setSaveNotice(""), 1800);
    return () => window.clearTimeout(handle);
  }, [saveNotice]);

  const model = useMemo(
    () =>
      data
        ? buildPreprintedBillPrintModel(data, {
            hidePrintTotals: hideTotalsFromQuery || data.hidePrintTotals === true,
          })
        : null,
    [data, hideTotalsFromQuery]
  );

  const fieldSpecs = useMemo(() => PREPRINTED_BILL_TEST_FIELD_SPECS, []);

  const fieldContext = useMemo(
    () =>
      model
        ? {
            factoryPrintLabel: getFactoryPrintLabel(activeFactoryKey),
            customerPrintText: `${model.data.customer.id} ${model.customerName}`,
            formattedTestDate: formatCompactPrintDate(model.data.saleDate),
            isReturnPrint: model.data.transactionKind === "return",
            model,
          }
        : null,
    [activeFactoryKey, model]
  );

  const resolvedFields = useMemo(() => {
    if (!fieldContext) return [];

    return fieldSpecs.map((spec) => {
      const baseRect = spec.getDefaultRect(fieldContext);
      const rect = resolvePrintFieldSpec(spec, fieldContext, draftFieldLayout[spec.id]);
      const text = spec.renderText(fieldContext);
      const visible = spec.isVisible ? spec.isVisible(fieldContext) : true;

      return {
        spec,
        baseRect,
        rect,
        text,
        visible,
        handleWidthMm: Math.max(
          rect.widthMm ?? spec.editorWidthMm ?? estimateEditorWidthMm(text),
          8
        ),
      };
    });
  }, [draftFieldLayout, fieldContext, fieldSpecs]);

  const activeField = useMemo(
    () => resolvedFields.find((field) => field.spec.id === activeFieldId) ?? resolvedFields[0] ?? null,
    [activeFieldId, resolvedFields]
  );

  useEffect(() => {
    if (activeFieldId && resolvedFields.some((field) => field.spec.id === activeFieldId)) return;
    if (resolvedFields[0]) {
      setActiveFieldId(resolvedFields[0].spec.id);
    }
  }, [activeFieldId, resolvedFields]);

  const offsetX = PREPRINTED_BILL_LAYOUT.BASE_OFFSET_X_MM + manualOffsetX;
  const offsetY = PREPRINTED_BILL_LAYOUT.BASE_OFFSET_Y_MM + manualOffsetY;

  function saveFactoryOffsets(): void {
    writeFactoryPrintLayoutOffset(activeFactoryKey, {
      x: manualOffsetX,
      y: manualOffsetY,
    });
  }

  function saveCurrentLayout(): void {
    saveFactoryOffsets();
    writeFactoryPrintFieldLayout(
      PREPRINTED_BILL_TEST_LAYOUT_SCOPE,
      activeFactoryKey,
      draftFieldLayout
    );
    setSaveNotice("Saved for this factory");
  }

  function resetFactoryOffsets(): void {
    const fallback = resetFactoryPrintLayoutOffset(activeFactoryKey);
    setManualOffsetX(fallback.x);
    setManualOffsetY(fallback.y);
  }

  function resetSelectedField(): void {
    if (!activeField) return;
    setDraftFieldLayout((prev) => {
      const next = { ...prev };
      delete next[activeField.spec.id];
      return next;
    });
  }

  function resetAllFieldAdjustments(): void {
    setDraftFieldLayout({});
  }

  const applyFieldOverride = useCallback((
    fieldId: string,
    nextRectPatch: { xMm?: number; yMm?: number; widthMm?: number | null }
  ): void => {
    if (!fieldContext) return;
    const spec = fieldSpecs.find((entry) => entry.id === fieldId);
    if (!spec) return;

    setDraftFieldLayout((prev) => {
      const baseRect = spec.getDefaultRect(fieldContext);
      const currentRect = resolvePrintFieldSpec(spec, fieldContext, prev[fieldId]);
      const nextXMm = nextRectPatch.xMm ?? currentRect.xMm;
      const nextYMm = nextRectPatch.yMm ?? currentRect.yMm;
      const nextWidthMm =
        nextRectPatch.widthMm === null
          ? undefined
          : nextRectPatch.widthMm ?? currentRect.widthMm;

      const nextOverride: PrintFieldOverride = {};
      const dxMm = roundMm(nextXMm - baseRect.xMm);
      const dyMm = roundMm(nextYMm - baseRect.yMm);

      if (Math.abs(dxMm) >= 0.01) nextOverride.dxMm = dxMm;
      if (Math.abs(dyMm) >= 0.01) nextOverride.dyMm = dyMm;

      if (nextWidthMm != null) {
        const baseWidthMm = baseRect.widthMm ?? nextWidthMm;
        if (Math.abs(nextWidthMm - baseWidthMm) >= 0.01) {
          nextOverride.widthMm = roundMm(nextWidthMm);
        }
      }

      const nextLayout = { ...prev };
      if (Object.keys(nextOverride).length === 0) {
        delete nextLayout[fieldId];
      } else {
        nextLayout[fieldId] = nextOverride;
      }
      return nextLayout;
    });
  }, [fieldContext, fieldSpecs]);

  function beginFieldDrag(fieldId: string, clientX: number, clientY: number): void {
    if (!sheetRef.current || !fieldContext) return;
    const sheetRect = sheetRef.current.getBoundingClientRect();

    dragRef.current = {
      fieldId,
      startClientX: clientX,
      startClientY: clientY,
      startDxMm: draftFieldLayout[fieldId]?.dxMm ?? 0,
      startDyMm: draftFieldLayout[fieldId]?.dyMm ?? 0,
      pxPerMmX: sheetRect.width / PREPRINTED_BILL_LAYOUT.PAPER_WIDTH_MM,
      pxPerMmY: sheetRect.height / PREPRINTED_BILL_LAYOUT.PAPER_HEIGHT_MM,
    };

    setActiveFieldId(fieldId);
    setDragStatus({
      fieldId,
      dxMm: draftFieldLayout[fieldId]?.dxMm ?? 0,
      dyMm: draftFieldLayout[fieldId]?.dyMm ?? 0,
    });
  }

  useEffect(() => {
    function handlePointerMove(event: PointerEvent): void {
      const drag = dragRef.current;
      if (!drag || !fieldContext) return;

      const spec = fieldSpecs.find((entry) => entry.id === drag.fieldId);
      if (!spec) return;

      const nextDxMm = roundMm(
        drag.startDxMm + (event.clientX - drag.startClientX) / drag.pxPerMmX
      );
      const nextDyMm = roundMm(
        drag.startDyMm + (event.clientY - drag.startClientY) / drag.pxPerMmY
      );
      const baseRect = spec.getDefaultRect(fieldContext);

      applyFieldOverride(drag.fieldId, {
        xMm: baseRect.xMm + nextDxMm,
        yMm: baseRect.yMm + nextDyMm,
      });
      setDragStatus({
        fieldId: drag.fieldId,
        dxMm: nextDxMm,
        dyMm: nextDyMm,
      });
    }

    function clearDrag(): void {
      dragRef.current = null;
      setDragStatus(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", clearDrag);
    window.addEventListener("pointercancel", clearDrag);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", clearDrag);
      window.removeEventListener("pointercancel", clearDrag);
    };
  }, [applyFieldOverride, fieldContext, fieldSpecs]);

  if (loading) {
    return (
      <div className="state-shell">
        <p className="state-copy">กำลังโหลด editor...</p>
      </div>
    );
  }

  if (!data || !model || !fieldContext) {
    return (
      <div className="state-shell">
        <p className="state-copy">ไม่พบบิล #{id}</p>
      </div>
    );
  }

  return (
    <div className="editor-page">
      <div className="editor-toolbar print:hidden">
        <div className="toolbar-copy">
          <p className="toolbar-title">Preprinted Bill Editor</p>
          <p className="toolbar-subtitle">
            115 x 140 mm bill canvas with a 1 mm calibration grid. Drag the blocks directly on the bill.
          </p>
        </div>
        <div className="toolbar-actions">
          <span className="factory-badge">Factory: {activeFactoryKey.toUpperCase()}</span>
          {saveNotice ? <span className="save-badge">{saveNotice}</span> : null}
          <button type="button" className="toolbar-button primary" onClick={() => window.print()}>
            Print Epson (Test)
          </button>
          <button type="button" className="toolbar-button" onClick={saveCurrentLayout}>
            Save for this factory
          </button>
          <button type="button" className="toolbar-button" onClick={resetSelectedField}>
            Reset selected
          </button>
          <button type="button" className="toolbar-button" onClick={resetAllFieldAdjustments}>
            Reset all
          </button>
          <button type="button" className="toolbar-button" onClick={() => window.close()}>
            Close
          </button>
        </div>
      </div>

      <div className="editor-shell">
        <section className="canvas-shell">
          <div className="canvas-card">
            <div className="canvas-header print:hidden">
              <div>
                <p className="canvas-title">Bill canvas</p>
                <p className="canvas-help">
                  Select or drag any part on the bill. The printed page will hide the grid and controls.
                </p>
              </div>
            </div>

            <div className="canvas-stage">
              <div ref={sheetRef} className="sheet" data-testid="bill-sheet">
                <div className="grid" data-testid="bill-grid" />
                <div
                  className="overlay"
                  style={{ transform: `translate(${offsetX}mm, ${offsetY}mm)` }}
                >
                  {resolvedFields.map((field) => {
                    const shouldRenderText = field.visible && field.text.trim().length > 0;
                    return (
                      <div key={field.spec.id}>
                        {shouldRenderText ? (
                          <div
                            className={`field ${field.spec.className ?? ""} ${
                              field.spec.textAlign === "right" ? "right" : ""
                            } ${field.spec.textAlign === "center" ? "center" : ""}`}
                            style={{
                              left: `${field.rect.xMm}mm`,
                              top: `${field.rect.yMm}mm`,
                              width:
                                field.rect.widthMm != null ? `${field.rect.widthMm}mm` : undefined,
                            }}
                          >
                            {field.text}
                          </div>
                        ) : null}

                        <button
                          type="button"
                          className={`drag-handle print:hidden ${
                            activeField?.spec.id === field.spec.id ? "active" : ""
                          } ${field.visible ? "" : "ghost"}`}
                          style={{
                            left: `${field.rect.xMm}mm`,
                            top: `${field.rect.yMm}mm`,
                            width: `${field.handleWidthMm}mm`,
                            height: `${Math.max(field.spec.editorHeightMm ?? 5, 5)}mm`,
                          }}
                          data-testid={`bill-element-${field.spec.id}`}
                          aria-label={`Select ${field.spec.label}`}
                          onClick={() => setActiveFieldId(field.spec.id)}
                          onPointerDown={(event) => {
                            beginFieldDrag(field.spec.id, event.clientX, event.clientY);
                            event.preventDefault();
                          }}
                        >
                          <span className="handle-label">
                            {field.spec.label}
                            {!field.visible ? " (hidden)" : ""}
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className="inspector-card print:hidden" data-testid="layout-inspector">
          {activeField ? (
            <>
              <div className="inspector-section">
                <div className="inspector-heading-row">
                  <div>
                    <p className="inspector-label">Selected element</p>
                    <p className="selected-name">{activeField.spec.label}</p>
                  </div>
                  <span className={`visibility-pill ${activeField.visible ? "live" : "ghost"}`}>
                    {activeField.visible ? "Visible" : "Hidden"}
                  </span>
                </div>

                <div className="status-card">
                  {dragStatus?.fieldId === activeField.spec.id ? (
                    <span>
                      Dragging: ΔX {dragStatus.dxMm.toFixed(1)} / ΔY {dragStatus.dyMm.toFixed(1)} mm
                    </span>
                  ) : (
                    <span>
                      X {activeField.rect.xMm.toFixed(1)} / Y {activeField.rect.yMm.toFixed(1)}
                      {activeField.rect.widthMm != null
                        ? ` / W ${activeField.rect.widthMm.toFixed(1)}`
                        : ""}
                    </span>
                  )}
                </div>

                <div className="input-grid">
                  <label className="input-label">
                    <span>X (mm)</span>
                    <input
                      aria-label={`${activeField.spec.label} X (mm)`}
                      type="number"
                      step="0.5"
                      value={activeField.rect.xMm}
                      onChange={(event) =>
                        applyFieldOverride(activeField.spec.id, {
                          xMm: toOffset(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="input-label">
                    <span>Y (mm)</span>
                    <input
                      aria-label={`${activeField.spec.label} Y (mm)`}
                      type="number"
                      step="0.5"
                      value={activeField.rect.yMm}
                      onChange={(event) =>
                        applyFieldOverride(activeField.spec.id, {
                          yMm: toOffset(event.target.value),
                        })
                      }
                    />
                  </label>
                  {activeField.spec.widthEditable && activeField.rect.widthMm != null ? (
                    <label className="input-label input-wide">
                      <span>Width (mm)</span>
                      <input
                        aria-label={`${activeField.spec.label} Width (mm)`}
                        type="number"
                        step="0.5"
                        value={activeField.rect.widthMm}
                        onChange={(event) =>
                          applyFieldOverride(activeField.spec.id, {
                            widthMm: Math.max(4, toOffset(event.target.value)),
                          })
                        }
                      />
                    </label>
                  ) : null}
                </div>

                <div className="nudge-grid">
                  <button
                    type="button"
                    className="nudge-button"
                    onClick={() =>
                      applyFieldOverride(activeField.spec.id, {
                        xMm: activeField.rect.xMm - 1,
                      })
                    }
                  >
                    ← 1 mm
                  </button>
                  <button
                    type="button"
                    className="nudge-button"
                    onClick={() =>
                      applyFieldOverride(activeField.spec.id, {
                        xMm: activeField.rect.xMm + 1,
                      })
                    }
                  >
                    → 1 mm
                  </button>
                  <button
                    type="button"
                    className="nudge-button"
                    onClick={() =>
                      applyFieldOverride(activeField.spec.id, {
                        yMm: activeField.rect.yMm - 1,
                      })
                    }
                  >
                    ↑ 1 mm
                  </button>
                  <button
                    type="button"
                    className="nudge-button"
                    onClick={() =>
                      applyFieldOverride(activeField.spec.id, {
                        yMm: activeField.rect.yMm + 1,
                      })
                    }
                  >
                    ↓ 1 mm
                  </button>
                  <button
                    type="button"
                    className="nudge-button subtle"
                    onClick={() =>
                      applyFieldOverride(activeField.spec.id, {
                        xMm: activeField.rect.xMm - 0.5,
                      })
                    }
                  >
                    ← 0.5
                  </button>
                  <button
                    type="button"
                    className="nudge-button subtle"
                    onClick={() =>
                      applyFieldOverride(activeField.spec.id, {
                        xMm: activeField.rect.xMm + 0.5,
                      })
                    }
                  >
                    → 0.5
                  </button>
                  <button
                    type="button"
                    className="nudge-button subtle"
                    onClick={() =>
                      applyFieldOverride(activeField.spec.id, {
                        yMm: activeField.rect.yMm - 0.5,
                      })
                    }
                  >
                    ↑ 0.5
                  </button>
                  <button
                    type="button"
                    className="nudge-button subtle"
                    onClick={() =>
                      applyFieldOverride(activeField.spec.id, {
                        yMm: activeField.rect.yMm + 0.5,
                      })
                    }
                  >
                    ↓ 0.5
                  </button>
                </div>
              </div>

              <div className="inspector-section">
                <p className="inspector-label">Bill offset</p>
                <p className="section-help">
                  Keep the whole-bill calibration if you need to shift the entire print together.
                </p>
                <div className="input-grid">
                  <label className="input-label">
                    <span>Offset X (mm)</span>
                    <input
                      aria-label="Offset X (mm)"
                      type="number"
                      step="0.5"
                      value={manualOffsetX}
                      onChange={(event) => setManualOffsetX(toOffset(event.target.value))}
                    />
                  </label>
                  <label className="input-label">
                    <span>Offset Y (mm)</span>
                    <input
                      aria-label="Offset Y (mm)"
                      type="number"
                      step="0.5"
                      value={manualOffsetY}
                      onChange={(event) => setManualOffsetY(toOffset(event.target.value))}
                    />
                  </label>
                </div>
                <div className="nudge-grid compact">
                  <button type="button" className="nudge-button" onClick={() => setManualOffsetX((value) => roundMm(value - 1))}>
                    ← 1 mm
                  </button>
                  <button type="button" className="nudge-button" onClick={() => setManualOffsetX((value) => roundMm(value + 1))}>
                    → 1 mm
                  </button>
                  <button type="button" className="nudge-button" onClick={() => setManualOffsetY((value) => roundMm(value - 1))}>
                    ↑ 1 mm
                  </button>
                  <button type="button" className="nudge-button" onClick={() => setManualOffsetY((value) => roundMm(value + 1))}>
                    ↓ 1 mm
                  </button>
                </div>
                <button type="button" className="toolbar-button reset-offset" onClick={resetFactoryOffsets}>
                  Reset saved offset
                </button>
              </div>
            </>
          ) : null}
        </aside>
      </div>

      <style>{`
        .editor-page {
          min-height: 100vh;
          padding: 1.25rem;
          background:
            radial-gradient(circle at top left, rgba(59, 130, 246, 0.1), transparent 28%),
            linear-gradient(180deg, #f7fbff 0%, #eef4fb 50%, #f8fafc 100%);
          color: #0f172a;
        }

        .state-shell {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #f8fafc;
        }

        .state-copy {
          color: #475569;
          font-size: 0.95rem;
        }

        .editor-toolbar {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          align-items: flex-start;
          margin-bottom: 1rem;
          padding: 1rem 1.1rem;
          border-radius: 20px;
          border: 1px solid rgba(148, 163, 184, 0.28);
          background: rgba(255, 255, 255, 0.92);
          box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
          backdrop-filter: blur(10px);
        }

        .toolbar-copy {
          max-width: 28rem;
        }

        .toolbar-title {
          font-size: 1.2rem;
          font-weight: 800;
          letter-spacing: -0.01em;
        }

        .toolbar-subtitle {
          margin-top: 0.35rem;
          color: #475569;
          line-height: 1.45;
        }

        .toolbar-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 0.6rem;
          align-items: center;
        }

        .factory-badge,
        .save-badge {
          display: inline-flex;
          align-items: center;
          border-radius: 9999px;
          padding: 0.5rem 0.8rem;
          font-size: 0.8rem;
          font-weight: 700;
        }

        .factory-badge {
          background: #dbeafe;
          color: #1d4ed8;
        }

        .save-badge {
          background: #dcfce7;
          color: #166534;
        }

        .toolbar-button {
          border-radius: 9999px;
          border: 1px solid #cbd5e1;
          background: #fff;
          color: #0f172a;
          padding: 0.65rem 0.95rem;
          font-weight: 700;
          box-shadow: 0 6px 18px rgba(15, 23, 42, 0.05);
        }

        .toolbar-button.primary {
          border-color: transparent;
          background: #2563eb;
          color: #fff;
        }

        .editor-shell {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 320px;
          gap: 1rem;
          align-items: start;
        }

        .canvas-card,
        .inspector-card {
          border-radius: 24px;
          border: 1px solid rgba(148, 163, 184, 0.26);
          background: rgba(255, 255, 255, 0.94);
          box-shadow: 0 20px 44px rgba(15, 23, 42, 0.08);
        }

        .canvas-card {
          padding: 1rem;
        }

        .canvas-header {
          margin-bottom: 0.8rem;
        }

        .canvas-title {
          font-size: 1rem;
          font-weight: 800;
        }

        .canvas-help {
          margin-top: 0.25rem;
          color: #64748b;
          line-height: 1.45;
        }

        .canvas-stage {
          display: flex;
          justify-content: center;
          padding: 1rem;
          border-radius: 18px;
          background:
            linear-gradient(180deg, rgba(248, 250, 252, 0.95), rgba(226, 232, 240, 0.9));
          overflow: auto;
        }

        .sheet {
          position: relative;
          width: ${PREPRINTED_BILL_LAYOUT.PAPER_WIDTH_MM}mm;
          height: ${PREPRINTED_BILL_LAYOUT.PAPER_HEIGHT_MM}mm;
          border-radius: 10px;
          border: 1px solid rgba(15, 23, 42, 0.85);
          background: #fff;
          box-shadow: 0 18px 32px rgba(15, 23, 42, 0.14);
          overflow: hidden;
        }

        .grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(to right, rgba(37, 99, 235, 0.14) 0.14mm, transparent 0.14mm),
            linear-gradient(to bottom, rgba(37, 99, 235, 0.14) 0.14mm, transparent 0.14mm),
            linear-gradient(to right, rgba(15, 23, 42, 0.16) 0.22mm, transparent 0.22mm),
            linear-gradient(to bottom, rgba(15, 23, 42, 0.16) 0.22mm, transparent 0.22mm);
          background-size: 1mm 100%, 100% 1mm, 5mm 100%, 100% 5mm;
          background-position: top left;
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

        .right {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        .center {
          text-align: center;
        }

        .drag-handle {
          position: absolute;
          z-index: 10;
          border-radius: 6px;
          border: 1px dashed rgba(37, 99, 235, 0.58);
          background: rgba(37, 99, 235, 0.06);
          cursor: grab;
        }

        .drag-handle:hover,
        .drag-handle.active {
          border-style: solid;
          border-color: rgba(14, 116, 144, 0.92);
          background: rgba(14, 116, 144, 0.12);
          box-shadow: 0 0 0 0.45mm rgba(14, 116, 144, 0.12);
        }

        .drag-handle.ghost {
          border-color: rgba(100, 116, 139, 0.48);
          background: rgba(148, 163, 184, 0.08);
        }

        .handle-label {
          position: absolute;
          top: -4.1mm;
          left: 0;
          border-radius: 9999px;
          background: rgba(15, 23, 42, 0.9);
          color: #fff;
          padding: 0.95mm 1.8mm;
          font-size: 8px;
          line-height: 1;
          white-space: nowrap;
          opacity: 0;
          transform: translateY(2px);
          transition: opacity 120ms ease, transform 120ms ease;
        }

        .drag-handle:hover .handle-label,
        .drag-handle.active .handle-label {
          opacity: 1;
          transform: translateY(0);
        }

        .inspector-card {
          position: sticky;
          top: 1rem;
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .inspector-section {
          border-radius: 18px;
          border: 1px solid #dbe3ef;
          background: #fff;
          padding: 1rem;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
        }

        .inspector-heading-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 0.75rem;
        }

        .inspector-label {
          font-size: 0.78rem;
          font-weight: 800;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #2563eb;
        }

        .selected-name {
          margin-top: 0.3rem;
          font-size: 1rem;
          font-weight: 800;
        }

        .visibility-pill {
          display: inline-flex;
          align-items: center;
          border-radius: 9999px;
          padding: 0.35rem 0.6rem;
          font-size: 0.74rem;
          font-weight: 700;
        }

        .visibility-pill.live {
          background: #dcfce7;
          color: #166534;
        }

        .visibility-pill.ghost {
          background: #e2e8f0;
          color: #475569;
        }

        .status-card {
          margin-top: 0.85rem;
          border-radius: 14px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          padding: 0.75rem 0.85rem;
          color: #334155;
        }

        .section-help {
          margin-top: 0.35rem;
          color: #64748b;
          line-height: 1.4;
        }

        .input-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.75rem;
          margin-top: 0.9rem;
        }

        .input-wide {
          grid-column: 1 / -1;
        }

        .input-label {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
          color: #475569;
        }

        .input-label input {
          width: 100%;
          border-radius: 12px;
          border: 1px solid #cbd5e1;
          background: #fff;
          padding: 0.7rem 0.8rem;
          color: #0f172a;
        }

        .nudge-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.6rem;
          margin-top: 0.9rem;
        }

        .nudge-grid.compact {
          margin-top: 0.8rem;
        }

        .nudge-button {
          border-radius: 12px;
          border: 1px solid transparent;
          background: #dbe4f0;
          color: #0f172a;
          padding: 0.72rem 0.8rem;
          font-weight: 700;
        }

        .nudge-button.subtle {
          border-color: #cbd5e1;
          background: #fff;
        }

        .reset-offset {
          margin-top: 0.9rem;
          width: 100%;
          justify-content: center;
        }

        @media (max-width: 1180px) {
          .editor-toolbar,
          .editor-shell {
            grid-template-columns: minmax(0, 1fr);
            display: grid;
          }

          .toolbar-actions {
            justify-content: flex-start;
          }

          .inspector-card {
            position: static;
          }
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
            background: #fff !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .editor-page,
          .editor-shell,
          .canvas-shell,
          .canvas-card,
          .canvas-stage {
            margin: 0 !important;
            padding: 0 !important;
            background: transparent !important;
            border: 0 !important;
            box-shadow: none !important;
          }

          .sheet {
            border: 0;
            border-radius: 0;
            box-shadow: none;
            margin: 0 !important;
            width: ${PREPRINTED_BILL_LAYOUT.PAPER_WIDTH_MM}mm;
            height: ${PREPRINTED_BILL_LAYOUT.PAPER_HEIGHT_MM}mm;
          }

          .grid,
          .drag-handle {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
