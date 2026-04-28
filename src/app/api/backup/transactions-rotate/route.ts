import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, gt, gte, lt, or } from "drizzle-orm";
import { getDb } from "@/db";
import {
  bagLedger,
  customers,
  productTypes,
  transactionItems,
  transactions,
} from "@/db/schema";
import { withErrorHandler } from "@/lib/api-utils";
import {
  parseDryRun,
  readCronToken,
  shiftDate,
} from "@/lib/line-report-utils";
import { putObjectToS3Compatible } from "@/lib/s3-upload";
import { getSupericeBackupEnv } from "@/lib/config/env";

const BACKUP_TIMEZONE = "Asia/Bangkok";

interface CutoffWindow {
  startDate: string;
  endDate: string;
  cutoffTime: string;
}

function parseCutoffHour(): number {
  return getSupericeBackupEnv().backupCutoffHour;
}

function getDateAndHourInTimezone(timeZone: string, date = new Date()): {
  isoDate: string;
  hour: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  const hour = parts.find((p) => p.type === "hour")?.value;

  if (!year || !month || !day || !hour) {
    throw new Error("Failed to resolve timezone date/hour for backup window");
  }

  return {
    isoDate: `${year}-${month}-${day}`,
    hour: Number.parseInt(hour, 10),
  };
}

function resolveCutoffWindow(cutoffHour: number): CutoffWindow {
  const { isoDate: todayInBkk, hour: currentHourInBkk } =
    getDateAndHourInTimezone(BACKUP_TIMEZONE);

  const endDate =
    currentHourInBkk >= cutoffHour ? todayInBkk : shiftDate(todayInBkk, -1);
  const startDate = shiftDate(endDate, -1);
  const cutoffTime = `${String(cutoffHour).padStart(2, "0")}:00:00`;

  return {
    startDate,
    endDate,
    cutoffTime,
  };
}

function slotForDate(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map((part) => Number.parseInt(part, 10));
  const dayNumber = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
  return (dayNumber % 3) + 1;
}

async function fetchWindowBackupData(window: CutoffWindow) {
  const db = await getDb();

  const lowerBound = or(
    gt(transactions.saleDate, window.startDate),
    and(eq(transactions.saleDate, window.startDate), gte(transactions.saleTime, window.cutoffTime))
  );

  const upperBound = or(
    lt(transactions.saleDate, window.endDate),
    and(eq(transactions.saleDate, window.endDate), lt(transactions.saleTime, window.cutoffTime))
  );

  const whereWindow = and(lowerBound, upperBound);

  const [txRows, itemRows, bagRows] = await Promise.all([
    db
      .select({
        id: transactions.id,
        customerId: transactions.customerId,
        customerName: customers.name,
        totalAmount: transactions.totalAmount,
        paid: transactions.paid,
        outstandingAmount: transactions.outstandingAmount,
        status: transactions.status,
        transactionKind: transactions.transactionKind,
        saleDate: transactions.saleDate,
        saleTime: transactions.saleTime,
        note: transactions.note,
        transferRef: transactions.transferRef,
        transferDestination: transactions.transferDestination,
        transferTruck: transactions.transferTruck,
        transferAccountingStatus: transactions.transferAccountingStatus,
        originalTransactionId: transactions.originalTransactionId,
        sourceSystem: transactions.sourceSystem,
        sourceFactory: transactions.sourceFactory,
        sourceFile: transactions.sourceFile,
        sourceRowKey: transactions.sourceRowKey,
        importBatchId: transactions.importBatchId,
        fulfillment: transactions.fulfillment,
        createdBy: transactions.createdBy,
        voidedBy: transactions.voidedBy,
        voidReason: transactions.voidReason,
        clientId: transactions.clientId,
        createdAt: transactions.createdAt,
      })
      .from(transactions)
      .leftJoin(customers, eq(transactions.customerId, customers.id))
      .where(whereWindow)
      .orderBy(
        asc(transactions.saleDate),
        asc(transactions.saleTime),
        asc(transactions.id)
      ),
    db
      .select({
        id: transactionItems.id,
        transactionId: transactionItems.transactionId,
        productTypeId: transactionItems.productTypeId,
        productName: productTypes.name,
        quantity: transactionItems.quantity,
        unitPrice: transactionItems.unitPrice,
        subtotal: transactionItems.subtotal,
        loadedQty: transactionItems.loadedQty,
      })
      .from(transactionItems)
      .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
      .leftJoin(productTypes, eq(transactionItems.productTypeId, productTypes.id))
      .where(whereWindow)
      .orderBy(asc(transactionItems.transactionId), asc(transactionItems.id)),
    db
      .select({
        id: bagLedger.id,
        transactionId: bagLedger.transactionId,
        customerId: bagLedger.customerId,
        customerName: customers.name,
        productTypeId: bagLedger.productTypeId,
        productName: productTypes.name,
        type: bagLedger.type,
        quantity: bagLedger.quantity,
        note: bagLedger.note,
        createdBy: bagLedger.createdBy,
        createdAt: bagLedger.createdAt,
      })
      .from(bagLedger)
      .innerJoin(transactions, eq(bagLedger.transactionId, transactions.id))
      .leftJoin(customers, eq(bagLedger.customerId, customers.id))
      .leftJoin(productTypes, eq(bagLedger.productTypeId, productTypes.id))
      .where(whereWindow)
      .orderBy(asc(bagLedger.transactionId), asc(bagLedger.id)),
  ]);

  return {
    transactions: txRows,
    transactionItems: itemRows,
    bagLedger: bagRows,
  };
}

