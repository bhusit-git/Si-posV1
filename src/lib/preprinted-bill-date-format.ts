const COMPACT_THAI_MONTHS = [
  "มค",
  "กพ",
  "มี",
  "เม",
  "พค",
  "มิ",
  "กค",
  "สค",
  "กย",
  "ตค",
  "พย",
  "ธค",
] as const;

export function formatCompactPrintDate(value: string): string {
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const monthIndex = Number.parseInt(month, 10) - 1;
    const monthLabel = COMPACT_THAI_MONTHS[monthIndex];
    if (monthLabel) {
      return `${day}.${monthLabel}.${year.slice(-2)}`;
    }
  }

  try {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    const day = `${date.getDate()}`.padStart(2, "0");
    const monthLabel = COMPACT_THAI_MONTHS[date.getMonth()];
    const year = `${date.getFullYear()}`.slice(-2);
    return monthLabel ? `${day}.${monthLabel}.${year}` : value;
  } catch {
    return value;
  }
}
