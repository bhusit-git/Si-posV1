import { and, eq, gte, inArray, lte } from "drizzle-orm";
import type { DrizzleDB } from "@/db";
import { invoices } from "@/db/schema";
import type { UserRole } from "@/lib/auth";
import type { TransactionWarning } from "@/lib/types";
import { parseBangkokDateTimeStrict } from "@/lib/validations";

const BANGKOK_TIMEZONE = "Asia/Bangkok";
const MAX_BACKDATE_DAYS = 30;
const MAX_BACKDATE_MS = MAX_BACKDATE_DAYS * 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 60 * 1000;

function getBangkokDateTimeNow(): { saleDate: string; saleTime: string; epochMs: number } {
  const now = new Date();
  return {
    saleDate: now.toLocaleDateString("en-CA", { timeZone: BANGKOK_TIMEZONE }),
    saleTime: now.toLocaleTimeString("en-GB", {
      timeZone: BANGKOK_TIMEZONE,
      hour12: false,
    }),
    epochMs: now.getTime(),
  };
}

export interface BackdatePolicyResult {
  effectiveSaleDate: string;
  effectiveSaleTime: string;
  isBackdated: boolean;
  backdateMinutes: number;
  requestedEpochMs: number;
}

type BackdatePolicyError = {
  error: string;
  status: 400 | 403;
};

type BackdatePolicyEvaluation =
  | { ok: true; data: BackdatePolicyResult }
  | { ok: false; error: BackdatePolicyError };

export function evaluateTransactionDateTimePolicy(input: {
  saleDate: string;
  saleTime: string;
  role: UserRole;
}): BackdatePolicyEvaluation {
  const parsed = parseBangkokDateTimeStrict(input.saleDate, input.saleTime);
  if (!parsed) {
    return {
      ok: false,
      error: { error: "saleDate/saleTime ไม่ถูกต้อง", status: 400 },
    };
  }

  const now = getBangkokDateTimeNow();
  if (parsed.epochMs > now.epochMs + FUTURE_TOLERANCE_MS) {
    return {
      ok: false,
      error: {
        error: "ไม่สามารถบันทึกรายการในอนาคตได้",
        status: 400,
      },
    };
  }

  if (parsed.epochMs < now.epochMs - MAX_BACKDATE_MS) {
    return {
      ok: false,
      error: {
        error: `ไม่สามารถบันทึกรายการย้อนหลังเกิน ${MAX_BACKDATE_DAYS} วัน`,
        status: 400,
      },
    };
  }

  if (input.role !== "admin" && parsed.saleDate < now.saleDate) {
    return {
      ok: false,
      error: {
        error: "เฉพาะผู้ดูแลระบบเท่านั้นที่บันทึกย้อนหลังได้",
        status: 403,
      },
    };
  }

  const diffMinutes = Math.max(0, Math.floor((now.epochMs - parsed.epochMs) / 60000));
  return {
    ok: true,
    data: {
      effectiveSaleDate: parsed.saleDate,
      effectiveSaleTime: parsed.saleTime,
      isBackdated: diffMinutes >= 5,
      backdateMinutes: diffMinutes,
      requestedEpochMs: parsed.epochMs,
    },
  };
}

export async function detectInvoiceOverlapWarnings(
  db: DrizzleDB,
  customerId: number,
  saleDate: string
): Promise<TransactionWarning[]> {
  const overlapping = await db
    .select({
      id: invoices.id,
      status: invoices.status,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.customerId, customerId),
        inArray(invoices.status, ["issued", "paid"]),
        lte(invoices.periodStart, saleDate),
        gte(invoices.periodEnd, saleDate)
      )
    );

  if (overlapping.length === 0) return [];

  return [
    {
      code: "invoice_period_overlap",
      message:
        "วันที่ขายตรงกับช่วงใบวางบิลที่ออกแล้ว/ชำระแล้ว ควรตรวจสอบการ reconcile ใบวางบิลหลังบันทึก",
      invoiceIds: overlapping.map((row) => row.id),
    },
  ];
}
