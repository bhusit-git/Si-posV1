"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatCurrency } from "@/lib/thai-utils";
import {
  getPendingSales,
  removeQueuedSale,
  syncAll,
  type QueuedSale,
  type SyncResult,
} from "@/lib/sync-engine";
import { toast } from "sonner";

interface PendingSalesProps {
  pendingCount: number;
  onSynced: () => void;
  canSyncNow: boolean;
}

export default function PendingSales({ pendingCount, onSynced, canSyncNow }: PendingSalesProps) {
  const [open, setOpen] = useState(false);
  const [sales, setSales] = useState<QueuedSale[]>([]);
  const [syncing, setSyncing] = useState(false);

  const loadSales = useCallback(async () => {
    const pending = await getPendingSales();
    setSales(pending);
  }, []);

  useEffect(() => {
    if (open) {
      loadSales();
    }
  }, [open, loadSales, pendingCount]);

  async function handleSync() {
    setSyncing(true);
    try {
      const result: SyncResult = await syncAll();
      if (result.success > 0) {
        toast.success(`ส่งสำเร็จ ${result.success} รายการ`);
      }
      if (result.errors.length > 0) {
        for (const err of result.errors) {
          toast.error("ส่งไม่สำเร็จ", { description: err });
        }
      }
      await loadSales();
      onSynced();
      if (result.pending === 0) {
        setOpen(false);
      }
    } finally {
      setSyncing(false);
    }
  }

  async function handleDelete(clientId: string) {
    await removeQueuedSale(clientId);
    await loadSales();
    onSynced();
  }

  function formatTime(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return iso;
    }
  }

  if (pendingCount === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-50 border border-orange-300 text-orange-700 text-sm font-medium hover:bg-orange-100 transition-colors">
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
          >
            <path d="M12 2v4" />
            <path d="m16.2 7.8 2.9-2.9" />
            <path d="M18 12h4" />
            <path d="m16.2 16.2 2.9 2.9" />
            <path d="M12 18v4" />
            <path d="m4.9 19.1 2.9-2.9" />
            <path d="M2 12h4" />
            <path d="m4.9 4.9 2.9 2.9" />
          </svg>
          รอส่ง
          <Badge variant="destructive" className="text-[10px] px-1.5 py-0 min-w-[18px] h-[18px] flex items-center justify-center">
            {pendingCount}
          </Badge>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>รายการรอส่ง ({sales.length})</DialogTitle>
          <DialogDescription>
            รายการขายที่ยังไม่ได้ส่งไปเซิร์ฟเวอร์ จะส่งอัตโนมัติเมื่ออินเทอร์เน็ตกลับมา
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {sales.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-4">ไม่มีรายการรอส่ง</p>
          )}
          {sales.map((sale) => (
            <div
              key={sale.clientId}
              className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{sale.customerName}</p>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span>{formatCurrency(sale.total)} บาท</span>
                  <span>|</span>
                  <span>{formatTime(sale.queuedAt)}</span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-700 hover:bg-red-50 shrink-0 ml-2 text-xs"
                onClick={() => handleDelete(sale.clientId)}
              >
                ลบ
              </Button>
            </div>
          ))}
        </div>

        {sales.length > 0 && (
          <>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">
                รวม {formatCurrency(sales.reduce((s, q) => s + q.total, 0))} บาท
              </span>
              <Button onClick={handleSync} disabled={syncing || !canSyncNow}>
                {syncing ? "กำลังส่ง..." : canSyncNow ? "ส่งทั้งหมดตอนนี้" : "รอเข้าสู่ระบบออนไลน์"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
