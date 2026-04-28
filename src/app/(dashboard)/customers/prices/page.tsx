"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { matchesCustomerQuery } from "@/lib/filter-utils";

interface Product {
  id: number;
  name: string;
}

interface MatrixRow {
  customerId: number;
  customerName: string;
  prices: Record<number, number>;
}

interface Change {
  customerId: number;
  productTypeId: number;
  unitPrice: number;
}

export default function PriceMatrixPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [matrix, setMatrix] = useState<MatrixRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changes, setChanges] = useState<Map<string, Change>>(new Map());
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sortCol, setSortCol] = useState<number | "name">( "name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadMatrix();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  async function loadMatrix() {
    setLoading(true);
    const res = await fetch("/api/customers/prices");
    const data = await res.json();
    setProducts(data.products);
    setMatrix(data.matrix);
    setLoading(false);
  }

  function handlePriceChange(customerId: number, productTypeId: number, value: string) {
    const price = parseFloat(value) || 0;
    const key = `${customerId}-${productTypeId}`;

    // Update matrix display
    setMatrix((prev) =>
      prev.map((row) => {
        if (row.customerId === customerId) {
          return {
            ...row,
            prices: { ...row.prices, [productTypeId]: price },
          };
        }
        return row;
      })
    );

    // Track change
    setChanges((prev) => {
      const next = new Map(prev);
      next.set(key, { customerId, productTypeId, unitPrice: price });
      return next;
    });
  }

  function isChanged(customerId: number, productTypeId: number) {
    return changes.has(`${customerId}-${productTypeId}`);
  }

  async function handleSave() {
    if (changes.size === 0) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/customers/prices", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes: Array.from(changes.values()) }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessage(`บันทึกสำเร็จ (${data.updated} รายการ)`);
        setChanges(new Map());
      }
    } finally {
      setSaving(false);
    }
  }

  function toggleSort(col: number | "name") {
    if (sortCol === col) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  const filteredMatrix = useMemo(() => {
    let rows = matrix;
    if (search) {
      rows = rows.filter((r) => matchesCustomerQuery(r.customerId, r.customerName, search));
    }

    const sorted = [...rows];
    sorted.sort((a, b) => {
      let cmp = 0;
      if (sortCol === "name") {
        cmp = a.customerName.localeCompare(b.customerName, "th");
      } else {
        cmp = (a.prices[sortCol] || 0) - (b.prices[sortCol] || 0);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [matrix, search, sortCol, sortDir]);

  return (
    <div className="max-w-full mx-auto px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ตารางราคาลูกค้า</h1>
          <p className="text-sm text-gray-500">
            ดูและแก้ไขราคาทั้งหมดในตารางเดียว ({matrix.length} ลูกค้า x {products.length} สินค้า)
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {message && <Badge variant="secondary" className="mr-2">{message}</Badge>}
          {changes.size > 0 && (
            <Badge variant="destructive">{changes.size} การเปลี่ยนแปลง</Badge>
          )}
          <Button onClick={handleSave} disabled={saving || changes.size === 0}>
            {saving ? "กำลังบันทึก..." : "บันทึกทั้งหมด"}
          </Button>
          <Link href="/customers">
            <Button variant="outline">กลับ</Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-4">
            <Input
              placeholder="Customer name or #id"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="max-w-xs"
            />
            <span className="text-sm text-gray-500">
              แสดง {filteredMatrix.length} / {matrix.length} ราย
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="text-center py-8 text-gray-500">กำลังโหลด...</p>
          ) : (
            <div className="overflow-auto max-h-[calc(100vh-260px)]">
              <table className="w-full text-sm border-collapse">
                <thead className="sticky top-0 z-10 bg-gray-50">
                  <tr>
                    <th
                      className="sticky left-0 z-20 bg-gray-50 text-left px-3 py-2 border-b border-r font-medium cursor-pointer hover:bg-gray-100 min-w-[200px]"
                      onClick={() => toggleSort("name")}
                    >
                      ลูกค้า
                      {sortCol === "name" && (
                        <span className="ml-1 text-blue-600">{sortDir === "asc" ? "▲" : "▼"}</span>
                      )}
                    </th>
                    {products.map((p) => (
                      <th
                        key={p.id}
                        className="text-right px-2 py-2 border-b font-medium cursor-pointer hover:bg-gray-100 min-w-[90px] whitespace-nowrap"
                        onClick={() => toggleSort(p.id)}
                      >
                        {p.name}
                        {sortCol === p.id && (
                          <span className="ml-1 text-blue-600">{sortDir === "asc" ? "▲" : "▼"}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredMatrix.map((row) => (
                    <tr key={row.customerId} className="hover:bg-blue-50/30">
                      <td className="sticky left-0 z-10 bg-white border-r px-3 py-1 font-medium text-sm whitespace-nowrap">
                        <Link href={`/customers/${row.customerId}`} className="hover:text-blue-600 hover:underline">
                          {row.customerName}
                        </Link>
                      </td>
                      {products.map((p) => {
                        const price = row.prices[p.id] || 0;
                        const changed = isChanged(row.customerId, p.id);
                        return (
                          <td key={p.id} className="px-1 py-0.5 border-b">
                            <input
                              type="number"
                              className={`w-full text-right text-sm px-1 py-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                                changed
                                  ? "bg-yellow-50 border-yellow-400"
                                  : price === 0
                                  ? "bg-red-50 border-red-200 text-red-400"
                                  : "border-transparent hover:border-gray-300"
                              }`}
                              value={price || ""}
                              onChange={(e) =>
                                handlePriceChange(row.customerId, p.id, e.target.value)
                              }
                              onFocus={(e) => e.target.select()}
                              min={0}
                              step="0.01"
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
