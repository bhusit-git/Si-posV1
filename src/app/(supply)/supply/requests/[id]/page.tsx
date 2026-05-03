"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Expand,
  History,
  type LucideIcon,
  Package,
  ShieldCheck,
  UserRound,
  Warehouse,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatSupplyRequestRef } from "@/lib/supply/request-ref";
import { formatBaseQuantityWithPack } from "@/lib/supply/unit-conversion";
import { cn } from "@/lib/utils";

interface RequestUser {
  id: number;
  username: string;
  role: string | null;
  factoryKey: string | null;
}

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
  createdByUser?: RequestUser | null;
  approvedByUser?: RequestUser | null;
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
      imageUrl?: string | null;
    } | null;
  }>;
}

interface StockBalanceRow {
  item: {
    id: number;
    unit: string;
    packSize: number;
  };
  balance: number;
}

const statusLabels: Record<string, string> = {
  draft: "แบบร่าง",
  pending: "รอการอนุมัติ",
  approved: "อนุมัติแล้ว",
  rejected: "ปฏิเสธแล้ว",
  fulfilled: "จ่ายของแล้ว",
  cancelled: "ยกเลิกแล้ว",
};

function getRequestRef(detail: RequestDetail) {
  return detail.requestRef || formatSupplyRequestRef(detail.createdAt, detail.id);
}

function getApprovalFactoryKey(detail: RequestDetail) {
  return detail.requestType === "cross_factory"
    ? detail.targetFactoryKey
    : detail.targetFactoryKey || detail.factoryKey;
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getInitials(value: string | null | undefined) {
  const text = value?.trim();
  if (!text) return "SJ";
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  }
  return text.slice(0, 2).toUpperCase();
}

