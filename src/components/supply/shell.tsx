"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Boxes, ClipboardList, Factory, LogOut, Moon, Package2, Settings2, Sun, Truck } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth";
import { useUIScale, writeUIScale, type UIScale } from "@/lib/ui-scale";
import { getPendingCount } from "@/lib/sync-engine";
import { resetAuthenticatedUser } from "@/lib/posthog-client";
import { clearSaleContinuitySession } from "@/lib/sale-continuity";

interface FactoryInfo {
  key: string;
  name: string;
}

type UILang = "th" | "en";

const LANG_STORAGE_KEY = "superice_ui_lang";

const navLabels: Record<
  UILang,
  Record<"/supply" | "/supply/stock" | "/supply/requests" | "/supply/transfers" | "/supply/items" | "/supply/settings", string>
> = {
  th: {
    "/supply": "ภาพรวม",
    "/supply/stock": "สต็อก",
    "/supply/requests": "ใบเบิก",
    "/supply/transfers": "โอนย้าย",
    "/supply/items": "คลังรายการ",
    "/supply/settings": "ตั้งค่า",
  },
  en: {
    "/supply": "Overview",
    "/supply/stock": "Stock",
    "/supply/requests": "Requests",
    "/supply/transfers": "Transfers",
    "/supply/items": "Catalog",
    "/supply/settings": "Settings",
  },
};

const items = [
  { href: "/supply", icon: Factory },
  { href: "/supply/stock", icon: Boxes },
  { href: "/supply/requests", icon: ClipboardList },
  { href: "/supply/transfers", icon: Truck },
  { href: "/supply/items", icon: Package2 },
  { href: "/supply/settings", icon: Settings2 },
] as const;

const sidebarCopy: Record<
  UILang,
  {
    moduleName: string;
    title: string;
    factoryPrefix: string;
    fallbackDescription: string;
    importantRuleTitle: string;
    importantRuleBody: string;
    backToModules: string;
    pendingSyncConfirm: (count: number) => string;
    loading: string;
  }
> = {
  th: {
    moduleName: "ระบบคลังพัสดุ",
    title: "คลังพัสดุ",
    factoryPrefix: "โรงงาน",
    fallbackDescription: "ภาพรวมสต็อกและการเบิกของใช้",
    importantRuleTitle: "กติกาสำคัญ",
    importantRuleBody: "อนุมัติแล้วยังไม่ตัดสต็อก ระบบจะตัดตอนจ่ายของจริงหรือส่งโอนย้ายจริงเท่านั้น",
    backToModules: "กลับหน้าหลัก",
    pendingSyncConfirm:
      (count) =>
        `ยังมีรายการขายรอซิงก์ ${count} รายการในเครื่องนี้\n\nออกจากระบบได้ แต่ต้องกลับมาเข้าสู่ระบบออนไลน์ภายหลังเพื่อซิงก์รายการเหล่านี้`,
    loading: "กำลังโหลดคลังพัสดุ...",
  },
  en: {
    moduleName: "SUPPLY MODULE",
    title: "Supply",
    factoryPrefix: "Factory",
    fallbackDescription: "Stock overview and supply requests",
    importantRuleTitle: "Important rule",
    importantRuleBody: "Approval does not deduct stock. Stock updates only when items are actually fulfilled or transferred.",
    backToModules: "Back to modules",
    pendingSyncConfirm:
      (count) =>
        `There are ${count} sales queued to sync on this device.\n\nYou can log out now, but you will need to sign in online later to sync them.`,
    loading: "Loading supply workspace...",
  },
};

const roleLabels: Record<UILang, Record<string, string>> = {
  th: {
    admin: "ผู้ดูแลระบบ",
    office: "สำนักงาน",
    manager: "ผู้จัดการ",
    factory: "โรงงาน",
  },
  en: {
    admin: "Administrator",
    office: "Office",
    manager: "Manager",
    factory: "Factory",
  },
};

