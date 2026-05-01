import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  doublePrecision,
  date,
  time,
  timestamp,
  index,
  uniqueIndex,
  pgEnum,
  jsonb,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { productTypes, users } from "./core";

// ==================== Enums ====================
export const transactionStatusEnum = pgEnum("transaction_status", [
  "paid",
  "unpaid",
  "partial",
  "voided",
]);

export const bagLedgerTypeEnum = pgEnum("bag_ledger_type", [
  "out",
  "return",
  "adjust",
]);

export const fulfillmentStatusEnum = pgEnum("fulfillment_status", [
  "pending",
  "loaded",
]);

export const transactionKindEnum = pgEnum("transaction_kind", [
  "sale",
  "transfer_out",
  "return",
  "adjustment",
]);

export const transferAccountingStatusEnum = pgEnum("transfer_accounting_status", [
  "open",
  "closed",
]);

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "issued",
  "paid",
  "void",
]);

export const invoiceLineTypeEnum = pgEnum("invoice_line_type", [
  "sale",
  "return",
]);

export const invoicePaymentMethodEnum = pgEnum("invoice_payment_method", [
  "cash",
  "bank_transfer",
  "cheque",
  "other",
]);

export const sourceSystemEnum = pgEnum("source_system", [
  "access_mdb",
  "sqlite_legacy",
  "app_pos",
  "api_import",
  "manual_adjustment",
]);

// ==================== Import Batches ====================
export const importBatches = pgTable(
  "import_batches",
  {
    id: serial("id").primaryKey(),
    sourceSystem: sourceSystemEnum("source_system").notNull(),
    sourceFactory: text("source_factory"),
    sourceFile: text("source_file"),
    status: text("status").notNull().default("completed"),
    rowCount: integer("row_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    metadata: jsonb("metadata"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_import_batches_source").on(table.sourceSystem, table.sourceFactory),
    index("idx_import_batches_status").on(table.status),
  ]
);

// ==================== Customers ====================
export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone"),
  credit: boolean("credit").notNull().default(false),
  transferCustomer: boolean("transfer_customer").notNull().default(false),
  sourceSystem: sourceSystemEnum("source_system"),
  sourceFactory: text("source_factory"),
  sourceFile: text("source_file"),
  sourceRowKey: text("source_row_key"),
  importBatchId: integer("import_batch_id").references(() => importBatches.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ==================== Customer Prices ====================
export const customerPrices = pgTable(
  "customer_prices",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id),
    productTypeId: integer("product_type_id")
      .notNull()
      .references(() => productTypes.id),
    unitPrice: doublePrecision("unit_price").notNull().default(0),
    bagDeposit: doublePrecision("bag_deposit").notNull().default(0),
  },
  (table) => [
    index("idx_customer_prices_customer_id").on(table.customerId),
    uniqueIndex("idx_customer_prices_customer_product").on(
      table.customerId,
      table.productTypeId
    ),
  ]
);

// ==================== Transactions ====================
export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id),
    totalAmount: doublePrecision("total_amount").notNull().default(0),
    paid: doublePrecision("paid").notNull().default(0),
    outstandingAmount: doublePrecision("outstanding_amount").notNull().default(0),
    status: transactionStatusEnum("status").notNull().default("paid"),
    transactionKind: transactionKindEnum("transaction_kind").notNull().default("sale"),
    pool: integer("pool"),
    row: integer("row"),
    col: integer("col"),
    saleDate: date("sale_date", { mode: "string" }).notNull(),
    saleTime: time("sale_time", { precision: 0 }).notNull(),
    note: text("note"),
    printedBillNumber: integer("printed_bill_number"),
    transferRef: text("transfer_ref"),
    transferDestination: text("transfer_destination"),
    transferTruck: text("transfer_truck"),
    transferAccountingStatus: transferAccountingStatusEnum("transfer_accounting_status"),
    originalTransactionId: integer("original_transaction_id").references(
      (): AnyPgColumn => transactions.id
    ),
    sourceSystem: sourceSystemEnum("source_system"),
    sourceFactory: text("source_factory"),
    sourceFile: text("source_file"),
    sourceRowKey: text("source_row_key"),
    importBatchId: integer("import_batch_id").references(() => importBatches.id),
    fulfillment: fulfillmentStatusEnum("fulfillment"),
    createdBy: integer("created_by"),
    voidedBy: integer("voided_by"),
    voidReason: text("void_reason"),
    clientId: text("client_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_transactions_customer_id").on(table.customerId),
    index("idx_transactions_sale_date").on(table.saleDate),
    index("idx_transactions_status").on(table.status),
    index("idx_transactions_kind_status_date").on(
      table.transactionKind,
      table.status,
      table.saleDate
    ),
    index("idx_transactions_printed_bill_number").on(table.printedBillNumber),
    index("idx_transactions_transfer_ref").on(table.transferRef),
    index("idx_transactions_outstanding_amount").on(table.customerId, table.outstandingAmount),
    index("idx_transactions_date_status").on(table.saleDate, table.status),
    index("idx_transactions_fulfillment").on(table.fulfillment),
    uniqueIndex("idx_transactions_client_id").on(table.clientId),
  ]
);

