function normalizeDate(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getBangkokParts(value: string | Date) {
  const date = normalizeDate(value);
  if (!date) {
    const raw = String(value);
    const digits = raw.replace(/\D/g, "");
    return {
      year: digits.slice(0, 4) || "0000",
      month: digits.slice(4, 6) || "00",
      day: digits.slice(6, 8) || "00",
    };
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  return {
    year: parts.find((part) => part.type === "year")?.value ?? "0000",
    month: parts.find((part) => part.type === "month")?.value ?? "00",
    day: parts.find((part) => part.type === "day")?.value ?? "00",
  };
}

export function getSupplyRequestMonthKey(value: string | Date): string {
  const { year, month } = getBangkokParts(value);
  return `${year}${month}`;
}

export function getSupplyRequestYmd(value: string | Date): string {
  const { year, month, day } = getBangkokParts(value);
  return `${year}${month}${day}`;
}

export function formatSupplyRequestRef(createdAt: string | Date, monthlySequence: number): string {
  return `REQ-${getSupplyRequestYmd(createdAt)}-${String(monthlySequence).padStart(3, "0")}`;
}

export function buildSupplyRequestRefMap<T extends { id: number; createdAt: string | Date }>(rows: T[]): Map<number, string> {
  const sorted = [...rows].sort((left, right) => {
    const leftTime = normalizeDate(left.createdAt)?.getTime() ?? 0;
    const rightTime = normalizeDate(right.createdAt)?.getTime() ?? 0;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.id - right.id;
  });

  const sequences = new Map<string, number>();
  const refs = new Map<number, string>();
  for (const row of sorted) {
    const monthKey = getSupplyRequestMonthKey(row.createdAt);
    const next = (sequences.get(monthKey) || 0) + 1;
    sequences.set(monthKey, next);
    refs.set(row.id, formatSupplyRequestRef(row.createdAt, next));
  }
  return refs;
}
