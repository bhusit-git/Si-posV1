"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import type { SessionUser } from "@/lib/auth";
import {
  Home,
  ShoppingCart,
  Undo2,
  List,
  FileText,
  Users,
  Package,
  Factory,
  Archive,
  BarChart3,
  Monitor,
  Settings,
  Menu,
  X,
  Sun,
  Moon,
  LogOut,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useUIScale, writeUIScale, type UIScale } from "@/lib/ui-scale";
import { canAccessDailyLedger } from "@/lib/daily-ledger-access";
import {
  clearSaleContinuitySession,
  markSaleContinuitySession,
  readSaleContinuitySessionUser,
} from "@/lib/sale-continuity";
import { scheduleBackgroundTask } from "@/lib/client-scheduler";
import { resetAuthenticatedUser } from "@/lib/posthog-client";
import { getPendingCount } from "@/lib/sync-engine";

type UILang = "th" | "en";

const LANG_STORAGE_KEY = "superice_ui_lang";

const navItems: {
  href: string;
  labels: Record<UILang, string>;
  icon: LucideIcon;
  allowedRoles: string[];
}[] = [
  { href: "/dashboard", labels: { th: "แดชบอร์ด", en: "Dashboard" }, icon: Home, allowedRoles: ["admin", "office"] },
  { href: "/sale", labels: { th: "ขายน้ำแข็ง", en: "Sale" }, icon: ShoppingCart, allowedRoles: ["admin", "office", "manager"] },
  { href: "/returns", labels: { th: "คืนสินค้า", en: "Returns" }, icon: Undo2, allowedRoles: ["admin", "office", "manager"] },
  { href: "/transactions", labels: { th: "รายการขาย", en: "Transactions" }, icon: List, allowedRoles: ["admin", "office", "manager"] },
  { href: "/invoice", labels: { th: "วางบิล", en: "Invoice" }, icon: FileText, allowedRoles: ["admin", "office"] },
  { href: "/daily-ledger", labels: { th: "สมุดรายวัน", en: "Daily Ledger" }, icon: FileText, allowedRoles: ["admin", "office", "manager"] },
  { href: "/customers", labels: { th: "ลูกค้า", en: "Customers" }, icon: Users, allowedRoles: ["admin", "office", "manager"] },
  { href: "/products", labels: { th: "จัดการสินค้า", en: "Products" }, icon: Package, allowedRoles: ["admin"] },
  { href: "/production", labels: { th: "ผลิต/สต็อก", en: "Production/Stock" }, icon: Factory, allowedRoles: ["admin", "office"] },
  { href: "/bags", labels: { th: "ติดตามถุง", en: "Bags" }, icon: Archive, allowedRoles: ["admin", "office"] },
  { href: "/reports", labels: { th: "รายงาน", en: "Reports" }, icon: BarChart3, allowedRoles: ["admin", "office"] },
  { href: "/audit", labels: { th: "บันทึกระบบ", en: "Audit Log" }, icon: ShieldCheck, allowedRoles: ["admin"] },
  { href: "/display", labels: { th: "หน้าจอโรงงาน", en: "Factory Display" }, icon: Monitor, allowedRoles: ["admin", "office", "manager", "factory"] },
  { href: "/settings", labels: { th: "ตั้งค่า", en: "Settings" }, icon: Settings, allowedRoles: ["admin", "office", "manager", "factory"] },
];

const shellText: Record<
  UILang,
  {
    appSubtitle: string;
    openMenuAria: string;
    textSize: string;
    sizeCompact: string;
    sizeNormal: string;
    sizeLarge: string;
    lightMode: string;
    darkMode: string;
    logout: string;
    roles: Record<string, string>;
  }
> = {
  th: {
    appSubtitle: "ระบบขายน้ำแข็ง",
    openMenuAria: "เปิดเมนู",
    textSize: "ขนาดตัวอักษร",
    sizeCompact: "เล็ก",
    sizeNormal: "ปกติ",
    sizeLarge: "ใหญ่",
    lightMode: "โหมดสว่าง",
    darkMode: "โหมดมืด",
    logout: "ออก",
    roles: {
      admin: "ผู้ดูแลระบบ",
      office: "สำนักงาน",
      manager: "ผู้จัดการ",
      factory: "โรงงาน",
    },
  },
  en: {
    appSubtitle: "Ice Sales System",
    openMenuAria: "Open menu",
    textSize: "Text size",
    sizeCompact: "Small",
    sizeNormal: "Normal",
    sizeLarge: "Large",
    lightMode: "Light mode",
    darkMode: "Dark mode",
    logout: "Logout",
    roles: {
      admin: "Administrator",
      office: "Office",
      manager: "Manager",
      factory: "Factory",
    },
  },
};