// ==================== Production Logs ====================
export const productionLogs = pgTable("production_logs", {
  id: serial("id").primaryKey(),
  productTypeId: integer("product_type_id")
    .notNull()
    .references(() => productTypes.id),
  quantity: doublePrecision("quantity").notNull().default(0),
  note: text("note"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ==================== Transaction Items ====================
export const transactionItems = pgTable(
  "transaction_items",
  {
    id: serial("id").primaryKey(),
    transactionId: integer("transaction_id")
      .notNull()
      .references(() => transactions.id),
    productTypeId: integer("product_type_id")
      .notNull()
      .references(() => productTypes.id),
    quantity: doublePrecision("quantity").notNull().default(0),
    unitPrice: doublePrecision("unit_price").notNull().default(0),
    subtotal: doublePrecision("subtotal").notNull().default(0),
    loadedQty: doublePrecision("loaded_qty").notNull().default(0),
  },
  (table) => [
    index("idx_transaction_items_transaction_id").on(table.transactionId),
    index("idx_transaction_items_product_type_id").on(table.productTypeId),
  ]
);

// ==================== Bag Ledger ====================
export const bagLedger = pgTable(
  "bag_ledger",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id),
    productTypeId: integer("product_type_id")
      .notNull()
      .references(() => productTypes.id),
    type: bagLedgerTypeEnum("type").notNull(),
    quantity: integer("quantity").notNull().default(0),
    transactionId: integer("transaction_id").references(() => transactions.id),
    note: text("note"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_bag_ledger_customer_id").on(table.customerId),
    index("idx_bag_ledger_transaction_id").on(table.transactionId),
    index("idx_bag_ledger_customer_product").on(
      table.customerId,
      table.productTypeId
    ),
  ]
);

// ==================== Audit Log ====================
export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    username: text("username").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: integer("entity_id"),
    details: jsonb("details"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_audit_log_entity").on(table.entity, table.entityId),
    index("idx_audit_log_user").on(table.userId),
    index("idx_audit_log_created").on(table.createdAt),
  ]
);

// ==================== Migrate Audit Log ====================
export const migrateAuditLog = pgTable(
  "migrate_audit_log",
  {
    id: serial("id").primaryKey(),
    actionName: text("action_name").notNull(),
    factoryScope: text("factory_scope").notNull(),
    factoryKeys: jsonb("factory_keys").notNull(),
    dbTarget: text("db_target").notNull(),
    mutationType: text("mutation_type").notNull(),
    dryRun: boolean("dry_run").notNull().default(false),
    callerIp: text("caller_ip"),
    actorIdentifier: text("actor_identifier"),
    confirmationProvided: boolean("confirmation_provided").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    success: boolean("success").notNull(),
    summary: jsonb("summary"),
    errorMessage: text("error_message"),
  },
  (table) => [
    index("idx_migrate_audit_log_action_started").on(table.actionName, table.startedAt),
    index("idx_migrate_audit_log_success_started").on(table.success, table.startedAt),
  ]
);

// ==================== Audit Findings ====================
export const auditFindings = pgTable(
  "audit_findings",
  {
    id: serial("id").primaryKey(),
    fingerprint: text("fingerprint").notNull(),
    ruleKey: text("rule_key").notNull(),
    category: text("category").notNull(),
    severity: text("severity").notNull(),
    riskScore: integer("risk_score").notNull().default(0),
    status: text("status").notNull().default("open"),
    entity: text("entity").notNull(),
    entityId: integer("entity_id"),
    userId: integer("user_id"),
    username: text("username"),
    customerId: integer("customer_id"),
    transactionId: integer("transaction_id"),
    title: text("title").notNull(),
    reason: text("reason").notNull(),
    evidence: jsonb("evidence"),
    reviewNote: text("review_note"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_audit_findings_fingerprint").on(table.fingerprint),
    index("idx_audit_findings_status_severity").on(table.status, table.severity),
    index("idx_audit_findings_category_status").on(table.category, table.status),
    index("idx_audit_findings_transaction").on(table.transactionId, table.lastSeenAt),
    index("idx_audit_findings_customer").on(table.customerId, table.lastSeenAt),
    index("idx_audit_findings_last_seen").on(table.lastSeenAt),
  ]
);

// ==================== Invoice Counters ====================
export const billCounters = pgTable(
  "bill_counters",
  {
    id: serial("id").primaryKey(),
    factoryKey: text("factory_key").notNull(),
    nextNumber: integer("next_number").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("idx_bill_counters_factory").on(table.factoryKey)]
);

// ==================== Invoice Counters ====================
export const invoiceCounters = pgTable(
  "invoice_counters",
  {
    id: serial("id").primaryKey(),
    factoryKey: text("factory_key").notNull(),
    year: integer("year").notNull(),
    nextNumber: integer("next_number").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_invoice_counters_factory_year").on(table.factoryKey, table.year),
  ]
);

// ==================== Invoices ====================
export const invoices = pgTable(
  "invoices",
  {
    id: serial("id").primaryKey(),
    invoiceNo: text("invoice_no"),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    vatEnabled: boolean("vat_enabled").notNull().default(false),
    vatRate: doublePrecision("vat_rate").notNull().default(0.07),
    subtotal: doublePrecision("subtotal").notNull().default(0),
    vatAmount: doublePrecision("vat_amount").notNull().default(0),
    grandTotal: doublePrecision("grand_total").notNull().default(0),
    paidTotal: doublePrecision("paid_total").notNull().default(0),
    outstandingTotal: doublePrecision("outstanding_total").notNull().default(0),
    issueDate: date("issue_date", { mode: "string" }),
    dueDate: date("due_date", { mode: "string" }),
    notes: text("notes"),
    voidReason: text("void_reason"),
    issuedBy: integer("issued_by"),
    voidedBy: integer("voided_by"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_invoices_invoice_no").on(table.invoiceNo),
    index("idx_invoices_customer_status_period").on(
      table.customerId,
      table.status,
      table.periodStart,
      table.periodEnd
    ),
  ]
);

// ==================== Invoice Lines ====================
export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoices.id),
    transactionId: integer("transaction_id")
      .notNull()
      .references(() => transactions.id),
    lineType: invoiceLineTypeEnum("line_type").notNull(),
    saleDate: date("sale_date", { mode: "string" }).notNull(),
    saleTime: time("sale_time", { precision: 0 }).notNull(),
    amount: doublePrecision("amount").notNull().default(0),
    snapshotJson: jsonb("snapshot_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_invoice_lines_invoice_tx").on(table.invoiceId, table.transactionId),
    index("idx_invoice_lines_transaction").on(table.transactionId),
  ]
);