async function handle(request: NextRequest) {
  const backupEnv = getSupericeBackupEnv(process.cwd());
  const expectedToken = backupEnv.backupCronToken;
  if (!expectedToken) {
    return NextResponse.json(
      { error: "BACKUP_CRON_TOKEN is not configured" },
      { status: 500 }
    );
  }

  const providedToken = readCronToken(request);
  if (!providedToken || providedToken !== expectedToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = parseDryRun(request);
  const cutoffHour = parseCutoffHour();
  const window = resolveCutoffWindow(cutoffHour);
  const slot = slotForDate(window.endDate);

  const backupPayload = {
    exportDate: new Date().toISOString(),
    version: "transaction-history-backup.v1",
    timezone: BACKUP_TIMEZONE,
    cutoffHour,
    window: {
      startDate: window.startDate,
      startTime: window.cutoffTime,
      endDate: window.endDate,
      endTime: window.cutoffTime,
    },
    slot,
    tables: await fetchWindowBackupData(window),
  };

  const counts = {
    transactions: backupPayload.tables.transactions.length,
    transactionItems: backupPayload.tables.transactionItems.length,
    bagLedger: backupPayload.tables.bagLedger.length,
  };

  const localDir = backupEnv.backupLocalDir;
  const fileName = `transactions-history-slot-${slot}.json`;
  const localPath = path.join(localDir, fileName);

  const {
    endpoint: r2Endpoint,
    bucket: r2Bucket,
    accessKeyId: r2AccessKeyId,
    secretAccessKey: r2SecretAccessKey,
    sessionToken: r2SessionToken,
    region: r2Region,
    prefix: r2Prefix,
  } = backupEnv.r2;

  const missingR2 = [
    ["BACKUP_R2_ENDPOINT", r2Endpoint],
    ["BACKUP_R2_BUCKET", r2Bucket],
    ["BACKUP_R2_ACCESS_KEY_ID", r2AccessKeyId],
    ["BACKUP_R2_SECRET_ACCESS_KEY", r2SecretAccessKey],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  const r2ObjectKey = r2Prefix ? `${r2Prefix}/${fileName}` : fileName;

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      slot,
      window: backupPayload.window,
      counts,
      localPath,
      r2ObjectKey,
      missingR2,
    });
  }

  if (missingR2.length > 0) {
    return NextResponse.json(
      {
        error: "Missing required R2 configuration",
        missing: missingR2,
      },
      { status: 500 }
    );
  }

  const json = JSON.stringify(
    {
      ...backupPayload,
      counts,
    },
    null,
    2
  );

  await mkdir(localDir, { recursive: true });
  await writeFile(localPath, json, "utf8");

  const upload = await putObjectToS3Compatible({
    endpoint: r2Endpoint!,
    region: r2Region,
    accessKeyId: r2AccessKeyId!,
    secretAccessKey: r2SecretAccessKey!,
    sessionToken: r2SessionToken || undefined,
    bucket: r2Bucket!,
    key: r2ObjectKey,
    body: json,
    contentType: "application/json; charset=utf-8",
  });

  return NextResponse.json({
    ok: true,
    slot,
    window: backupPayload.window,
    counts,
    localPath,
    r2ObjectKey,
    r2Etag: upload.etag,
  });
}

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  return handle(request);
});

export const POST = withErrorHandler(async function POST(request: NextRequest) {
  return handle(request);
});
