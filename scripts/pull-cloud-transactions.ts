import postgres from "postgres";

type CloudProduct = {
  id: number;
  name: string;
  nameEn?: string | null;
  hasBag?: boolean;
  decreasesBag?: boolean;
  isActive?: boolean;
  sortOrder?: number;
};

type CloudCustomer = {
  id: number;
  name: string;
  phone?: string | null;
  credit?: boolean;
  createdAt?: string | null;
};

type CloudItem = {
  id: number;
  transactionId: number;
  productTypeId: number;
  quantity: number;
  unitPrice: number;
  subtotal: number;
};

type CloudTx = {
  id: number;
  customerId: number;
  totalAmount: number;
  paid: number;
  status: "paid" | "unpaid" | "partial" | "voided";
  transactionKind?: "sale" | "return" | "transfer_out" | "adjustment" | null;
  pool?: number | null;
  row?: number | null;
  col?: number | null;
  saleDate: string;
  saleTime: string;
  note?: string | null;
  fulfillment?: "pending" | "loaded" | null;
  clientId?: string | null;
  createdAt?: string | null;
  customer?: { id: number; name: string };
  items?: CloudItem[];
};

const CLOUD_URL = (process.env.CLOUD_URL || "https://superice-pos.onrender.com").replace(/\/$/, "");
const CLOUD_USER = process.env.CLOUD_USER || "Admin";
const CLOUD_PASS = process.env.CLOUD_PASS || "lion";
const FACTORY = process.env.FACTORY || "si";
const START_DATE = process.env.START_DATE || "2026-02-26";
const END_DATE = process.env.END_DATE || new Date().toISOString().slice(0, 10);

const DB_URL_MAP: Record<string, string | undefined> = {
  si: process.env.DATABASE_URL_SI,
  bearing: process.env.DATABASE_URL_BEARING,
  ktk: process.env.DATABASE_URL_KTK,
};

type BillKind = "sale" | "return" | "transfer_out" | "adjustment";

function inferBillKind(tx: CloudTx): BillKind {
  if (
    tx.transactionKind === "sale" ||
    tx.transactionKind === "return" ||
    tx.transactionKind === "transfer_out" ||
    tx.transactionKind === "adjustment"
  ) {
    return tx.transactionKind;
  }
  const note = (tx.note || "").trim();
  if (note.startsWith("XFER|")) return "transfer_out";
  if (Number(tx.totalAmount || 0) < 0) return "return";
  return "sale";
}

function parseTransferNote(note: string | null | undefined): {
  ref: string | null;
  destination: string | null;
  truck: string | null;
  accountingStatus: "open" | "closed" | null;
} {
  const text = (note || "").trim();
  if (!text.startsWith("XFER|")) {
    return {
      ref: null,
      destination: null,
      truck: null,
      accountingStatus: null,
    };
  }

  const parts = text.split("|").slice(1);
  const map = new Map<string, string>();
  for (const part of parts) {
    const [k, ...rest] = part.split("=");
    if (!k) continue;
    map.set(k.trim().toLowerCase(), rest.join("=").trim());
  }

  const statusRaw = (map.get("status") || "").toLowerCase();
  const accountingStatus =
    statusRaw === "open" || statusRaw === "closed" ? (statusRaw as "open" | "closed") : "closed";

  return {
    ref: map.get("ref") || null,
    destination: map.get("to") || null,
    truck: map.get("truck") || null,
    accountingStatus,
  };
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

function splitDateWindows(
  startDate: string,
  endDate: string,
  maxDaysPerWindow = 31
): Array<{ startDate: string; endDate: string }> {
  const windows: Array<{ startDate: string; endDate: string }> = [];
  let cursor = startDate;

  while (cursor <= endDate) {
    const windowEnd = addDays(cursor, maxDaysPerWindow - 1);
    const boundedEnd = windowEnd < endDate ? windowEnd : endDate;
    windows.push({ startDate: cursor, endDate: boundedEnd });
    cursor = addDays(boundedEnd, 1);
  }

  return windows;
}

async function login(): Promise<string> {
  const res = await fetch(`${CLOUD_URL}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: CLOUD_USER, password: CLOUD_PASS }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cloud login failed: ${res.status} ${body}`);
  }

  const setCookie = res.headers.get("set-cookie") || "";
  const m = setCookie.match(/(superice_session=[^;]+)/);
  if (!m) throw new Error("Cloud login succeeded but session cookie not found");
  return m[1];
}

