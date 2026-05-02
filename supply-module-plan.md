# Supply Module — Implementation Plan
### Si-posV1 Mini ERP (Module 2)

---

## Vision & Boundary

```
Si-posV1 Mini ERP
├── [✓] Module 1: POS     — ขายน้ำแข็ง, invoice, bag tracking
└── [ ] Module 2: Supply  — เบิกของใช้, ส่งของระหว่างโรงงาน, stock
    (Module 3+: TBD)
```

> **หลักการ:** Supply module ไม่แตะ POS code เลย ยกเว้น 3 จุดที่ระบุชัดใน Phase 4 และทำแบบ additive เท่านั้น

---

## Current Operational Flow (Authoritative)

> **Section นี้เป็น source of truth ของ business flow ปัจจุบัน**
> ถ้ามีส่วนไหนใน phase ถัดไปขัดกับ section นี้ ให้ยึด section นี้ก่อนแล้วค่อยปรับ technical design ตาม

### Operational Rules

- คนงานคือ `ผู้ขอใช้ของจริง` แต่ **ไม่ใช่คนทำใบเบิกในระบบ**
- คนที่ทำใบเบิกในระบบมีแค่ `manager` และ `office`
- `เบิกในโรงงาน` กับ `เบิกข้ามโรงงาน` ต้องเริ่มจาก `ใบเบิก (request)` เหมือนกัน
- `transfer` เป็นเอกสารสำหรับขั้นตอนขนย้ายของระหว่างโรงงานเท่านั้น และต้องอ้างอิงกลับไปที่ request ต้นทางได้

### Flow A — เบิกในโรงงานเดียวกัน

```
worker แจ้ง manager หรือ office
  → manager/office สร้าง supply request
  → manager/office อนุมัติใบเบิก (ถ้าจำเป็น)
  → office จ่ายของ
  → ระบบตัด stock ตอน "จ่ายของจริง"
  → ปิดใบเบิก
```

### Flow B — เบิกจากโรงงานอื่น

```
worker ที่โรงงานปลายทางแจ้ง manager
  → manager โรงงานปลายทาง สร้าง supply request ส่งไปโรงงานหลัก
  → office โรงงานหลัก รับเรื่อง / ตรวจ stock / อนุมัติ / เตรียมของ
  → office โรงงานหลัก สร้าง transfer อ้างอิง request ใบนั้น
  → ระบบตัด stock ตอน transfer ถูกส่งออกจากโรงงานหลักจริง
  → โรงงานปลายทางยืนยันรับของ
  → request ต้นทางถูกปิดเมื่อ transfer เสร็จสมบูรณ์
```

### Role Mapping

| Scenario | Real requester | Document creator | Approver | Fulfillment owner | Stock movement |
|---|---|---|---|---|---|
| เบิกในโรงงาน | worker | manager / office | manager / office | office โรงงานเดียวกัน | ตอนจ่ายของ |
| เบิกข้ามโรงงาน | worker ที่โรงงานปลายทาง | manager โรงงานปลายทาง | office / manager โรงงานหลัก | office โรงงานหลัก | ตอนส่ง transfer |

### Design Consequences

- `request` ต้องเก็บทั้ง `ผู้ขอใช้จริง` และ `ผู้สร้างเอกสาร`
- `request` ต้องรู้ว่าเป็น `internal_factory` หรือ `cross_factory`
- `cross_factory request` ต้องระบุ `targetFactoryKey` ว่าส่งไปขอที่โรงงานไหน
- `request` ต้องรองรับการเป็น `draft` แบบแก้ไขต่อได้จริง ไม่ใช่มีแค่ status ใน schema
- `request` และ `transfer` ควรเผื่อช่องสำหรับ `เหตุผล`, `metadata หน้างาน`, และ `attachment references`
- `approve request` **ยังไม่ตัด stock**
- `stock ledger` จะถูกเขียนตอน `fulfil request` (กรณีเบิกในโรงงาน) หรือ `create transfer` (กรณีเบิกข้ามโรงงาน)
- `durable item` ไม่ควรถูกมองว่า fulfil แล้วจบเสมอ ต้องมี borrow/return lifecycle ตามหลังได้
- technical plan เดิมที่มองว่า transfer ถูกสร้างตรงจากโรงงานหลักโดยไม่ผ่าน request ต้องถือว่า **ไม่ตรงกับ operation จริง**

---

## Architecture Decisions

### 1. Inter-Factory Transfer — Dual-write with Saga Pattern

แต่ละ factory มี DB แยกกัน (`DATABASE_URL_SI`, `DATABASE_URL_BEARING`, `DATABASE_URL_KTK`)
Transfer record ต้องอยู่ทั้งสองฝั่ง ใช้ **Saga pattern แบบ explicit status** เพื่อรับมือกับ partial failure:

```
createTransfer (Saga):
  Step 1: write fromDb  status = "sending"       ← in-progress marker
          ถ้าล้มตรงนี้ → ไม่มีผลอะไร (ไม่มีอะไรเกิดขึ้น)

  Step 2: write toDb    status = "pending_receive"
          ถ้า toDb ล้มเหลว → rollback fromDb กลับเป็น "cancelled"
                              + log error ให้ admin เห็น

  Step 3: update fromDb status = "sent"          ← confirm สำเร็จทั้งคู่

receiveTransfer (Saga):
  Step 1: update toDb   status = "received"
          ถ้าล้มตรงนี้ → ไม่มีผลต่อ fromDb

  Step 2: writeStockLedger(transfer_in) ลง toDb
          ถ้าล้มเหลว → rollback toDb กลับ pending_receive

  Step 3: update fromDb status = "confirmed"
```

> **"sending" status** คือ in-progress marker — transfer ที่ค้างใน `"sending"` นานผิดปกติ
> คือสัญญาณว่า dual-write ล้มเหลวกลางทาง ต้องมี reconciliation job ตรวจ

ใช้ `createFactoryRegistry` ที่มีอยู่แล้วใน `src/shared/db/runtime/clients.ts`
ไม่ต้องสร้าง central DB ใหม่

### 2. Supply Items vs Product Types

ถุงกระสอบและของใช้อื่น **สร้างเป็น supply_item ใหม่** และ link กลับผ่าน `linkedProductTypeId`:

```
supply_items: { name: "ถุงกระสอบ", linkedProductTypeId: 3 }
                                                         ↑
                                          FK กลับ product_types.id (read-only reference)
```

