/**
 * Migrate a date window from Access MDB directly to Render /api/migrate upload endpoint.
 *
 * Safe defaults:
 * - DRY_RUN=1 (no remote writes)
 * - ID offsets default to high values to reduce collision risk on non-empty targets
 *
 * Usage:
 *   START_DATE=YYYY-MM-DD END_DATE=YYYY-MM-DD FACTORY=si \
 *   DRY_RUN=1 npx tsx scripts/migrate-mdb-to-render-window.ts "/path/to/SI.mdb"
 *
 * Live run (after dry-run validation):
 *   START_DATE=YYYY-MM-DD END_DATE=YYYY-MM-DD FACTORY=si DRY_RUN=0 \
 *   TRANSACTIONS_ONLY=1 \
 *   OVERWRITE=1 \
 *   OVERWRITE_SCOPE=window \
 *   MIGRATE_KEY="..." RENDER_URL="https://superice-pos.onrender.com" \
 *   npx tsx scripts/migrate-mdb-to-render-window.ts "/path/to/SI.mdb"
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { parse as parseCsvSync } from "csv-parse/sync";
import { parse as parseCsvStream } from "csv-parse";
import {
  DRY_GOODS,
  LEGACY_BY_ACCESS_EN,
  LEGACY_ICE,
  NEW_ICE_PRODUCTS,
} from "../src/lib/product-definitions";

type FactoryKey = "si" | "bearing" | "ktk";
type TransactionKind = "sale" | "transfer_out" | "return" | "adjustment";
type TransferAccountingStatus = "open" | "closed";

type CsvRow = Record<string, string | undefined>;

type UploadProduct = {
  id: number;
  name: string;
  name_en: string | null;
  has_bag: boolean;
  decreases_bag: boolean;
  is_active: boolean;
  sort_order: number;
};

type UploadCustomer = {
  id: number;
  name: string;
  phone: string | null;
  credit: boolean;
  source_system: "access_mdb";
  source_factory: string | null;
  source_file: string | null;
  source_row_key: string;
  import_batch_id: null;
  created_at: string;
};

type UploadCustomerPrice = {
  id: number;
  customer_id: number;
  product_type_id: number;
  unit_price: number;
  bag_deposit: number;
};

type UploadTransaction = {
  id: number;
  customer_id: number;
  total_amount: number;
  paid: number;
  outstanding_amount: number;
  status: "paid" | "unpaid" | "partial" | "voided";
  transaction_kind: TransactionKind;
  pool: number | null;
  row: number | null;
  col: number | null;
  sale_date: string;
  sale_time: string;
  note: string | null;
  transfer_ref: string | null;
  transfer_destination: string | null;
  transfer_truck: string | null;
  transfer_accounting_status: TransferAccountingStatus | null;
  original_transaction_id: number | null;
  source_system: "access_mdb";
  source_factory: string | null;
  source_file: string | null;
  source_row_key: string;
  import_batch_id: null;
  created_at: string;
};

type UploadTransactionItem = {
  id: number;
  transaction_id: number;
  product_type_id: number;
  quantity: number;
  unit_price: number;
  subtotal: number;
};

type UploadBagLedger = {
  id: number;
  customer_id: number;
  product_type_id: number;
  type: "adjust";
  quantity: number;
  transaction_id: null;
  note: string;
  created_at: string;
};

type PreparedPayload = {
  products: UploadProduct[];
  customers: UploadCustomer[];
  customerPrices: UploadCustomerPrice[];
  transactions: UploadTransaction[];
  transactionItems: UploadTransactionItem[];
  bagLedger: UploadBagLedger[];
  stats: {
    startDate: string;
    endDate: string;
    sourceRowsRead: number;
    sourceRowsInWindow: number;
    skippedInvalidDate: number;
    skippedOrphanCustomer: number;
    transactions: number;
    transactionItems: number;
    uniqueCustomers: number;
    totalSales: number;
  };
};

const mdbPath = process.argv[2];
const factory = (process.env.FACTORY || "si") as FactoryKey;
const sourceFactory = factory;
const sourceFile = mdbPath ? path.basename(mdbPath) : null;

const START_DATE = process.env.START_DATE || "";
const END_DATE = process.env.END_DATE || "";
const START_TIME = normalizeTime(process.env.START_TIME, "00:00:00");
const END_TIME = normalizeTime(process.env.END_TIME, "23:59:59");
const DRY_RUN = process.env.DRY_RUN !== "0";
const TRANSACTIONS_ONLY = process.env.TRANSACTIONS_ONLY === "1";
const OVERWRITE = process.env.OVERWRITE === "1";
const OVERWRITE_SCOPE = (process.env.OVERWRITE_SCOPE || "window").toLowerCase(); // window | all
const INIT_FACTORY = process.env.INIT_FACTORY === "1";
const RENDER_URL = (process.env.RENDER_URL || "https://superice-pos.onrender.com").replace(/\/$/, "");
const MIGRATE_KEY = process.env.MIGRATE_KEY || "superice2026migrate";
const BATCH_SIZE = toInt(process.env.BATCH_SIZE, 500);

// For append mode, default to high IDs to reduce collisions on non-empty targets.
// For overwrite mode, default to low IDs.
const defaultOffsetBase = OVERWRITE || TRANSACTIONS_ONLY ? 0 : 1_000_000;
const defaultCustomerPriceStart = OVERWRITE ? 1 : defaultOffsetBase + 1_000_000;
const defaultTxStart = OVERWRITE ? 1 : defaultOffsetBase + 2_000_000;
const defaultItemStart = OVERWRITE ? 1 : defaultOffsetBase + 20_000_000;
const defaultBagStart = OVERWRITE ? 1 : defaultOffsetBase + 40_000_000;

const ID_OFFSET_BASE = toInt(process.env.ID_OFFSET_BASE, defaultOffsetBase);
const CUSTOMER_ID_OFFSET = toInt(process.env.CUSTOMER_ID_OFFSET, ID_OFFSET_BASE);
const CUSTOMER_PRICE_ID_START = toInt(process.env.CUSTOMER_PRICE_ID_START, defaultCustomerPriceStart);
const TX_ID_START = toInt(process.env.TX_ID_START, defaultTxStart);
const ITEM_ID_START = toInt(process.env.ITEM_ID_START, defaultItemStart);
const BAG_ID_START = toInt(process.env.BAG_ID_START, defaultBagStart);

if (!mdbPath) {
  console.error("Usage: npx tsx scripts/migrate-mdb-to-render-window.ts <path-to-file.mdb>");
  process.exit(1);
}
if (!fs.existsSync(mdbPath)) {
  console.error(`File not found: ${mdbPath}`);
  process.exit(1);
}
if (!START_DATE || !END_DATE) {
  console.error("START_DATE and END_DATE are required (format: YYYY-MM-DD).");
  process.exit(1);
}
if (!isIsoDate(START_DATE) || !isIsoDate(END_DATE) || START_DATE > END_DATE) {
  console.error(`Invalid START_DATE/END_DATE: ${START_DATE} .. ${END_DATE} (format: YYYY-MM-DD).`);
  process.exit(1);
}
if (!START_TIME || !END_TIME) {
  console.error(
    `Invalid START_TIME/END_TIME: ${process.env.START_TIME || ""} .. ${process.env.END_TIME || ""} (format: HH:MM or HH:MM:SS).`
  );
  process.exit(1);
}
if (!["si", "bearing", "ktk"].includes(factory)) {
  console.error(`Invalid FACTORY: ${factory}. Use si | bearing | ktk`);
  process.exit(1);
}
if (!["window", "all"].includes(OVERWRITE_SCOPE)) {
  console.error(`Invalid OVERWRITE_SCOPE: ${OVERWRITE_SCOPE}. Use window | all`);
  process.exit(1);
}

const legacyByAccessEn = new Map(
  Array.from(LEGACY_BY_ACCESS_EN.entries()).map(([accessEn, product]) => [accessEn, product.newId])
);

const priceMapping: { accessEn: string; priceCol: string; bagPriceCol: string; bagCol: string }[] = [
  { accessEn: "Pack", priceCol: "PackPrice", bagPriceCol: "", bagCol: "" },
  { accessEn: "Unit", priceCol: "UnitPrice", bagPriceCol: "UnitBagPrice", bagCol: "UnitBag" },
  { accessEn: "Bare", priceCol: "BarePrice", bagPriceCol: "BareBagPrice", bagCol: "BareBag" },
  { accessEn: "Unit30", priceCol: "Unit30Price", bagPriceCol: "Unit30BagPrice", bagCol: "Unit30Bag" },
  { accessEn: "Crack", priceCol: "CrackPrice", bagPriceCol: "CrackBagPrice", bagCol: "CrackBag" },
  { accessEn: "UnitSmall", priceCol: "UnitPriceSmall", bagPriceCol: "UnitBagPriceSmall", bagCol: "UnitBagSmall" },
];

const transProductMapping: { accessEn: string; qtyCol: string; priceCol: string }[] = [
  { accessEn: "Pack", qtyCol: "Pack", priceCol: "PackPrice" },
  { accessEn: "Unit", qtyCol: "Unit", priceCol: "UnitPrice" },
  { accessEn: "Bare", qtyCol: "Bare", priceCol: "BarePrice" },
  { accessEn: "Unit30", qtyCol: "Unit30", priceCol: "Unit30Price" },
  { accessEn: "Crack", qtyCol: "Crack", priceCol: "CrackPrice" },
  { accessEn: "UnitSmall", qtyCol: "UnitSmall", priceCol: "UnitPriceSmall" },
];

function toInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function toNum(raw: string | undefined | null): number {
  if (!raw || raw === "" || raw === "null") return 0;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function toBool(raw: string | undefined | null): boolean {
  if (!raw) return false;
  return raw === "1" || raw.toLowerCase() === "true";
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function normalizeTime(raw: string | undefined, fallback: string): string | null {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  const second = match[3] ? Number.parseInt(match[3], 10) : 0;
  if (hour > 23 || minute > 59 || second > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

function parseAccessDate(dateStr: string | undefined | null): Date | null {
  if (!dateStr) return null;
  const parts = dateStr.split(" ")[0].split("/");
  if (parts.length !== 3) return null;
  const month = parseInt(parts[0], 10);
  const day = parseInt(parts[1], 10);
  let year = parseInt(parts[2], 10);
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return null;
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(year, month - 1, day);
}

function formatDateFromAccess(dateStr: string | undefined | null): string | null {
  const d = parseAccessDate(dateStr);
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTimeFromAccess(timeStr: string | undefined | null): string {
  if (!timeStr) return "00:00:00";
  const parts = timeStr.split(" ");
  if (parts.length > 1 && /^\d{1,2}:\d{2}:\d{2}$/.test(parts[1])) {
    const [h, m, s] = parts[1].split(":");
    return `${h.padStart(2, "0")}:${m}:${s}`;
  }
  return "00:00:00";
}

function isWithinWindow(date: string, time: string): boolean {
  if (date < START_DATE || date > END_DATE) return false;
  if (date === START_DATE && time < START_TIME) return false;
  if (date === END_DATE && time > END_TIME) return false;
  return true;
}

function parseOriginalBillId(note: string | undefined | null): number | null {
  if (!note) return null;
  const match = /อ้างอิงบิล\s*#\s*(\d+)/.exec(note);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseTransferNote(note: string | undefined | null): {
  ref: string | null;
  destination: string | null;
  truck: string | null;
  accountingStatus: TransferAccountingStatus;
} | null {
  if (!note) return null;
  const trimmed = note.trim();
  if (!trimmed.startsWith("XFER|")) return null;

  const fields = new Map<string, string>();
  for (const token of trimmed.split("|").slice(1)) {
    const idx = token.indexOf("=");
    if (idx <= 0) continue;
    fields.set(token.slice(0, idx).trim().toLowerCase(), token.slice(idx + 1).trim());
  }

  const rawStatus = (fields.get("status") || "").toLowerCase();
  const accountingStatus: TransferAccountingStatus = rawStatus === "closed" ? "closed" : "open";

  return {
    ref: fields.get("ref") || null,
    destination: fields.get("to") || null,
    truck: fields.get("truck") || null,
    accountingStatus,
  };
}

function inferTransactionKind(note: string | undefined | null, totalAmount: number): TransactionKind {
  if (parseTransferNote(note)) return "transfer_out";
  if (totalAmount < 0) return "return";
  return "sale";
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

function exportMdbTableSync(tableName: string): CsvRow[] {
  const csv = execSync(`mdb-export "${mdbPath}" "${tableName}"`, {
    maxBuffer: 512 * 1024 * 1024,
    encoding: "utf-8",
  });
  return parseCsvSync(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as CsvRow[];
}

async function streamMdbTable(tableName: string, onRow: (row: CsvRow, idx: number) => Promise<void> | void): Promise<number> {
  const tmpFile = path.join(process.cwd(), `scripts/_tmp_${tableName}_${Date.now()}.csv`);
  try {
    execSync(`mdb-export "${mdbPath}" "${tableName}" > "${tmpFile}"`, {
      shell: "/bin/bash",
      maxBuffer: 10 * 1024,
    });

    const parser = parseCsvStream({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
      relax_column_count: true,
    });

    const input = fs.createReadStream(tmpFile, { encoding: "utf-8" });
    input.pipe(parser);

    let idx = 0;
    for await (const row of parser) {
      idx++;
      await onRow(row as CsvRow, idx);
    }

    return idx;
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
}

function buildProducts(): UploadProduct[] {
  const products: UploadProduct[] = [];

  for (const p of NEW_ICE_PRODUCTS) {
    products.push({
      id: p.id,
      name: p.name,
      name_en: p.nameEn,
      has_bag: p.hasBag,
      decreases_bag: false,
      is_active: true,
      sort_order: p.sortOrder,
    });
  }

  for (const d of DRY_GOODS) {
    products.push({
      id: d.id,
      name: d.name,
      name_en: null,
      has_bag: false,
      decreases_bag: Boolean(d.decreasesBag),
      is_active: true,
      sort_order: d.id,
    });
  }

  for (const l of LEGACY_ICE) {
    products.push({
      id: l.newId,
      name: l.name,
      name_en: l.nameEn,
      has_bag: l.hasBag,
      decreases_bag: false,
      is_active: true,
      sort_order: l.newId,
    });
  }

  return products;
}

async function preparePayload(): Promise<PreparedPayload> {
  console.log("Exporting CustomerTable...");
  const customerRows = exportMdbTableSync("CustomerTable");
  const customerBySourceId = new Map<number, CsvRow>();
  for (const row of customerRows) {
    const sourceCustomerId = toInt(row.CustomerID, 0);
    if (sourceCustomerId > 0) customerBySourceId.set(sourceCustomerId, row);
  }
  console.log(`  Customers in MDB: ${customerBySourceId.size}`);

  const products = TRANSACTIONS_ONLY ? [] : buildProducts();

  const customers: UploadCustomer[] = [];
  const customerPrices: UploadCustomerPrice[] = [];
  const bagLedger: UploadBagLedger[] = [];
  const transactions: UploadTransaction[] = [];
  const transactionItems: UploadTransactionItem[] = [];

  let sourceRowsRead = 0;
  let sourceRowsInWindow = 0;
  let skippedInvalidDate = 0;
  let skippedOrphanCustomer = 0;
  let totalSales = 0;

  let nextTxId = TX_ID_START;
  let nextItemId = ITEM_ID_START;
  let sourceRowCounter = 0;
  const referencedSourceCustomerIds = new Set<number>();

  console.log("Streaming TransTable (this can take a while)...");
  sourceRowsRead = await streamMdbTable("TransTable", (row) => {
    sourceRowCounter++;

    const sourceCustomerId = toInt(row.CustomerID, 0);
    if (sourceCustomerId <= 0) return;

    const saleDate = formatDateFromAccess(row.SaleDate);
    if (!saleDate) {
      skippedInvalidDate++;
      return;
    }
    const saleTime = formatTimeFromAccess(row.SaleTime);
    if (!isWithinWindow(saleDate, saleTime)) return;

    sourceRowsInWindow++;

    const customerRow = customerBySourceId.get(sourceCustomerId);
    if (!customerRow) {
      skippedOrphanCustomer++;
      return;
    }

    let total = 0;
    const txItems: Array<{ productTypeId: number; qty: number; unitPrice: number; subtotal: number }> = [];

    for (const pm of transProductMapping) {
      const qty = toNum(row[pm.qtyCol]);
      if (qty === 0) continue;
      const unitPrice = toNum(row[pm.priceCol]);
      const productTypeId = legacyByAccessEn.get(pm.accessEn);
      if (!productTypeId) continue;
      const subtotal = qty * unitPrice;
      total += subtotal;
      txItems.push({ productTypeId, qty, unitPrice, subtotal });
    }

    const bagQty = toNum(row.Bag);
    const bagPrice = toNum(row.BagPrice);
    total += bagQty * bagPrice;

    const othQty = toNum(row.Oth);
    const othPrice = toNum(row.OthPrice);
    total += othQty * othPrice;

    const paidRaw = toNum(row.Paid);
    const note = row.Note || null;
    const transfer = parseTransferNote(note);
    const transactionKind = inferTransactionKind(note, total);
    const originalTransactionId = transactionKind === "return" ? parseOriginalBillId(note) : null;

    let status: UploadTransaction["status"];
    let paidAmount: number;
    if (paidRaw === -1) {
      paidAmount = total;
      status = "paid";
    } else if (paidRaw >= total) {
      paidAmount = paidRaw;
      status = "paid";
    } else if (paidRaw > 0) {
      paidAmount = paidRaw;
      status = "partial";
    } else {
      paidAmount = 0;
      status = total === 0 ? "paid" : "unpaid";
    }

    const targetCustomerId = sourceCustomerId + CUSTOMER_ID_OFFSET;
    referencedSourceCustomerIds.add(sourceCustomerId);

    const createdAt = `${saleDate}T${saleTime}`;

    transactions.push({
      id: nextTxId,
      customer_id: targetCustomerId,
      total_amount: total,
      paid: paidAmount,
      outstanding_amount: total - paidAmount,
      status,
      transaction_kind: transactionKind,
      pool: row.Pool == null || row.Pool === "" ? null : toInt(row.Pool, 0),
      row: row.Row == null || row.Row === "" ? null : toInt(row.Row, 0),
      col: row.Col == null || row.Col === "" ? null : toInt(row.Col, 0),
      sale_date: saleDate,
      sale_time: saleTime,
      note,
      transfer_ref: transfer?.ref || null,
      transfer_destination: transfer?.destination || null,
      transfer_truck: transfer?.truck || null,
      transfer_accounting_status: transfer?.accountingStatus || null,
      original_transaction_id: originalTransactionId,
      source_system: "access_mdb",
      source_factory: sourceFactory,
      source_file: sourceFile,
      source_row_key: `TransTable:${sourceRowCounter}`,
      import_batch_id: null,
      created_at: createdAt,
    });

    for (const item of txItems) {
      transactionItems.push({
        id: nextItemId,
        transaction_id: nextTxId,
        product_type_id: item.productTypeId,
        quantity: item.qty,
        unit_price: item.unitPrice,
        subtotal: item.subtotal,
      });
      nextItemId++;
    }

    totalSales += total;
    nextTxId++;
  });

  console.log(`  TransTable rows scanned: ${sourceRowsRead}`);

  if (!TRANSACTIONS_ONLY) {
    // Build customer, price, and opening bag rows only for referenced customers.
    let nextCustomerPriceId = CUSTOMER_PRICE_ID_START;
    let nextBagId = BAG_ID_START;

    for (const sourceCustomerId of Array.from(referencedSourceCustomerIds).sort((a, b) => a - b)) {
      const row = customerBySourceId.get(sourceCustomerId);
      if (!row) continue;

      const targetCustomerId = sourceCustomerId + CUSTOMER_ID_OFFSET;

      customers.push({
        id: targetCustomerId,
        name: row.CustomerName || `ลูกค้า ${sourceCustomerId}`,
        phone: row.TelephoneNumber || null,
        credit: toBool(row.Credit),
        source_system: "access_mdb",
        source_factory: sourceFactory,
        source_file: sourceFile,
        source_row_key: `CustomerTable:${sourceCustomerId}`,
        import_batch_id: null,
        created_at: row.DateIn || new Date().toISOString(),
      });

      for (const pm of priceMapping) {
        const productTypeId = legacyByAccessEn.get(pm.accessEn);
        if (!productTypeId) continue;

        customerPrices.push({
          id: nextCustomerPriceId,
          customer_id: targetCustomerId,
          product_type_id: productTypeId,
          unit_price: toNum(row[pm.priceCol]),
          bag_deposit: pm.bagPriceCol ? toNum(row[pm.bagPriceCol]) : 0,
        });
        nextCustomerPriceId++;
      }

      for (const pm of priceMapping) {
        if (!pm.bagCol) continue;
        const productTypeId = legacyByAccessEn.get(pm.accessEn);
        if (!productTypeId) continue;
        const bagBalance = toNum(row[pm.bagCol]);
        if (bagBalance === 0) continue;

        bagLedger.push({
          id: nextBagId,
          customer_id: targetCustomerId,
          product_type_id: productTypeId,
          type: "adjust",
          quantity: Math.abs(bagBalance),
          transaction_id: null,
          note:
            bagBalance > 0
              ? `ยอดยกมาจากระบบเดิม (ลูกค้าค้างถุง ${bagBalance} ใบ)`
              : `ยอดยกมาจากระบบเดิม (ถุงคืนเกิน ${Math.abs(bagBalance)} ใบ)`,
          created_at: new Date().toISOString(),
        });
        nextBagId++;
      }
    }
  }

  return {
    products,
    customers,
    customerPrices,
    transactions,
    transactionItems,
    bagLedger,
    stats: {
      startDate: START_DATE,
      endDate: END_DATE,
      sourceRowsRead,
      sourceRowsInWindow,
      skippedInvalidDate,
      skippedOrphanCustomer,
      transactions: transactions.length,
      transactionItems: transactionItems.length,
      uniqueCustomers: referencedSourceCustomerIds.size,
      totalSales,
    },
  };
}

function printSummary(payload: PreparedPayload): void {
  console.log("\n========================================");
  console.log("  MDB Window Migration Preview");
  console.log("========================================");
  console.log(`  Source file: ${mdbPath}`);
  console.log(`  Factory:     ${factory}`);
  console.log(`  Window:      ${payload.stats.startDate} -> ${payload.stats.endDate}`);
  console.log(`  Time range:  ${START_TIME} -> ${END_TIME}`);
  console.log(`  Mode:        ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`  Scope:       ${TRANSACTIONS_ONLY ? "TRANSACTIONS ONLY" : "FULL IMPORT"}`);
  console.log(`  Overwrite:   ${OVERWRITE ? "YES (wipe before upload)" : "NO (append/skip by id)"}`);
  if (OVERWRITE) {
    const scopeText =
      TRANSACTIONS_ONLY && OVERWRITE_SCOPE === "window"
        ? `WINDOW (${START_DATE}..${END_DATE})`
        : TRANSACTIONS_ONLY
          ? "ALL TRANSACTIONS"
          : "FULL FACTORY";
    console.log(`  Wipe scope:  ${scopeText}`);
  }
  console.log(`  Render URL:  ${RENDER_URL}`);
  console.log(`  Batch size:  ${BATCH_SIZE}`);
  console.log("\nID strategy:");
  console.log(`  CUSTOMER_ID_OFFSET:     ${CUSTOMER_ID_OFFSET}`);
  console.log(`  CUSTOMER_PRICE_ID_START:${CUSTOMER_PRICE_ID_START}`);
  console.log(`  TX_ID_START:            ${TX_ID_START}`);
  console.log(`  ITEM_ID_START:          ${ITEM_ID_START}`);
  console.log(`  BAG_ID_START:           ${BAG_ID_START}`);

  console.log("\nSource scan:");
  console.log(`  TransTable rows scanned:            ${payload.stats.sourceRowsRead}`);
  console.log(`  Rows in date window:                ${payload.stats.sourceRowsInWindow}`);
  console.log(`  Skipped invalid date rows:          ${payload.stats.skippedInvalidDate}`);
  console.log(`  Skipped orphan-customer rows:       ${payload.stats.skippedOrphanCustomer}`);

  console.log("\nPrepared upload rows:");
  console.log(`  product_types:      ${payload.products.length}`);
  console.log(`  customers:          ${payload.customers.length}`);
  console.log(`  customer_prices:    ${payload.customerPrices.length}`);
  console.log(`  transactions:       ${payload.transactions.length}`);
  console.log(`  transaction_items:  ${payload.transactionItems.length}`);
  console.log(`  bag_ledger:         ${payload.bagLedger.length}`);
  console.log(`  Total sales window: ${payload.stats.totalSales.toFixed(2)}`);

  if (payload.transactions.length === 0) {
    console.log("\nWARNING: No transactions found in the selected window.");
  }
}

function migrateHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${MIGRATE_KEY}`,
  };
}

async function checkMigrationAccess(): Promise<void> {
  const url = `${RENDER_URL}/api/migrate?action=check-products&factory=${factory}`;
  const res = await fetch(url, { headers: migrateHeaders() });
  if (res.ok) return;
  const body = await res.text();
  throw new Error(`Migration endpoint check failed (${res.status}): ${body.slice(0, 300)}`);
}

async function initFactorySchema(): Promise<void> {
  const url = `${RENDER_URL}/api/migrate?action=init-factory&factory=${factory}`;
  const res = await fetch(url, { method: "POST", headers: migrateHeaders() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`init-factory failed (${res.status}): ${body.slice(0, 300)}`);
  }
}

async function wipeFactoryData(): Promise<void> {
  const url = `${RENDER_URL}/api/migrate?action=wipe-factory-data&factory=${factory}&confirm=WIPE_FACTORY_DATA`;
  const res = await fetch(url, { method: "POST", headers: migrateHeaders() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`wipe-factory-data failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const wiped = Array.isArray(data.wipedTables) ? data.wipedTables.length : 0;
  console.log(`Wipe completed. Tables wiped: ${wiped}`);
}

async function wipeTransactionsData(): Promise<void> {
  const url = `${RENDER_URL}/api/migrate?action=wipe-transactions-data&factory=${factory}&confirm=WIPE_TRANSACTIONS_DATA`;
  const res = await fetch(url, { method: "POST", headers: migrateHeaders() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`wipe-transactions-data failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const mode = data?.mode || "transactions_only";
  console.log(`Wipe completed. Mode: ${mode}`);
}

async function wipeTransactionsWindow(): Promise<void> {
  const url = `${RENDER_URL}/api/migrate?action=wipe-transactions-window&factory=${factory}&startDate=${START_DATE}&endDate=${END_DATE}&confirm=WIPE_TRANSACTIONS_WINDOW`;
  const res = await fetch(url, { method: "POST", headers: migrateHeaders() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`wipe-transactions-window failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const remaining = Number(data?.remainingTransactionsInWindow ?? -1);
  console.log(
    `Wipe completed. Mode: ${data?.mode || "transactions_window"}, range: ${START_DATE}..${END_DATE}, remaining in window: ${remaining}`
  );
}

async function uploadTable<T extends Record<string, unknown>>(table: string, rows: T[]): Promise<void> {
  if (rows.length === 0) {
    console.log(`\n--- ${table}: 0 rows (skip) ---`);
    return;
  }

  console.log(`\n--- ${table}: ${rows.length} rows ---`);
  let insertedTotal = 0;

  for (const [index, batch] of chunk(rows, BATCH_SIZE).entries()) {
    const url = `${RENDER_URL}/api/migrate?action=upload&factory=${factory}`;
    const res = await fetch(url, {
      method: "POST",
      headers: migrateHeaders(),
      body: JSON.stringify({ table, rows: batch }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${table} batch ${index + 1} failed (${res.status}): ${body.slice(0, 400)}`);
    }

    const data = (await res.json()) as { inserted?: number; error?: string };
    insertedTotal += Number(data.inserted || 0);

    const sent = Math.min((index + 1) * BATCH_SIZE, rows.length);
    const pct = Math.round((sent / rows.length) * 100);
    process.stdout.write(`\r  ${table}: inserted ${insertedTotal}/${rows.length} (${pct}%)`);
  }

  process.stdout.write("\n");
}

async function resetSequences(): Promise<void> {
  const url = `${RENDER_URL}/api/migrate?action=reset-sequences&factory=${factory}`;
  const res = await fetch(url, { method: "POST", headers: migrateHeaders() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`reset-sequences failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  console.log("\nSequence reset summary:");
  if (Array.isArray(data.sequences)) {
    for (const s of data.sequences.slice(0, 6)) console.log(`  ${s}`);
    if (data.sequences.length > 6) console.log(`  ... ${data.sequences.length - 6} more`);
  }
}

async function liveUpload(payload: PreparedPayload): Promise<void> {
  console.log("\nValidating Render migration endpoint...");
  await checkMigrationAccess();

  if (INIT_FACTORY) {
    console.log("Running init-factory before upload...");
    await initFactorySchema();
  }

  if (OVERWRITE) {
    if (TRANSACTIONS_ONLY) {
      if (OVERWRITE_SCOPE === "window") {
        console.log(`Running destructive wipe-transactions-window before upload (${START_DATE}..${END_DATE})...`);
        await wipeTransactionsWindow();
      } else {
        console.log("Running destructive wipe-transactions-data before upload...");
        await wipeTransactionsData();
      }
    } else {
      console.log("Running destructive wipe-factory-data before upload...");
      await wipeFactoryData();
    }
  }

  if (!TRANSACTIONS_ONLY) {
    await uploadTable("product_types", payload.products);
    await uploadTable("customers", payload.customers);
    await uploadTable("customer_prices", payload.customerPrices);
  }
  await uploadTable("transactions", payload.transactions);
  await uploadTable("transaction_items", payload.transactionItems);
  if (!TRANSACTIONS_ONLY) {
    await uploadTable("bag_ledger", payload.bagLedger);
  }
  await resetSequences();
}

async function main(): Promise<void> {
  const payload = await preparePayload();
  printSummary(payload);

  if (DRY_RUN) {
    console.log("\nDRY RUN complete. No remote writes were performed.");
    return;
  }

  await liveUpload(payload);
  console.log("\nMigration upload complete.");
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