async function fetchJson<T>(path: string, cookie: string): Promise<T> {
  const res = await fetch(`${CLOUD_URL}${path}`, {
    headers: { Cookie: cookie },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${path} failed: ${res.status} ${body}`);
  }
  return (await res.json()) as T;
}

async function fetchJsonWithRetry<T>(
  path: string,
  cookie: string,
  retries = 3
): Promise<T> {
  let attempt = 0;
  let lastError: unknown = null;
  while (attempt < retries) {
    try {
      return await fetchJson<T>(path, cookie);
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (attempt >= retries) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchTransactionsByWindows(
  cookie: string,
  status?: "voided"
): Promise<CloudTx[]> {
  const windows = splitDateWindows(START_DATE, END_DATE, 31);
  const txById = new Map<number, CloudTx>();

  for (const w of windows) {
    const path =
      `/api/transactions?startDate=${w.startDate}&endDate=${w.endDate}&limit=999999` +
      (status ? `&status=${status}` : "");
    const rows = await fetchJsonWithRetry<CloudTx[]>(path, cookie, 3);
    for (const tx of rows) txById.set(tx.id, tx);
    console.log(
      `- pulled ${rows.length} tx (${status || "active"}) for ${w.startDate} -> ${w.endDate}`
    );
  }

  return Array.from(txById.values());
}

async function main() {
  const dbUrl = DB_URL_MAP[FACTORY];
  if (!dbUrl) {
    throw new Error(`Missing local DB URL for factory '${FACTORY}'`);
  }

  console.log(`Cloud: ${CLOUD_URL}`);
  console.log(`Factory: ${FACTORY}`);
  console.log(`Window: ${START_DATE} -> ${END_DATE}`);

  const sessionCookie = await login();
  const cookie = `${sessionCookie}; superice_factory=${FACTORY}`;

  const [products, customers] = await Promise.all([
    fetchJson<CloudProduct[]>(`/api/products`, cookie),
    fetchJson<CloudCustomer[]>(`/api/customers?search=`, cookie),
  ]);
  const txMain = await fetchTransactionsByWindows(cookie);
  const txVoided = await fetchTransactionsByWindows(cookie, "voided");

  const txById = new Map<number, CloudTx>();
  for (const tx of [...txMain, ...txVoided]) txById.set(tx.id, tx);
  const txs = Array.from(txById.values());

  const customerById = new Map<number, CloudCustomer>();
  for (const c of customers) customerById.set(c.id, c);
  for (const tx of txs) {
    if (!customerById.has(tx.customerId)) {
      customerById.set(tx.customerId, {
        id: tx.customerId,
        name: tx.customer?.name || `Customer ${tx.customerId}`,
        phone: null,
        credit: false,
        createdAt: null,
      });
    }
  }
  const allCustomers = Array.from(customerById.values());

  const txIds = txs.map((t) => t.id);
  const allItems = txs.flatMap((t) => t.items || []);

  const sql = postgres(dbUrl, { max: 1, connect_timeout: 15 });
  const [beforeCount] = await sql`
    SELECT COUNT(*)::int AS c
    FROM transactions
    WHERE sale_date >= ${START_DATE}::date AND sale_date <= ${END_DATE}::date
  `;

  await sql.begin(async (db) => {
    for (const batch of chunks(products, 300)) {
      for (const p of batch) {
        await db`
          INSERT INTO product_types (id, name, name_en, has_bag, decreases_bag, is_active, sort_order)
          VALUES (
            ${p.id},
            ${p.name},
            ${p.nameEn ?? null},
            ${p.hasBag ?? false},
            ${p.decreasesBag ?? false},
            ${p.isActive ?? true},
            ${p.sortOrder ?? 0}
          )
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            name_en = EXCLUDED.name_en,
            has_bag = EXCLUDED.has_bag,
            decreases_bag = EXCLUDED.decreases_bag,
            is_active = EXCLUDED.is_active,
            sort_order = EXCLUDED.sort_order
        `;
      }
    }

    for (const batch of chunks(allCustomers, 300)) {
      for (const c of batch) {
        await db`
          INSERT INTO customers (
            id, name, phone, credit,
            source_system, source_factory, source_file, source_row_key,
            created_at
          )
          VALUES (
            ${c.id},
            ${c.name},
            ${c.phone ?? null},
            ${c.credit ?? false},
            ${"api_import"}::source_system,
            ${FACTORY},
            ${CLOUD_URL},
            ${`cloud_customer:${c.id}`},
            ${c.createdAt ?? new Date().toISOString()}
          )
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            phone = EXCLUDED.phone,
            credit = EXCLUDED.credit,
            source_system = EXCLUDED.source_system,
            source_factory = EXCLUDED.source_factory,
            source_file = EXCLUDED.source_file,
            source_row_key = EXCLUDED.source_row_key
        `;
      }
    }

    for (const batch of chunks(txs, 250)) {
      for (const t of batch) {
        const amount = Number(t.totalAmount ?? 0);
        const paid = Number(t.paid ?? 0);
        const outstanding = Math.max(0, amount - paid);
        const kind = inferBillKind(t);
        const transfer = parseTransferNote(t.note);
        await db`
          INSERT INTO transactions (
            id, customer_id, total_amount, paid, status, pool, "row", col,
            sale_date, sale_time, note, fulfillment, client_id,
            outstanding_amount, transaction_kind,
            transfer_ref, transfer_destination, transfer_truck, transfer_accounting_status,
            source_system, source_factory, source_file, source_row_key,
            created_at
          )
          VALUES (
            ${t.id},
            ${t.customerId},
            ${amount},
            ${paid},
            ${t.status ?? "paid"},
            ${t.pool ?? null},
            ${t.row ?? null},
            ${t.col ?? null},
            ${t.saleDate},
            ${t.saleTime},
            ${t.note ?? null},
            ${t.fulfillment ?? null},
            ${t.clientId ?? null},
            ${outstanding},
            ${kind}::transaction_kind,
            ${kind === "transfer_out" ? transfer.ref : null},
            ${kind === "transfer_out" ? transfer.destination : null},
            ${kind === "transfer_out" ? transfer.truck : null},
            ${kind === "transfer_out" ? transfer.accountingStatus : null}::transfer_accounting_status,
            ${"api_import"}::source_system,
            ${FACTORY},
            ${CLOUD_URL},
            ${`cloud_tx:${t.id}`},
            ${t.createdAt ?? new Date().toISOString()}
          )
          ON CONFLICT (id) DO UPDATE SET
            customer_id = EXCLUDED.customer_id,
            total_amount = EXCLUDED.total_amount,
            paid = EXCLUDED.paid,
            status = EXCLUDED.status,
            pool = EXCLUDED.pool,
            "row" = EXCLUDED."row",
            col = EXCLUDED.col,
            sale_date = EXCLUDED.sale_date,
            sale_time = EXCLUDED.sale_time,
            note = EXCLUDED.note,
            fulfillment = EXCLUDED.fulfillment,
            client_id = EXCLUDED.client_id,
            outstanding_amount = EXCLUDED.outstanding_amount,
            transaction_kind = EXCLUDED.transaction_kind,
            transfer_ref = EXCLUDED.transfer_ref,
            transfer_destination = EXCLUDED.transfer_destination,
            transfer_truck = EXCLUDED.transfer_truck,
            transfer_accounting_status = EXCLUDED.transfer_accounting_status,
            source_system = EXCLUDED.source_system,
            source_factory = EXCLUDED.source_factory,
            source_file = EXCLUDED.source_file,
            source_row_key = EXCLUDED.source_row_key
        `;
      }
    }

    if (txIds.length > 0) {
      await db`DELETE FROM transaction_items WHERE transaction_id = ANY(${txIds})`;
    }

    for (const batch of chunks(allItems, 500)) {
      for (const it of batch) {
        await db`
          INSERT INTO transaction_items (
            id, transaction_id, product_type_id, quantity, unit_price, subtotal
          )
          VALUES (
            ${it.id},
            ${it.transactionId},
            ${it.productTypeId},
            ${it.quantity ?? 0},
            ${it.unitPrice ?? 0},
            ${it.subtotal ?? 0}
          )
          ON CONFLICT (id) DO UPDATE SET
            transaction_id = EXCLUDED.transaction_id,
            product_type_id = EXCLUDED.product_type_id,
            quantity = EXCLUDED.quantity,
            unit_price = EXCLUDED.unit_price,
            subtotal = EXCLUDED.subtotal
        `;
      }
    }
  });

  const [afterCount] = await sql`
    SELECT COUNT(*)::int AS c
    FROM transactions
    WHERE sale_date >= ${START_DATE}::date AND sale_date <= ${END_DATE}::date
  `;
  await sql.end();

  console.log("Sync complete:");
  console.log(`- products synced: ${products.length}`);
  console.log(`- customers synced: ${allCustomers.length}`);
  console.log(`- transactions pulled: ${txs.length}`);
  console.log(`- items pulled: ${allItems.length}`);
  console.log(`- local transactions in range: ${beforeCount.c} -> ${afterCount.c}`);
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
