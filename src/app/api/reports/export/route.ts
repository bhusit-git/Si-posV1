import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { transactions, customers } from "@/db/schema";
import { eq, and, gte, lte, sql, desc, ne } from "drizzle-orm";
import { requireOfficeUp } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";
import { asDiagnosticError } from "@/lib/diagnostic-error";
import * as XLSX from "xlsx";

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  const auth = await requireOfficeUp();
  if (auth.error) return auth.error;

  const type = request.nextUrl.searchParams.get("type") || "daily";
  const date = request.nextUrl.searchParams.get("date");
  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  const customerId = request.nextUrl.searchParams.get("customerId");

  try {
    const db = await getDb();
    const wb = XLSX.utils.book_new();

    if (type === "daily" && date) {
      // Daily sales report
      const txs = await db
        .select({
          id: transactions.id,
          customerName: customers.name,
          totalAmount: transactions.totalAmount,
          paid: transactions.paid,
          status: transactions.status,
          saleTime: transactions.saleTime,
        })
        .from(transactions)
        .innerJoin(customers, eq(transactions.customerId, customers.id))
        .where(
          and(
            eq(transactions.saleDate, date),
            ne(transactions.status, "voided"),
            ne(transactions.transactionKind, "transfer_out")
          )
        )
        .orderBy(transactions.saleTime);

      const rows = txs.map((tx) => ({
        "เลขที่": tx.id,
        "ลูกค้า": tx.customerName,
        "ยอดรวม": tx.totalAmount,
        "ชำระแล้ว": tx.paid,
        "ค้างชำระ": tx.totalAmount - tx.paid,
        "สถานะ": tx.status === "paid" ? "ชำระแล้ว" : tx.status === "partial" ? "ชำระบางส่วน" : "ค้างชำระ",
        "เวลา": tx.saleTime,
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, `ยอดขาย ${date}`);
    } else if (type === "credit" && from && to) {
      // Credit report
      const creditTxs = await db
        .select({
          id: transactions.id,
          customerName: customers.name,
          totalAmount: transactions.totalAmount,
          paid: transactions.paid,
          status: transactions.status,
          saleDate: transactions.saleDate,
        })
        .from(transactions)
        .innerJoin(customers, eq(transactions.customerId, customers.id))
        .where(
          and(
            gte(transactions.saleDate, from),
            lte(transactions.saleDate, to),
            sql`${transactions.status} IN ('unpaid', 'partial')`,
            ne(transactions.status, "voided"),
            ne(transactions.transactionKind, "transfer_out")
          )
        )
        .orderBy(desc(transactions.saleDate));

      const rows = creditTxs.map((tx) => ({
        "เลขที่": tx.id,
        "ลูกค้า": tx.customerName,
        "วันที่": tx.saleDate,
        "ยอดรวม": tx.totalAmount,
        "ชำระแล้ว": tx.paid,
        "ค้างชำระ": tx.totalAmount - tx.paid,
        "สถานะ": tx.status === "partial" ? "ชำระบางส่วน" : "ค้างชำระ",
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, `สรุปค้างชำระ`);
    } else if (type === "customer" && customerId && from && to) {
      // Customer invoice
      const custTxs = await db
        .select({
          id: transactions.id,
          totalAmount: transactions.totalAmount,
          paid: transactions.paid,
          status: transactions.status,
          saleDate: transactions.saleDate,
          saleTime: transactions.saleTime,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.customerId, parseInt(customerId)),
            gte(transactions.saleDate, from),
            lte(transactions.saleDate, to),
            ne(transactions.status, "voided"),
            ne(transactions.transactionKind, "transfer_out")
          )
        )
        .orderBy(transactions.saleDate, transactions.saleTime);

      const rows = custTxs.map((tx) => ({
        "เลขที่": tx.id,
        "วันที่": tx.saleDate,
        "เวลา": tx.saleTime,
        "ยอดรวม": tx.totalAmount,
        "ชำระแล้ว": tx.paid,
        "ค้างชำระ": tx.totalAmount - tx.paid,
        "สถานะ": tx.status === "paid" ? "ชำระแล้ว" : tx.status === "partial" ? "ชำระบางส่วน" : "ค้างชำระ",
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, `ใบวางบิล`);
    } else {
      return NextResponse.json({ error: "ข้อมูลไม่ครบถ้วน" }, { status: 400 });
    }

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const fileName = `superice-${type}-${date || from || "report"}.xlsx`;

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    throw asDiagnosticError(error, {
      code: "FILE-EXPORT-1001",
      category: "file.export",
      source: "reports.export",
      operation: `build-${type}-xlsx`,
      title: "Report export failed",
      hint: "การสร้างไฟล์รายงานล้มเหลว ให้ตรวจสอบ query และข้อมูลต้นทาง",
      retryable: false,
      safeContext: {
        type,
        date,
        from,
        to,
        customerId,
      },
    });
  }
}, {
  source: "reports.export",
  operation: "GET /api/reports/export",
  context: (request) => ({
    type: request.nextUrl.searchParams.get("type") || "daily",
  }),
});