function parseQuantity(value: string | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatItemQuantity(item: RequestDetail["items"][number], quantity: number) {
  return formatBaseQuantityWithPack(
    quantity,
    item.supplyItem?.unit || "หน่วย",
    item.supplyItem?.packSize || 1
  );
}

export default function SupplyRequestDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [signature, setSignature] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [stockByItemId, setStockByItemId] = useState<Record<number, StockBalanceRow>>({});
  const [saving, setSaving] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ url: string; alt: string } | null>(null);
  const requestFactoryKey = searchParams.get("factoryKey")?.trim() || "";
  const requestQuery = requestFactoryKey
    ? `?factoryKey=${encodeURIComponent(requestFactoryKey)}`
    : "";

  const loadStock = useCallback(async (requestDetail: RequestDetail) => {
    const approvalFactoryKey = getApprovalFactoryKey(requestDetail);
    if (!approvalFactoryKey) {
      setStockByItemId({});
      return;
    }

    const response = await fetch(`/api/supply/stock?factoryKey=${encodeURIComponent(approvalFactoryKey)}`);
    if (!response.ok) {
      setStockByItemId({});
      return;
    }

    const rows = (await response.json()) as StockBalanceRow[];
    setStockByItemId(Object.fromEntries(rows.map((row) => [row.item.id, row])));
  }, []);

  const load = useCallback(async () => {
    const response = await fetch(`/api/supply/requests/${params.id}${requestQuery}`);
    if (!response.ok) throw new Error("โหลดใบเบิกไม่สำเร็จ");
    const data = (await response.json()) as RequestDetail;
    setDetail(data);
    setSignature(data.approverSignature || "");
    setRejectNote("");
    setQuantities(
      Object.fromEntries(
        (data.items || []).map((item) => [
          item.id,
          String(item.quantityApproved ?? item.quantityRequested),
        ])
      )
    );
    void loadStock(data);
  }, [loadStock, params.id, requestQuery]);

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
    return <div className="p-6 text-sm font-medium text-slate-500 dark:text-slate-400">กำลังโหลดใบเบิก...</div>;
  }

  const currentDetail = detail;
  const requestRef = getRequestRef(currentDetail);
  const approvalFactoryKey = getApprovalFactoryKey(currentDetail);
  const requesterLabel = currentDetail.requesterName || currentDetail.createdByUser?.username || "-";
  const isPendingApproval = currentDetail.status === "pending";
  const canCancel = currentDetail.status === "draft" || currentDetail.status === "pending";
  const approvedQtys = currentDetail.items.map((item) => ({
    requestItemId: item.id,
    quantity: parseQuantity(quantities[item.id]),
  }));

  function approveFullQuantities() {
    setQuantities(
      Object.fromEntries(
        currentDetail.items.map((item) => [item.id, String(item.quantityRequested)])
      )
    );
  }

  return (
    <div className="mx-auto max-w-[1560px] space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_20px_70px_-42px_rgba(15,23,42,0.55)] dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-6 py-5 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              onClick={() => router.push("/supply/requests")}
              aria-label="กลับหน้ารายการ"
            >
              <ArrowLeft className="size-5" />
            </Button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="truncate text-2xl font-extrabold tracking-tight text-slate-950 dark:text-slate-50">
                  {requestRef}
                </h1>
                <StatusBadge status={currentDetail.status} />
              </div>
              <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                สร้างเมื่อ {formatDateTime(currentDetail.createdAt)}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            className="h-11 rounded-xl border-slate-200 bg-white px-6 font-bold text-slate-700 shadow-sm shadow-slate-200/70 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:shadow-none"
            onClick={() => router.push("/supply/requests")}
          >
            กลับหน้ารายการ
          </Button>
        </div>

        <div className="grid gap-5 bg-slate-50/70 p-6 dark:bg-slate-950/35 lg:grid-cols-3">
          <SummaryPanel
            icon={UserRound}
            label="ผู้ขอเบิก"
            title={requesterLabel}
            avatar={getInitials(requesterLabel)}
          />
          <SummaryPanel
            icon={Warehouse}
            label="คลังต้นทาง (จ่าย)"
            title={approvalFactoryKey || "-"}
          />
          <SummaryPanel
            icon={ChevronRight}
            label="ปลายทาง (รับ)"
            title={currentDetail.factoryKey}
            prefix={currentDetail.requestType === "cross_factory" ? "เบิกข้ามโรงงาน" : "เบิกในโรงงาน"}
          />
        </div>
      </section>

      <Card className="overflow-hidden rounded-[28px] border-slate-200 bg-white py-0 shadow-[0_20px_70px_-42px_rgba(15,23,42,0.55)] dark:border-slate-800 dark:bg-slate-900">
        <CardHeader className="border-b border-slate-100 px-6 py-5 dark:border-slate-800 md:flex-row md:items-center md:justify-between">
          <CardTitle className="text-xl font-extrabold tracking-tight text-slate-950 dark:text-slate-50">
            รายการพัสดุที่ขอเบิก <span className="ml-2 text-sm font-bold text-slate-400">({currentDetail.items.length} รายการ)</span>
          </CardTitle>
          {isPendingApproval ? (
            <Button
              variant="ghost"
              className="justify-start rounded-xl font-bold text-indigo-700 hover:bg-indigo-50 hover:text-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
              onClick={approveFullQuantities}
            >
              อนุมัติเต็มจำนวนทั้งหมด
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-100 bg-slate-50/60 hover:bg-slate-50/60 dark:border-slate-800 dark:bg-slate-950/35">
                  <TableHead className="h-14 w-20 px-6 text-sm font-bold text-slate-500 dark:text-slate-400">รูป</TableHead>
                  <TableHead className="h-14 min-w-[300px] px-4 text-sm font-bold text-slate-500 dark:text-slate-400">รายละเอียดสินค้า</TableHead>
                  <TableHead className="h-14 w-28 px-4 text-center text-sm font-bold text-slate-500 dark:text-slate-400">ขอเบิก</TableHead>
                  <TableHead className="h-14 w-48 px-4 text-center text-sm font-bold text-slate-500 dark:text-slate-400">จำนวนที่อนุมัติ</TableHead>
                  <TableHead className="h-14 w-48 px-4 text-center text-sm font-bold text-slate-500 dark:text-slate-400">สต็อกคงเหลือ</TableHead>
                  <TableHead className="h-14 min-w-[190px] px-6 text-sm font-bold text-slate-500 dark:text-slate-400">หมายเหตุ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentDetail.items.map((item) => {
                  const stock = stockByItemId[item.supplyItemId];
                  const approvedQuantity = parseQuantity(quantities[item.id]);
                  const stockIsEnough = stock ? stock.balance >= approvedQuantity : true;

                  return (
                    <TableRow key={item.id} className="border-slate-100 hover:bg-slate-50/70 dark:border-slate-800 dark:hover:bg-slate-800/40">
                      <TableCell className="px-6 py-5">
                        <SupplyItemImage item={item} onPreview={setPreviewImage} />
                      </TableCell>
                      <TableCell className="px-4 py-5">
                        <p className="text-base font-extrabold text-slate-950 dark:text-slate-50">
                          {item.supplyItem?.name || `รายการ #${item.supplyItemId}`}
                        </p>
                        <p className="mt-1 text-sm font-bold text-slate-500 dark:text-slate-400">
                          หน่วยนับ: {item.supplyItem?.unit || "หน่วยไม่ระบุ"}
                        </p>
                      </TableCell>
                      <TableCell className="px-4 py-5 text-center">
                        <span className="inline-flex min-w-12 items-center justify-center rounded-xl bg-slate-100 px-3 py-2 text-lg font-extrabold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          {item.quantityRequested}
                        </span>
                      </TableCell>
                      <TableCell className="px-4 py-5">
                        {isPendingApproval ? (
                          <div className="flex items-center justify-center gap-3">
                            <Input
                              type="number"
                              min={0}
                              max={item.quantityRequested}
                              inputMode="numeric"
                              className="h-12 w-32 rounded-2xl border-slate-200 bg-white text-center text-lg font-extrabold shadow-sm dark:border-slate-700 dark:bg-slate-950"
                              value={quantities[item.id] || ""}
                              onChange={(event) =>
                                setQuantities((current) => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))
                              }
                            />
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                              onClick={() =>
                                setPreviewImage({
                                  url: item.supplyItem?.imageUrl || "",
                                  alt: item.supplyItem?.name || `รายการ #${item.supplyItemId}`,
                                })
                              }
                              disabled={!item.supplyItem?.imageUrl}
                              aria-label="ดูรูปสินค้า"
                            >
                              <Expand className="size-4" />
                            </Button>
                          </div>
                        ) : (
                          <p className="text-center font-bold text-slate-700 dark:text-slate-200">
                            {item.quantityApproved == null ? "-" : formatItemQuantity(item, item.quantityApproved)}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="px-4 py-5">
                        <StockCell item={item} stock={stock} stockIsEnough={stockIsEnough} />
                      </TableCell>
                      <TableCell className="px-6 py-5">
                        <p
                          className={cn(
                            "text-sm font-semibold",
                            stockIsEnough
                              ? "text-slate-400 dark:text-slate-500"
                              : "text-rose-500 dark:text-rose-300"
                          )}
                        >
                          {stockIsEnough ? item.note || "-" : "สต็อกคงเหลือน้อยกว่าที่ขอ"}
                        </p>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_32rem] lg:items-start">
        <Card className="rounded-[28px] border-slate-200 bg-white shadow-[0_20px_70px_-48px_rgba(15,23,42,0.5)] dark:border-slate-800 dark:bg-slate-900">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-extrabold text-slate-700 dark:text-slate-100">
              <History className="size-4 text-slate-400" />
              บันทึกการดำเนินการ
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
            <TimelineLine
              label={`${currentDetail.createdByUser?.username || requesterLabel} สร้างใบเบิกเมื่อ ${formatDateTime(currentDetail.createdAt)}`}
              active
            />
            <TimelineLine label="รอการตรวจสอบจากผู้อนุมัติ" active={currentDetail.status !== "draft"} current={currentDetail.status === "pending"} />
            <TimelineLine
              label={currentDetail.approvedAt ? `อนุมัติโดย ${currentDetail.approvedByUser?.username || currentDetail.approverSignature || "-"} เมื่อ ${formatDateTime(currentDetail.approvedAt)}` : "อนุมัติแล้ว"}
              active={["approved", "fulfilled"].includes(currentDetail.status)}
            />
            <TimelineLine label="จ่ายของ / ปิดงาน" active={currentDetail.status === "fulfilled"} />
          </CardContent>
        </Card>

        <ApprovalPanel
          detail={currentDetail}
          saving={saving}
          signature={signature}
          rejectNote={rejectNote}
          setSignature={setSignature}
          setRejectNote={setRejectNote}
          onSubmit={() => void runAction("submit")}
          onApprove={() => void runAction("approve", { signature, approvedQtys })}
          onReject={() => void runAction("reject", { note: rejectNote })}
          onFulfil={() => void runAction("fulfil")}
          onCancel={canCancel ? () => void runAction("cancel") : undefined}
        />
      </div>

      <Dialog open={Boolean(previewImage)} onOpenChange={(open) => !open && setPreviewImage(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{previewImage?.alt || "รูปสินค้า"}</DialogTitle>
          </DialogHeader>
          {previewImage ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewImage.url}
                alt={previewImage.alt}
                className="max-h-[70dvh] w-full object-contain"
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isPending = status === "pending";
  const isDone = status === "approved" || status === "fulfilled";
  const isStopped = status === "rejected" || status === "cancelled";

  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full px-3 py-1 font-bold",
        isPending && "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200",
        isDone && "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300",
        isStopped && "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300"
      )}
    >
      {statusLabels[status] || status}
    </Badge>
  );
}

function SummaryPanel({
  icon: Icon,
  label,
  title,
  prefix,
  avatar,
}: {
  icon: LucideIcon;
  label: string;
  title: string;
  prefix?: string;
  avatar?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/60 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
      <p className="text-sm font-bold text-slate-400 dark:text-slate-500">{label}</p>
      <div className="mt-3 flex items-center gap-3">
        {avatar ? (
          <div className="flex size-11 items-center justify-center rounded-full bg-indigo-100 text-sm font-extrabold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">
            {avatar}
          </div>
        ) : (
          <Icon className="size-6 text-slate-400" />
        )}
        <div className="min-w-0">
          {prefix ? <p className="text-xs font-bold text-slate-400 dark:text-slate-500">{prefix}</p> : null}
          <p className="truncate text-lg font-extrabold text-slate-800 dark:text-slate-100">{title}</p>
        </div>
      </div>
    </div>
  );
}

function SupplyItemImage({
  item,
  onPreview,
}: {
  item: RequestDetail["items"][number];
  onPreview: (preview: { url: string; alt: string }) => void;
}) {
  if (!item.supplyItem?.imageUrl) {
    return (
      <div className="flex h-16 w-12 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-[10px] font-medium text-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-500">
        ไม่มีรูป
      </div>
    );
  }

  return (
    <button
      type="button"
      className="overflow-hidden rounded-2xl border border-slate-200 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-700 dark:focus-visible:ring-slate-500"
      onClick={() =>
        onPreview({
          url: item.supplyItem?.imageUrl || "",
          alt: item.supplyItem?.name || `รายการ #${item.supplyItemId}`,
        })
      }
      aria-label={`ดูรูป ${item.supplyItem?.name || item.supplyItemId}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.supplyItem.imageUrl}
        alt={item.supplyItem?.name || `รายการ #${item.supplyItemId}`}
        className="h-16 w-12 object-cover"
        loading="lazy"
      />
    </button>
  );
}

function StockCell({
  item,
  stock,
  stockIsEnough,
}: {
  item: RequestDetail["items"][number];
  stock?: StockBalanceRow;
  stockIsEnough: boolean;
}) {
  if (!stock) {
    return <p className="text-center text-sm font-semibold text-slate-400 dark:text-slate-500">-</p>;
  }

  return (
    <div className="text-center">
      <div
        className={cn(
          "inline-flex items-center gap-2 font-extrabold",
          stockIsEnough ? "text-emerald-600 dark:text-emerald-300" : "text-rose-500 dark:text-rose-300"
        )}
      >
        {stockIsEnough ? <CheckCircle2 className="size-5" /> : <XCircle className="size-5" />}
        <span className="text-lg">{stock.balance}</span>
        <span className="text-sm font-bold">{item.supplyItem?.unit || stock.item.unit}</span>
      </div>
      {!stockIsEnough ? (
        <p className="mt-1 text-xs font-bold text-rose-500 dark:text-rose-300">สินค้าในคลังไม่เพียงพอ</p>
      ) : (
        <p className="mt-1 text-xs font-semibold text-slate-400 dark:text-slate-500">
          {formatBaseQuantityWithPack(stock.balance, item.supplyItem?.unit || stock.item.unit, item.supplyItem?.packSize || stock.item.packSize)}
        </p>
      )}
    </div>
  );
}

function ApprovalPanel({
  detail,
  saving,
  signature,
  rejectNote,
  setSignature,
  setRejectNote,
  onSubmit,
  onApprove,
  onReject,
  onFulfil,
  onCancel,
}: {
  detail: RequestDetail;
  saving: boolean;
  signature: string;
  rejectNote: string;
  setSignature: (value: string) => void;
  setRejectNote: (value: string) => void;
  onSubmit: () => void;
  onApprove: () => void;
  onReject: () => void;
  onFulfil: () => void;
  onCancel?: () => void;
}) {
  return (
    <div className="space-y-4 lg:sticky lg:top-6">
      {detail.status === "pending" ? (
        <div className="rounded-[28px] border border-indigo-100 bg-indigo-50 p-5 shadow-sm shadow-indigo-100/80 dark:border-indigo-900 dark:bg-indigo-950/30 dark:shadow-none">
          <div className="flex items-center gap-4">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-white text-indigo-500 shadow-sm dark:bg-slate-900 dark:text-indigo-300">
              <ShieldCheck className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <Label className="font-extrabold text-indigo-800 dark:text-indigo-200">รหัสผ่านผู้อนุมัติ (PIN)</Label>
              <p className="mt-1 text-xs font-bold text-indigo-500 dark:text-indigo-300">
                เพื่อยืนยันตัวตนก่อนดำเนินการ
              </p>
            </div>
          </div>
          <Input
            value={signature}
            onChange={(event) => setSignature(event.target.value)}
            placeholder="Manager PIN หรือชื่อผู้อนุมัติ"
            className="mt-4 h-12 rounded-2xl border-indigo-100 bg-white text-base font-extrabold shadow-sm dark:border-indigo-900 dark:bg-slate-900"
          />
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {detail.status === "draft" ? (
          <Button className="h-[52px] rounded-2xl bg-emerald-600 font-extrabold text-white shadow-sm hover:bg-emerald-700 sm:col-span-2" disabled={saving} onClick={onSubmit}>
            <Clock3 className="size-5" />
            ส่งอนุมัติ
          </Button>
        ) : null}

        {detail.status === "pending" ? (
          <>
            <Button variant="outline" className="h-[52px] rounded-2xl border-rose-200 bg-white font-extrabold text-rose-600 shadow-sm hover:bg-rose-50 hover:text-rose-700 dark:border-rose-800 dark:bg-slate-950 dark:text-rose-300 dark:hover:bg-rose-950/40" disabled={saving} onClick={onReject}>
              <XCircle className="size-5" />
              ปฏิเสธการเบิก
            </Button>
            <Button className="h-[52px] rounded-2xl bg-emerald-600 font-extrabold text-white shadow-sm hover:bg-emerald-700" disabled={saving} onClick={onApprove}>
              <CheckCircle2 className="size-5" />
              ยืนยันการอนุมัติ
            </Button>
            <Input
              value={rejectNote}
              onChange={(event) => setRejectNote(event.target.value)}
              placeholder="เหตุผลกรณีปฏิเสธ"
              className="h-12 rounded-2xl sm:col-span-2"
            />
          </>
        ) : null}

        {detail.status === "approved" && detail.requestType === "internal_factory" ? (
          <Button className="h-[52px] rounded-2xl bg-emerald-600 font-extrabold text-white shadow-sm hover:bg-emerald-700 sm:col-span-2" disabled={saving} onClick={onFulfil}>
            <Package className="size-5" />
            จ่ายของแล้ว / Fulfil
          </Button>
        ) : null}
      </div>

      {detail.status === "approved" && detail.requestType === "cross_factory" ? (
        <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4 text-sm font-bold text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
          ใบเบิกนี้ต้องสร้าง transfer จากโรงงานต้นทาง ({detail.targetFactoryKey}) เพื่อดำเนินการส่งของ
        </div>
      ) : null}

      {onCancel ? (
        <Button variant="outline" className="h-12 w-full rounded-2xl border-slate-200 bg-white font-extrabold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" disabled={saving} onClick={onCancel}>
          ยกเลิกใบเบิก
        </Button>
      ) : null}
    </div>
  );
}

function TimelineLine({ label, active, current }: { label: string; active: boolean; current?: boolean }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "mt-0.5 size-3 rounded-full",
            active ? "bg-indigo-500" : "bg-slate-200 dark:bg-slate-700",
            current && "ring-4 ring-indigo-100 dark:ring-indigo-900"
          )}
        />
        <span className="mt-1 h-full w-px bg-slate-100 dark:bg-slate-800" />
      </div>
      <p className={cn("pb-3 font-bold", active ? "text-slate-800 dark:text-slate-100" : "text-slate-400 dark:text-slate-500")}>
        {label}
      </p>
    </div>
  );
}
