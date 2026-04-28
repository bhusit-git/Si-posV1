"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const shortcuts = [
  { keys: ["Ctrl/Cmd", "K"], description: "เปิด Command Palette ค้นหา", scope: "ทุกหน้า" },
  { keys: ["?"], description: "แสดงคีย์ลัดทั้งหมด", scope: "ทุกหน้า" },
  { keys: ["Enter"], description: "บันทึกการขาย", scope: "หน้าขาย" },
  { keys: ["Escape"], description: "ล้างฟอร์ม", scope: "หน้าขาย" },
  { keys: ["F2"], description: "โฟกัสช่องค้นหา", scope: "หน้าขาย" },
];

export function KeyboardShortcutsModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Only trigger on "?" when not typing in an input
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable;

      if (e.key === "?" && !isInput && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setOpen(true);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>คีย์ลัด (Keyboard Shortcuts)</DialogTitle>
          <DialogDescription>คีย์ลัดที่ใช้งานได้ในแอปพลิเคชัน</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          {shortcuts.map((shortcut, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-2 px-1 border-b border-gray-100 dark:border-gray-800 last:border-0"
            >
              <div className="flex-1">
                <p className="text-sm font-medium">{shortcut.description}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{shortcut.scope}</p>
              </div>
              <div className="flex gap-1">
                {shortcut.keys.map((key, ki) => (
                  <kbd
                    key={ki}
                    className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 text-xs font-mono bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded"
                  >
                    {key}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