// ==================== Invoice Payments ====================
export const invoicePayments = pgTable(
  "invoice_payments",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoices.id),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
    amount: doublePrecision("amount").notNull().default(0),
    method: invoicePaymentMethodEnum("method").notNull().default("cash"),
    note: text("note"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_invoice_payments_invoice").on(table.invoiceId, table.paidAt),
  ]
);

// ==================== Invoice Payment Allocations ====================
export const invoicePaymentAllocations = pgTable(
  "invoice_payment_allocations",
  {
    id: serial("id").primaryKey(),
    invoicePaymentId: integer("invoice_payment_id")
      .notNull()
      .references(() => invoicePayments.id),
    invoiceLineId: integer("invoice_line_id")
      .notNull()
      .references(() => invoiceLines.id),
    transactionId: integer("transaction_id")
      .notNull()
      .references(() => transactions.id),
    allocatedAmount: doublePrecision("allocated_amount").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_invoice_payment_allocations_payment_line").on(
      table.invoicePaymentId,
      table.invoiceLineId
    ),
    index("idx_invoice_payment_allocations_transaction").on(table.transactionId),
  ]
);

// ==================== Payment Events ====================
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: serial("id").primaryKey(),
    transactionId: integer("transaction_id").references(() => transactions.id),
    invoiceId: integer("invoice_id").references(() => invoices.id),
    invoicePaymentId: integer("invoice_payment_id").references(() => invoicePayments.id),
    eventDate: date("event_date", { mode: "string" }).notNull(),
    eventTime: time("event_time", { precision: 0 }).notNull(),
    amount: doublePrecision("amount").notNull().default(0),
    method: invoicePaymentMethodEnum("method"),
    note: text("note"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_payment_events_transaction_date").on(table.transactionId, table.eventDate),
    index("idx_payment_events_invoice").on(table.invoiceId, table.eventDate),
  ]
);

