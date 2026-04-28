export const POSTHOG_APP = "superice-pos";
export const POSTHOG_SCHEMA_VERSION = 2;

export const AUTH_LOGIN_SUCCEEDED_EVENT = "auth.login.succeeded";
export const AUTH_LOGOUT_EVENT = "auth.logout";
export const BACKUP_DOWNLOADED_EVENT = "backup.downloaded";
export const CUSTOMER_CREATED_EVENT = "customer.created";
export const INVOICE_DRAFT_CREATED_EVENT = "invoice.draft_created";
export const INVOICE_ISSUED_EVENT = "invoice.issued";
export const INVOICE_PAYMENT_RECORDED_EVENT = "invoice.payment_recorded";
export const INVOICE_VOIDED_EVENT = "invoice.voided";
export const SALE_PAYMENT_RECORDED_EVENT = "sale.payment.recorded";
export const SALE_RETURN_COMPLETED_EVENT = "sale.return.completed";

export type AnalyticsEventOrigin = "client" | "server";

export interface AnalyticsActorContext {
  actorUserId: number | null;
  actorRole: string | null;
  factoryKey: string | null;
}

export interface AnalyticsBaseProperties {
  schema_version: number;
  app: string;
  event_origin: AnalyticsEventOrigin;
  factory_key: string | null;
  actor_user_id: number | null;
  actor_role: string | null;
}

type WithBaseProperties<T extends Record<string, unknown>> = AnalyticsBaseProperties & T;

export function buildAuthenticatedDistinctId(userId: number): string {
  return `user:${userId}`;
}

export function buildAnalyticsBaseProperties(input: {
  eventOrigin: AnalyticsEventOrigin;
  actorUserId: number | null;
  actorRole: string | null;
  factoryKey: string | null;
}): AnalyticsBaseProperties {
  return {
    schema_version: POSTHOG_SCHEMA_VERSION,
    app: POSTHOG_APP,
    event_origin: input.eventOrigin,
    factory_key: input.factoryKey ?? null,
    actor_user_id: input.actorUserId ?? null,
    actor_role: input.actorRole ?? null,
  };
}

export function buildAuthLoginSucceededProperties(
  context: AnalyticsActorContext
): AnalyticsBaseProperties {
  return buildAnalyticsBaseProperties({
    eventOrigin: "server",
    actorUserId: context.actorUserId,
    actorRole: context.actorRole,
    factoryKey: context.factoryKey,
  });
}

export function buildAuthLogoutProperties(
  context: AnalyticsActorContext
): AnalyticsBaseProperties {
  return buildAnalyticsBaseProperties({
    eventOrigin: "server",
    actorUserId: context.actorUserId,
    actorRole: context.actorRole,
    factoryKey: context.factoryKey,
  });
}

export function buildBackupDownloadedProperties(input: AnalyticsActorContext & {
  scope: string;
  format: string;
}): WithBaseProperties<{
  scope: string;
  format: string;
}> {
  return {
    ...buildAnalyticsBaseProperties({
      eventOrigin: "server",
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      factoryKey: input.factoryKey,
    }),
    scope: input.scope,
    format: input.format,
  };
}

export function buildCustomerCreatedProperties(input: AnalyticsActorContext & {
  customerId: number;
  creditEnabled: boolean;
  transferCustomer: boolean;
  priceRowsCount: number;
  pricedProductCount: number;
}): WithBaseProperties<{
  customer_id: number;
  credit_enabled: boolean;
  transfer_customer: boolean;
  price_rows_count: number;
  priced_product_count: number;
}> {
  return {
    ...buildAnalyticsBaseProperties({
      eventOrigin: "server",
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      factoryKey: input.factoryKey,
    }),
    customer_id: input.customerId,
    credit_enabled: input.creditEnabled,
    transfer_customer: input.transferCustomer,
    price_rows_count: input.priceRowsCount,
    priced_product_count: input.pricedProductCount,
  };
}