- stock ถุงสำหรับเบิกใช้ภายใน → `supply_stock_ledger`
- stock ถุงลูกค้าค้าง → `bag_ledger` (เดิม ไม่แตะ)
- `linkedProductTypeId` ใช้ตอน admin กด "นำเข้า Supply" จาก bags page

### 3. Low Stock Threshold — Per Factory

แต่ละ factory ตั้ง threshold ของตัวเองได้ ผ่าน `supply_stock_thresholds` table แยก
ถ้าไม่ได้ตั้งไว้ใช้ `supplyItems.lowStockThreshold` เป็น global default

### 4. Approval — Single Approver + Required Signature

- approve คนเดียวพอ ไม่มี multi-sign
- แต่ต้องมี `approverSignature` field บันทึกไว้ (text — ชื่อ หรือ PIN ยืนยัน)
- log เข้า `audit_log` ทุกครั้ง

### 5. Request Is The Entry Point, Transfer Is The Execution Document

- ทุกการเบิกเริ่มจาก `supply_request` ก่อนเสมอ
- `supply_transfer` มีไว้สำหรับ execute การส่งของระหว่างโรงงานหลัง request ถูกอนุมัติแล้ว
- `internal request` ใช้การ fulfil เพื่อจบงาน
- `cross-factory request` ใช้ linked transfer เพื่อจบงาน
- อย่าตัด stock ตอน approve เพราะของยังไม่ถูกจ่าย/ส่งจริง

### 6. Supply Item Type — Two Operational Types Only

`supply_items.itemType` ไม่ใช่หมวดหมู่สินค้า แต่เป็นตัวกำหนดพฤติกรรมการเบิก:

- `consumable` = ใช้แล้วหมดไป เมื่อตัดจ่ายแล้วถือว่าใช้สิ้นเปลือง ไม่ต้องคืน
- `durable` = อุปกรณ์ใช้งานซ้ำ / เบิกแล้วต้องคืน ต้องติดตามการคืนหลังเบิก

ห้ามเพิ่ม type แยกเช่น `tool`, `spare_part`, หรือหมวดอื่นใน field นี้ เพราะสิ่งเหล่านั้นเป็น `category`
ไม่ใช่ operational type. ถ้ามี legacy value เหล่านี้ ให้ map กลับเป็น `durable`.

### 7. Draft Is A First-Class Request State

- `draft` ต้องไม่เป็นแค่ enum สำรองใน DB
- user ต้องสามารถ `save draft`, `edit draft`, `add/remove items`, และ `submit ภายหลัง` ได้
- detail page และ list page ต้องแยก draft ที่ยังไม่ส่งอนุมัติออกจาก pending อย่างชัดเจน

### 8. Operational Metadata Must Be Explicit

- field `note` อย่างเดียวไม่พอสำหรับงานหน้างานบางเคส
- request และ transfer ควรเผื่อ:
  - `reasonCode` หรือ equivalent
  - `metadata` แบบ JSON สำหรับข้อมูลเฉพาะเคส
  - `attachments` เป็น reference list ไปยังไฟล์/รูป/เอกสาร
- version แรกอาจยังไม่ต้องมี file upload เต็มรูปแบบ แต่ schema และ API contract ควรเปิดทางไว้

### 9. Transfer Stuck Visibility Is Part Of The Product, Not Only Ops API

- transfer ที่ค้าง `sending` นานผิดปกติต้องไม่ซ่อนอยู่แค่ใน API
- admin/office ต้องเห็น warning ที่หน้า overview และ transfers list
- ต้องมี flow inspect / retry / cancel ที่ชัดเจนใน UI

### 10. Durable Items Need A Borrow / Return Workflow

- `durable` ไม่ใช่แค่ label ใน catalog
- หลัง fulfil ของ durable item ต้องสามารถ:
  - สร้าง borrow record
  - track ของที่ยังไม่คืน
  - คืนบางส่วนได้
  - บันทึกสภาพของ / ผู้รับคืน / ลายเซ็นผู้รับคืน
  - แจ้ง overdue ได้

---

## File Structure

```
src/
├── app/
│   ├── (dashboard)/                  ← POS module (ไม่แตะ)
│   │   ├── sale/
│   │   ├── invoice/
│   │   ├── bags/                     ← เพิ่มปุ่ม 1 ปุ่มใน Phase 4 เท่านั้น
│   │   └── ...
│   │
│   ├── (supply)/                     ← Supply module (ใหม่ทั้งหมด)
│   │   ├── layout.tsx                ← Supply layout + nav แยกจาก POS
│   │   ├── supply/page.tsx           ← Overview / dashboard
│   │   ├── supply/stock/page.tsx     ← Stock คงเหลือ
│   │   ├── supply/items/page.tsx     ← Catalog ของใช้ (admin master data)
│   │   ├── supply/requests/
│   │   │   ├── page.tsx              ← รายการใบเบิก (history + tabs)
│   │   │   ├── new/page.tsx          ← Catalog UI + Requisition Cart (ใหม่)
│   │   │   └── [id]/page.tsx         ← Detail + approval
│   │   └── supply/transfers/
│   │       ├── page.tsx              ← รายการ transfer
│   │       └── [id]/page.tsx         ← Detail + confirm receive
│   │
│   └── api/
│       ├── transactions/             ← POS API (ไม่แตะ)
│       ├── invoices/                 ← POS API (ไม่แตะ)
│       └── supply/                   ← Supply API (ใหม่ทั้งหมด)
│           ├── items/route.ts
│           ├── items/[id]/route.ts
│           ├── stock/route.ts
│           ├── stock/adjust/route.ts
│           ├── requests/route.ts
│           ├── requests/[id]/route.ts
│           ├── transfers/route.ts
│           └── transfers/[id]/route.ts
│
├── lib/
│   ├── sale-entry-view.ts            ← POS lib (ไม่แตะ)
│   ├── idempotency.ts                ← POS lib (ไม่แตะ)
│   └── supply/                       ← Supply lib (ใหม่ทั้งหมด)
│       ├── stock-engine.ts
│       ├── request-engine.ts
│       └── transfer-engine.ts
│
├── components/
│   └── supply/                       ← Supply UI components (ใหม่ทั้งหมด)
│       ├── supply-shell.tsx          ← wrapper layout + factory context display
│       ├── supply-sidebar.tsx        ← sidebar nav ของ supply โดยเฉพาะ
│       ├── stock-balance-grid.tsx    ← grid cards stock คงเหลือ
│       ├── supply-catalog-card.tsx   ← product card ใน requisition catalog
│       ├── supply-cart-drawer.tsx    ← cart sidebar (Sheet/Drawer จาก shadcn)
│       ├── request-status-tabs.tsx   ← tabs filter สถานะใบเบิก
│       ├── request-approval-panel.tsx ← panel approve/reject + signature
│       ├── transfer-receive-dialog.tsx ← dialog ยืนยันรับของ
│       └── supply-alert-widget.tsx   ← widget KPI สำหรับ POS dashboard
│
└── shared/db/schema/
    └── index.ts                      ← เพิ่ม supply tables ต่อท้าย
                                         ไม่แก้บรรทัดเดิมแม้แต่บรรทัดเดียว
```

