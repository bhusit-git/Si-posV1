"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/thai-utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getInvoiceCreditEligibilityState,
  isActiveInvoiceCreditCustomer,
} from "@/lib/invoice-credit-rollout";
import {
  INVOICE_CREDIT_LABEL,
  SHORT_TERM_CREDIT_LABEL,
} from "@/lib/customer-credit-labels";

interface CustomerRow {
  id: number;
  name: string;
  phone: string | null;
  credit: boolean;
  transferCustomer: boolean;
  bagBalance: number;
}

function normalizeCustomerRows(data: unknown): CustomerRow[] {
  if (!Array.isArray(data)) return [];
  return data.map((row) => {
    const record = row as Partial<CustomerRow>;
    return {
      id: Number(record.id ?? 0),
      name: record.name || "",
      phone: record.phone ?? null,
      credit: !!record.credit,
      transferCustomer: !!record.transferCustomer,
      bagBalance: Number(record.bagBalance ?? 0) || 0,
    };
  });
}

type SortKey = "id" | "name" | "phone" | "credit" | "bagBalance";
type SortDir = "asc" | "desc";

function SortIcon({ active, direction }: { active: boolean; direction: SortDir }) {
  if (!active) {
    return (
      <svg className="inline ml-1 w-3 h-3 text-gray-300" viewBox="0 0 12 12" fill="currentColor">
        <path d="M6 2l3 4H3zM6 10l-3-4h6z" />
      </svg>
    );
  }
  return direction === "asc" ? (
    <svg className="inline ml-1 w-3 h-3 text-blue-600" viewBox="0 0 12 12" fill="currentColor">
      <path d="M6 2l3 4H3z" />
    </svg>
  ) : (
    <svg className="inline ml-1 w-3 h-3 text-blue-600" viewBox="0 0 12 12" fill="currentColor">
      <path d="M6 10l-3-4h6z" />
    </svg>
  );
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [customerTab, setCustomerTab] = useState<"all" | "transfer">("all");

  async function loadCustomers(query = "") {
    setLoading(true);
    const res = await fetch(`/api/customers?search=${encodeURIComponent(query)}`);
    const data = await res.json();
    setCustomers(normalizeCustomerRows(data));
    setLoading(false);
  }

  useEffect(() => {
    let active = true;
    async function initialLoad() {
      try {
        const res = await fetch("/api/customers?search=");
        const data = await res.json();
        if (!active) return;
        setCustomers(normalizeCustomerRows(data));
      } finally {
        if (active) setLoading(false);
      }
    }
    void initialLoad();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadCustomers(search);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sortedCustomers = useMemo(() => {
    const sorted = [...customers];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "id":
          cmp = a.id - b.id;
          break;
        case "name":
          cmp = (a.name || "").localeCompare(b.name || "", "th");
          break;
        case "phone":
          cmp = (a.phone || "").localeCompare(b.phone || "");
          break;
        case "credit":
          cmp = (a.credit ? 1 : 0) - (b.credit ? 1 : 0);
          break;
        case "bagBalance":
          cmp = a.bagBalance - b.bagBalance;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [customers, sortKey, sortDir]);

  const visibleCustomers = useMemo(
    () =>
      customerTab === "transfer"
        ? sortedCustomers.filter((c) => isActiveInvoiceCreditCustomer(c))
        : sortedCustomers,
    [sortedCustomers, customerTab]
  );

  const headerBtn = (key: SortKey, label: string, className = "") => (
    <button
      onClick={() => toggleSort(key)}
      className={`inline-flex items-center text-left hover:text-blue-700 transition-colors font-medium ${className}`}
    >
      {label}
      <SortIcon active={sortKey === key} direction={sortDir} />
    </button>
  );

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4 md:mb-6 flex-wrap gap-2">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 ui-scale-page-title">ลูกค้า</h1>
          <p className="text-xs md:text-sm text-gray-500 ui-scale-page-subtitle">จัดการข้อมูลลูกค้าทั้งหมด</p>
        </div>
        <div className="flex gap-2">
          <Link href="/customers/prices">
            <Button variant="outline" size="sm" className="text-xs md:text-sm">ดูราคาทั้งหมด</Button>
          </Link>
          <Link href="/customers/new">
            <Button size="sm" className="text-xs md:text-sm">เพิ่มลูกค้าใหม่</Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2 md:gap-4 flex-wrap">
            <Input
              placeholder="Customer name or #id"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-[180px] max-w-sm"
            />
            <Tabs
              value={customerTab}
              onValueChange={(value) => setCustomerTab(value as "all" | "transfer")}
              className="shrink-0"
            >
              <TabsList>
                <TabsTrigger value="all" className="text-xs">ทั้งหมด</TabsTrigger>
                <TabsTrigger value="transfer" className="text-xs">ลูกค้า{INVOICE_CREDIT_LABEL}</TabsTrigger>
              </TabsList>
            </Tabs>
            <span className="text-xs md:text-sm text-gray-500 shrink-0 ui-scale-body">
              {customerTab === "transfer" ? `ลูกค้า${INVOICE_CREDIT_LABEL}` : "ทั้งหมด"} {visibleCustomers.length} ราย
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-8 text-gray-500">กำลังโหลด...</p>
          ) : (
            <div className="overflow-x-auto">
            <Table className="ui-scale-dense-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 md:w-16">{headerBtn("id", "รหัส")}</TableHead>
                  <TableHead>{headerBtn("name", "ชื่อ")}</TableHead>
                  <TableHead className="hidden md:table-cell">{headerBtn("phone", "โทรศัพท์")}</TableHead>
                  <TableHead className="text-center">{headerBtn("credit", SHORT_TERM_CREDIT_LABEL, "mx-auto")}</TableHead>
                  <TableHead className="text-center">{INVOICE_CREDIT_LABEL}</TableHead>
                  <TableHead className="text-right hidden md:table-cell">{headerBtn("bagBalance", "ถุงค้าง", "ml-auto")}</TableHead>
                  <TableHead className="w-14 md:w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleCustomers.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.id}</TableCell>
                    <TableCell className="font-medium text-sm">
                      {c.name}
                      <div className="md:hidden text-[11px] mt-0.5">
                        <span className="text-gray-500">ถุงค้าง: </span>
                        <span
                          className={
                            c.bagBalance > 0
                              ? "text-orange-600 font-medium"
                              : c.bagBalance < 0
                                ? "text-green-600 font-medium"
                                : "text-gray-400"
                          }
                        >
                          {formatNumber(c.bagBalance)}
                        </span>
                      </div>
                      <div className="md:hidden mt-1 flex gap-1">
                        {c.credit && (
                          <Badge variant="destructive" className="text-[10px]">{SHORT_TERM_CREDIT_LABEL}</Badge>
                        )}
                        {getInvoiceCreditEligibilityState(c) === "saved" && (
                          <Badge variant="secondary" className="text-[10px]">{INVOICE_CREDIT_LABEL}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-gray-500 hidden md:table-cell">{c.phone || "-"}</TableCell>
                    <TableCell className="text-center">
                      {c.credit ? (
                        <Badge variant="destructive" className="text-[10px] md:text-xs">{SHORT_TERM_CREDIT_LABEL}</Badge>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {getInvoiceCreditEligibilityState(c) === "saved" ? (
                        <Badge variant="secondary" className="text-[10px] md:text-xs">
                          {INVOICE_CREDIT_LABEL}
                        </Badge>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right hidden md:table-cell">
                      {c.bagBalance !== 0 ? (
                        <span className={c.bagBalance > 0 ? "text-orange-600 font-medium" : "text-green-600"}>
                          {formatNumber(c.bagBalance)}
                        </span>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link href={`/customers/${c.id}`}>
                        <Button variant="ghost" size="sm" className="text-xs h-7 px-2">ดู</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
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
