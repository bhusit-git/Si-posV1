import { z } from "zod";
import { TRANSFER_REF_REGEX } from "@/lib/transfer-utils";

// Shared primitives
const positiveInt = z.number().int().positive();
const nonNegativeNum = z.number().nonnegative();
const optionalPositiveInt = z.number().int().positive().nullable().optional();
const shortString = z.string().min(1).max(500);
const optionalShortString = z.string().max(500).optional().nullable();

// ============================================================
// Transaction schemas
// ============================================================

export const transactionItemSchema = z.object({
  productTypeId: positiveInt,
  quantity: z.number().int().min(1).max(99999),
  unitPrice: nonNegativeNum.max(999999),
});

export const bagReturnSchema = z.object({
  productTypeId: positiveInt,
  quantity: z.number().int().min(1).max(99999),
});

export const createTransactionSchema = z.object({
  clientId: z.string().max(100).optional().nullable(),
  customerId: positiveInt,
  billNumber: z.number().int().min(0).max(9999).optional().nullable(),
  items: z.array(transactionItemSchema).max(100).default([]),
  paid: z.number().optional(),
  status: z.enum(["paid", "unpaid", "partial"]).optional(),
  pool: z.number().int().min(1).max(2).nullable().optional(),
  row: z.number().int().min(1).max(6).nullable().optional(),
  col: z.number().int().nullable().optional(),
  saleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  saleTime: z.string().regex(/^\d{2}:\d{2}:\d{2}$/),
  fulfillment: z.enum(["pending", "loaded"]).optional().nullable(),
  bagReturns: z.array(bagReturnSchema).optional().default([]),
  newPrices: z
    .array(
      z.object({
        productTypeId: positiveInt,
        unitPrice: nonNegativeNum.max(999999),
      })
    )
    .optional(),
  transactionType: z.enum(["sale", "transfer_out"]).optional(),
  transferRef: z.string().max(50).optional(),
  transferDestination: z.string().max(200).optional().nullable(),
  transferTruck: z.string().max(200).optional().nullable(),
  backdateReason: optionalShortString,
  note: optionalShortString,
}).superRefine((data, ctx) => {
  const hasItems = (data.items?.length || 0) > 0;
  const hasBagReturns = (data.bagReturns?.length || 0) > 0;

  if (!hasItems && !hasBagReturns) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "ต้องมีรายการขาย หรือคืนถุงอย่างน้อย 1 รายการ",
      path: ["items"],
    });
  }

  if (data.transactionType === "transfer_out") {
    if (!hasItems && !hasBagReturns) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "เครดิตต้องมีรายการสินค้า หรือคืนถุงอย่างน้อย 1 รายการ",
        path: ["items"],
      });
    }
    if (!data.transferRef || !TRANSFER_REF_REGEX.test(data.transferRef.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "รหัสโอนต้องเป็นรูปแบบ TRF-YYYYMMDD-###",
        path: ["transferRef"],
      });
    }
  }
});

export const transactionPrecheckSchema = z.object({
  customerId: positiveInt,
  saleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  saleTime: z.string().regex(/^\d{2}:\d{2}:\d{2}$/),
  backdateReason: optionalShortString,
});

export const voidTransactionSchema = z.object({
  id: positiveInt,
  action: z.literal("void"),
  reason: shortString,
});

export const payTransactionSchema = z.object({
  id: positiveInt,
  action: z.literal("payment"),
  amount: z.number().refine((value) => value !== 0, {
    message: "จำนวนเงินต้องไม่เป็น 0",
  }).refine((value) => Math.abs(value) <= 999999999, {
    message: "จำนวนเงินเกินกว่าที่ระบบรองรับ",
  }),
});

export const payAllTransactionSchema = z.object({
  action: z.literal("payAll"),
  customerId: positiveInt,
});

export const updateTransferAccountingStatusSchema = z.object({
  id: positiveInt,
  accountingStatus: z.enum(["open", "closed"]),
});

export const fulfillmentSchema = z.object({
  id: positiveInt,
  action: z.literal("fulfillment"),
});

// ============================================================
// Return schema
// ============================================================