---

## Phase 0 — Schema & Migration
**1-2 วัน | ต้องทำก่อนทุกอย่าง**

เพิ่มต่อท้าย `src/shared/db/schema/index.ts`

### Enums ใหม่

```typescript
export const supplyStockLedgerTypeEnum = pgEnum("supply_stock_ledger_type", [
  "purchase_in",       // ซื้อเข้า stock
  "internal_use",      // เบิกใช้ภายใน (ตอน fulfil / จ่ายของจริง)
  "transfer_out",      // ส่งออกไป factory อื่น
  "transfer_in",       // รับจาก factory อื่น
  "bag_return_manual", // admin นำถุงคืนเข้า supply (manual เท่านั้น)
  "adjustment",        // ปรับปรุงยอด
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
  "sending",           // ⚠️ in-progress marker — กำลัง dual-write (transient)
  "sent",              // dual-write สำเร็จทั้งสองฝั่ง + ตัด stock โรงงานต้นทางแล้ว
  "pending_receive",   // รอ branch confirm
  "received",          // branch confirm รับแล้ว
  "confirmed",         // โรงงานต้นทางรับรู้ว่าปลายทางได้ของแล้ว
  "rejected",          // branch ปฏิเสธ → คืน stock โรงงานต้นทาง
  "cancelled",         // ยกเลิกก่อนส่ง
]);
```

### Tables ใหม่

```typescript
// Catalog ของใช้ภายใน (แยกจาก product_types)
export const supplyItems = pgTable("supply_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  unit: text("unit").notNull(),              // ใบ, ขวด, กล่อง, ชิ้น
  category: text("category"),               // สารเคมี, อุปกรณ์, บรรจุภัณฑ์
  itemType: text("item_type").notNull().default("consumable"),
                                             // consumable = ใช้แล้วหมดไป
                                             // durable = อุปกรณ์ใช้งานซ้ำ / เบิกแล้วต้องคืน
  imageUrl: text("image_url"),              // nullable — รูปภาพสินค้าใน catalog
  linkedProductTypeId: integer("linked_product_type_id")
    .references(() => productTypes.id),     // nullable — link ถุงกระสอบ (read-only)
  lowStockThreshold: integer("low_stock_threshold").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Per-factory threshold override
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
    uniqueIndex("idx_supply_thresholds_factory_item")
      .on(table.factoryKey, table.supplyItemId),
  ]
);

// Ledger-based stock — stock คงเหลือ = SUM(quantity)
export const supplyStockLedger = pgTable(
  "supply_stock_ledger",
  {
    id: serial("id").primaryKey(),
    factoryKey: text("factory_key").notNull(),
    supplyItemId: integer("supply_item_id")
      .notNull()
      .references(() => supplyItems.id),
    type: supplyStockLedgerTypeEnum("type").notNull(),
    quantity: integer("quantity").notNull(),   // + เข้า / - ออก
    referenceId: integer("reference_id"),      // request.id หรือ transfer.id
    referenceType: text("reference_type"),     // "request" | "transfer" | null
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

// ใบเบิกของใช้ภายใน
export const supplyRequests = pgTable(
  "supply_requests",
  {
    id: serial("id").primaryKey(),
    factoryKey: text("factory_key").notNull(),
    requestType: supplyRequestTypeEnum("request_type").notNull().default("internal_factory"),
    targetFactoryKey: text("target_factory_key"), // required เมื่อเป็น cross_factory
    requesterName: text("requester_name").notNull(), // ชื่อคนงาน/แผนกที่ขอใช้จริง
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    status: supplyRequestStatusEnum("status").notNull().default("draft"),
    reasonCode: text("reason_code"),                  // optional — ใช้แยกเหตุผลมาตรฐาน
    note: text("note"),
    metadata: jsonb("metadata").notNull().default({}),   // ข้อมูลหน้างานเพิ่มเติม
    attachments: jsonb("attachments").notNull().default([]), // [{name,url,type}]
    approvedBy: integer("approved_by").references(() => users.id),
    approverSignature: text("approver_signature"),   // required ตอน approve
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
    quantityApproved: integer("quantity_approved"),   // null จนกว่าจะ approve
    note: text("note"),
  },
  (table) => [
    index("idx_supply_request_items_request").on(table.requestId),
  ]
);

// Inter-factory transfer
export const supplyTransfers = pgTable(
  "supply_transfers",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id").references(() => supplyRequests.id),
    fromFactoryKey: text("from_factory_key").notNull(),
    toFactoryKey: text("to_factory_key").notNull(),
    status: supplyTransferStatusEnum("status").notNull().default("sent"),
    reasonCode: text("reason_code"),
    note: text("note"),
    metadata: jsonb("metadata").notNull().default({}),
    attachments: jsonb("attachments").notNull().default([]),
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
    quantityReceived: integer("quantity_received"),   // null จนกว่าจะ confirm
    note: text("note"),
  },
  (table) => [
    index("idx_supply_transfer_items_transfer").on(table.transferId),
  ]
);

// Durable item borrow / return tracking
export const supplyBorrowStatusEnum = pgEnum("supply_borrow_status", [
  "pending",
  "borrowing",
  "partial_returned",
  "returned",
  "overdue",
  "rejected",
  "cancelled",
]);

export const supplyBorrows = pgTable(
  "supply_borrows",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id").references(() => supplyRequests.id),
    factoryKey: text("factory_key").notNull(),
    requesterName: text("requester_name").notNull(),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    status: supplyBorrowStatusEnum("status").notNull().default("pending"),
    approvedBy: integer("approved_by").references(() => users.id),
    approverSignature: text("approver_signature"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    returnCondition: text("return_condition"),
    receiverSignature: text("receiver_signature"),
    note: text("note"),
    metadata: jsonb("metadata").notNull().default({}),
    attachments: jsonb("attachments").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_supply_borrows_factory_status").on(table.factoryKey, table.status),
    index("idx_supply_borrows_due_at").on(table.dueAt, table.status),
  ]
);

export const supplyBorrowItems = pgTable(
  "supply_borrow_items",
  {
    id: serial("id").primaryKey(),
    borrowId: integer("borrow_id")
      .notNull()
      .references(() => supplyBorrows.id),
    supplyItemId: integer("supply_item_id")
      .notNull()
      .references(() => supplyItems.id),
    quantityBorrowed: integer("quantity_borrowed").notNull(),
    quantityReturned: integer("quantity_returned").notNull().default(0),
    note: text("note"),
  },
  (table) => [
    index("idx_supply_borrow_items_borrow").on(table.borrowId),
  ]
);
```

