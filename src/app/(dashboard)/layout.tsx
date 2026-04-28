"use client";

import { Sidebar } from "@/components/nav";
import { CommandPalette } from "@/components/command-palette";
import { KeyboardShortcutsModal } from "@/components/keyboard-shortcuts";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUIScale } from "@/lib/ui-scale";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const uiScale = useUIScale();

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && data.role === "factory") {
          // Factory-only users should use the display view
          router.replace("/display");
        } else {
          setAllowed(true);
        }
      })
      .catch(() => {
        // Auth check failed -- Sidebar handles redirect to login
        setAllowed(true);
      });
  }, [router]);

  useEffect(() => {
    document.body.setAttribute("data-dashboard-ui-scale", uiScale);
    return () => {
      document.body.removeAttribute("data-dashboard-ui-scale");
    };
  }, [uiScale]);

  if (!allowed) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">กำลังโหลด...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Sidebar />
      <CommandPalette />
      <KeyboardShortcutsModal />
      <main
        data-dashboard-content
        className="pt-14 md:pt-0 md:ml-56 p-4 md:p-6 min-w-0"
      >
        {children}
      </main>
    </div>
  );
}
