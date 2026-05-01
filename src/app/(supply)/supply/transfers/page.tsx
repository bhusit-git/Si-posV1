"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SupplyPageHeader } from "@/components/supply/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface TransferRow {
  id: number;
  transferRef: string;
  fromFactoryKey: string;
  toFactoryKey: string;
  status: string;
  requestId: number | null;
  createdAt: string;
  items: Array<{ id: number; quantityShipped: number; quantityReceived: number | null }>;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export default function SupplyTransfersPage() {
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [status, setStatus] = useState("pending_receive");
  const [direction, setDirection] = useState("incoming");
  const [open, setOpen] = useState(false);
  const [factories, setFactories] = useState<Array<{ key: string; name: string }>>([]);
  const [catalog, setCatalog] = useState<Array<{ id: number; name: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ requestId: "", toFactoryKey: "", supplyItemId: "", quantity: "", note: "" });

  async function load(nextStatus = status, nextDirection = direction) {
    const params = new URLSearchParams({ status: nextStatus, direction: nextDirection });
    const response = await fetch(`/api/supply/transfers?${params.toString()}`);
    if (!response.ok) throw new Error("โหลด transfer ไม่สำเร็จ");
    const data = await response.json();
    setRows(asArray<TransferRow>(data));
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/factory").then((response) => response.json()),
      fetch("/api/supply/items").then((response) => response.json()),
    ])
      .then(([factoryData, items]) => {
        setFactories(asArray<{ key: string; name: string }>(factoryData?.factories));
        setCatalog(asArray<{ id: number; name: string }>(items));
      })
      .catch(() => undefined);
    load().catch(() => toast.error("โหลด transfer ไม่สำเร็จ"));
  }, []);

  async function handleCreate() {
    setSaving(true);
    try {
      const response = await fetch("/api/supply/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: form.requestId ? Number(form.requestId) : null,
          toFactoryKey: form.toFactoryKey,
          note: form.note,
          items: form.requestId ? undefined : [{ supplyItemId: Number(form.supplyItemId), quantity: Number(form.quantity) }],
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "สร้าง transfer ไม่สำเร็จ");
      }
      toast.success("สร้าง transfer แล้ว");
      setOpen(false);
      setForm({ requestId: "", toFactoryKey: "", supplyItemId: "", quantity: "", note: "" });
      await load(status, direction);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "สร้าง transfer ไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <SupplyPageHeader
        title="Transfers"
        description="ติดตามของที่กำลังส่งระหว่างโรงงาน และยืนยันรับของเมื่อปลายทางได้รับจริง"
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button className="rounded-full">สร้าง Transfer</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>สร้าง transfer ใหม่</DialogTitle>
                <DialogDescription>ถ้ามี requestId ระบบจะดึงรายการจากใบเบิกปลายทางที่อนุมัติแล้วมาใช้ได้</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label>Request ID (ถ้ามี)</Label><Input value={form.requestId} onChange={(event) => setForm((current) => ({ ...current, requestId: event.target.value }))} /></div>
                  <div className="space-y-2">
                    <Label>โรงงานปลายทาง</Label>
                    <Select value={form.toFactoryKey} onValueChange={(value) => setForm((current) => ({ ...current, toFactoryKey: value }))}>
                      <SelectTrigger><SelectValue placeholder="เลือกโรงงานปลายทาง" /></SelectTrigger>
                      <SelectContent>
                        {factories.map((factory) => <SelectItem key={factory.key} value={factory.key}>{factory.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {!form.requestId ? (
                  <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
                    <div className="space-y-2">
                      <Label>รายการ</Label>
                      <Select value={form.supplyItemId} onValueChange={(value) => setForm((current) => ({ ...current, supplyItemId: value }))}>
                        <SelectTrigger><SelectValue placeholder="เลือกของใช้" /></SelectTrigger>
                        <SelectContent>
                          {catalog.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2"><Label>จำนวน</Label><Input value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} /></div>
                  </div>
                ) : null}
                <div className="space-y-2"><Label>หมายเหตุ</Label><Input value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>ยกเลิก</Button>
                <Button onClick={handleCreate} disabled={saving}>{saving ? "กำลังสร้าง..." : "สร้าง"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={status} onValueChange={(value) => { setStatus(value); void load(value, direction); }}>
          <TabsList variant="line">
            <TabsTrigger value="pending_receive">pending_receive</TabsTrigger>
            <TabsTrigger value="received">received</TabsTrigger>
            <TabsTrigger value="confirmed">confirmed</TabsTrigger>
            <TabsTrigger value="rejected">rejected</TabsTrigger>
            <TabsTrigger value="sent">sent</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={direction} onValueChange={(value) => { setDirection(value); void load(status, value); }}>
          <SelectTrigger className="w-44 rounded-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="incoming">incoming</SelectItem>
            <SelectItem value="outgoing">outgoing</SelectItem>
            <SelectItem value="all">all</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="border-slate-200 shadow-none">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Transfer</TableHead>
                <TableHead>จาก</TableHead>
                <TableHead>ไป</TableHead>
                <TableHead>Request</TableHead>
                <TableHead>รายการ</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead>สร้างเมื่อ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell><Link href={`/supply/transfers/${row.id}`} className="font-medium text-slate-900">{row.transferRef}</Link></TableCell>
                  <TableCell>{row.fromFactoryKey}</TableCell>
                  <TableCell>{row.toFactoryKey}</TableCell>
                  <TableCell>{row.requestId ? `REQ-${row.requestId}` : "-"}</TableCell>
                  <TableCell>{row.items.length} รายการ</TableCell>
                  <TableCell><Badge variant="outline">{row.status}</Badge></TableCell>
                  <TableCell>{new Date(row.createdAt).toLocaleString("th-TH")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
