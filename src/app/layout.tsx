import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { PostHogAuthBridge } from "@/components/posthog-auth-bridge";
import "./globals.css";

export const metadata: Metadata = {
  title: "Super Ice (SI) - ระบบขายน้ำแข็ง",
  description: "ระบบจัดการขายน้ำแข็ง Super Ice",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Super Ice",
  },
  other: {
    "mobile-web-app-capable": "yes",
    google: "notranslate",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#1e40af",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" translate="no" className="notranslate" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icon-192.svg" />
      </head>
      <body className="notranslate font-sans antialiased">
        <PostHogAuthBridge />
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster position="top-right" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