export function buildSalePaymentRecordedProperties(input: AnalyticsActorContext & {
  transactionId: number;
  customerId: number | null;
  paymentAmount: number;
  previousPaid: number;
  newPaid: number;
  newStatus: string;
  outstandingAfterPayment: number;
  paymentDirection: string;
  backToCredit: boolean;
}): WithBaseProperties<{
  transaction_id: number;
  customer_id: number | null;
  payment_amount: number;
  previous_paid: number;
  new_paid: number;
  new_status: string;
  outstanding_after_payment: number;
  payment_direction: string;
  back_to_credit: boolean;
}> {
  return {
    ...buildAnalyticsBaseProperties({
      eventOrigin: "server",
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      factoryKey: input.factoryKey,
    }),
    transaction_id: input.transactionId,
    customer_id: input.customerId,
    payment_amount: input.paymentAmount,
    previous_paid: input.previousPaid,
    new_paid: input.newPaid,
    new_status: input.newStatus,
    outstanding_after_payment: input.outstandingAfterPayment,
    payment_direction: input.paymentDirection,
    back_to_credit: input.backToCredit,
  };
}

export function buildSaleReturnCompletedProperties(input: AnalyticsActorContext & {
  returnTransactionId: number;
  customerId: number;
  totalRefund: number;
  returnedItemQty: number;
  returnedItemLines: number;
  bagsReversedFromItems: number;
  bagsReturnedManual: number;
  refundAppliedToOutstanding: number;
  unappliedRefundCredit: number;
  originalBillId: number | null;
  originalBillKind: string | null;
  invoiceCreditReturn: boolean;
  allocationCount: number;
  printedBillNumber: number | null;
  billNumber: string;
}): WithBaseProperties<{
  return_transaction_id: number;
  customer_id: number;
  total_refund: number;
  returned_item_qty: number;
  returned_item_lines: number;
  bags_reversed_from_items: number;
  bags_returned_manual: number;
  refund_applied_to_outstanding: number;
  unapplied_refund_credit: number;
  original_bill_id: number | null;
  original_bill_kind: string | null;
  invoice_credit_return: boolean;
  allocation_count: number;
  printed_bill_number: number | null;
  bill_number: string;
}> {
  return {
    ...buildAnalyticsBaseProperties({
      eventOrigin: "server",
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      factoryKey: input.factoryKey,
    }),
    return_transaction_id: input.returnTransactionId,
    customer_id: input.customerId,
    total_refund: input.totalRefund,
    returned_item_qty: input.returnedItemQty,
    returned_item_lines: input.returnedItemLines,
    bags_reversed_from_items: input.bagsReversedFromItems,
    bags_returned_manual: input.bagsReturnedManual,
    refund_applied_to_outstanding: input.refundAppliedToOutstanding,
    unapplied_refund_credit: input.unappliedRefundCredit,
    original_bill_id: input.originalBillId,
    original_bill_kind: input.originalBillKind,
    invoice_credit_return: input.invoiceCreditReturn,
    allocation_count: input.allocationCount,
    printed_bill_number: input.printedBillNumber,
    bill_number: input.billNumber,
  };
}

export function buildInvoiceDraftCreatedProperties(input: AnalyticsActorContext & {
  invoiceId: number;
  customerId: number;
  periodStart: string;
  periodEnd: string;
  includeKinds: string[];
  lineCount: number;
  subtotal: number;
  vatEnabled: boolean;
  vatAmount: number;
  grandTotal: number;
  selectedTransactionCount: number;
  idempotentReplay: boolean;
}): WithBaseProperties<{
  invoice_id: number;
  customer_id: number;
  period_start: string;
  period_end: string;
  include_kinds: string[];
  line_count: number;
  subtotal: number;
  vat_enabled: boolean;
  vat_amount: number;
  grand_total: number;
  selected_transaction_count: number;
  idempotent_replay: boolean;
}> {
  return {
    ...buildAnalyticsBaseProperties({
      eventOrigin: "server",
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      factoryKey: input.factoryKey,
    }),
    invoice_id: input.invoiceId,
    customer_id: input.customerId,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    include_kinds: input.includeKinds,
    line_count: input.lineCount,
    subtotal: input.subtotal,
    vat_enabled: input.vatEnabled,
    vat_amount: input.vatAmount,
    grand_total: input.grandTotal,
    selected_transaction_count: input.selectedTransactionCount,
    idempotent_replay: input.idempotentReplay,
  };
}

