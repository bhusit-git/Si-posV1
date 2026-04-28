import { isInvoiceCreditCustomer } from "@/lib/transfer-utils";

export type InvoiceCreditEligibilityState = "saved" | "none";

type InvoiceCreditCustomerLike = {
  id?: number | null;
  name?: string | null;
  transferCustomer?: boolean | null;
} | null | undefined;

export function getInvoiceCreditEligibilityState(
  customer: InvoiceCreditCustomerLike
): InvoiceCreditEligibilityState {
  if (isInvoiceCreditCustomer(customer)) return "saved";
  return "none";
}

export function isActiveInvoiceCreditCustomer(
  customer: InvoiceCreditCustomerLike
): boolean {
  return getInvoiceCreditEligibilityState(customer) !== "none";
}
