"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { scheduleBackgroundTask } from "@/lib/client-scheduler";
import {
  markLoginResponseReceived,
  markLoginSubmitStarted,
} from "@/lib/sale-readiness";
import { identifyAuthenticatedUser } from "@/lib/posthog-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  markSaleContinuitySession,
  readSaleContinuitySession,
} from "@/lib/sale-continuity";
import { getOfflineReferenceCacheStatus } from "@/lib/offline-reference-cache";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [hasOfflineSession, setHasOfflineSession] = useState(false);
  const [offlineSaleReady, setOfflineSaleReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsOnline(window.navigator.onLine);
    const session = readSaleContinuitySession();
    setHasOfflineSession(session != null);
    void getOfflineReferenceCacheStatus(session?.factoryKey ?? null).then((status) => {
      setOfflineSaleReady(status.ready);
    });

    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    markLoginSubmitStarted();

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "เกิดข้อผิดพลาด");
        return;
      }

      const data = await res.json();
      markLoginResponseReceived();
      markSaleContinuitySession({
        username: data.username,
        role: data.role,
        factoryKey: data.factoryKey ?? null,
      });
      identifyAuthenticatedUser({
        id: Number(data.id),
        role: data.role,
        factoryKey: data.factoryKey ?? null,
      });
      setHasOfflineSession(true);
      setOfflineSaleReady(true);
      const nextRoute =
        data.role === "factory"
          ? "/display"
          : data.role === "user"
            ? "/user/sale"
            : "/sale";
      router.push(nextRoute);

      scheduleBackgroundTask(async () => {
        try {
          const { ensureOfflineReferenceCacheWarm } = await import(
            "@/lib/offline-reference-cache"
          );
          await ensureOfflineReferenceCacheWarm();
        } catch {
          // Best effort. Navigation should not wait on background cache refresh.
        }
      }, 250);
    } catch {
      setError("ไม่สามารถเชื่อมต่อได้");
    } finally {
      setLoading(false);
    }
  }

  function openOfflineSale(): void {
    router.push("/sale");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-cyan-100">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mb-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-8 h-8"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <CardTitle className="text-2xl font-bold text-blue-900">
            Super Ice (SI)
          </CardTitle>
          <CardDescription className="text-base">
            ระบบขายน้ำแข็ง
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!isOnline && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">อุปกรณ์นี้กำลังออฟไลน์</p>
              {hasOfflineSession ? (
                <>
                  <p className="mt-1">
                    {offlineSaleReady
                      ? "เครื่องนี้เคยเข้าสู่ระบบแล้ว คุณสามารถเปิดหน้าขายที่แคชไว้เพื่อทำรายการออฟไลน์ได้"
                      : "เครื่องนี้เคยเข้าสู่ระบบแล้ว แต่ยังไม่มีข้อมูลขายออฟไลน์ครบ ต้องล็อกอินออนไลน์อีกครั้งเพื่อเตรียมข้อมูลเครื่อง"}
                  </p>
                  {offlineSaleReady ? (
                    <Button type="button" className="mt-3 w-full" onClick={openOfflineSale}>
                      เปิดหน้าขายออฟไลน์
                    </Button>
                  ) : null}
                </>
              ) : (
                <p className="mt-1">
                  ต้องเชื่อมต่ออินเทอร์เน็ตเพื่อเข้าสู่ระบบครั้งแรกก่อน แล้วจึงจะกลับมาใช้งานออฟไลน์ได้
                </p>
              )}
            </div>
          )}
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">ชื่อผู้ใช้</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ชื่อผู้ใช้"
                required
                autoFocus
                disabled={!isOnline}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">รหัสผ่าน</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="รหัสผ่าน"
                required
                disabled={!isOnline}
              />
            </div>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 p-2 rounded">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" size="lg" disabled={loading || !isOnline}>
              {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
