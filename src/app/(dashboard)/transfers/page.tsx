"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatThaiDate, formatNumber, todayISO } from "@/lib/thai-utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  formatCustomerDisplay,
  useShowCustomerIdWithName,
} from "@/lib/customer-display";
import { INVOICE_CREDIT_LABEL } from "@/lib/customer-credit-labels";

type AccountingStatus = "open" | "closed";
type AccountingFilter = AccountingStatus | "all";

interface TransferRow {
  id: number;
  customerId: number;
  customerName: string;
  saleDate: string;
  saleTime: string;
  totalAmount: number;
  paid: number;
  status: string;
  note: string | null;
  itemQty: number;
  bagReturnQty: number;
  transferRef: string | null;
  destination: string | null;
  truck: string | null;
  memo: string | null;
  accountingStatus: AccountingStatus;
  canToggleAccounting: boolean;
}

interface TransferResponse {
  rows: TransferRow[];
  totals: { count: number; totalAmount: number; totalQty: number; totalBagReturnQty: number };
}

interface CustomerGroup {
  customerId: number;
  customerName: string;
  rows: TransferRow[];
  billCount: number;
  openCount: number;
  closedCount: number;
  totalAmount: number;
}

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function dateBefore(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function paymentStatusLabel(status: string): string {
  if (status === "paid") return "ชำระแล้ว";
  if (status === "partial") return "ชำระบางส่วน";
  if (status === "unpaid") return "ค้างชำระ";
  return status;
}

function accountingStatusLabel(status: AccountingStatus): string {
  return status === "closed" ? "ปิดแล้ว" : "เปิดอยู่";
}

const DATE_SHORTCUTS = [
  { key: "today", label: "วันนี้" },
  { key: "yesterday", label: "เมื่อวาน" },
  { key: "thisWeek", label: "สัปดาห์นี้" },
  { key: "lastWeek", label: "สัปดาห์ก่อน" },
  { key: "thisMonth", label: "เดือนนี้" },
  { key: "lastMonth", label: "เดือนก่อน" },
  { key: "last3Months", label: "3 เดือน" },
  { key: "all", label: "ทั้งหมด" },
];

export default function TransfersPage() {
  const showCustomerIdWithName = useShowCustomerIdWithName();
  const initialStartDate = dateBefore(7);
  const initialEndDate = todayISO();
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [customerQuery, setCustomerQuery] = useState("");
  const [accountingFilter, setAccountingFilter] = useState<AccountingFilter>("open");
  const [draftStartDate, setDraftStartDate] = useState(initialStartDate);
  const [draftEndDate, setDraftEndDate] = useState(initialEndDate);
  const [draftCustomerQuery, setDraftCustomerQuery] = useState("");
  const [draftAccountingFilter, setDraftAccountingFilter] = useState<AccountingFilter>("open");
  const [activeQuick, setActiveQuick] = useState("");
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [expandedCustomer, setExpandedCustomer] = useState<number | null>(null);

  const loadTransfers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
        accountingStatus: accountingFilter,
      });
      if (customerQuery.trim()) params.set("customerQuery", customerQuery.trim());

      const res = await fetch(`/api/transfers?${params.toString()}`);
      if (!res.ok) throw new Error("load_failed");

      const data: TransferResponse = await res.json();
      setRows(data.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, customerQuery, accountingFilter]);

  useEffect(() => {
    void loadTransfers();
  }, [loadTransfers]);

  const toggleAccounting = useCallback(
    async (row: TransferRow) => {
      if (!row.canToggleAccounting || updatingId === row.id) return;
      const nextStatus: AccountingStatus = row.accountingStatus === "open" ? "closed" : "open";
      setUpdatingId(row.id);
      try {
        const res = await fetch("/api/transfers", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: row.id, accountingStatus: nextStatus }),
        });
        if (!res.ok) throw new Error("toggle_failed");
        toast.success(nextStatus === "closed" ? "ปิดยอดแล้ว" : "เปิดยอดกลับแล้ว");
        await loadTransfers();
      } catch {
        toast.error("บันทึกสถานะปิดยอดไม่สำเร็จ");
      } finally {
        setUpdatingId(null);
      }
    },
    [loadTransfers, updatingId]
  );

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          count: acc.count + 1,
          totalAmount: acc.totalAmount + Number(row.totalAmount || 0),
          totalQty: acc.totalQty + Number(row.itemQty || 0),
          totalBagReturnQty: acc.totalBagReturnQty + Number(row.bagReturnQty || 0),
        }),
        { count: 0, totalAmount: 0, totalQty: 0, totalBagReturnQty: 0 }
      ),
    [rows]
  );

  const customerGroups = useMemo(() => {
    const byCustomer = new Map<number, CustomerGroup>();

    for (const row of rows) {
      const current = byCustomer.get(row.customerId);
      if (!current) {
        byCustomer.set(row.customerId, {
          customerId: row.customerId,
          customerName: row.customerName,
          rows: [row],
          billCount: 1,
          openCount: row.accountingStatus === "open" ? 1 : 0,
          closedCount: row.accountingStatus === "closed" ? 1 : 0,
          totalAmount: Number(row.totalAmount || 0),
        });
        continue;
      }

      current.rows.push(row);
      current.billCount += 1;
      current.totalAmount += Number(row.totalAmount || 0);
      if (row.accountingStatus === "open") current.openCount += 1;
      else current.closedCount += 1;
    }

    return Array.from(byCustomer.values());
  }, [rows]);

  useEffect(() => {
    if (expandedCustomer === null) return;
    if (!customerGroups.some((group) => group.customerId === expandedCustomer)) {
      setExpandedCustomer(null);
    }
  }, [customerGroups, expandedCustomer]);

  function toggleExpand(customerId: number) {
    setExpandedCustomer((prev) => (prev === customerId ? null : customerId));
  }

  function applyFilters() {
    setStartDate(draftStartDate);
    setEndDate(draftEndDate);
    setCustomerQuery(draftCustomerQuery);
    setAccountingFilter(draftAccountingFilter);
  }

  function resetFilters() {
    setDraftStartDate(initialStartDate);
    setDraftEndDate(initialEndDate);
    setDraftCustomerQuery("");
    setDraftAccountingFilter("open");
    setActiveQuick("");
    setStartDate(initialStartDate);
    setEndDate(initialEndDate);
    setCustomerQuery("");
    setAccountingFilter("open");
  }

  function applyQuickRange(key: string) {
    const now = new Date();
    let s: Date;
    let e: Date;
    switch (key) {
      case "today":
        s = now;
        e = now;
        break;
      case "yesterday": {
        const y = new Date(now);
        y.setDate(y.getDate() - 1);
        s = y;
        e = y;
        break;
      }
      case "thisWeek":
        s = getMonday(now);
        e = now;
        break;
      case "lastWeek": {
        const lm = getMonday(now);
        lm.setDate(lm.getDate() - 7);
        const ls = new Date(lm);
        ls.setDate(ls.getDate() + 6);
        s = lm;
        e = ls;
        break;
      }
      case "thisMonth":
        s = new Date(now.getFullYear(), now.getMonth(), 1);
        e = now;
        break;
      case "lastMonth":
        s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        e = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
      case "last3Months":
        s = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        e = now;
        break;
      case "all":
        s = new Date(2000, 0, 1);
        e = now;
        break;
      default:
        return;
    }

    setDraftStartDate(toISO(s));
    setDraftEndDate(toISO(e));
    setActiveQuick(key);
  }

  return (
    <div className="w-full max-w-none">
      <div className="flex items-center justify-between mb-4 md:mb-6 flex-wrap gap-2">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">ปิดยอดบัญชี{INVOICE_CREDIT_LABEL}</h1>
          <p className="text-xs md:text-sm text-gray-500">มุมมองแบบกลุ่มลูกค้า พร้อมปุ่มปิดยอดรายบิล{INVOICE_CREDIT_LABEL}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={draftAccountingFilter === "open" ? "default" : "outline"}
            onClick={() => setDraftAccountingFilter("open")}
          >
            เปิดอยู่
          </Button>
          <Button
            size="sm"
            variant={draftAccountingFilter === "closed" ? "default" : "outline"}
            onClick={() => setDraftAccountingFilter("closed")}
          >
            ปิดแล้ว
          </Button>
          <Button
            size="sm"
            variant={draftAccountingFilter === "all" ? "default" : "outline"}
            onClick={() => setDraftAccountingFilter("all")}
          >
            ทั้งหมด
          </Button>
        </div>
      </div>

      <Card className="mb-4">
        <CardContent className="pt-4">
          <div className="grid grid-cols-4 md:grid-cols-8 gap-1.5 mb-3">
            {DATE_SHORTCUTS.map((btn) => (
              <button
                key={btn.key}
                onClick={() => applyQuickRange(btn.key)}
                className={`px-2 py-1.5 text-xs font-medium rounded-lg border transition-colors text-center ${
                  activeQuick === btn.key
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-600 border-gray-200 hover:border-blue-400 hover:text-blue-600"
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
            <div>
              <div className="text-xs text-gray-500 mb-1">จากวันที่</div>
              <Input
                type="date"
                value={draftStartDate}
                onChange={(e) => {
                  setDraftStartDate(e.target.value);
                  setActiveQuick("");
                }}
              />
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">ถึงวันที่</div>
              <Input
                type="date"
                value={draftEndDate}
                onChange={(e) => {
                  setDraftEndDate(e.target.value);
                  setActiveQuick("");
                }}
              />
            </div>
            <div className="md:col-span-2">
              <div className="text-xs text-gray-500 mb-1">ค้นหาลูกค้า</div>
              <Input
                value={draftCustomerQuery}
                onChange={(e) => setDraftCustomerQuery(e.target.value)}
                placeholder="ชื่อหรือรหัส..."
                className="h-9"
              />
            </div>
            <div className="flex items-end">
              <Button onClick={applyFilters} className="w-full">
                Apply
              </Button>
            </div>
            <div className="flex items-end">
              <Button variant="outline" onClick={resetFilters} className="w-full">
                Reset
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-gray-500">จำนวนบิล</p>
            <p className="text-xl font-bold">{formatNumber(totals.count)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-gray-500">จำนวนสินค้า</p>
            <p className="text-xl font-bold">{formatNumber(totals.totalQty)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-gray-500">มูลค่ารวม</p>
            <p className="text-xl font-bold">{formatCurrency(totals.totalAmount)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-gray-500">คืนถุงรวม</p>
            <p className="text-xl font-bold">{formatNumber(totals.totalBagReturnQty)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">สรุปตามลูกค้า</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-8 text-gray-500">กำลังโหลด...</p>
          ) : customerGroups.length === 0 ? (
            <p className="text-center py-8 text-gray-500">ไม่พบบิลในช่วงที่เลือก</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>ลูกค้า</TableHead>
                    <TableHead className="text-right">บิล</TableHead>
                    <TableHead className="text-right">เปิดอยู่</TableHead>
                    <TableHead className="text-right">ปิดแล้ว</TableHead>
                    <TableHead className="text-right">ยอดรวม</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customerGroups.map((group) => (
                    <Fragment key={group.customerId}>
                      <TableRow
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => toggleExpand(group.customerId)}
                      >
                        <TableCell className="text-center text-gray-400">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={`transition-transform ${expandedCustomer === group.customerId ? "rotate-90" : ""}`}
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </TableCell>
                        <TableCell className="font-medium">
                          {formatCustomerDisplay(
                            group.customerId,
                            group.customerName,
                            showCustomerIdWithName
                          )}
                        </TableCell>
                        <TableCell className="text-right">{formatNumber(group.billCount)}</TableCell>
                        <TableCell className="text-right">{formatNumber(group.openCount)}</TableCell>
                        <TableCell className="text-right">{formatNumber(group.closedCount)}</TableCell>
                        <TableCell className="text-right font-semibold">{formatCurrency(group.totalAmount)}</TableCell>
                      </TableRow>

                      {expandedCustomer === group.customerId && (
                        <TableRow>
                          <TableCell colSpan={6} className="p-0 bg-gray-50">
                            <div className="px-4 py-2 overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-xs text-gray-500 border-b border-gray-200">
                                    <th className="text-left py-1.5 font-medium">บิล</th>
                                    <th className="text-left py-1.5 font-medium">วันที่</th>
                                    <th className="text-left py-1.5 font-medium">เวลา</th>
                                    <th className="text-right py-1.5 font-medium">จำนวน</th>
                                    <th className="text-right py-1.5 font-medium">คืนถุง</th>
                                    <th className="text-right py-1.5 font-medium">มูลค่า</th>
                                    <th className="text-center py-1.5 font-medium">สถานะบัญชี</th>
                                    <th className="text-center py-1.5 font-medium">สถานะชำระ</th>
                                    <th className="text-right py-1.5 font-medium">จัดการ</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {group.rows.map((row) => (
                                    <tr key={row.id} className="border-b border-gray-100">
                                      <td className="py-1.5 font-mono text-xs text-gray-500">#{row.id}</td>
                                      <td className="py-1.5 whitespace-nowrap">{formatThaiDate(row.saleDate)}</td>
                                      <td className="py-1.5">{row.saleTime?.slice(0, 5)}</td>
                                      <td className="py-1.5 text-right">{formatNumber(row.itemQty)}</td>
                                      <td className="py-1.5 text-right">{formatNumber(row.bagReturnQty || 0)}</td>
                                      <td className="py-1.5 text-right">{formatCurrency(row.totalAmount)}</td>
                                      <td className="py-1.5 text-center">
                                        <Badge variant={row.accountingStatus === "closed" ? "secondary" : "outline"}>
                                          {accountingStatusLabel(row.accountingStatus)}
                                        </Badge>
                                      </td>
                                      <td className="py-1.5 text-center">
                                        <Badge variant={row.status === "paid" ? "secondary" : "destructive"}>
                                          {paymentStatusLabel(row.status)}
                                        </Badge>
                                      </td>
                                      <td className="py-1.5 text-right">
                                        {row.canToggleAccounting ? (
                                          <Button
                                            size="sm"
                                            variant={row.accountingStatus === "open" ? "default" : "outline"}
                                            onClick={() => void toggleAccounting(row)}
                                            disabled={updatingId === row.id}
                                          >
                                            {updatingId === row.id
                                              ? "กำลังบันทึก..."
                                              : row.accountingStatus === "open"
                                                ? "ปิดยอด"
                                                : "เปิดใหม่"}
                                          </Button>
                                        ) : (
                                          <Badge variant="outline">แก้ไขไม่ได้</Badge>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
