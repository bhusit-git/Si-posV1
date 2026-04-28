export interface DisplayItemTone {
  label: string;
  badgeClassName: string;
  panelClassName: string;
  subtlePanelClassName: string;
  textClassName: string;
  valueClassName: string;
  borderClassName: string;
}

const displayNumberFormatter = new Intl.NumberFormat("th-TH", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatDisplayNumber(value: number): string {
  return displayNumberFormatter.format(value);
}

export function getDisplayItemTone(name: string): DisplayItemTone {
  if (/ซอง|กั๊ก/.test(name)) {
    return {
      label: "ซอง",
      badgeClassName: "bg-sky-600 text-white",
      panelClassName: "bg-sky-50 border-sky-200",
      subtlePanelClassName: "bg-sky-50/70 border-sky-100",
      textClassName: "text-sky-950",
      valueClassName: "text-sky-700",
      borderClassName: "border-sky-300",
    };
  }

  if (/หลอด/.test(name)) {
    return {
      label: "หลอด",
      badgeClassName: "bg-amber-500 text-white",
      panelClassName: "bg-amber-50 border-amber-200",
      subtlePanelClassName: "bg-amber-50/70 border-amber-100",
      textClassName: "text-amber-950",
      valueClassName: "text-amber-700",
      borderClassName: "border-amber-300",
    };
  }

  return {
    label: "อื่นๆ",
    badgeClassName: "bg-emerald-600 text-white",
    panelClassName: "bg-emerald-50 border-emerald-200",
    subtlePanelClassName: "bg-emerald-50/70 border-emerald-100",
    textClassName: "text-emerald-950",
    valueClassName: "text-emerald-700",
    borderClassName: "border-emerald-300",
  };
}