export function buildInvoiceIssuedProperties(input: AnalyticsActorContext & {
  invoiceId: number;
  invoiceNo: string | null;
  issueDate: string | null;
  dueDate: string | null;
  idempotentReplay: boolean;
}): WithBaseProperties<{
  invoice_id: number;
  invoice_no: string | null;
  issue_date: string | null;
  due_date: string | null;
  idempotent_replay: boolean;
}> {
  return {
    ...buildAnalyticsBaseProperties({
      eventOrigin: "server",
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      factoryKey: input.factoryKey,
    }),
    invoice_id: input.invoiceId,
    invoice_no: input.invoiceNo,
    issue_date: input.issueDate,
    due_date: input.dueDate,
    idempotent_replay: input.idempotentReplay,
  };
}

export function buildInvoicePaymentRecordedProperties(input: AnalyticsActorContext & {
  invoiceId: number;
  paymentId: number;
  amount: number;
  method: string;
  paidTotalAfter: number;
  outstandingAfter: number;
  invoiceStatusAfter: string;
  allocationCount: number;
  unallocatedAmount: number;
  idempotentReplay: boolean;
}): WithBaseProperties<{
  invoice_id: number;
  payment_id: number;
  amount: number;
  method: string;
  paid_total_after: number;
  outstanding_after: number;
  invoice_status_after: string;
  allocation_count: number;
  unallocated_amount: number;
  idempotent_replay: boolean;
}> {
  return {
    ...buildAnalyticsBaseProperties({
      eventOrigin: "server",
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      factoryKey: input.factoryKey,
    }),
    invoice_id: input.invoiceId,
    payment_id: input.paymentId,
    amount: input.amount,
    method: input.method,
    paid_total_after: input.paidTotalAfter,
    outstanding_after: input.outstandingAfter,
    invoice_status_after: input.invoiceStatusAfter,
    allocation_count: input.allocationCount,
    unallocated_amount: input.unallocatedAmount,
    idempotent_replay: input.idempotentReplay,
  };
}

export function buildInvoiceVoidedProperties(input: AnalyticsActorContext & {
  invoiceId: number;
  paidTotalBeforeReversal: number;
  reversalPaymentCount: number;
  allocationReversalCount: number;
  idempotentReplay: boolean;
}): WithBaseProperties<{
  invoice_id: number;
  paid_total_before_reversal: number;
  reversal_payment_count: number;
  allocation_reversal_count: number;
  idempotent_replay: boolean;
}> {
  return {
    ...buildAnalyticsBaseProperties({
      eventOrigin: "server",
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      factoryKey: input.factoryKey,
    }),
    invoice_id: input.invoiceId,
    paid_total_before_reversal: input.paidTotalBeforeReversal,
    reversal_payment_count: input.reversalPaymentCount,
    allocation_reversal_count: input.allocationReversalCount,
    idempotent_replay: input.idempotentReplay,
  };
}

export function buildTransactionVoidedProperties(input: AnalyticsActorContext & {
  transactionId: number;
  customerId: number | null;
  totalAmount: number;
  voidedByUserId: number;
}): WithBaseProperties<{
  transaction_id: number;
  customer_id: number | null;
  total_amount: number;
  voided_by_user_id: number;
}> {
  return {
    ...buildAnalyticsBaseProperties({
      eventOrigin: "server",
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      factoryKey: input.factoryKey,
    }),
    transaction_id: input.transactionId,
    customer_id: input.customerId,
    total_amount: input.totalAmount,
    voided_by_user_id: input.voidedByUserId,
  };
}
