import { getFactoryInvoiceStartSeq } from "@/lib/factory-profile";

export function getInvoiceStartSeq(factoryKey: string, year: number): number {
  return getFactoryInvoiceStartSeq(factoryKey, year);
}