### Relations ใหม่ (เพิ่มต่อท้าย)

```typescript
export const supplyItemsRelations = relations(supplyItems, ({ one, many }) => ({
  linkedProductType: one(productTypes, {
    fields: [supplyItems.linkedProductTypeId],
    references: [productTypes.id],
  }),
  stockLedgerEntries: many(supplyStockLedger),
  thresholds: many(supplyStockThresholds),
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
```

**Deliverable:**
- `npm run db:push` ผ่านทั้ง 3 factory DB (`si`, `bearing`, `ktk`)
- Drizzle relations export ครบ
- ไม่มี breaking change กับ table เดิม

---

## Phase 1 — Stock Engine
**2-3 วัน | ต้องเสร็จก่อน API**

### `src/lib/supply/stock-engine.ts`

```typescript
// Stock คงเหลือ = SUM(quantity) จาก ledger
// quantity > 0 = เข้า (purchase_in, transfer_in, bag_return_manual)
// quantity < 0 = ออก (internal_use, transfer_out)
async function getStockBalance(
  db: DrizzleDb,
  factoryKey: string,
  supplyItemId: number
): Promise<number>

// Bulk version สำหรับหน้า overview
// รวม per-factory threshold (override จาก supplyStockThresholds ก่อน
// fallback ไป supplyItems.lowStockThreshold)
async function getStockBalances(
  db: DrizzleDb,
  factoryKey: string
): Promise<StockBalanceRow[]>
// return: { item, balance, threshold, isLow, lastMovementAt }

// ทุก movement ต้องผ่านฟังก์ชันนี้เสมอ
async function writeStockLedger(
  db: DrizzleDb,
  entry: NewStockLedgerEntry
): Promise<StockLedgerRow>

// ตรวจก่อน approve / transfer — ของพอไหม
async function checkStockSufficiency(
  db: DrizzleDb,
  factoryKey: string,
  items: { supplyItemId: number; quantity: number }[]
): Promise<{
  sufficient: boolean
  shortfalls: { supplyItemId: number; available: number; requested: number }[]
}>
```

### `src/lib/supply/request-engine.ts`

```typescript
// draft → pending
async function submitRequest(db, requestId, user): Promise<SupplyRequest>

// pending → approved
// อนุมัติใบเบิกอย่างเดียว ยังไม่ตัด stock
// internal_factory: รอ office จ่ายของก่อนค่อย fulfil
// cross_factory: รอ office โรงงานต้นทางสร้าง transfer ก่อน
// บันทึก approverSignature บังคับ
async function approveRequest(
  db, requestId, approver,
  approvedQtys: { requestItemId: number; quantity: number }[],
  signature: string
): Promise<SupplyRequest>

// pending → rejected
async function rejectRequest(
  db, requestId, approver, note: string
): Promise<SupplyRequest>

// approved → fulfilled (internal_factory only)
// ใช้ DB transaction: update status + writeStockLedger(internal_use) atomically
async function fulfillRequest(db, requestId, user): Promise<SupplyRequest>

// draft | pending → cancelled
async function cancelRequest(db, requestId, user): Promise<SupplyRequest>
```

### `src/lib/supply/transfer-engine.ts`

```typescript
// สร้าง transfer ด้วย Saga pattern (3 steps)
// ใช้สำหรับ cross_factory request ที่ได้รับอนุมัติแล้ว
// Step 1: fromDb status = "sending"
// Step 2: toDb   status = "pending_receive" (rollback fromDb ถ้าล้มเหลว)
// Step 3: fromDb status = "sent"
// ตัด stock fromFactory ตอน step สำเร็จจริง
async function createTransfer(
  fromDb: DrizzleDb,
  toDb: DrizzleDb,
  payload: CreateTransferPayload,
  user: AuthUser
): Promise<{ fromRecord: SupplyTransfer; toRecord: SupplyTransfer }>

// branch confirm รับ ด้วย Saga pattern
// Step 1: toDb status = "received" + writeStockLedger(transfer_in)
// Step 2: fromDb status = "confirmed"
async function receiveTransfer(
  fromDb: DrizzleDb,
  toDb: DrizzleDb,
  transferId: number,
  receiver: AuthUser,
  receivedQtys: { transferItemId: number; quantity: number }[]
): Promise<void>

// branch reject → คืน stock โรงงานต้นทาง (writeStockLedger กลับ)
async function rejectTransfer(
  fromDb: DrizzleDb,
  toDb: DrizzleDb,
  transferId: number,
  receiver: AuthUser,
  note: string
): Promise<void>
```

### Vitest Tests ที่ต้องครอบ

```
stock-engine.test.ts
  ✓ getStockBalance คืนค่า 0 เมื่อไม่มี ledger
  ✓ คำนวณถูกทุก type (purchase_in, internal_use, transfer_out...)
  ✓ getStockBalances — isLow ใช้ per-factory threshold ก่อน fallback global
  ✓ checkStockSufficiency — พอ / ไม่พอ / บางตัวไม่พอ

request-engine.test.ts
  ✓ submit: draft → pending
  ✓ approve: pending → approved + signature บันทึก + ยังไม่ตัด stock
  ✓ approve ล้มเหลวถ้า stock ไม่พอ
  ✓ reject: pending → rejected
  ✓ fulfil internal_factory: approved → fulfilled + ledger(internal_use)
  ✓ cross_factory request: approve ได้ แต่ fulfil ตรงไม่ได้ถ้ายังไม่มี transfer

transfer-engine.test.ts
  ✓ create: step1 fromDb = "sending" → step2 toDb = "pending_receive" → step3 fromDb = "sent"
  ✓ create: toDb ล้มเหลว → fromDb rollback เป็น "cancelled"
  ✓ create: ตัด stock fromFactory เมื่อ sent สำเร็จ + ผูก requestId กลับ request ต้นทาง
  ✓ receive: toDb received + ledger(transfer_in) → fromDb confirmed
  ✓ receive: toDb ล้มเหลว → ไม่กระทบ fromDb
  ✓ reject: คืน stock fromFactory
  ✓ partial receive: quantityReceived < quantityShipped
```

