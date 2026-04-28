"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, Factory, Radio } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

export default function DisplayLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [homeHref, setHomeHref] = useState<string | null>(null);

  const tabs = [
    { href: "/display", label: "หน้าจอโหลด" },
    { href: "/display/manager", label: "จัดการออเดอร์" },
    { href: "/display/bays", label: "บอร์ด 6 Bay" },
    { href: "/display/summary", label: "สรุปโหลด" },
  ];

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SessionUser | null) => {
        if (data?.role === "admin" || data?.role === "office") {
          setHomeHref("/dashboard");
          return;
        }
        if (data?.role === "manager") {
          setHomeHref("/sale");
          return;
        }
        setHomeHref(null);
      })
      .catch(() => setHomeHref(null));
  }, []);

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fbff_0%,#eef5ff_38%,#f6f8fc_100%)] text-slate-950 flex flex-col">
      <header className="sticky top-0 z-30 shrink-0 border-b border-slate-200/80 bg-white/92 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1680px] items-center justify-between gap-4 px-4 py-4 md:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm shadow-blue-200">
              <Factory size={22} />
            </div>
            {homeHref && (
              <Link
                href={homeHref}
                className="flex min-h-[48px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-900"
                title="กลับหน้าหลัก"
              >
                <ArrowLeft size={18} />
                <span className="hidden sm:inline">กลับ</span>
              </Link>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-semibold text-slate-950 md:text-xl">
                  Super Ice Factory
                </h1>
                <span className="hidden rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 sm:inline-flex">
                  Light Display
                </span>
              </div>
              <p className="flex items-center gap-1.5 text-sm text-slate-500">
                <Radio size={14} className="text-emerald-500" />
                อัปเดตสถานะออเดอร์อัตโนมัติสำหรับหน้าจอโรงงาน
              </p>
            </div>
          </div>

          <nav className="flex flex-wrap items-center justify-end gap-2">
            {tabs.map((tab) => {
              const isActive =
                tab.href === "/display"
                  ? pathname === "/display"
                  : pathname.startsWith(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={cn(
                    "flex min-h-[52px] items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition-all md:px-5 md:text-base",
                    isActive
                      ? "border-blue-600 bg-blue-600 text-white shadow-lg shadow-blue-200"
                      : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white hover:text-slate-950"
                  )}
                >
                  <span>{tab.label}</span>
                  {isActive ? <ChevronRight size={16} /> : null}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[1680px] px-4 py-6 md:px-6 md:py-8 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  );
}
