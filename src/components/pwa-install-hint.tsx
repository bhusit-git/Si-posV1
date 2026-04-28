"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "superice-pwa-install-dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function isStandaloneMode(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export default function PwaInstallHint() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  });
  const [standalone, setStandalone] = useState(() => isStandaloneMode());

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setDismissed(false);
    };

    const media = window.matchMedia?.("(display-mode: standalone)");
    const handleDisplayModeChange = () => setStandalone(isStandaloneMode());

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    media?.addEventListener?.("change", handleDisplayModeChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      media?.removeEventListener?.("change", handleDisplayModeChange);
    };
  }, []);

  function dismiss(): void {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DISMISS_KEY, "1");
    }
    setDismissed(true);
  }

  async function install(): Promise<void> {
    if (!deferredPrompt) {
      dismiss();
      return;
    }
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setStandalone(true);
    }
    setDeferredPrompt(null);
    dismiss();
  }

  if (standalone || dismissed) return null;

  return (
    <div className="mb-1.5 xl:mb-1 rounded-lg border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">ติดตั้ง Super Ice เป็นแอปบนเดสก์ท็อป</span>
        <span className="text-emerald-800/80">
          จะเปิดได้เหมือนแอปและเหมาะกับการใช้งานออฟไลน์มากกว่าแท็บเบราว์เซอร์
        </span>
        <div className="ml-auto flex gap-2">
          <Button type="button" size="sm" onClick={() => void install()}>
            ติดตั้งแอป
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={dismiss}>
            ซ่อน
          </Button>
        </div>
      </div>
    </div>
  );
}
