"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { SessionUser } from "@/lib/auth";
import { canAccessDailyLedger } from "@/lib/daily-ledger-access";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Home,
  ShoppingCart,
  Undo2,
  List,
  ArrowRightLeft,
  FileText,
  CreditCard,
  Users,
  Package,
  Factory,
  Archive,
  BarChart3,
  Settings,
  Search,
  Printer,
  Download,
} from "lucide-react";
import {
  INVOICE_CREDIT_LABEL,
  SHORT_TERM_CREDIT_LABEL,
} from "@/lib/customer-credit-labels";

interface Customer {
  id: number;
  name: string;
}

const pages = [
  { href: "/dashboard", label: "แดชบอร์ด", icon: Home, keywords: "dashboard home หน้าหลัก", allowedRoles: ["admin", "office"] },
  { href: "/sale", label: "ขายน้ำแข็ง", icon: ShoppingCart, keywords: "sale pos ขาย", allowedRoles: ["admin", "office", "manager"] },
  { href: "/returns", label: "คืนสินค้า", icon: Undo2, keywords: "return คืน", allowedRoles: ["admin", "office", "manager"] },
  { href: "/transactions", label: "รายการขาย", icon: List, keywords: "transaction history รายการ ประวัติ", allowedRoles: ["admin", "office", "manager"] },
  { href: "/invoice?tab=transfers", label: `${INVOICE_CREDIT_LABEL} / ปิดยอดบัญชี`, icon: ArrowRightLeft, keywords: "accounting settle โอน ปิดยอด บัญชี เครดิต", allowedRoles: ["admin", "office"] },
  { href: "/invoice", label: "วางบิล", icon: FileText, keywords: "invoice billing วางบิล", allowedRoles: ["admin", "office"] },
  { href: "/daily-ledger", label: "สมุดรายวัน", icon: FileText, keywords: "daily ledger สมุดรายวัน รายวัน", allowedRoles: ["admin", "office", "manager"] },
  { href: "/invoice?tab=credit", label: SHORT_TERM_CREDIT_LABEL, icon: CreditCard, keywords: "credit outstanding ค้าง หนี้", allowedRoles: ["admin", "office"] },
  { href: "/customers", label: "ลูกค้า", icon: Users, keywords: "customer ลูกค้า", allowedRoles: ["admin", "office", "manager"] },
  { href: "/products", label: "จัดการสินค้า", icon: Package, keywords: "product สินค้า", allowedRoles: ["admin"] },
  { href: "/production", label: "ผลิต/สต็อก", icon: Factory, keywords: "production stock ผลิต สต็อก", allowedRoles: ["admin", "office"] },
  { href: "/bags", label: "ติดตามถุง", icon: Archive, keywords: "bag ถุง", allowedRoles: ["admin", "office"] },
  { href: "/reports", label: "รายงาน", icon: BarChart3, keywords: "report รายงาน สรุป", allowedRoles: ["admin", "office"] },
  { href: "/settings", label: "ตั้งค่า", icon: Settings, keywords: "settings ตั้งค่า password", allowedRoles: ["admin", "office", "manager", "factory"] },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) =>
        setSessionUser(
          data &&
            typeof data?.role === "string" &&
            typeof data?.username === "string" &&
            typeof data?.id === "number"
            ? {
                id: data.id,
                username: data.username,
                role: data.role,
                factoryKey:
                  typeof data?.factoryKey === "string" && data.factoryKey.length > 0
                    ? data.factoryKey
                    : null,
              }
            : null
        )
      )
      .catch(() => setSessionUser(null));
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Search customers when user types 2+ characters
  const searchCustomers = useCallback(async (query: string) => {
    const trimmed = query.trim();
    const numeric = trimmed.startsWith("#") ? trimmed.slice(1).trim() : trimmed;
    const isNumeric = /^\d+$/.test(numeric);
    if (trimmed.length < 2 && !isNumeric) {
      setCustomers([]);
      return;
    }
    try {
      const res = await fetch(`/api/customers?search=${encodeURIComponent(trimmed)}`);
      if (res.ok) {
        const data = await res.json();
        setCustomers(data.slice(0, 5));
      }
    } catch {
      setCustomers([]);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => searchCustomers(search), 250);
    return () => clearTimeout(timer);
  }, [search, searchCustomers]);

  function navigate(href: string) {
    setOpen(false);
    setSearch("");
    router.push(href);
  }

  const visiblePages = pages.filter(
    (page) =>
      sessionUser &&
      page.allowedRoles.includes(sessionUser.role) &&
      (page.href !== "/daily-ledger" || canAccessDailyLedger(sessionUser))
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setSearch("");
      }}
      title="ค้นหา"
      description="ค้นหาหน้า ลูกค้า หรือคำสั่ง"
    >
      <CommandInput
        placeholder="ค้นหาหน้า ลูกค้า หรือคำสั่ง..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>ไม่พบผลลัพธ์</CommandEmpty>

        <CommandGroup heading="หน้า">
          {visiblePages.map((page) => {
            const Icon = page.icon;
            return (
              <CommandItem
                key={page.href}
                value={`${page.label} ${page.keywords}`}
                onSelect={() => navigate(page.href)}
              >
                <Icon size={16} />
                <span>{page.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        {customers.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="ลูกค้า">
              {customers.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`customer-${c.id} ${c.name}`}
                  onSelect={() => navigate(`/customers/${c.id}`)}
                >
                  <Search size={16} />
                  <span>{c.name}</span>
                  <CommandShortcut>#{c.id}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading="คำสั่ง">
          <CommandItem
            value="new-sale เปิดหน้าขาย"
            onSelect={() => navigate("/sale")}
          >
            <ShoppingCart size={16} />
            <span>เปิดหน้าขาย</span>
          </CommandItem>
          <CommandItem
            value="print-report พิมพ์รายงาน"
            onSelect={() => {
              setOpen(false);
              router.push("/reports");
            }}
          >
            <Printer size={16} />
            <span>พิมพ์รายงาน</span>
          </CommandItem>
          <CommandItem
            value="export-data ส่งออกข้อมูล"
            onSelect={() => {
              setOpen(false);
              router.push("/reports");
            }}
          >
            <Download size={16} />
            <span>ส่งออกข้อมูล</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
