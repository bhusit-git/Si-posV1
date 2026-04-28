"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPrintedBillNumber } from "@/lib/bill-number";

interface PrintedBillCounterProps {
  value: number | null;
  loading?: boolean;
  saving?: boolean;
  disabled?: boolean;
  label?: string;
  onCommit: (nextBillNumber: number) => Promise<void> | void;
}

export function PrintedBillCounter({
  value,
  loading = false,
  saving = false,
  disabled = false,
  label = "เลขบิลถัดไป",
  onCommit,
}: PrintedBillCounterProps) {
  const [draftValue, setDraftValue] = useState("");

  useEffect(() => {
    setDraftValue(typeof value === "number" ? formatPrintedBillNumber(value) || String(value) : "");
  }, [value]);

  async function commitValue() {
    const trimmed = draftValue.trim();
    if (!trimmed) {
      setDraftValue(typeof value === "number" ? formatPrintedBillNumber(value) || String(value) : "");
      return;
    }

    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 9999) {
      toast.error("เลขบิลต้องอยู่ระหว่าง 0000-9999");
      setDraftValue(typeof value === "number" ? formatPrintedBillNumber(value) || String(value) : "");
      return;
    }

    if (parsed === value) {
      setDraftValue(formatPrintedBillNumber(parsed) || String(parsed));
      return;
    }

    await onCommit(parsed);
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5">
      <Label className="text-xs font-medium text-slate-600 whitespace-nowrap">{label}</Label>
      <Input
        value={draftValue}
        onChange={(event) => setDraftValue(event.target.value.replace(/[^\d]/g, "").slice(0, 4))}
        onBlur={() => {
          void commitValue();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void commitValue();
            event.currentTarget.blur();
          }
        }}
        placeholder={loading ? "...." : "0001"}
        disabled={disabled || loading || saving}
        className="h-8 w-20 bg-white text-center font-mono text-sm"
        inputMode="numeric"
      />
      {saving && <span className="text-[11px] text-slate-500">กำลังบันทึก...</span>}
    </div>
  );
}
