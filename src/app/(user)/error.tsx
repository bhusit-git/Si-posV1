"use client";

import { useEffect } from "react";

export default function UserError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("User page error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8">
      <div className="text-6xl">⚠️</div>
      <h2 className="text-2xl font-bold text-red-600">เกิดข้อผิดพลาด</h2>
      <p className="text-muted-foreground text-center max-w-md">
        ระบบเกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง
      </p>
      <button
        onClick={reset}
        className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-md text-white font-medium transition-colors"
      >
        ลองใหม่อีกครั้ง
      </button>
    </div>
  );
}
