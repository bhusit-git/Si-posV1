import { SupplyShell } from "@/components/supply/shell";

export default function SupplyLayout({ children }: { children: React.ReactNode }) {
  return <SupplyShell>{children}</SupplyShell>;
}
