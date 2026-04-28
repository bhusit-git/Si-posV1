export type InvoiceDuplicateWorkflow = "confirm_on_issue" | "strict";

// Re-entry note:
// This flag exists so invoice duplicate handling can be loosened during rollout/testing
// and then restored to the older strict behavior without rewriting route/page logic.
// - confirm_on_issue: allow duplicate drafts, warn on issue, allow confirmed override
// - strict: block duplicate drafts and block duplicate issue with no override path
const DEFAULT_INVOICE_DUPLICATE_WORKFLOW: InvoiceDuplicateWorkflow = "confirm_on_issue";

function normalizeDuplicateWorkflow(
  rawValue: string | undefined
): InvoiceDuplicateWorkflow {
  const normalized = String(rawValue || "")
    .trim()
    .toLowerCase();

  if (
    normalized === "strict" ||
    normalized === "legacy" ||
    normalized === "disabled" ||
    normalized === "off" ||
    normalized === "false" ||
    normalized === "0"
  ) {
    return "strict";
  }

  if (
    normalized === "confirm_on_issue" ||
    normalized === "enabled" ||
    normalized === "on" ||
    normalized === "true" ||
    normalized === "1"
  ) {
    return "confirm_on_issue";
  }

  return DEFAULT_INVOICE_DUPLICATE_WORKFLOW;
}

export function getInvoiceDuplicateWorkflow(): InvoiceDuplicateWorkflow {
  return normalizeDuplicateWorkflow(
    process.env.NEXT_PUBLIC_INVOICE_DUPLICATE_WORKFLOW
  );
}

export function allowDuplicateDraftInvoices(): boolean {
  return getInvoiceDuplicateWorkflow() === "confirm_on_issue";
}

export function allowDuplicateInvoiceIssueOverride(): boolean {
  return getInvoiceDuplicateWorkflow() === "confirm_on_issue";
}
