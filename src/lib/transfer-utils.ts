export const TRANSFER_CUSTOMER_PREFIX = "XFER->";
export const TRANSFER_REF_REGEX = /^(?:TRF|XFER)-\d{8}-\d{3}$/;
export type TransferAccountingStatus = "open" | "closed";
const LEGACY_ACCOUNTING_CLOSED_TAG = "[acct=closed]";
export const TRANSFER_ALLOWLIST_CUSTOMER_IDS = new Set<number>([
  3, 4, 5, 6, 16, 20, 22, 29, 43, 51, 54, 58, 73, 76, 80, 81, 84, 85, 96,
  98, 100, 111, 117, 124, 126, 132, 142, 147, 149, 150, 151, 152, 154, 166,
  168, 169, 170, 171, 173, 177, 178, 179, 196, 197, 200, 201, 203, 207, 208,
  217, 435,
]);

export interface TransferNoteFields {
  ref: string;
  to?: string | null;
  truck?: string | null;
  memo?: string | null;
  accountingStatus?: TransferAccountingStatus;
}

export function isTransferCustomerName(name: string | null | undefined): boolean {
  if (!name) return false;
  return name.trim().toUpperCase().startsWith(TRANSFER_CUSTOMER_PREFIX);
}

export function isInvoiceCreditCustomer(
  customer: { transferCustomer?: boolean | null } | null | undefined
): boolean {
  return !!customer && customer.transferCustomer === true;
}

// Legacy/history-only fallback: true for customers that look like transfer
// customers by persisted flag, allowlisted id, or XFER-> name prefix. Retained
// so historical transfer-report rows (and one-time backfills) can still be
// classified, but it MUST NOT be used for active customer permission or sale
// selection — use isInvoiceCreditCustomer for that.
export function isTransferEligibleCustomer(
  customer: { id?: number | null; name?: string | null; transferCustomer?: boolean | null } | null | undefined
): boolean {
  if (!customer) return false;
  if (customer.transferCustomer === true) return true;
  if (isTransferCustomerName(customer.name)) return true;
  const id = customer.id;
  return typeof id === "number" && TRANSFER_ALLOWLIST_CUSTOMER_IDS.has(id);
}

function escapeNoteValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return encodeURIComponent(trimmed);
}

function decodeNoteValue(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeAccountingStatus(
  value: string | TransferAccountingStatus | null | undefined
): TransferAccountingStatus {
  return `${value || ""}`.trim().toLowerCase() === "closed" ? "closed" : "open";
}

function stripLegacyAccountingTag(note: string | null | undefined): string {
  if (!note) return "";
  return note
    .replace(/\s*\[acct=closed\]\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasLegacyAccountingClosedTag(note: string | null | undefined): boolean {
  return !!note && /\[acct=closed\]/i.test(note);
}

export function buildTransferNote(fields: TransferNoteFields): string {
  const parts = [`XFER`, `ref=${fields.ref}`];
  const to = escapeNoteValue(fields.to);
  const truck = escapeNoteValue(fields.truck);
  const memo = escapeNoteValue(fields.memo);
  const accountingStatus = normalizeAccountingStatus(fields.accountingStatus);
  if (to) parts.push(`to=${to}`);
  if (truck) parts.push(`truck=${truck}`);
  if (memo) parts.push(`memo=${memo}`);
  if (accountingStatus === "closed") parts.push("acct=closed");
  return parts.join("|");
}

export function parseTransferNote(note: string | null | undefined): TransferNoteFields | null {
  if (!note) return null;
  const trimmed = note.trim();
  if (!trimmed.startsWith("XFER|")) return null;

  const result: TransferNoteFields = { ref: "", accountingStatus: "open" };
  const segments = trimmed.split("|");
  for (const segment of segments.slice(1)) {
    const eqIndex = segment.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = segment.slice(0, eqIndex);
    const value = segment.slice(eqIndex + 1);
    if (key === "ref") result.ref = value;
    if (key === "to") result.to = decodeNoteValue(value);
    if (key === "truck") result.truck = decodeNoteValue(value);
    if (key === "memo") result.memo = decodeNoteValue(value);
    if (key === "acct") result.accountingStatus = normalizeAccountingStatus(value);
  }

  if (!TRANSFER_REF_REGEX.test(result.ref)) return null;
  return result;
}

export function getTransferAccountingStatus(note: string | null | undefined): TransferAccountingStatus {
  const parsed = parseTransferNote(note);
  if (parsed) return parsed.accountingStatus || "open";
  return hasLegacyAccountingClosedTag(note) ? "closed" : "open";
}

export function applyLegacyAccountingStatusToNote(
  note: string | null | undefined,
  accountingStatus: TransferAccountingStatus
): string | null {
  const base = stripLegacyAccountingTag(note);
  if (accountingStatus === "closed") {
    return base ? `${base} ${LEGACY_ACCOUNTING_CLOSED_TAG}` : LEGACY_ACCOUNTING_CLOSED_TAG;
  }
  return base || null;
}

interface ParsedTransferRef {
  prefix: string;
  ymd: string;
  seq: number;
}

function parseTransferRef(ref: string | null | undefined): ParsedTransferRef | null {
  if (!ref) return null;
  const upper = ref.trim().toUpperCase();
  const match = /^(TRF|XFER)-(\d{8})-(\d{3})$/.exec(upper);
  if (!match) return null;
  return { prefix: match[1], ymd: match[2], seq: parseInt(match[3], 10) };
}

function formatTransferRef(ymd: string, seq: number): string {
  return `TRF-${ymd}-${String(seq).padStart(3, "0")}`;
}

function getMonthKey(dateISO: string): string {
  return dateISO.replace(/-/g, "").slice(0, 6);
}

export function buildLocalTransferRef(dateISO: string): string {
  const ymd = dateISO.replace(/-/g, "");
  const monthKey = getMonthKey(dateISO);
  if (typeof window === "undefined") {
    const seq = (Date.now() % 999) + 1;
    return formatTransferRef(ymd, seq);
  }

  const key = `superice-transfer-seq-${monthKey}`;
  const raw = window.localStorage.getItem(key);
  const prev = raw !== null ? parseInt(raw, 10) : NaN;
  const prevSafe = Number.isFinite(prev) && prev >= 1 && prev <= 999 ? prev : 0;
  const next = prevSafe >= 999 ? 1 : prevSafe + 1;
  window.localStorage.setItem(key, String(next));
  return formatTransferRef(ymd, next);
}

export function allocateTransferRef(
  saleDateISO: string,
  existingRefs: string[],
  preferredRef?: string | null
): string | null {
  const ymd = saleDateISO.replace(/-/g, "");
  const monthKey = getMonthKey(saleDateISO);
  const usedSeq = new Set<number>();
  for (const ref of existingRefs) {
    const parsed = parseTransferRef(ref);
    if (parsed && parsed.ymd.slice(0, 6) === monthKey) usedSeq.add(parsed.seq);
  }

  const preferredParsed = parseTransferRef(preferredRef || null);
  if (preferredParsed && preferredParsed.ymd.slice(0, 6) === monthKey && !usedSeq.has(preferredParsed.seq)) {
    return formatTransferRef(ymd, preferredParsed.seq);
  }

  const start = preferredParsed && preferredParsed.ymd.slice(0, 6) === monthKey ? preferredParsed.seq : 1;
  for (let i = 0; i < 999; i += 1) {
    const seq = ((start - 1 + i) % 999) + 1;
    if (!usedSeq.has(seq)) return formatTransferRef(ymd, seq);
  }
  return null;
}
