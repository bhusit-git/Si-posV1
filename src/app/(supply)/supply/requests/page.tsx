"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { SupplyPageHeader } from "@/components/supply/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildApiErrorDescription,
  parseApiErrorResponse,
} from "@/lib/api-error-diagnostics";
import { formatSupplyRequestRef } from "@/lib/supply/request-ref";

interface SupplyRequestRow {
  id: number;
  requestRef?: string | null;
  factoryKey: string;
  requestType: "internal_factory" | "cross_factory";
  targetFactoryKey: string | null;
  requesterName: string | null;
  status: string;
  note: string | null;
  createdAt: string;
  items: Array<{ id: number; quantityRequested: number; quantityApproved: number | null }>;
}

const statuses = ["draft", "pending", "approved", "rejected", "fulfilled", "cancelled"] as const;

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function getRequestHref(row: SupplyRequestRow) {
  return `/supply/requests/${row.id}?factoryKey=${encodeURIComponent(row.factoryKey)}`;
}

function getDraftEditHref(row: SupplyRequestRow) {
  return `/supply/requests/new?draftId=${row.id}&factoryKey=${encodeURIComponent(row.factoryKey)}`;
}

async function readErrorMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  const payload = parseApiErrorResponse(body);
  const requestId = payload?.requestId || response.headers.get("x-request-id") || null;
  const enrichedPayload = payload || (requestId ? { error: fallback, requestId } : null);
  return buildApiErrorDescription(enrichedPayload, `${fallback} (HTTP ${response.status})`);
}

export default function SupplyRequestsPage() {
  const [rows, setRows] = useState<SupplyRequestRow[]>([]);
  const [status, setStatus] = useState<(typeof statuses)[number]>("pending");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<number | null>(null);

  const load = useCallback(async (nextStatus: (typeof statuses)[number]) => {
    const response = await fetch(`/api/supply/requests?status=${nextStatus}`);
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, "โหลดใบเบิกไม่สำเร็จ"));
    }
    const data = await response.json();
    setRows(asArray<SupplyRequestRow>(data));
    setLoadError(null);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(status).catch((error) => {
        const message = error instanceof Error ? error.message : "โหลดใบเบิกไม่สำเร็จ";
        setLoadError(message);
        console.error("[supply.requests.load.failed]", { status, message });
        toast.error("โหลดใบเบิกไม่สำเร็จ", { description: message });
      });
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [load, status]);

  async function runDraftAction(row: SupplyRequestRow, action: "submit" | "cancel") {
    const requestHref = `/api/supply/requests/${row.id}?factoryKey=${encodeURIComponent(row.factoryKey)}`;
    setActionId(row.id);
    try {
      const response = await fetch(requestHref, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, `ทำรายการ ${action} ไม่สำเร็จ`));
      }

      toast.success(action === "submit" ? "ส่ง draft เข้าอนุมัติแล้ว" : "ยกเลิก draft แล้ว");
      await load(status);
    } catch (error) {
      const message = error instanceof Error ? error.message : "ทำรายการไม่สำเร็จ";
      toast.error(action === "submit" ? "ส่ง draft ไม่สำเร็จ" : "ยกเลิก draft ไม่สำเร็จ", {
        description: message,
      });
    } finally {
      setActionId(null);
    }
  }

  return (
    <div>
      <SupplyPageHeader
        title="ใบเบิก"
        description="สร้างและติดตามเอกสารเบิกของใช้ ทั้งกรณีในโรงงานเดียวกันและเบิกข้ามโรงงาน"
        actions={
          <Button asChild className="rounded-full">
            <Link href="/supply/requests/new">สร้างใบเบิกใหม่</Link>
          </Button>
        }
      />

      <Tabs
        value={status}
        onValueChange={(value) => {
          const next = value as (typeof statuses)[number];
          setStatus(next);
        }}
        className="mb-4"
      >
        <TabsList variant="line" className="w-full justify-start overflow-x-auto">
          {statuses.map((item) => <TabsTrigger key={item} value={item} className="capitalize">{item}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      {loadError ? (
        <Card className="mb-4 border-rose-200 bg-rose-50 shadow-none">
          <CardContent className="space-y-2 p-4 text-sm text-rose-900">
            <p className="font-medium">โหลดใบเบิกไม่สำเร็จ</p>
            <pre className="whitespace-pre-wrap font-sans text-sm">{loadError}</pre>
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-slate-200 shadow-none">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เลขที่</TableHead>
                <TableHead>ประเภท</TableHead>
                <TableHead>ผู้ขอใช้จริง</TableHead>
                <TableHead>รายการ</TableHead>
                <TableHead>ปลายทาง/ต้นทาง</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead>สร้างเมื่อ</TableHead>
                <TableHead>จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} className="cursor-pointer hover:bg-slate-50">
                  <TableCell><Link href={getRequestHref(row)} className="font-medium text-slate-900">{row.requestRef || formatSupplyRequestRef(row.createdAt, row.id)}</Link></TableCell>
                  <TableCell>{row.requestType === "cross_factory" ? "ข้ามโรงงาน" : "ในโรงงาน"}</TableCell>
                  <TableCell>{row.requesterName || "-"}</TableCell>
                  <TableCell>{row.items.length} รายการ</TableCell>
                  <TableCell>{row.targetFactoryKey || row.factoryKey}</TableCell>
                  <TableCell><Badge variant="outline">{row.status}</Badge></TableCell>
                  <TableCell>{new Date(row.createdAt).toLocaleString("th-TH")}</TableCell>
                  <TableCell>
                    {row.status === "draft" ? (
                      <div className="flex flex-wrap gap-2">
                        <Button asChild size="sm" variant="outline" className="h-8 rounded-full px-3">
                          <Link href={getDraftEditHref(row)}>แก้ไข</Link>
                        </Button>
                        <Button
                          size="sm"
                          className="h-8 rounded-full px-3"
                          disabled={actionId === row.id}
                          onClick={() => void runDraftAction(row, "submit")}
                        >
                          ส่งอนุมัติ
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 rounded-full px-3 text-rose-700"
                          disabled={actionId === row.id}
                          onClick={() => void runDraftAction(row, "cancel")}
                        >
                          ยกเลิก
                        </Button>
                      </div>
                    ) : (
                      <Button asChild size="sm" variant="ghost" className="h-8 rounded-full px-3">
                        <Link href={getRequestHref(row)}>เปิดดู</Link>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
