import type { DrizzleDB } from "@/db";
import { paymentEvents } from "@/db/schema";
import { nowTimeISO, todayISO } from "@/lib/thai-utils";

export type PaymentEventMethod = "cash" | "bank_transfer" | "cheque" | "other";

type PaymentEventWriter = Pick<DrizzleDB, "insert">;

export interface RecordPaymentEventParams {
  transactionId: number | null;
  invoiceId?: number | null;
  invoicePaymentId?: number | null;
  amount: number;
  method?: PaymentEventMethod | null;
  note?: string | null;
  createdBy?: number | null;
  createdAt?: Date;
  eventDate?: string;
  eventTime?: string;
}

export async function recordPaymentEvent(
  db: PaymentEventWriter,
  params: RecordPaymentEventParams
): Promise<void> {
  const createdAt = params.createdAt || new Date();

  await db.insert(paymentEvents).values({
    transactionId: params.transactionId,
    invoiceId: params.invoiceId ?? null,
    invoicePaymentId: params.invoicePaymentId ?? null,
    eventDate: params.eventDate || todayISO(),
    eventTime: params.eventTime || nowTimeISO(),
    amount: params.amount,
    method: params.method ?? null,
    note: params.note ?? null,
    createdBy: params.createdBy ?? null,
    createdAt,
  });
}
