"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { captureClientException } from "@/lib/posthog-client";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard error:", error);
    // Capture exception in PostHog
    captureClientException(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-8">
      <div className="text-6xl">⚠️</div>
      <h2 className="text-2xl font-bold text-red-600">เกิดข้อผิดพลาด</h2>
      <p className="text-muted-foreground text-center max-w-md">
        ระบบเกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง
        หากปัญหายังคงอยู่ กรุณาติดต่อผู้ดูแลระบบ
      </p>
      <Button onClick={reset} variant="default" size="lg">
        ลองใหม่อีกครั้ง
      </Button>
    </div>
  );
}