interface NotificationCounts {
  overdueCredit: number;
  highBagBalance: number;
  unresolvedHighRiskFindings: number;
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(() => {
    if (typeof window === "undefined") return null;
    return readSaleContinuitySessionUser();
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const uiScale = useUIScale();
  const [badges, setBadges] = useState<NotificationCounts>({
    overdueCredit: 0,
    highBagBalance: 0,
    unresolvedHighRiskFindings: 0,
  });
  const [lang, setLang] = useState<UILang>(() => {
    if (typeof window === "undefined") return "th";
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    return saved === "th" || saved === "en" ? saved : "th";
  });
  const [factoryName, setFactoryName] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && !data.error) {
          setUser(data);
          markSaleContinuitySession({
            username: data.username,
            role: data.role,
            factoryKey: data.factoryKey ?? null,
          });
          return;
        }
        if (typeof window !== "undefined" && !window.navigator.onLine) {
          const fallbackUser = readSaleContinuitySessionUser();
          if (fallbackUser) {
            setUser(fallbackUser);
            return;
          }
        }
        if (pathname === "/sale") {
          setUser(null);
          return;
        }
        clearSaleContinuitySession();
        router.push("/");
      })
      .catch(() => {
        {
          const fallbackUser = readSaleContinuitySessionUser();
          if (fallbackUser) {
            setUser(fallbackUser);
            return;
          }
        }
        if (pathname === "/sale") {
          setUser(null);
          return;
        }
        router.push("/");
      });
  }, [pathname, router]);

  // Fetch notification badges
  useEffect(() => {
    const cancel = scheduleBackgroundTask(async () => {
      try {
        const response = await fetch("/api/notifications");
        const data = response.ok ? await response.json() : null;
        if (data) setBadges(data);
      } catch {
        // Best effort only.
      }
    }, 250);

    return cancel;
  }, [pathname]); // refresh on route change

  // Fetch active factory info
  useEffect(() => {
    const cancel = scheduleBackgroundTask(async () => {
      try {
        const response = await fetch("/api/factory");
        const data = response.ok ? await response.json() : null;
        if (data?.multiFactory && data.factories?.length > 1) {
          const active = data.factories.find((f: { key: string; name: string }) => f.key === data.current);
          setFactoryName(active?.name || data.current);
        }
      } catch {
        // Best effort only.
      }
    }, 400);

    return cancel;
  }, [pathname]);

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

  const filteredItems = navItems.filter(
    (item) =>
      user &&
      item.allowedRoles.includes(user.role) &&
      (item.href !== "/daily-ledger" || canAccessDailyLedger(user))
  );
  const t = shellText[lang];

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
            ? "bg-white dark:bg-gray-700 text-blue-700 dark:text-blue-300 font-semibold"
            : "text-gray-600 dark:text-gray-300 hover:bg-white/70 dark:hover:bg-gray-700/60"
        )}
      >
        {label}
      </button>
    );
  }

  return (
    <>
      {/* Mobile top bar with hamburger */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex items-center h-14 px-4 print:hidden">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="p-2 -ml-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label={t.openMenuAria}
        >
          {menuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
        <h1 className="ml-3 text-lg font-bold text-blue-900 dark:text-blue-400">Super Ice</h1>
        {factoryName && (
          <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {factoryName}
          </span>
        )}
        {user && (
          <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">{user.username}</span>
        )}
      </div>

      {/* Backdrop for mobile menu */}
      {menuOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40 transition-opacity"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex flex-col h-screen fixed left-0 top-0 z-50 print:hidden transition-transform duration-200 ease-in-out w-64 md:w-56",
          // Mobile: slide in/out
          menuOpen ? "translate-x-0" : "-translate-x-full",
          // Desktop: always visible
          "md:translate-x-0"
        )}
      >
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h1 className="text-lg font-bold text-blue-900 dark:text-blue-400">Super Ice</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t.appSubtitle}</p>
          {factoryName && (
            <span className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {factoryName}
            </span>
          )}
        </div>

        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {filteredItems.map((item) => {
            const Icon = item.icon;
            // Determine badge count for this item
            let badgeCount = 0;
            if (item.href === "/invoice" && badges.overdueCredit > 0) {
              badgeCount = badges.overdueCredit;
            } else if (item.href === "/bags" && badges.highBagBalance > 0) {
              badgeCount = badges.highBagBalance;
            } else if (item.href === "/audit" && badges.unresolvedHighRiskFindings > 0) {
              badgeCount = badges.unresolvedHighRiskFindings;
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2.5 md:py-2 rounded-lg text-sm font-medium transition-colors",
                  pathname.startsWith(item.href)
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                )}
              >
                <Icon size={18} />
                {item.labels[lang]}
                {badgeCount > 0 && (
                  <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-red-500 rounded-full">
                    {badgeCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-gray-200 dark:border-gray-700 space-y-2">
          <div className="space-y-1">
            <p className="px-2 text-[11px] font-medium text-gray-500 dark:text-gray-400">
              {t.textSize}
            </p>
            <div className="flex items-center gap-1 p-1 rounded-lg bg-gray-100 dark:bg-gray-800">
              {renderScaleButton("compact", t.sizeCompact)}
              {renderScaleButton("normal", t.sizeNormal)}
              {renderScaleButton("large", t.sizeLarge)}
            </div>
          </div>
          {typeof window !== "undefined" && (
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
              {theme === "dark" ? t.lightMode : t.darkMode}
            </button>
          )}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-gray-100 dark:bg-gray-800">
            <button
              onClick={() => updateLang("th")}
              className={cn(
                "flex-1 text-xs rounded px-2 py-1 transition-colors",
                lang === "th"
                  ? "bg-white dark:bg-gray-700 text-blue-700 dark:text-blue-300 font-semibold"
                  : "text-gray-600 dark:text-gray-300 hover:bg-white/70 dark:hover:bg-gray-700/60"
              )}
            >
              TH
            </button>
            <button
              onClick={() => updateLang("en")}
              className={cn(
                "flex-1 text-xs rounded px-2 py-1 transition-colors",
                lang === "en"
                  ? "bg-white dark:bg-gray-700 text-blue-700 dark:text-blue-300 font-semibold"
                  : "text-gray-600 dark:text-gray-300 hover:bg-white/70 dark:hover:bg-gray-700/60"
              )}
            >
              EN
            </button>
          </div>
          {user && (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{user.username}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t.roles[user.role] || user.role}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                <LogOut size={14} className="mr-1" />
                {t.logout}
              </Button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
