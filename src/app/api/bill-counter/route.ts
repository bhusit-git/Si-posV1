import { NextRequest, NextResponse } from "next/server";
import { FACTORY_COOKIE, getDb } from "@/db";
import { requireManagerUp } from "@/lib/api-auth";
import { logAudit } from "@/lib/audit";
import { withErrorHandler } from "@/lib/api-utils";
import { getOrCreateBillCounter, setNextBillCounterNumber } from "@/lib/bill-counter";
import { formatPrintedBillNumber, PRINTED_BILL_MAX, PRINTED_BILL_MIN } from "@/lib/bill-number";
import { resolveActiveFactoryKey } from "@/lib/factory-key";
import { requireFactoryWriteContext } from "@/lib/factory-context";

function parseNextBillNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < PRINTED_BILL_MIN || value > PRINTED_BILL_MAX) return null;
  return value;
}

function parseSourcePage(value: unknown): "sale" | "returns" | null {
  return value === "sale" || value === "returns" ? value : null;
}

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;

  const db = await getDb();
  const factoryKey = await resolveActiveFactoryKey(
    request.cookies.get(FACTORY_COOKIE)?.value,
    auth.user.factoryKey
  );
  const state = await getOrCreateBillCounter(db, factoryKey);

  return NextResponse.json(state);
});

export const PATCH = withErrorHandler(async function PATCH(request: NextRequest) {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;

  const body = await request.json();
  const nextBillNumber = parseNextBillNumber(body?.nextBillNumber);
  const sourcePage = parseSourcePage(body?.sourcePage);

  if (nextBillNumber == null) {
    return NextResponse.json(
      { error: "เลขบิลต้องเป็นตัวเลข 4 หลักระหว่าง 0000-9999" },
      { status: 400 }
    );
  }

  if (!sourcePage) {
    return NextResponse.json(
      { error: "sourcePage ต้องเป็น sale หรือ returns" },
      { status: 400 }
    );
  }

  const factoryContext = requireFactoryWriteContext(request, auth.user);
  if ("error" in factoryContext) return factoryContext.error;
  const { db, factoryKey } = factoryContext;
  const current = await getOrCreateBillCounter(db, factoryKey);
  if (current.nextBillNumber === nextBillNumber) {
    return NextResponse.json(current);
  }

  const updated = await setNextBillCounterNumber(db, factoryKey, nextBillNumber);

  await logAudit({
    userId: auth.user.id,
    username: auth.user.username,
    action: "bill_counter.update",
    entity: "bill_counter",
    entityId: null,
    details: {
      factoryKey,
      previousNextBillNumber: current.nextBillNumber,
      newNextBillNumber: updated.nextBillNumber,
      sourcePage,
      auditActionLabel: "แก้เลขบิลถัดไป",
      auditSummary: `เปลี่ยนเลขบิลถัดไปจาก ${
        formatPrintedBillNumber(current.nextBillNumber) || current.nextBillNumber
      } เป็น ${formatPrintedBillNumber(updated.nextBillNumber) || updated.nextBillNumber}`,
    },
  }, db);

  return NextResponse.json(updated);
});
