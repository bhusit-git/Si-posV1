import {
  getFactoryDefaultPrintLayoutOffset,
  type PrintLayoutOffset,
} from "@/lib/factory-profile";

const PRINT_LAYOUT_OFFSET_KEY = "superice-print-layout-offset";

function toFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function getActiveFactoryKeyFromCookie(): string {
  if (typeof document === "undefined") return "default";
  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith("superice_factory="));
  const value = cookie?.split("=")[1];
  return value ? decodeURIComponent(value) : "default";
}

export function getDefaultPrintLayoutOffset(factoryKey: string): PrintLayoutOffset {
  return getFactoryDefaultPrintLayoutOffset(factoryKey);
}

export function readFactoryPrintLayoutOffset(factoryKey: string): PrintLayoutOffset {
  const fallback = getDefaultPrintLayoutOffset(factoryKey);
  if (typeof window === "undefined") return fallback;

  try {
    const raw = localStorage.getItem(`${PRINT_LAYOUT_OFFSET_KEY}:${factoryKey}`);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Partial<PrintLayoutOffset>;
    return {
      x: toFiniteNumber(parsed.x, fallback.x),
      y: toFiniteNumber(parsed.y, fallback.y),
    };
  } catch {
    return fallback;
  }
}

export function writeFactoryPrintLayoutOffset(
  factoryKey: string,
  offset: PrintLayoutOffset
): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    `${PRINT_LAYOUT_OFFSET_KEY}:${factoryKey}`,
    JSON.stringify({
      x: toFiniteNumber(offset.x, 0),
      y: toFiniteNumber(offset.y, 0),
    })
  );
}

export function resetFactoryPrintLayoutOffset(factoryKey: string): PrintLayoutOffset {
  const fallback = getDefaultPrintLayoutOffset(factoryKey);
  if (typeof window !== "undefined") {
    localStorage.removeItem(`${PRINT_LAYOUT_OFFSET_KEY}:${factoryKey}`);
  }
  return fallback;
}