export function SupplyShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const uiScale = useUIScale();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [factory, setFactory] = useState<FactoryInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState<UILang>(() => {
    if (typeof window === "undefined") return "th";
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    return saved === "th" || saved === "en" ? saved : "th";
  });

  useEffect(() => {
    Promise.all([
      fetch("/api/auth").then((response) => (response.ok ? response.json() : null)),
      fetch("/api/factory").then((response) => (response.ok ? response.json() : null)),
    ])
      .then(([session, factoryData]) => {
        if (!session) {
          router.replace("/");
          return;
        }
        if (session.role === "factory") {
          router.replace("/display");
          return;
        }
        setUser(session);
        if (factoryData?.factories?.length) {
          const active = factoryData.factories.find(
            (entry: FactoryInfo) => entry.key === factoryData.current
          );
          setFactory(active || null);
        }
        setLoading(false);
      })
      .catch(() => {
        router.replace("/");
      });
  }, [router]);

  useEffect(() => {
    document.body.setAttribute("data-dashboard-ui-scale", uiScale);
    return () => {
      document.body.removeAttribute("data-dashboard-ui-scale");
    };
  }, [uiScale]);

  const copy = sidebarCopy[lang];

  const visibleItems = useMemo(() => {
    if (!user) return [];
    return items.filter((item) => user.role === "admin" || (item.href !== "/supply/items" && item.href !== "/supply/settings"));
  }, [user]);

  function updateLang(next: UILang) {
    setLang(next);
    localStorage.setItem(LANG_STORAGE_KEY, next);
  }

  function renderScaleButton(value: UIScale, label: string) {
    return (
      <button
        type="button"
        onClick={() => writeUIScale(value)}
        className={cn(
          "flex-1 text-xs rounded px-2 py-1 transition-colors",
          uiScale === value
            ? "bg-white text-blue-700 font-semibold dark:bg-slate-700 dark:text-blue-300"
            : "text-slate-600 hover:bg-white/70 dark:text-slate-300 dark:hover:bg-slate-700/60"
        )}
      >
        {label}
      </button>
    );
  }

  async function handleLogout() {
    const queuedCount = await getPendingCount();
    if (
      queuedCount > 0 &&
      !window.confirm(copy.pendingSyncConfirm(queuedCount))
    ) {
      return;
    }
    await fetch("/api/auth", { method: "DELETE" }).catch(() => null);
    resetAuthenticatedUser();
    clearSaleContinuitySession();
    router.push("/");
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 px-6 py-16 dark:bg-gray-950">
        <div className="mx-auto max-w-6xl rounded-2xl border border-gray-200 bg-white p-10 shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <p className="text-sm text-gray-500 ui-scale-body dark:text-gray-400">{copy.loading}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <div className="mx-auto min-h-screen max-w-[1800px] md:pl-56">
        <aside
          className="flex w-full flex-col border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 md:fixed md:left-0 md:top-0 md:z-30 md:h-screen md:w-56 md:border-b-0 md:border-r print:hidden"
          data-testid="supply-sidebar"
        >
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-amber-600">{copy.moduleName}</p>
              <h1 className="mt-2 text-lg font-bold text-slate-900 dark:text-slate-100">{copy.title}</h1>
              <p className="mt-1 text-xs text-gray-500 ui-scale-page-subtitle dark:text-gray-400">
                {factory ? `${copy.factoryPrefix} ${factory.name}` : copy.fallbackDescription}
              </p>
            </div>
          </div>

          <div
            className="flex-1 min-h-0 overflow-y-auto p-2 space-y-4"
            data-testid="supply-sidebar-scroll"
          >
            <nav className="space-y-0.5">
              {visibleItems.map((item) => {
                const active = item.href === "/supply" 
                  ? pathname === item.href 
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ui-scale-body",
                      active
                        ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                    )}
                  >
                    <Icon className="size-[18px]" />
                    {navLabels[lang][item.href]}
                  </Link>
                );
              })}
            </nav>

            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              <p className="font-medium ui-scale-label">{copy.importantRuleTitle}</p>
              <p className="mt-2 text-amber-800 ui-scale-body dark:text-amber-100/90">
                {copy.importantRuleBody}
              </p>
            </div>
          </div>

          <div className="p-3 border-t border-gray-200 space-y-2 shrink-0 dark:border-gray-700" data-testid="supply-sidebar-footer">
            <Button asChild variant="outline" size="sm" className="w-full rounded-full">
              <Link href="/modules">
                <ArrowLeft className="size-4" />
                <span>{copy.backToModules}</span>
              </Link>
            </Button>

            <div className="space-y-1">
              <p className="px-2 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                {lang === "th" ? "ขนาดตัวอักษร" : "Text size"}
              </p>
              <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
                {renderScaleButton("compact", lang === "th" ? "เล็ก" : "Small")}
                {renderScaleButton("normal", lang === "th" ? "ปกติ" : "Normal")}
                {renderScaleButton("large", lang === "th" ? "ใหญ่" : "Large")}
              </div>
            </div>

            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
              {theme === "dark"
                ? lang === "th" ? "โหมดสว่าง" : "Light mode"
                : lang === "th" ? "โหมดมืด" : "Dark mode"}
            </button>

            <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
              <button
                onClick={() => updateLang("th")}
                className={cn(
                  "flex-1 text-xs rounded px-2 py-1 transition-colors",
                  lang === "th"
                    ? "bg-white text-blue-700 font-semibold dark:bg-slate-700 dark:text-blue-300"
                    : "text-slate-600 hover:bg-white/70 dark:text-slate-300 dark:hover:bg-slate-700/60"
                )}
              >
                TH
              </button>
              <button
                onClick={() => updateLang("en")}
                className={cn(
                  "flex-1 text-xs rounded px-2 py-1 transition-colors",
                  lang === "en"
                    ? "bg-white text-blue-700 font-semibold dark:bg-slate-700 dark:text-blue-300"
                    : "text-slate-600 hover:bg-white/70 dark:text-slate-300 dark:hover:bg-slate-700/60"
                )}
              >
                EN
              </button>
            </div>

            {user ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900 ui-scale-body dark:text-gray-100">{user.username}</p>
                  <p className="text-xs text-gray-500 ui-scale-label dark:text-gray-400">{roleLabels[lang][user.role] || user.role}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={handleLogout}>
                  <LogOut size={14} className="mr-1" />
                  {lang === "th" ? "ออก" : "Logout"}
                </Button>
              </div>
            ) : null}
          </div>
        </aside>

        <main className="min-w-0 p-4 md:p-6" data-testid="supply-main">
          {children}
        </main>
      </div>
    </div>
  );
}

export function SupplyPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 border-b border-slate-100 pb-5 dark:border-slate-800 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-sky-600 ui-scale-label">Supply workspace</p>
        <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-slate-900 ui-scale-page-title dark:text-slate-100">{title}</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-500 ui-scale-page-subtitle dark:text-slate-400">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
