"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SupplyPageHeader } from "@/components/supply/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface TransferDetail {
  id: number;
  transferRef: string;
  fromFactoryKey: string;
  toFactoryKey: string;
  status: string;
  note: string | null;
  requestId: number | null;
  items: Array<{
    id: number;
    supplyItemId: number;
    quantityShipped: number;
    quantityReceived: number | null;
    note: string | null;
  }>;
}

export default function SupplyTransferDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<TransferDetail | null>(null);
  const [receivedQtys, setReceivedQtys] = useState<Record<number, string>>({});
  const [rejectNote, setRejectNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const response = await fetch(`/api/supply/transfers/${params.id}`);
    if (!response.ok) throw new Error("โหลด transfer ไม่สำเร็จ");
    const data = await response.json();
    setDetail(data);
    setReceivedQtys(
      Object.fromEntries(
        (data.items || []).map((item: TransferDetail["items"][number]) => [
          item.id,
          String(item.quantityReceived ?? item.quantityShipped),
        ])
      )
    );
  }

  useEffect(() => {
    load().catch(() => toast.error("โหลด transfer ไม่สำเร็จ"));
  }, [params.id]);

  async function runAction(action: "receive" | "reject") {
    setSaving(true);
    try {
      const response = await fetch(`/api/supply/transfers/${params.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "receive"
            ? {
                action,
                receivedQtys: detail?.items.map((item) => ({
                  transferItemId: item.id,
                  quantity: Number(receivedQtys[item.id] || 0),
                })),
              }
            : { action, note: rejectNote }
        ),
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
    return <div className="p-6 text-sm text-slate-500">กำลังโหลด transfer...</div>;
  }

  return (
    <div>
      <SupplyPageHeader
        title={detail.transferRef}
        description="ดู shipped vs received ของแต่ละรายการ และยืนยันรับของเมื่อปลายทางตรวจรับเรียบร้อย"
        actions={<Button variant="outline" className="rounded-full" onClick={() => router.push("/supply/transfers")}>กลับรายการ transfer</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-slate-200 shadow-none">
          <CardHeader>
            <CardTitle>รายละเอียดการโอนย้าย</CardTitle>
            <CardDescription>{detail.fromFactoryKey} → {detail.toFactoryKey}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Meta label="สถานะ" value={detail.status} badge />
              <Meta label="Linked request" value={detail.requestId ? `REQ-${detail.requestId}` : "-"} />
              <Meta label="จากโรงงาน" value={detail.fromFactoryKey} />
              <Meta label="ไปโรงงาน" value={detail.toFactoryKey} />
            </div>
            <div className="rounded-2xl border border-slate-100">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supply item</TableHead>
                    <TableHead>ส่ง</TableHead>
                    <TableHead>รับจริง</TableHead>
                    <TableHead>หมายเหตุ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>#{item.supplyItemId}</TableCell>
                      <TableCell>{item.quantityShipped}</TableCell>
                      <TableCell>{item.quantityReceived ?? "-"}</TableCell>
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
              <CardTitle>Confirm receive</CardTitle>
              <CardDescription>ใช้เมื่อปลายทางนับของจริงแล้ว หากรับไม่ครบให้กรอกจำนวนจริงต่อรายการ</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {detail.status === "pending_receive" ? (
                <>
                  <div className="space-y-2">
                    {detail.items.map((item) => (
                      <div key={item.id} className="flex items-center gap-3 rounded-2xl border border-slate-100 px-3 py-2">
                        <span className="min-w-0 flex-1 text-sm text-slate-600">รายการ #{item.supplyItemId}</span>
                        <Input className="w-28" value={receivedQtys[item.id] || ""} onChange={(event) => setReceivedQtys((current) => ({ ...current, [item.id]: event.target.value }))} />
                      </div>
                    ))}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button disabled={saving} onClick={() => void runAction("receive")}>ยืนยันรับของ</Button>
                    <Button variant="destructive" disabled={saving} onClick={() => void runAction("reject")}>ปฏิเสธการรับ</Button>
                  </div>
                  <div className="space-y-2">
                    <Label>หมายเหตุกรณี reject</Label>
                    <Input value={rejectNote} onChange={(event) => setRejectNote(event.target.value)} placeholder="เช่น ของเสียหายหรือจำนวนไม่ครบ" />
                  </div>
                </>
              ) : (
                <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">transfer นี้ไม่อยู่ในสถานะ pending_receive แล้ว</div>
              )}
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
