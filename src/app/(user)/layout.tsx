"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth";
import { clearSaleContinuitySession } from "@/lib/sale-continuity";
import { resetAuthenticatedUser } from "@/lib/posthog-client";
import { getPendingCount } from "@/lib/sync-engine";

export default function UserLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || data.error) {
          router.push("/");
          return;
        }
        // Admin should use the full dashboard
        if (data.role === "admin") {
          router.push("/dashboard");
          return;
        }
        setUser(data);
      })
      .catch(() => router.push("/"));
  }, [router]);

  async function handleLogout() {
    const queuedCount = await getPendingCount();
    if (
      queuedCount > 0 &&
      !window.confirm(
        `ยังมีรายการขายรอซิงก์ ${queuedCount} รายการในเครื่องนี้\n\nออกจากระบบได้ แต่ต้องกลับมาเข้าสู่ระบบออนไลน์ภายหลังเพื่อซิงก์รายการเหล่านี้`
      )
    ) {
      return;
    }
    await fetch("/api/auth", { method: "DELETE" }).catch(() => null);
    resetAuthenticatedUser();
    clearSaleContinuitySession();
    router.push("/");
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">กำลังโหลด...</p>
      </div>
    );
  }

  const tabs = [
    {
      href: "/user/sale",
      label: "ขาย",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
      ),
    },
    {
      href: "/user/transactions",
      label: "รายการ",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="fixed top-0 left-0 right-0 z-40 bg-white border-b border-gray-200 flex items-center h-12 px-3 print:hidden">
        <h1 className="text-base font-bold text-blue-900">Super Ice</h1>
        <span className="ml-auto text-xs text-gray-500 mr-2">{user.username}</span>
        <button
          onClick={handleLogout}
          className="text-xs text-gray-400 hover:text-red-600 transition-colors p-1"
          aria-label="ออกจากระบบ"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </button>
      </div>

      {/* Content */}
      <main className="pt-12 pb-16">{children}</main>

      {/* Bottom tab bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 flex print:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        {tabs.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex-1 flex flex-col items-center justify-center py-1.5 text-xs font-medium transition-colors",
                active ? "text-blue-600" : "text-gray-400 hover:text-gray-600"
              )}
            >
              {tab.icon}
              <span className="mt-0.5">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
