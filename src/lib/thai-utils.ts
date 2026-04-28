const THAI_MONTHS = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];

const THAI_MONTHS_FULL = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

/** Format date string (YYYY-MM-DD) to Thai Buddhist Era format */
export function formatThaiDate(dateStr: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = d.getDate();
  const month = THAI_MONTHS[d.getMonth()];
  const year = d.getFullYear() + 543;
  return `${day} ${month} ${year}`;
}

/** Format date string to full Thai date */
export function formatThaiDateFull(dateStr: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = d.getDate();
  const month = THAI_MONTHS_FULL[d.getMonth()];
  const year = d.getFullYear() + 543;
  return `${day} ${month} พ.ศ. ${year}`;
}

/** Format time string (HH:MM:SS) to Thai format */
export function formatThaiTime(timeStr: string): string {
  if (!timeStr) return "-";
  const parts = timeStr.split(":");
  if (parts.length < 2) return timeStr;
  return `${parts[0]}:${parts[1]} น.`;
}

/** Format number as Thai currency */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Format number with commas */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat("th-TH").format(num);
}

/** Get today's date in YYYY-MM-DD format (local timezone, not UTC) */
export function todayISO(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Format year-month string (YYYY-MM) to Thai month with Buddhist Era year */
export function formatThaiMonth(yearMonth: string): string {
  if (!yearMonth) return "-";
  const parts = yearMonth.split("-");
  if (parts.length < 2) return yearMonth;
  const year = parseInt(parts[0]);
  const month = parseInt(parts[1]);
  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) return yearMonth;
  return `${THAI_MONTHS_FULL[month - 1]} พ.ศ. ${year + 543}`;
}

/** Format date or year-month to short Thai month + 2-digit BE year (e.g., "ก.พ. 69") */
export function formatShortMonth(dateStr: string): string {
  if (!dateStr) return "-";
  // Handle YYYY-MM format
  const parts = dateStr.split("-");
  if (parts.length >= 2) {
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]);
    if (!isNaN(year) && !isNaN(month) && month >= 1 && month <= 12) {
      const beYear = (year + 543) % 100;
      return `${THAI_MONTHS[month - 1]} ${String(beYear).padStart(2, "0")}`;
    }
  }
  // Fallback: try parsing as a Date
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    const beYear = (d.getFullYear() + 543) % 100;
    return `${THAI_MONTHS[d.getMonth()]} ${String(beYear).padStart(2, "0")}`;
  }
  return dateStr;
}

/** Get current time in HH:MM:SS format (local timezone) */
export function nowTimeISO(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}
