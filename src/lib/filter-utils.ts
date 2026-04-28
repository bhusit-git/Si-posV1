export interface ParsedCustomerQuery {
  raw: string;
  normalized: string;
  customerId: number | null;
  customerIds: number[];
  customerNameQuery: string | null;
  isEmpty: boolean;
}

export interface ParsedTransactionSearchQuery {
  raw: string;
  normalized: string;
  customerQuery: ParsedCustomerQuery;
  printedBillNumber: number | null;
  isEmpty: boolean;
}

function parseCustomerIdToken(input: string): number | null {
  const normalized = input.startsWith("#") ? input.slice(1).trim() : input.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsedId = Number(normalized);
  if (!Number.isFinite(parsedId) || !Number.isInteger(parsedId) || parsedId <= 0) {
    return null;
  }
  return parsedId;
}

export function parseCustomerQuery(input: string | null | undefined): ParsedCustomerQuery {
  const raw = `${input || ""}`;
  const normalized = raw.trim();
  if (!normalized) {
    return {
      raw,
      normalized: "",
      customerId: null,
      customerIds: [],
      customerNameQuery: null,
      isEmpty: true,
    };
  }

  if (normalized.includes(",")) {
    const parsedIds = Array.from(
      new Set(
        normalized
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => parseCustomerIdToken(part))
      )
    );

    if (parsedIds.length > 0 && parsedIds.every((value): value is number => value !== null)) {
      return {
        raw,
        normalized,
        customerId: parsedIds[0] ?? null,
        customerIds: parsedIds,
        customerNameQuery: null,
        isEmpty: false,
      };
    }
  }

  const parsedId = parseCustomerIdToken(normalized);
  if (parsedId !== null) {
    return {
      raw,
      normalized,
      customerId: parsedId,
      customerIds: [parsedId],
      customerNameQuery: null,
      isEmpty: false,
    };
  }

  return {
    raw,
    normalized,
    customerId: null,
    customerIds: [],
    customerNameQuery: normalized.toLowerCase(),
    isEmpty: false,
  };
}

export function parseTransactionSearchQuery(
  input: string | null | undefined
): ParsedTransactionSearchQuery {
  const parsedCustomerQuery = parseCustomerQuery(input);
  const normalized = parsedCustomerQuery.normalized;
  const isExactPrintedBillSearch = /^\d{4}$/.test(normalized);
  const printedBillNumber = isExactPrintedBillSearch
    ? Number.parseInt(normalized, 10)
    : null;
  const customerQuery = isExactPrintedBillSearch
    ? {
        ...parsedCustomerQuery,
        customerId: null,
        customerIds: [],
      }
    : parsedCustomerQuery;

  return {
    raw: customerQuery.raw,
    normalized,
    customerQuery,
    printedBillNumber:
      printedBillNumber != null && Number.isInteger(printedBillNumber)
        ? printedBillNumber
        : null,
    isEmpty: customerQuery.isEmpty,
  };
}

export function matchesCustomerQuery(
  customerId: number | string | null | undefined,
  customerName: string | null | undefined,
  query: string | null | undefined
): boolean {
  const parsed = parseCustomerQuery(query);
  if (parsed.isEmpty) return true;
  if (parsed.customerIds.length > 0) {
    return parsed.customerIds.includes(Number(customerId));
  }
  return (customerName || "").toLowerCase().includes(parsed.customerNameQuery || "");
}

export function matchesTransactionSearchQuery(
  input: {
    customerId: number | string | null | undefined;
    customerName: string | null | undefined;
    printedBillNumber?: number | null | undefined;
  },
  query: string | null | undefined
): boolean {
  const parsed = parseTransactionSearchQuery(query);
  if (parsed.isEmpty) return true;

  if (
    parsed.printedBillNumber !== null &&
    input.printedBillNumber === parsed.printedBillNumber
  ) {
    return true;
  }
  if (parsed.printedBillNumber !== null) {
    return false;
  }

  return matchesCustomerQuery(input.customerId, input.customerName, query);
}

export function isValidDateRange(startDate: string, endDate: string): boolean {
  if (!startDate || !endDate) return false;
  return startDate <= endDate;
}

export function normalizeTimeInput(value: string): string {
  if (!value) return "00:00:00";
  return value.length === 5 ? `${value}:00` : value.slice(0, 8);
}

export function isInTimeWindowInclusive(
  value: string,
  startTime: string,
  endTime: string,
  allowCrossMidnight = true
): boolean {
  const t = normalizeTimeInput(value);
  const start = normalizeTimeInput(startTime);
  const end = normalizeTimeInput(endTime);

  if (start <= end) return t >= start && t <= end;
  if (!allowCrossMidnight) return false;
  return t >= start || t <= end;
}