---

## Phase 2 — API Routes
**2-3 วัน**

ทุก route ใช้ pattern เดิมของโปรเจกต์:

```typescript
export const POST = withErrorHandler(async (req) => {
  const auth = await requireManagerUp()
  if (auth.error) return auth.error
  const factoryContext = requireFactoryWriteContext(req, auth.user)
  if ("error" in factoryContext) return factoryContext.error
  const { db } = factoryContext
  // ... call engine function
  await logAudit({ action: "supply.request.approve", ... }, db)
  return NextResponse.json(result)
})
```

### Routes

```
GET  /api/supply/items              list items (admin/manager/office only)
                                    ?activeOnly=true → กรอง isActive
                                    response รวม currentStock: number
                                    (aggregate SUM จาก supply_stock_ledger
                                     ต่อ factoryKey ของ user ที่ request)
                                    role factory ไม่มีสิทธิ์ใช้ Supply module
POST /api/supply/items              create (admin only)
PUT  /api/supply/items/[id]         update (admin only)
                                    รองรับ imageUrl field

GET  /api/supply/stock              balances per factory
                                    ?factoryKey=si (admin ดูได้ทุก factory)
                                    (manager/office ดูได้เฉพาะ factory ตัวเอง)
POST /api/supply/stock/adjust       manual adjustment (admin only)
                                    body: { supplyItemId, quantity, type, note }

GET  /api/supply/requests           list + filter
                                    ?status=pending&factoryKey=si
POST /api/supply/requests           create request
                                    body: {
                                      requestType,
                                      targetFactoryKey?,
                                      requesterName,
                                      items: [{ supplyItemId, quantity }],
                                      reasonCode?,
                                      note
                                    }
                                    → ถ้ามาจาก cart ให้ส่ง status = "pending" ทันที
                                      (ข้าม draft เพราะ user ยืนยันแล้วใน cart)
                                    → ถ้าต้องการ save draft ให้ส่ง status = "draft"
                                    → validate `requesterName` ก่อน insert
                                      ถ้าไม่มีให้ return 400
                                    → ถ้า `requestType = cross_factory`
                                      ต้องมี `targetFactoryKey`

GET  /api/supply/requests/[id]      detail + items + timeline
PUT  /api/supply/requests/[id]      update draft only
                                    body: {
                                      requesterName?,
                                      targetFactoryKey?,
                                      reasonCode?,
                                      note?,
                                      metadata?,
                                      attachments?,
                                      items?
                                    }
POST /api/supply/requests/[id]      action ใน body:
                                    { action: "submit" }
                                    { action: "approve", approvedQtys: [...], signature }
                                    { action: "reject", note }
                                    { action: "fulfil" }
                                    { action: "cancel" }

GET  /api/supply/transfers          list + filter
                                    ?status=pending_receive&toFactoryKey=bearing
POST /api/supply/transfers          create จาก approved cross_factory request
                                    body: { requestId, toFactoryKey, items: [...], reasonCode?, note, metadata?, attachments? }

GET  /api/supply/transfers/[id]     detail + items
POST /api/supply/transfers/[id]     action ใน body:
                                    { action: "receive", receivedQtys: [...] }
                                    { action: "reject", note }

GET  /api/supply/transfers/stuck    transfer ที่ค้างใน "sending" > 5 นาที (admin only)
                                    ใช้สำหรับ reconciliation และ manual resolve
POST /api/supply/transfers/stuck/[id]
                                    action ใน body:
                                    { action: "retry" }
                                    { action: "cancel" }

GET  /api/supply/borrows            list + filter
POST /api/supply/borrows            create borrow request สำหรับ durable item
GET  /api/supply/borrows/[id]       detail + items + timeline
POST /api/supply/borrows/[id]       action ใน body:
                                    { action: "approve", signature }
                                    { action: "reject", note }
                                    { action: "return", returnedQtys: [...], condition, receiverSignature, note }
GET  /api/supply/borrows/overdue    รายการของค้างคืนเกินกำหนด
```

### RBAC Matrix

> ลำดับสิทธิ์ของโมดูลนี้: `admin > office > manager > factory`
> และ `factory` role ไม่มีสิทธิ์ใช้งาน Supply module
> เพราะ role นี้ใช้กับหน้าจอแสดงออเดอร์ลานขึ้นของเท่านั้น

| Action | admin | manager | office | factory |
|---|---|---|---|---|
| items: view | ✓ | ✓ | ✓ | — |
| items: create/edit | ✓ | — | — | — |
| stock: view own factory | ✓ | ✓ | ✓ | — |
| stock: view all factories | ✓ | — | — | — |
| stock: manual adjust | ✓ | — | — | — |
| request: create | ✓ | ✓ | ✓ | — |
| request: submit | ✓ | ✓ | ✓ | — |
| request: approve/reject | ✓ | ✓ | ✓ | — |
| request: fulfil internal_factory | ✓ | ✓ | ✓ | — |
| transfer: create | ✓ | ✓ | ✓ | — |
| transfer: receive/reject | ✓ | ✓ | ✓ | — |

RBAC notes:
- `GET /api/supply/items` ใช้ได้เฉพาะ `admin / manager / office`
- `request: create` หมายถึง manager/office เป็นคนทำใบเบิกแทน worker
- `cross_factory request` ถูกสร้างจากโรงงานผู้ขอ แต่ผู้ approve ต้องเป็นฝั่งโรงงานที่รับเรื่อง
- `transfer: create` เป็นสิทธิ์ของโรงงานต้นทางที่กำลังส่งของ ไม่ใช่สิทธิ์เฉพาะ SI โดย hard-code

### Audit Actions

```
supply.item.create
supply.item.update
supply.stock.adjust
supply.request.create
supply.request.submit
supply.request.approve      ← บันทึก signature ใน details
supply.request.reject
supply.request.fulfil
supply.request.cancel
supply.transfer.create
supply.transfer.receive
supply.transfer.reject
```

