"use client";

import { useEffect } from "react";

export default function DisplayError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Display error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white gap-6 p-8">
      <div className="text-6xl">⚠️</div>
      <h2 className="text-3xl font-bold text-red-400">ระบบขัดข้อง</h2>
      <p className="text-gray-400 text-center text-lg">
        หน้าจอแสดงผลเกิดข้อผิดพลาด กรุณารีเฟรช
      </p>
      <button
        onClick={reset}
        className="px-8 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-white text-lg font-medium transition-colors"
      >
        รีเฟรช
      </button>
    </div>
  );
}