// ==================== Forecast Event Overrides ====================
export const forecastEventOverrides = pgTable(
  "forecast_event_overrides",
  {
    id: serial("id").primaryKey(),
    factoryKey: text("factory_key").notNull(),
    targetDate: date("target_date", { mode: "string" }).notNull(),
    eventType: text("event_type").notNull(),
    productTypeId: integer("product_type_id").references(() => productTypes.id),
    scope: text("scope").notNull().default("factory"),
    strength: doublePrecision("strength").notNull().default(1),
    notes: text("notes"),
    source: text("source").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_forecast_event_overrides_factory_date").on(table.factoryKey, table.targetDate),
    index("idx_forecast_event_overrides_type").on(table.eventType, table.targetDate),
  ]
);

// ==================== Idempotency Keys ====================
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    invoiceId: integer("invoice_id").references(() => invoices.id),
    invoicePaymentId: integer("invoice_payment_id").references(() => invoicePayments.id),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_idempotency_keys_scope_key").on(table.scope, table.idempotencyKey),
    index("idx_idempotency_keys_created_at").on(table.createdAt),
  ]
);

// ==================== Forecast Outputs ====================
export const forecastOutputs = pgTable(
  "forecast_outputs",
  {
    id: serial("id").primaryKey(),
    factoryKey: text("factory_key").notNull(),
    targetDate: date("target_date", { mode: "string" }).notNull(),
    productKey: text("product_key").notNull(),
    productTypeId: integer("product_type_id").references(() => productTypes.id),
    productName: text("product_name"),
    predictedUnits: doublePrecision("predicted_units").notNull().default(0),
    predictedUnitsLower: doublePrecision("predicted_units_lower").notNull().default(0),
    predictedUnitsUpper: doublePrecision("predicted_units_upper").notNull().default(0),
    predictedRevenue: doublePrecision("predicted_revenue").notNull().default(0),
    predictedRevenueLower: doublePrecision("predicted_revenue_lower").notNull().default(0),
    predictedRevenueUpper: doublePrecision("predicted_revenue_upper").notNull().default(0),
    confidence: text("confidence").notNull().default("medium"),
    keyDrivers: jsonb("key_drivers"),
    modelVersion: text("model_version").notNull(),
    modelFamily: text("model_family").notNull().default(""),
    featureSnapshotHash: text("feature_snapshot_hash").notNull(),
    dataEndDate: date("data_end_date", { mode: "string" }),
    signalCoverage: jsonb("signal_coverage"),
    sourceGeneratedAt: timestamp("source_generated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_forecast_outputs_factory_date").on(table.factoryKey, table.targetDate),
    index("idx_forecast_outputs_model_version").on(table.modelVersion),
    uniqueIndex("idx_forecast_outputs_factory_date_product").on(
      table.factoryKey,
      table.targetDate,
      table.productKey
    ),
  ]
);

// ==================== Relations ====================
export const productTypesRelations = relations(productTypes, ({ many }) => ({
  customerPrices: many(customerPrices),
  transactionItems: many(transactionItems),
  bagLedgerEntries: many(bagLedger),
  forecastEventOverrides: many(forecastEventOverrides),
  forecastOutputs: many(forecastOutputs),
}));

export const customersRelations = relations(customers, ({ many }) => ({
  prices: many(customerPrices),
  transactions: many(transactions),
  bagLedgerEntries: many(bagLedger),
  invoices: many(invoices),
}));

export const customerPricesRelations = relations(customerPrices, ({ one }) => ({
  customer: one(customers, {
    fields: [customerPrices.customerId],
    references: [customers.id],
  }),
  productType: one(productTypes, {
    fields: [customerPrices.productTypeId],
    references: [productTypes.id],
  }),
}));

export const transactionsRelations = relations(
  transactions,
  ({ one, many }) => ({
    customer: one(customers, {
      fields: [transactions.customerId],
      references: [customers.id],
    }),
    items: many(transactionItems),
    bagLedgerEntries: many(bagLedger),
    invoiceLines: many(invoiceLines),
    paymentEvents: many(paymentEvents),
    originalTransaction: one(transactions, {
      fields: [transactions.originalTransactionId],
      references: [transactions.id],
    }),
  })
);