---

## Phase 3 — UI
**3-5 วัน**

### Layout แยก (`src/app/(supply)/layout.tsx`)

```
┌─────────────────────────────────────────┐
│  🏭 คลังพัสดุ — โรงงาน SI   [POS ↗]    │  ← header แยก มี link กลับ POS
├──────────┬──────────────────────────────┤
│ sidebar  │  content                     │
│          │                              │
│ Overview │                              │
│ Stock    │                              │
│ ใบเบิก   │                              │
│ โอนย้าย  │                              │
│ Catalog  │  (admin)                     │
└──────────┴──────────────────────────────┘
```

### `/supply` — Overview

- KPI cards: stock items ใกล้หมด N | ใบเบิกรออนุมัติ N | transfer รอยืนยัน N
- Quick actions: "สร้างใบเบิก" | "ดู Stock"

### `/supply/stock` — Stock คงเหลือ

- Factory filter tabs (admin เห็นทุก tab, manager/office เห็นเฉพาะ factory ตัวเอง)
- Grid cards ต่อ item: ชื่อ, balance, unit, threshold, badge แดงเมื่อ `balance <= threshold`
- ปุ่ม "ปรับยอด" → dialog (admin only)
- ปุ่ม "ซื้อเข้า" → dialog ใส่ qty + note → POST stock/adjust type=purchase_in

### `/supply/requests` — ใบเบิก

- Tabs: ร่าง | รออนุมัติ | อนุมัติแล้ว | ปฏิเสธ | เสร็จสิ้น
- ปุ่ม "สร้างใบเบิกใหม่" → พาไปหน้า `/supply/requests/new` (Catalog UI)
- แต่ละ row → link ไป detail
- draft row ต้องมี quick actions: `แก้ไข`, `ส่งอนุมัติ`, `ยกเลิก`

### `/supply/requests/new` — Catalog & Requisition Cart

> **Desktop only** — ยังไม่รองรับมือถือใน version นี้

Layout (desktop):
```
┌──────────┬────────────────────────────────┬──────────────────┐
│ Category │  Search bar                    │                  │
│ sidebar  ├────────────────────────────────┤  Cart Drawer     │
│ (20%)   │  Grid: SupplyCatalogCard (80%) │  (เปิดเมื่อกด)   │
│          │  col-3 หรือ col-4             │                  │
└──────────┴────────────────────────────────┴──────────────────┘
```

**SupplyCatalogCard component:**
- ชื่อสินค้า (ตัวหนา)
- รูปภาพ หรือ category icon ถ้าไม่มีรูป (`imageUrl` nullable)
- ยอดคงเหลือ (`currentStock`) — สีเทา
- `IF currentStock <= 0` → Card จาง + ปุ่ม disabled + label "ของหมด"
- `IF ยังไม่เลือก` → ปุ่มเต็ม card "เบิกของ"
- `IF เลือกแล้ว` → ปุ่ม `[ - ]  <qty>  [ + ]`
- `IF qty >= currentStock` → ปุ่ม `[ + ]` disabled

**Floating Cart button:**
- มุมขวาล่าง sticky
- แสดงเมื่อมีของในตะกร้า: "ตะกร้า (N รายการ)" สีเขียว
- กดแล้วเปิด `SupplyCartDrawer`

**SupplyCartDrawer component (Sheet จาก shadcn/ui):**
- เลื่อนออกจากขวา
- Header: "สรุปรายการเบิก"
- เป็น multi-step drawer ใน panel เดิม ไม่ต้องสร้างหน้าใหม่
- Step 1: ตรวจรายการสินค้า
  - แต่ละ item แก้ qty ได้ หรือกดลบ
- Step 2: เลือก `requestType`
  - `เบิกในโรงงาน`
  - `เบิกข้ามโรงงาน`
  - ถ้าเลือก `เบิกข้ามโรงงาน` ให้แสดง dropdown `targetFactory`
- Step 3: กรอก `requesterName` (required)
- Step 4: กรอก `reasonCode` และ Textarea "หมายเหตุ / เหตุผลการเบิก" (required)
- Step 4.1: แนบ `metadata หน้างาน` เพิ่มได้ เช่น แผนก, เครื่องจักร, งานที่ใช้, reference ภายนอก
- Step 4.2: แนบ `attachments` ได้อย่างน้อยในรูป reference/link ก่อน แม้ version แรกยังไม่ทำ upload เต็ม
- Step 5: ปุ่ม "ส่งคำขอ" เต็มความกว้าง → `POST /api/supply/requests` status=pending
- หลัง submit → redirect กลับ `/supply/requests` พร้อมแสดง toast สถานะ pending
- ต้องมีปุ่ม `บันทึกร่าง` → `POST /api/supply/requests` status=draft และกลับมาแก้ต่อได้

**Frontend State (useRequisitionCart):**
```typescript
// src/lib/supply/use-requisition-cart.ts
// ใช้ React state หรือ Zustand (ตามแนวทางโปรเจกต์เดิม)
interface RequisitionCartStore {
  items: { supplyItemId: number; quantity: number; name: string; unit: string }[]
  requestType: "internal_factory" | "cross_factory"
  targetFactoryKey?: "si" | "bearing" | "ktk"
  requesterName: string
  note: string
  actions: {
    addItem(item): void
    removeItem(supplyItemId: number): void
    updateQuantity(supplyItemId: number, qty: number): void
    setRequestType(type): void
    setTargetFactoryKey(factoryKey): void
    setRequesterName(name): void
    setNote(note): void
    clearCart(): void
  }
}
```

> **Server-side validation:** quantity validation ต้องทำทั้ง client และ server
> client ป้องกัน UX, server ป้องกัน race condition (stock อาจเปลี่ยนระหว่าง user เลือกอยู่)
> client ต้อง disable submit ถ้า `requesterName` ว่าง, `note` ว่าง,
> หรือกรณี `cross_factory` ที่ยังไม่ได้เลือก `targetFactory`

`/supply/requests/[id]` — Detail
- แสดง items + qty ที่ขอ vs qty ที่อนุมัติ
- Timeline status (draft → pending → approved → fulfilled)
- ถ้า status = `draft` ต้องแก้รายการ, requesterName, reasonCode, metadata, attachments ได้
- Approval panel (office/manager/admin): กรอก qty อนุมัติต่อ item + signature field
- ถ้าเป็น cross_factory request และ approved แล้ว ต้องมี panel "สร้าง Transfer จากใบเบิกนี้"
- ปุ่ม approve (สีเขียว) / reject (สีแดง)

