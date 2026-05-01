"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes, ShoppingCart } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { SessionUser } from "@/lib/auth";

export default function ModuleChooserPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    fetch("/api/auth")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data || data.error) {
          router.replace("/");
          return;
        }
        if (data.role === "factory") {
          router.replace("/display");
          return;
        }
        if (data.role === "user") {
          router.replace("/user/sale");
          return;
        }
        setUser(data);
      })
      .catch(() => router.replace("/"));
  }, [router]);

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-sm text-slate-500">กำลังโหลด module...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#f8fafc,_#eef2ff_45%,_#ecfeff_100%)] px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-10">
          <p className="text-xs font-medium uppercase tracking-[0.28em] text-sky-700">
            Workspace
          </p>
          <h1 className="mt-3 font-serif text-4xl font-semibold tracking-tight text-slate-900">
            เลือกโมดูลที่ต้องการใช้งาน
          </h1>
          <p className="mt-3 text-sm text-slate-500">
            แยกงานขายกับงานคลังออกจากกันให้ชัด เพื่อให้ flow แต่ละฝั่งไม่ปะปนกัน
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:max-w-2xl">
          <ModuleCard
            href="/sale"
            title="หน้าขาย"
            description="เข้า flow ขาย, คืนสินค้า, ลูกค้า และงาน POS ประจำวัน"
            icon={ShoppingCart}
            tone="sky"
          />
          <ModuleCard
            href="/supply"
            title="คลัง"
            description="เข้า stock, ใบเบิก, transfer และ catalog ของใช้ภายใน"
            icon={Boxes}
            tone="slate"
          />
        </div>
      </div>
    </div>
  );
}

function ModuleCard({
  href,
  title,
  description,
  icon: Icon,
  tone,
}: {
  href: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "sky" | "slate";
}) {
  const accent =
    tone === "sky"
      ? "bg-sky-100 text-sky-700 border-sky-200"
      : "bg-slate-200 text-slate-700 border-slate-300";

  return (
    <Link href={href} className="group block">
      <Card className="rounded-[30px] border-slate-200 bg-white/90 shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
        <CardContent className="flex min-h-56 flex-col justify-between p-7">
          <div className={`flex h-16 w-16 items-center justify-center rounded-2xl border ${accent}`}>
            <Icon className="size-8" />
          </div>
          <div className="mt-10">
            <h2 className="text-3xl font-semibold tracking-tight text-slate-900">{title}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">{description}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