export const transactionItemsRelations = relations(
  transactionItems,
  ({ one }) => ({
    transaction: one(transactions, {
      fields: [transactionItems.transactionId],
      references: [transactions.id],
    }),
    productType: one(productTypes, {
      fields: [transactionItems.productTypeId],
      references: [productTypes.id],
    }),
  })
);

export const productionLogsRelations = relations(productionLogs, ({ one }) => ({
  productType: one(productTypes, {
    fields: [productionLogs.productTypeId],
    references: [productTypes.id],
  }),
}));

export const bagLedgerRelations = relations(bagLedger, ({ one }) => ({
  customer: one(customers, {
    fields: [bagLedger.customerId],
    references: [customers.id],
  }),
  productType: one(productTypes, {
    fields: [bagLedger.productTypeId],
    references: [productTypes.id],
  }),
  transaction: one(transactions, {
    fields: [bagLedger.transactionId],
    references: [transactions.id],
  }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user: one(users, {
    fields: [auditLog.userId],
    references: [users.id],
  }),
}));

export const auditFindingsRelations = relations(auditFindings, ({ one }) => ({
  user: one(users, {
    fields: [auditFindings.userId],
    references: [users.id],
  }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  customer: one(customers, {
    fields: [invoices.customerId],
    references: [customers.id],
  }),
  lines: many(invoiceLines),
  payments: many(invoicePayments),
  paymentEvents: many(paymentEvents),
}));

export const invoiceLinesRelations = relations(invoiceLines, ({ one, many }) => ({
  invoice: one(invoices, {
    fields: [invoiceLines.invoiceId],
    references: [invoices.id],
  }),
  transaction: one(transactions, {
    fields: [invoiceLines.transactionId],
    references: [transactions.id],
  }),
  allocations: many(invoicePaymentAllocations),
}));

export const invoicePaymentsRelations = relations(invoicePayments, ({ one, many }) => ({
  invoice: one(invoices, {
    fields: [invoicePayments.invoiceId],
    references: [invoices.id],
  }),
  allocations: many(invoicePaymentAllocations),
  paymentEvents: many(paymentEvents),
  idempotencyKeys: many(idempotencyKeys),
}));

export const invoicePaymentAllocationsRelations = relations(invoicePaymentAllocations, ({ one }) => ({
  invoicePayment: one(invoicePayments, {
    fields: [invoicePaymentAllocations.invoicePaymentId],
    references: [invoicePayments.id],
  }),
  invoiceLine: one(invoiceLines, {
    fields: [invoicePaymentAllocations.invoiceLineId],
    references: [invoiceLines.id],
  }),
  transaction: one(transactions, {
    fields: [invoicePaymentAllocations.transactionId],
    references: [transactions.id],
  }),
}));

export const paymentEventsRelations = relations(paymentEvents, ({ one }) => ({
  transaction: one(transactions, {
    fields: [paymentEvents.transactionId],
    references: [transactions.id],
  }),
  invoice: one(invoices, {
    fields: [paymentEvents.invoiceId],
    references: [invoices.id],
  }),
  invoicePayment: one(invoicePayments, {
    fields: [paymentEvents.invoicePaymentId],
    references: [invoicePayments.id],
  }),
}));

export const forecastEventOverridesRelations = relations(
  forecastEventOverrides,
  ({ one }) => ({
    productType: one(productTypes, {
      fields: [forecastEventOverrides.productTypeId],
      references: [productTypes.id],
    }),
  })
);

export const idempotencyKeysRelations = relations(idempotencyKeys, ({ one }) => ({
  invoice: one(invoices, {
    fields: [idempotencyKeys.invoiceId],
    references: [invoices.id],
  }),
  invoicePayment: one(invoicePayments, {
    fields: [idempotencyKeys.invoicePaymentId],
    references: [invoicePayments.id],
  }),
  user: one(users, {
    fields: [idempotencyKeys.createdBy],
    references: [users.id],
  }),
}));

export const forecastOutputsRelations = relations(forecastOutputs, ({ one }) => ({
  productType: one(productTypes, {
    fields: [forecastOutputs.productTypeId],
    references: [productTypes.id],
  }),
}));

export * from "./supply";
export * from "./core";