export const createReturnSchema = z.object({
  customerId: positiveInt,
  billNumber: z.number().int().min(0).max(9999).optional().nullable(),
  items: z.array(
    z.object({
      productTypeId: positiveInt,
      quantity: z.number().int().min(1).max(99999),
      unitPrice: nonNegativeNum.max(999999),
    })
  ).max(100).default([]),
  bagReturns: z
    .array(
      z.object({
        productTypeId: positiveInt,
        quantity: z.number().int().min(1).max(99999),
      })
    )
    .optional()
    .default([]),
  saleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  saleTime: z.string().regex(/^\d{2}:\d{2}:\d{2}$/),
  note: optionalShortString,
  originalBill: optionalPositiveInt,
}).superRefine((data, ctx) => {
  const hasItems = (data.items?.length || 0) > 0;
  const hasBagReturns = (data.bagReturns?.length || 0) > 0;

  if (!hasItems && !hasBagReturns) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "ต้องมีรายการคืนสินค้า หรือคืนถุงอย่างน้อย 1 รายการ",
      path: ["items"],
    });
  }

  // Product refunds must always be tied to an original bill.
  if (hasItems && !data.originalBill) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "การคืนสินค้าต้องอ้างอิงบิลเดิม",
      path: ["originalBill"],
    });
  }
});

// ============================================================
// Customer schema
// ============================================================

const customerPriceSchema = z.object({
  productTypeId: positiveInt,
  unitPrice: nonNegativeNum.max(999999),
  bagDeposit: nonNegativeNum.max(999999).optional(),
});

export const createCustomerSchema = z.object({
  name: shortString,
  phone: optionalShortString,
  credit: z.boolean().optional(),
  transferCustomer: z.boolean().optional(),
  prices: z.array(customerPriceSchema).optional(),
});

export const updateCustomerSchema = z.object({
  id: positiveInt,
  name: shortString,
  phone: optionalShortString,
  credit: z.boolean().optional(),
  transferCustomer: z.boolean().optional(),
  prices: z.array(customerPriceSchema).optional(),
});

// ============================================================
// Production schema
// ============================================================

export const createProductionSchema = z.object({
  productTypeId: positiveInt,
  quantity: z.number().int().min(1).max(999999),
  note: optionalShortString,
});

// ============================================================
// Bag adjustment schema
// ============================================================

export const createBagAdjustmentSchema = z.object({
  customerId: positiveInt,
  productTypeId: positiveInt.optional(),
  type: z.enum(["out", "return", "adjust"]),
  quantity: z.number().int().max(99999),
  note: optionalShortString,
});

// ============================================================
// Auth schema
// ============================================================

export const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

export const userPasswordSchema = z
  .string()
  .min(4, "รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร")
  .max(200);

// ============================================================
// Helper: validate and extract
// ============================================================

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}:\d{2}$/;
const BANGKOK_UTC_OFFSET_HOURS = 7;

export interface ParsedBangkokDateTime {
  saleDate: string;
  saleTime: string;
  epochMs: number;
}

export function parseBangkokDateTimeStrict(
  saleDate: string,
  saleTime: string
): ParsedBangkokDateTime | null {
  if (!DATE_RE.test(saleDate) || !TIME_RE.test(saleTime)) return null;

  const [yRaw, mRaw, dRaw] = saleDate.split("-");
  const [hhRaw, mmRaw, ssRaw] = saleTime.split(":");

  const year = Number(yRaw);
  const month = Number(mRaw);
  const day = Number(dRaw);
  const hour = Number(hhRaw);
  const minute = Number(mmRaw);
  const second = Number(ssRaw);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || !Number.isInteger(second)) {
    return null;
  }
  if (month < 1 || month > 12) return null;
  if (hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;
  if (second < 0 || second > 59) return null;

  const dateUtc = new Date(Date.UTC(year, month - 1, day));
  if (
    dateUtc.getUTCFullYear() !== year ||
    dateUtc.getUTCMonth() !== month - 1 ||
    dateUtc.getUTCDate() !== day
  ) {
    return null;
  }

  const epochMs = Date.UTC(
    year,
    month - 1,
    day,
    hour - BANGKOK_UTC_OFFSET_HOURS,
    minute,
    second
  );

  if (!Number.isFinite(epochMs)) return null;

  return {
    saleDate: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    saleTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`,
    epochMs,
  };
}

export function validateBody<T>(schema: z.ZodSchema<T>, body: unknown): { data: T } | { error: string } {
  const result = schema.safeParse(body);
  if (!result.success) {
    const firstError = result.error.issues[0];
    const path = firstError.path.join(".");
    return { error: `${path ? path + ": " : ""}${firstError.message}` };
  }
  return { data: result.data };
}
