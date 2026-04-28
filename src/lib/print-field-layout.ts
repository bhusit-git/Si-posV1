export interface PrintFieldRect {
  xMm: number;
  yMm: number;
  widthMm?: number;
}

export interface PrintFieldSpec<Context> {
  id: string;
  label: string;
  className?: string;
  editable?: boolean;
  widthEditable?: boolean;
  textAlign?: "left" | "right" | "center";
  getDefaultRect: (context: Context) => PrintFieldRect;
}

export interface PrintFieldOverride {
  dxMm?: number;
  dyMm?: number;
  widthMm?: number;
}

export type FactoryPrintFieldLayout = Record<string, PrintFieldOverride>;

const PRINT_FIELD_LAYOUT_PREFIX = "superice-print-field-layout";

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function layoutKey(scope: string, factoryKey: string): string {
  return `${PRINT_FIELD_LAYOUT_PREFIX}:${scope}:${factoryKey}`;
}

function sanitizeOverride(value: unknown): PrintFieldOverride | null {
  if (!value || typeof value !== "object") return null;

  const parsed = value as Partial<PrintFieldOverride>;
  const override: PrintFieldOverride = {};

  const dxMm = toFiniteNumber(parsed.dxMm);
  if (dxMm != null) override.dxMm = dxMm;

  const dyMm = toFiniteNumber(parsed.dyMm);
  if (dyMm != null) override.dyMm = dyMm;

  const widthMm = toFiniteNumber(parsed.widthMm);
  if (widthMm != null) override.widthMm = widthMm;

  return Object.keys(override).length > 0 ? override : null;
}

function sanitizeLayout(value: unknown): FactoryPrintFieldLayout {
  if (!value || typeof value !== "object") return {};

  const nextLayout: FactoryPrintFieldLayout = {};
  for (const [fieldId, fieldValue] of Object.entries(value as Record<string, unknown>)) {
    const override = sanitizeOverride(fieldValue);
    if (override) nextLayout[fieldId] = override;
  }
  return nextLayout;
}

export function readFactoryPrintFieldLayout(
  scope: string,
  factoryKey: string
): FactoryPrintFieldLayout {
  if (typeof window === "undefined") return {};

  try {
    const raw = localStorage.getItem(layoutKey(scope, factoryKey));
    if (!raw) return {};
    return sanitizeLayout(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function writeFactoryPrintFieldLayout(
  scope: string,
  factoryKey: string,
  layout: FactoryPrintFieldLayout
): void {
  if (typeof window === "undefined") return;

  const sanitized = sanitizeLayout(layout);
  if (Object.keys(sanitized).length === 0) {
    localStorage.removeItem(layoutKey(scope, factoryKey));
    return;
  }

  localStorage.setItem(layoutKey(scope, factoryKey), JSON.stringify(sanitized));
}

export function resetFactoryPrintFieldLayout(scope: string, factoryKey: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(layoutKey(scope, factoryKey));
}

export function resetFactoryPrintFieldOverride(
  scope: string,
  factoryKey: string,
  fieldId: string
): void {
  if (typeof window === "undefined") return;

  const nextLayout = { ...readFactoryPrintFieldLayout(scope, factoryKey) };
  delete nextLayout[fieldId];
  writeFactoryPrintFieldLayout(scope, factoryKey, nextLayout);
}

export function resolvePrintFieldSpec<Context>(
  spec: PrintFieldSpec<Context>,
  context: Context,
  override?: PrintFieldOverride | null
): PrintFieldRect {
  const base = spec.getDefaultRect(context);

  return {
    xMm: base.xMm + (override?.dxMm ?? 0),
    yMm: base.yMm + (override?.dyMm ?? 0),
    widthMm: override?.widthMm ?? base.widthMm,
  };
}
