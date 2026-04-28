export type FactoryDbKey = "si" | "bearing" | "ktk";

export interface FactoryInfo {
  key: string;
  name: string;
  envVar?: string;
}

export interface CanonicalFactoryInfo extends FactoryInfo {
  key: FactoryDbKey;
  envVar: string;
}

export const FACTORY_CONFIGS: readonly CanonicalFactoryInfo[] = [
  { key: "si", name: "SI (ซูเปอร์ไอซ์)", envVar: "DATABASE_URL_SI" },
  { key: "bearing", name: "แบริ่ง", envVar: "DATABASE_URL_BEARING" },
  { key: "ktk", name: "KTK", envVar: "DATABASE_URL_KTK" },
] as const;

export const DEFAULT_FACTORY_KEY: FactoryDbKey = "si";

export function getFactoryInfo(factoryKey: string): CanonicalFactoryInfo | null {
  const normalized = String(factoryKey || "").toLowerCase();
  return FACTORY_CONFIGS.find((factory) => factory.key === normalized) || null;
}

export function getFactoryInfoOrDefault(factoryKey: string): CanonicalFactoryInfo {
  return getFactoryInfo(factoryKey) || FACTORY_CONFIGS[0];
}
