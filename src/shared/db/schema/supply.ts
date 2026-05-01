import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { productTypes, users } from "./core";

export const supplyStockLedgerTypeEnum = pgEnum("supply_stock_ledger_type", [
  "purchase_in",
  "internal_use",
  "transfer_out",
  "transfer_in",
  "bag_return_manual",
  "adjustment",
]);

export const supplyRequestStatusEnum = pgEnum("supply_request_status", [
  "draft",
  "pending",
  "approved",
  "rejected",
  "fulfilled",
  "cancelled",
]);

export const supplyRequestTypeEnum = pgEnum("supply_request_type", [
  "internal_factory",
  "cross_factory",
]);

export const supplyTransferStatusEnum = pgEnum("supply_transfer_status", [
  "sending",
  "sent",
  "pending_receive",
  "received",
  "confirmed",
  "rejected",
  "cancelled",
]);

export const supplyItems = pgTable("supply_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  unit: text("unit").notNull(),
  category: text("category"),
  itemCode: text("item_code"),
  imageUrl: text("image_url"),
  linkedProductTypeId: integer("linked_product_type_id").references(() => productTypes.id),
  lowStockThreshold: integer("low_stock_threshold").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const supplyCatalogSettings = pgTable(
  "supply_catalog_settings",
  {
    id: serial("id").primaryKey(),
    factoryKey: text("factory_key").notNull(),
    units: jsonb("units").notNull().default([]),
    categories: jsonb("categories").notNull().default([]),
    updatedBy: integer("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("idx_supply_catalog_settings_factory").on(table.factoryKey)]
);

export const supplyStockThresholds = pgTable(
  "supply_stock_thresholds",
  {
    id: serial("id").primaryKey(),
    factoryKey: text("factory_key").notNull(),
    supplyItemId: integer("supply_item_id")
      .notNull()
      .references(() => supplyItems.id),
    threshold: integer("threshold").notNull().default(0),
    updatedBy: integer("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_supply_thresholds_factory_item").on(
      table.factoryKey,
      table.supplyItemId
    ),
  ]
);

export const supplyStockLedger = pgTable(
  "supply_stock_ledger",
  {
    id: serial("id").primaryKey(),
    factoryKey: text("factory_key").notNull(),
    supplyItemId: integer("supply_item_id")
      .notNull()
      .references(() => supplyItems.id),
    type: supplyStockLedgerTypeEnum("type").notNull(),
    quantity: integer("quantity").notNull(),
    referenceId: integer("reference_id"),
    referenceType: text("reference_type"),
    note: text("note"),
    createdBy: integer("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_supply_ledger_factory_item").on(table.factoryKey, table.supplyItemId),
    index("idx_supply_ledger_factory_type").on(table.factoryKey, table.type),
    index("idx_supply_ledger_reference").on(table.referenceType, table.referenceId),
  ]
);

export const supplyRequests = pgTable(
  "supply_requests",
  {
    id: serial("id").primaryKey(),
    factoryKey: text("factory_key").notNull(),
    requestType: supplyRequestTypeEnum("request_type").notNull().default("internal_factory"),
    targetFactoryKey: text("target_factory_key"),
    requesterName: text("requester_name"),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    status: supplyRequestStatusEnum("status").notNull().default("draft"),
    note: text("note"),
    approvedBy: integer("approved_by").references(() => users.id),
    approverSignature: text("approver_signature"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_supply_requests_factory_status").on(table.factoryKey, table.status),
    index("idx_supply_requests_created_by").on(table.createdBy),
    index("idx_supply_requests_target_factory").on(table.targetFactoryKey, table.status),
  ]
);

export const supplyRequestItems = pgTable(
  "supply_request_items",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id")
      .notNull()
      .references(() => supplyRequests.id),
    supplyItemId: integer("supply_item_id")
      .notNull()
      .references(() => supplyItems.id),
    quantityRequested: integer("quantity_requested").notNull(),
    quantityApproved: integer("quantity_approved"),
    note: text("note"),
  },
  (table) => [index("idx_supply_request_items_request").on(table.requestId)]
);

export const supplyTransfers = pgTable(
  "supply_transfers",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id").references(() => supplyRequests.id),
    transferRef: text("transfer_ref").notNull(),
    fromFactoryKey: text("from_factory_key").notNull(),
    toFactoryKey: text("to_factory_key").notNull(),
    status: supplyTransferStatusEnum("status").notNull().default("sent"),
    note: text("note"),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    receivedBy: integer("received_by").references(() => users.id),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_supply_transfers_ref").on(table.transferRef),
    index("idx_supply_transfers_from").on(table.fromFactoryKey, table.status),
    index("idx_supply_transfers_to").on(table.toFactoryKey, table.status),
  ]
);

export const supplyTransferItems = pgTable(
  "supply_transfer_items",
  {
    id: serial("id").primaryKey(),
    transferId: integer("transfer_id")
      .notNull()
      .references(() => supplyTransfers.id),
    supplyItemId: integer("supply_item_id")
      .notNull()
      .references(() => supplyItems.id),
    quantityShipped: integer("quantity_shipped").notNull(),
    quantityReceived: integer("quantity_received"),
    note: text("note"),
  },
  (table) => [index("idx_supply_transfer_items_transfer").on(table.transferId)]
);

export const supplyItemsRelations = relations(supplyItems, ({ one, many }) => ({
  linkedProductType: one(productTypes, {
    fields: [supplyItems.linkedProductTypeId],
    references: [productTypes.id],
  }),
  createdByUser: one(users, {
    fields: [supplyItems.createdBy],
    references: [users.id],
  }),
  stockLedgerEntries: many(supplyStockLedger),
  thresholds: many(supplyStockThresholds),
  requestItems: many(supplyRequestItems),
  transferItems: many(supplyTransferItems),
}));

export const supplyStockThresholdsRelations = relations(
  supplyStockThresholds,
  ({ one }) => ({
    supplyItem: one(supplyItems, {
      fields: [supplyStockThresholds.supplyItemId],
      references: [supplyItems.id],
    }),
    updatedByUser: one(users, {
      fields: [supplyStockThresholds.updatedBy],
      references: [users.id],
    }),
  })
);

export const supplyStockLedgerRelations = relations(supplyStockLedger, ({ one }) => ({
  supplyItem: one(supplyItems, {
    fields: [supplyStockLedger.supplyItemId],
    references: [supplyItems.id],
  }),
  createdByUser: one(users, {
    fields: [supplyStockLedger.createdBy],
    references: [users.id],
  }),
}));

export const supplyRequestsRelations = relations(supplyRequests, ({ one, many }) => ({
  createdByUser: one(users, {
    fields: [supplyRequests.createdBy],
    references: [users.id],
  }),
  approvedByUser: one(users, {
    fields: [supplyRequests.approvedBy],
    references: [users.id],
  }),
  items: many(supplyRequestItems),
}));

export const supplyRequestItemsRelations = relations(supplyRequestItems, ({ one }) => ({
  request: one(supplyRequests, {
    fields: [supplyRequestItems.requestId],
    references: [supplyRequests.id],
  }),
  supplyItem: one(supplyItems, {
    fields: [supplyRequestItems.supplyItemId],
    references: [supplyItems.id],
  }),
}));

export const supplyTransfersRelations = relations(supplyTransfers, ({ one, many }) => ({
  request: one(supplyRequests, {
    fields: [supplyTransfers.requestId],
    references: [supplyRequests.id],
  }),
  createdByUser: one(users, {
    fields: [supplyTransfers.createdBy],
    references: [users.id],
  }),
  receivedByUser: one(users, {
    fields: [supplyTransfers.receivedBy],
    references: [users.id],
  }),
  items: many(supplyTransferItems),
}));

export const supplyCatalogSettingsRelations = relations(
  supplyCatalogSettings,
  ({ one }) => ({
    updatedByUser: one(users, {
      fields: [supplyCatalogSettings.updatedBy],
      references: [users.id],
    }),
  })
);

export const supplyTransferItemsRelations = relations(supplyTransferItems, ({ one }) => ({
  transfer: one(supplyTransfers, {
    fields: [supplyTransferItems.transferId],
    references: [supplyTransfers.id],
  }),
  supplyItem: one(supplyItems, {
    fields: [supplyTransferItems.supplyItemId],
    references: [supplyItems.id],
  }),
}));