### `/supply/transfers` — โอนย้ายระหว่างโรงงาน

- Tabs: รอยืนยัน | ยืนยันแล้ว | ปฏิเสธ | ทั้งหมด
- ปุ่ม "สร้าง Transfer" ควรมาจาก approved cross_factory request เป็นหลัก
- แต่ละ row pending_receive → ปุ่ม "ยืนยันรับของ" → dialog กรอก qty รับจริงต่อ item
- แสดง shipped vs received เมื่อ status = received/confirmed
- ถ้ามี transfer ค้าง `sending` > 5 นาที ต้องมี warning banner ด้านบนหน้า list
- admin ต้องมี filter/view สำหรับ `stuck transfers`
- detail page ต้องมี action `retry` / `cancel` สำหรับ stuck transfer

### `/supply/borrows` — Durable Borrow / Return

- Tabs: รออนุมัติ | กำลังยืม | คืนบางส่วน | คืนแล้ว | เกินกำหนด | ปฏิเสธ
- list ต้องแสดงผู้ยืม, ของที่ยืม, due date, จำนวนคงค้าง
- detail page ต้องรองรับ approve/reject
- return dialog ต้องกรอกจำนวนคืนจริงต่อ item
- รองรับ partial return
- ต้องมี field `condition on return`, `receiver signature`, `note`
- overdue ต้องมี badge/alert ชัด และมี quick filter

### `/supply/items` — Master Data Catalog (admin)

> หน้านี้คือหน้าจัดการ catalog ของใช้ทั้งหมด ต่างจาก `/supply/requests/new`
> ที่เป็น catalog สำหรับพนักงานเบิกของ

- Table: ชื่อ, unit, category, threshold, imageUrl, link product_type, active toggle
- ปุ่ม "เพิ่มของใช้" → dialog form (รวมช่อง imageUrl)
- ปุ่ม edit ต่อ row → dialog

---

## Phase 4 — Integration
**1 วัน | แตะ POS code 3 จุดเท่านั้น**

### จุดที่ 1 — Main Sidebar (`(dashboard)/layout.tsx`)

เพิ่ม section ใหม่ใน nav ไม่แก้ของเดิม:

```tsx
// เพิ่มต่อท้าย nav section เดิม
<NavSection title="คลังพัสดุ">
  <NavItem href="/supply">Overview</NavItem>
  <NavItem href="/supply/stock">Stock</NavItem>
  <NavItem href="/supply/requests">ใบเบิก</NavItem>
  <NavItem href="/supply/transfers">โอนย้าย</NavItem>
</NavSection>
```

### จุดที่ 2 — Bags Page (`(dashboard)/bags/page.tsx`)

เพิ่มปุ่มข้างปุ่ม "ปรับยอด / คืนถุง" เดิม (admin only):

```tsx
{auth.role === "admin" && (
  <Button
    variant="outline"
    size="sm"
    onClick={() => openSupplyConvertDialog(selectedCustomer)}
  >
    นำเข้า Supply Stock
  </Button>
)}
// → POST /api/supply/stock/adjust { type: "bag_return_manual", supplyItemId: <ถุงกระสอบ id>, ... }
```

> **Scope note (current):** ยังไม่ทำระบบ auto-sync หรือ auto-convert คืนถุงจาก `bag_ledger` ของ POS
> ใน phase นี้ใช้เฉพาะ manual action ผ่านปุ่ม "นำเข้า Supply Stock" เท่านั้น

### จุดที่ 3 — Dashboard KPI (`(dashboard)/dashboard/page.tsx`)

เพิ่ม widget ใหม่ ไม่แก้ widget เดิม:

```tsx
<SupplyAlertWidget />
// GET /api/supply/stock?lowOnly=true
// GET /api/supply/requests?status=pending
// แสดง: "ใบเบิกรออนุมัติ 3 รายการ" | "สินค้าใกล้หมด 2 รายการ"
```

---

## Phase 5 — Hardening
**1-2 วัน | ก่อน release**

### Idempotency

ใช้ `idempotencyKeys` table เดิม เพิ่ม scope ใหม่:

```
scope: "supply.request.approve"   → referenceId = requestId
scope: "supply.transfer.receive"  → referenceId = transferId
```

ป้องกัน double-click approve / double confirm receive

### Low Stock Notification

Query ตอน `(supply)/layout.tsx` load:

```typescript
const lowItems = await fetch("/api/supply/stock?lowOnly=true")
if (lowItems.length > 0) {
  toast.warning(`สินค้าใกล้หมด ${lowItems.length} รายการ`)
}
```

### Reconciliation Job — Stuck Transfer Detection

```typescript
// GET /api/supply/transfers/stuck
// ดึง transfer ที่ status = "sending" และ updatedAt < now - 5min
// แสดงใน /supply/transfers หน้า admin เป็น warning banner
// admin กด "resolve" เพื่อ manually set เป็น cancelled หรือ retry
```

flow เมื่อพบ stuck transfer:
```
status = "sending" + updatedAt < now - 5min
  → แสดง alert ใน /supply overview
  → admin กด inspect → เห็น step ที่ค้าง (fromDb vs toDb status)
  → admin กด "ยกเลิก" → set ทั้งสองฝั่งเป็น "cancelled" + คืน stock
  → หรือ admin กด "retry" → ยิง createTransfer ใหม่
```

### Borrow / Return Hardening

```typescript
// cron / scheduled job หรือ query-on-read
// mark overdue durable borrows
GET /api/supply/borrows/overdue
// ดึง borrow ที่ dueAt < now และ status in ("borrowing", "partial_returned")
// แสดงใน /supply overview และ /supply/borrows
```

- overdue durable borrow ต้องขึ้น alert ที่ overview
- return action ต้อง idempotent เพื่อกัน double submit ตอนคืนของ
- partial return ต้องคำนวณสถานะ `partial_returned` → `returned` อัตโนมัติ

### Tech Debt: SUM Performance [TD-001]

```
[TD-001] supply_stock_balances snapshot table
  ปัญหา: getStockBalances ใช้ SUM(quantity) จาก ledger ทุกครั้ง
         จะช้าลงเมื่อ ledger rows > 50,000 ต่อ factory (~1-2 ปี)

  ตอนนี้: เพิ่ม index ที่ช่วย SUM query
    index("idx_supply_ledger_factory_item").on(factoryKey, supplyItemId)
    partial index .where(sql`quantity != 0`)

  อนาคต (trigger เมื่อ query > 500ms):
    → สร้าง supply_stock_balances table เป็น snapshot
    → หรือใช้ PostgreSQL Materialized View
    → incremental update ทุกครั้งที่ writeStockLedger
```

