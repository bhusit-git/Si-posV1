"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { SupplyPageHeader } from "@/components/supply/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatSupplyRequestRef } from "@/lib/supply/request-ref";
import { formatBaseQuantityWithPack } from "@/lib/supply/unit-conversion";

interface RequestDetail {
  id: number;
  requestRef?: string | null;
  factoryKey: string;
  requestType: "internal_factory" | "cross_factory";
  targetFactoryKey: string | null;
  requesterName: string | null;
  status: string;
  note: string | null;
  approverSignature: string | null;
  approvedAt: string | null;
  fulfilledAt: string | null;
  createdAt: string;
  items: Array<{
    id: number;
    supplyItemId: number;
    quantityRequested: number;
    quantityApproved: number | null;
    note: string | null;
    supplyItem: {
      id: number;
      name: string;
      unit: string;
      packSize: number;
    } | null;
  }>;
}

export default function SupplyRequestDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [signature, setSignature] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const requestFactoryKey = searchParams.get("factoryKey")?.trim() || "";
  const requestQuery = requestFactoryKey
    ? `?factoryKey=${encodeURIComponent(requestFactoryKey)}`
    : "";

  const load = useCallback(async () => {
    const response = await fetch(`/api/supply/requests/${params.id}${requestQuery}`);
    if (!response.ok) throw new Error("โหลดใบเบิกไม่สำเร็จ");
    const data = await response.json();
    setDetail(data);
    setSignature(data.approverSignature || "");
    setQuantities(
      Object.fromEntries(
        (data.items || []).map((item: RequestDetail["items"][number]) => [
          item.id,
          String(item.quantityApproved ?? item.quantityRequested),
        ])
      )
    );
  }, [params.id, requestQuery]);

  useEffect(() => {
    load().catch(() => toast.error("โหลดใบเบิกไม่สำเร็จ"));
  }, [load]);

  async function runAction(action: string, extra?: Record<string, unknown>) {
    setSaving(true);
    try {
      const response = await fetch(`/api/supply/requests/${params.id}${requestQuery}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `ทำรายการ ${action} ไม่สำเร็จ`);
      }
      await load();
      toast.success(`อัปเดตสถานะ ${action} แล้ว`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ทำรายการไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  if (!detail) {
    return <div className="p-6 text-sm text-slate-500">กำลังโหลดใบเบิก...</div>;
  }

  const sourceFactoryKey =
    detail.requestType === "cross_factory"
      ? detail.targetFactoryKey
      : detail.targetFactoryKey || detail.factoryKey;

  return (
    <div>
      <SupplyPageHeader
        title={`Request ${detail.requestRef || formatSupplyRequestRef(detail.createdAt, detail.id)}`}
        description="ตรวจรายการที่ขอ อนุมัติพร้อมลายเซ็น หรือ fulfil เมื่อจ่ายของจริงแล้ว"
        actions={<Button variant="outline" className="rounded-full" onClick={() => router.push("/supply/requests")}>กลับรายการใบเบิก</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <Card className="border-slate-200 shadow-none">
          <CardHeader>
            <CardTitle>รายละเอียดใบเบิก</CardTitle>
            <CardDescription>ประเภท {detail.requestType === "cross_factory" ? "เบิกข้ามโรงงาน" : "เบิกในโรงงาน"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Meta label="สถานะ" value={detail.status} badge />
              <Meta label="ผู้ขอใช้จริง" value={detail.requesterName || "-"} />
              <Meta label="โรงงานเอกสาร" value={detail.factoryKey} />
              <Meta label="โรงงานต้นทาง" value={sourceFactoryKey || "-"} />
            </div>
            <div className="rounded-2xl border border-slate-100">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supply item</TableHead>
                    <TableHead>ขอ</TableHead>
                    <TableHead>อนุมัติ</TableHead>
                    <TableHead>หมายเหตุ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-slate-900">
                            {item.supplyItem?.name || `#${item.supplyItemId}`}
                          </p>
                          <p className="text-xs text-slate-500">
                            {item.supplyItem?.unit || "หน่วยไม่ระบุ"}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        {formatBaseQuantityWithPack(
                          item.quantityRequested,
                          item.supplyItem?.unit || "หน่วย",
                          item.supplyItem?.packSize || 1
                        )}
                      </TableCell>
                      <TableCell>
                        {item.quantityApproved == null
                          ? "-"
                          : formatBaseQuantityWithPack(
                              item.quantityApproved,
                              item.supplyItem?.unit || "หน่วย",
                              item.supplyItem?.packSize || 1
                            )}
                      </TableCell>
                      <TableCell>{item.note || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-slate-200 shadow-none">
            <CardHeader>
              <CardTitle>Actions</CardTitle>
              <CardDescription>ทำตาม flow ของ request จาก draft ไปจน fulfil</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {detail.status === "draft" ? (
                <Button className="w-full" disabled={saving} onClick={() => void runAction("submit")}>ส่งอนุมัติ</Button>
              ) : null}

              {detail.status === "pending" ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>ลายเซ็นผู้อนุมัติ</Label>
                    <Input value={signature} onChange={(event) => setSignature(event.target.value)} placeholder="เช่น manager-pin หรือชื่อผู้อนุมัติ" />
                  </div>
                  <div className="space-y-2">
                    <Label>จำนวนอนุมัติต่อรายการ</Label>
                    <div className="space-y-2">
                      {detail.items.map((item) => (
                        <div key={item.id} className="flex items-center gap-3 rounded-2xl border border-slate-100 px-3 py-2">
                          <span className="min-w-0 flex-1 text-sm text-slate-600">
                            {item.supplyItem?.name || `รายการ #${item.supplyItemId}`}
                          </span>
                          <Input className="w-28" value={quantities[item.id] || ""} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} />
                          <span className="text-xs text-slate-500">
                            {item.supplyItem
                              ? `สูงสุด ${formatBaseQuantityWithPack(item.quantityRequested, item.supplyItem.unit, item.supplyItem.packSize)}`
                              : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button disabled={saving} onClick={() => void runAction("approve", { signature, approvedQtys: detail.items.map((item) => ({ requestItemId: item.id, quantity: Number(quantities[item.id] || 0) })) })}>อนุมัติ</Button>
                    <Button variant="destructive" disabled={saving} onClick={() => void runAction("reject", { note: rejectNote })}>ปฏิเสธ</Button>
                  </div>
                  <Input value={rejectNote} onChange={(event) => setRejectNote(event.target.value)} placeholder="เหตุผลกรณีปฏิเสธ" />
                </div>
              ) : null}

              {detail.status === "approved" && detail.requestType === "internal_factory" ? (
                <Button className="w-full" disabled={saving} onClick={() => void runAction("fulfil")}>จ่ายของแล้ว / fulfil</Button>
              ) : null}

              {detail.status === "approved" && detail.requestType === "cross_factory" ? (
                <div className="rounded-2xl bg-sky-50 p-4 text-sm text-sky-900">
                  ใบเบิกนี้ต้องไปสร้าง transfer จากโรงงานต้นทาง ({detail.targetFactoryKey}) หลังจากเข้าหน้า transfer ของฝั่งนั้น
                </div>
              ) : null}

              {(detail.status === "draft" || detail.status === "pending") ? (
                <Button variant="outline" className="w-full" disabled={saving} onClick={() => void runAction("cancel")}>ยกเลิกใบเบิก</Button>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-none">
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-600">
              <TimelineLine label="สร้าง draft แล้ว" active />
              <TimelineLine label="ส่งอนุมัติ" active={detail.status !== "draft"} />
              <TimelineLine label="อนุมัติแล้ว" active={["approved", "fulfilled"].includes(detail.status)} />
              <TimelineLine label="fulfil / ปิดงาน" active={detail.status === "fulfilled"} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value, badge }: { label: string; value: string; badge?: boolean }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{label}</p>
      {badge ? <Badge variant="outline" className="mt-2">{value}</Badge> : <p className="mt-2 font-medium text-slate-900">{value}</p>}
    </div>
  );
}

function TimelineLine({ label, active }: { label: string; active: boolean }) {
  return <div className={active ? "rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800" : "rounded-2xl border border-slate-100 px-4 py-3"}>{label}</div>;
}