เพิ่มใน `/api/migrate` registry:

```
action: "supply.seed-items"
  → seed ของใช้เริ่มต้น: ถุงกระสอบ, น้ำยาล้าง, อุปกรณ์
  → linkedProductTypeId ชี้กลับ product_types ที่มี hasBag = true
  → ป้องกัน duplicate ด้วย name check
```

---

## Phase 6 — Durable Borrow / Return + Advanced Request UX
**3-5 วัน | หลัง request/transfer flow หลักนิ่งแล้ว**

### Scope

- ทำ `draft editing flow` ให้ครบ
- เพิ่ม `reasonCode / metadata / attachments references` ใน request และ transfer UI
- ทำ borrow/return workflow สำหรับ `durable item`
- เพิ่ม overdue alert และ operational visibility สำหรับของค้างคืน

### Deliverables

- `/supply/requests` และ `/supply/requests/[id]` รองรับ draft edit จนกว่าจะ submit
- request/transfer form รองรับ metadata หน้างาน และ attachment references
- `/supply/borrows` list/detail/action ครบ
- approve borrow / reject borrow / return / partial return / overdue tracking
- return flow บังคับ `condition` และ `receiverSignature`

---

## Timeline Summary

| Phase | งาน | เวลา | Dependency |
|---|---|---|---|
| 0 | Schema + Migration | 1-2 วัน | — |
| 1 | Stock/Request/Transfer Engine + Tests | 2-3 วัน | Phase 0 |
| 2 | API Routes | 2-3 วัน | Phase 1 |
| 3 | UI 5 หน้า | 3-5 วัน | Phase 2 |
| 4 | Integration 3 จุด | 1 วัน | Phase 3 |
| 5 | Hardening | 1-2 วัน | Phase 4 |
| 6 | Durable Borrow/Return + Draft/Metadata UX | 3-5 วัน | Phase 5 |
| **รวม** | | **~13-21 วัน** | |

---

## Risks & Mitigations

| Risk | ความรุนแรง | Mitigation |
|---|---|---|
| Dual-write partial failure ("ของลอยกลางอากาศ") | สูง | Saga pattern + "sending" status + reconciliation job ใน Phase 5 |
| SUM(quantity) ช้าระยะยาว | ต่ำ (ระยะสั้น) | Index ใน Phase 0 + Tech Debt [TD-001] ทำเมื่อ trigger |
| Branch DB offline ตอน receive transfer | กลาง | Saga step แยก — toDb ล้มเหลวไม่กระทบ fromDb, retry ได้ |
| Double-click approve/receive | กลาง | Idempotency key ใน Phase 5 (ใช้ table เดิม) |

---

## Decisions Log

| เรื่อง | ตัดสินใจ | เหตุผล |
|---|---|---|
| Transfer DB | Dual-write ทั้งสองฝั่ง | ต้องการ record ทั้ง sender และ receiver |
| Dual-write failure handling | Saga pattern + "sending" status + reconciliation job | ป้องกัน data inconsistency กรณี partial failure |
| Entry document | ทุก flow เริ่มจาก supply_request | operation จริงเริ่มจากการ "ขอเบิก" ไม่ใช่การสร้าง transfer ตรง |
| Supply vs Product types | แยก supply_items + linkedProductTypeId | รักษา boundary ระหว่าง module |
| Low stock threshold | Per-factory (supplyStockThresholds) + global fallback | แต่ละโรงงานมีความต้องการต่างกัน |
| Approval | Single approver + required signature | เรียบง่าย แต่มี accountability |
| Request ownership | เก็บทั้ง requesterName (required) และ createdBy | คนงานเป็นผู้ขอใช้จริง แต่ manager/office เป็นคนทำเอกสาร |
| Stock deduction timing | ตัด stock ตอน fulfil หรือส่ง transfer จริง | ตรงกับ operation หน้างานและป้องกัน stock หายก่อนจ่ายจริง |
| Bag return → Supply | Manual convert โดย admin เท่านั้น | ถุงคืนจากลูกค้าเป็น "ถุงมือสอง" ต้องคัดก่อน |
| POS bag_ledger integration | ยังไม่ทำ auto-sync/auto-convert | กัน scope ไหล และคง boundary ให้ Supply/POS แยกกันก่อน |
| Code separation | Route group (supply) แยกจาก (dashboard) | Mini ERP pattern — module ชัดเจน ไม่ปนกัน |
| Stock calculation | Ledger-based SUM + index ตอนนี้ | เรียบง่าย snapshot เป็น TD-001 ทำเมื่อ query ช้า |

| Requisition UX | Shopping cart (catalog + multi-step cart drawer) | ใช้งานง่ายและยังรองรับ internal/cross-factory request ใน flow เดียว |
| imageUrl | เพิ่ม imageUrl nullable ใน supply_items | รองรับ catalog UX ใน Phase 3 |
| Mobile support | Desktop only ใน version นี้ | โรงงานใช้คอม ไม่จำเป็นต้องรองรับมือถือตอนนี้ |
| Cart submit status | ส่ง status=pending ทันที (ข้าม draft) | user ยืนยันแล้วใน cart ไม่จำเป็นต้องมี draft step |
| Draft support | ต้องมีทั้ง quick-submit และ save-draft/edit-draft | บางงานต้องเตรียมใบก่อนค่อยส่งอนุมัติ |
| Operational metadata | request/transfer ต้องรองรับ reasonCode + metadata + attachment refs | note อย่างเดียวไม่พอสำหรับหน้างานจริง |
| Transfer stuck visibility | ต้องมีทั้ง API และ UI warning/action | ปัญหา operational ต้องมองเห็นได้จากหน้าระบบ ไม่ใช่ซ่อนใน API |
| Durable item lifecycle | durable ต้องมี borrow/return flow แยกจาก consumable | fulfil อย่างเดียวไม่พอ เพราะต้องติดตามของที่ต้องคืน |
| currentStock ใน API | รวมใน GET /api/supply/items response | ลด round-trip และ simplify catalog page |

---

*เอกสารนี้เป็น living document — อัปเดตเมื่อมี decision ใหม่ก่อนเริ่มแต่ละ phase*
