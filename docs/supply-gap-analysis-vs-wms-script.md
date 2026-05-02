# Supply Gap Analysis vs WMS-Script

เป้าหมายของเอกสารนี้คือเทียบ **Supply module ปัจจุบันใน repo หลัก** กับ **WMS-Script** เพื่อดูว่าอะไรมีแล้ว, อะไรมีบางส่วน, และอะไรยังขาดอยู่ ถ้าจะยกระดับ Supply ในระบบหลักให้เทียบหรือดีกว่า WMS-Script

## Legend

- `[x]` มีแล้วในระบบปัจจุบัน
- `[~]` มีบางส่วน / โครงสร้างรองรับ แต่ยังไม่ครบเท่า WMS-Script
- `[ ]` ยังไม่มีในระบบปัจจุบัน

## Baseline ที่เทียบ

ฝั่งระบบปัจจุบัน:

- [src/shared/db/schema/supply.ts](/Users/bhusitt./Downloads/superice-pos-main/src/shared/db/schema/supply.ts)
- [src/lib/supply/stock-engine.ts](/Users/bhusitt./Downloads/superice-pos-main/src/lib/supply/stock-engine.ts)
- [src/lib/supply/request-engine.ts](/Users/bhusitt./Downloads/superice-pos-main/src/lib/supply/request-engine.ts)
- [src/lib/supply/transfer-engine.ts](/Users/bhusitt./Downloads/superice-pos-main/src/lib/supply/transfer-engine.ts)
- [src/app/(supply)/supply/page.tsx](/Users/bhusitt./Downloads/superice-pos-main/src/app/(supply)/supply/page.tsx)
- [src/app/(supply)/supply/stock/page.tsx](/Users/bhusitt./Downloads/superice-pos-main/src/app/(supply)/supply/stock/page.tsx)
- [src/app/(supply)/supply/items/page.tsx](/Users/bhusitt./Downloads/superice-pos-main/src/app/(supply)/supply/items/page.tsx)
- [src/app/(supply)/supply/requests/page.tsx](/Users/bhusitt./Downloads/superice-pos-main/src/app/(supply)/supply/requests/page.tsx)
- [src/app/(supply)/supply/requests/new/page.tsx](/Users/bhusitt./Downloads/superice-pos-main/src/app/(supply)/supply/requests/new/page.tsx)
- [src/app/(supply)/supply/requests/[id]/page.tsx](/Users/bhusitt./Downloads/superice-pos-main/src/app/(supply)/supply/requests/[id]/page.tsx)
- [src/app/api/supply](</Users/bhusitt./Downloads/superice-pos-main/src/app/api/supply>)

ฝั่ง WMS-Script:

- [WMS-Script/Code.gs](/Users/bhusitt./Downloads/superice-pos-main/WMS-Script/Code.gs)
- [WMS-Script/CodeReport.gs](/Users/bhusitt./Downloads/superice-pos-main/WMS-Script/CodeReport.gs)
- [WMS-Script/CodeScheduledReports.gs](/Users/bhusitt./Downloads/superice-pos-main/WMS-Script/CodeScheduledReports.gs)
- [WMS-Script/QRCode.gs](/Users/bhusitt./Downloads/superice-pos-main/WMS-Script/QRCode.gs)
- [WMS-Script/js.html](/Users/bhusitt./Downloads/superice-pos-main/WMS-Script/js.html)
- [WMS-Script/js-qrcode.html](/Users/bhusitt./Downloads/superice-pos-main/WMS-Script/js-qrcode.html)
- [WMS-Script/js-report.html](/Users/bhusitt./Downloads/superice-pos-main/WMS-Script/js-report.html)

## Executive Summary

สรุปสั้น ๆ:

- ระบบปัจจุบัน **ชนะเรื่อง architecture, state machine, auditability, validation, testing**
- WMS-Script **ชนะเรื่อง breadth ของ feature หน้างาน**
- ถ้าจะเดินต่อ ควรใช้ **Supply ปัจจุบันเป็นฐานหลัก** แล้ว **port feature จาก WMS-Script เข้ามาเป็นช่วง ๆ**

## Checklist

### 1. Master Data / Catalog

- `[x]` จัดการ Supply item master data
- `[x]` มี field พื้นฐาน เช่น name, unit, category, itemCode, image, barcode, brand, model
- `[x]` มี low stock threshold
- `[x]` มี pack size และ unit conversion
- `[x]` มี borrow limit เป็น metadata
- `[~]` มี item type แต่ยังใช้ในเชิง catalog มากกว่า workflow จริง
- `[~]` มี settings สำหรับ units/categories แต่ยังไม่ลึกเท่า settings กลางใน WMS-Script

Gap ที่เหลือ:

- `[ ]` ยังไม่มี category/location/factory master management แบบละเอียดใน supply module เอง
- `[ ]` ยังไม่มี asset/location enrichment แบบที่สแกนแล้วเห็นตำแหน่งจัดเก็บชัด ๆ เหมือน WMS

### 2. Stock Model / Inventory Engine

- `[x]` มี stock ledger แยกชัดเจน
- `[x]` มี stock balance per factory
- `[x]` มี manual purchase-in / adjustment
- `[x]` มี low-stock filtering
- `[x]` มี stock sufficiency check ก่อนอนุมัติ/โอน
- `[x]` มี cross-factory transfer model ชัดเจน

Gap ที่เหลือ:

- `[ ]` ยังไม่มี lot-based stock
- `[ ]` ยังไม่มี FIFO deduction
- `[ ]` ยังไม่มี expiry-aware stock movement
- `[ ]` ยังไม่มี migration/helper สำหรับ legacy stock แบบ WMS (`Asset_Lots`, `Transaction_Lots`)

### 3. Request / Approval Workflow

- `[x]` มี request status หลัก: draft, pending, approved, rejected, fulfilled, cancelled
- `[x]` มี approver signature ตอน approve
- `[x]` มี approved quantities ต่อรายการ
- `[x]` internal factory request แยกจาก cross-factory request
- `[x]` แนวคิด approve แล้วค่อย fulfil จริง ถูกต้องกว่า WMS ในเชิง control

Gap ที่เหลือ:

- `[~]` schema รองรับ draft แต่ UI ปัจจุบันเน้น submit เป็น `pending` ทันที ยังไม่มี draft editing flow ที่สมบูรณ์เท่า WMS
- `[ ]` ยังไม่มี requisition history/reporting เชิงลึก เช่น top requester, approval efficiency, rejected item trends
- `[ ]` ยังไม่มีแนบเหตุผล/เอกสาร/metadata หน้างานเท่า WMS

### 4. Transfer Workflow

- `[x]` มี transfer lifecycle ชัดเจน
- `[x]` ส่งของข้ามโรงงานได้
- `[x]` receive ปลายทางได้
- `[x]` reject transfer แล้วย้อน stock ต้นทางได้
- `[x]` มี transfer reference และ dual-side sync logic

Gap ที่เหลือ:

- `[ ]` ยังไม่มี dashboard/alert สำหรับ transfer stuck แบบ operational มากนัก นอกจาก API
- `[ ]` ยังไม่มี print เอกสาร transfer / packing style output
- `[ ]` ยังไม่มี proof-of-delivery หรือ signature ตอนรับของ

### 5. Borrow / Return

- `[~]` มี `borrowLimit` ใน item master

Gap ที่เหลือ:

- `[ ]` ยังไม่มี borrow request workflow
- `[ ]` ยังไม่มี approve borrow
- `[ ]` ยังไม่มี return flow
- `[ ]` ยังไม่มี partial return
- `[ ]` ยังไม่มี condition on return / receiver signature
- `[ ]` ยังไม่มี overdue borrow tracking

นี่เป็น gap ใหญ่ เพราะ WMS-Script มี flow นี้ครบกว่ามาก

### 6. Non-Stock Requisition

- `[ ]` ยังไม่มี non-stock requisition module
- `[ ]` ยังไม่มี flow ขอของนอกรายการ
- `[ ]` ยังไม่มี action แปลง non-stock item เข้า stock/catalog ภายหลัง

ถ้าหน้างานมีการขอของที่ยังไม่อยู่ใน catalog บ่อย ฟีเจอร์นี้น่าจะสำคัญ

### 7. Barcode / QR / Scanning

- `[x]` current supply เก็บ barcode ใน item master ได้

Gap ที่เหลือ:

- `[ ]` ยังไม่มี barcode generation flow
- `[ ]` ยังไม่มี bulk barcode generation
- `[ ]` ยังไม่มี scan lookup flow
- `[ ]` ยังไม่มี scanner modal / camera-based scanning
- `[ ]` ยังไม่มี barcode print labels
- `[ ]` ยังไม่มี scan-to-action เช่น scan แล้ว restock/edit/borrow/return ต่อได้

อันนี้ WMS-Script เด่นชัดมากจาก [QRCode.gs](/Users/bhusitt./Downloads/superice-pos-main/WMS-Script/QRCode.gs) และ [js-qrcode.html](/Users/bhusitt./Downloads/superice-pos-main/WMS-Script/js-qrcode.html)

### 8. Reporting / Analytics

- `[~]` current supply มี overview KPI พื้นฐาน
- `[~]` current supply มี stock ต่ำ / request pending / transfer pending ในหน้า overview

Gap ที่เหลือ:

- `[ ]` ยังไม่มี reports page เฉพาะ supply
- `[ ]` ยังไม่มี movement analysis (fast/slow moving)
- `[ ]` ยังไม่มี inventory valuation
- `[ ]` ยังไม่มี near-expiry report
- `[ ]` ยังไม่มี requisition analytics รายเดือน/รายแผนก/รายโรงงาน
- `[ ]` ยังไม่มี export CSV/PDF สำหรับ supply โดยตรง
- `[ ]` ยังไม่มี printable executive summary แบบ WMS

นี่เป็นอีก gap ใหญ่มาก เพราะ WMS-Script มีชุดรายงานครบใน [CodeReport.gs](/Users/bhusitt./Downloads/superice-pos-main/WMS-Script/CodeReport.gs) และ [js-report.html](/Users/bhusitt./Downloads/superice-pos-main/WMS-Script/js-report.html)

### 9. Notification / Scheduled Email

- `[ ]` ยังไม่มี low stock notification ใน supply module โดยตรง
- `[ ]` ยังไม่มี in-app notification feed สำหรับ supply events
- `[ ]` ยังไม่มี email notification สำหรับ approve / reject / new request / transfer receive
- `[ ]` ยังไม่มี scheduled report emails
- `[ ]` ยังไม่มี configurable report recipients แบบ WMS

WMS-Script มีครบกว่ามากผ่าน `Notifications`, `getLoginNotifications`, `createNotification`, `sendEmailNotification`, และ [CodeScheduledReports.gs](/Users/bhusitt./Downloads/superice-pos-main/WMS-Script/CodeScheduledReports.gs)

### 10. Lot / Expiry / Batch Control

- `[ ]` ยังไม่มี lot number per inbound stock
- `[ ]` ยังไม่มี receive date / expiry date per lot
- `[ ]` ยังไม่มี remaining quantity per lot
- `[ ]` ยังไม่มี lot consumption history
- `[ ]` ยังไม่มี FIFO engine ตาม lot
- `[ ]` ยังไม่มี lot-level reporting และ expiry warnings

ถ้าของใช้/วัตถุดิบมีอายุหรือจำเป็นต้อง trace batch นี่คือ P0/P1 ด้าน domain เลย

### 11. Print / Document Outputs

- `[ ]` ยังไม่มี print barcode labels
- `[ ]` ยังไม่มี requisition PDF ที่พร้อมใช้หน้างาน
- `[ ]` ยังไม่มี transfer printout
- `[ ]` ยังไม่มี report PDF สำหรับผู้บริหาร

### 12. History / Audit / Traceability

- `[x]` ระบบปัจจุบันมี audit log infrastructure ดีกว่า
- `[x]` action สำคัญใน supply route มีการ `logAudit`

Gap ที่เหลือ:

- `[~]` มี audit backend แล้ว แต่ UI history/timeline เชิงมนุษย์อ่านยังไม่ลึกเท่า WMS
- `[ ]` ยังไม่มี combined user-facing history แบบ “ประวัติของฉัน” สำหรับ supply
- `[ ]` ยังไม่มี approval history view แบบแยกเฉพาะ

### 13. UX / Operational Convenience

- `[x]` UI ใหม่ใช้งานง่ายกว่าและกลืนกับ app หลัก
- `[x]` item catalog / request cart / stock page เป็นฐานที่ดี

Gap ที่เหลือ:

- `[ ]` ยังไม่มี scanner-first workflow
- `[ ]` ยังไม่มี modal/action shortcuts สำหรับงานหน้างานเร็ว ๆ
- `[ ]` ยังไม่มี “one-stop operational console” แบบ WMS ที่รวมเบิก/ยืม/คืน/สแกน/รายงานไว้ในโมดูลเดียว

## Priority Backlog

### P0 — ถ้าจะให้ Supply ใช้งานแทน WMS-Script ได้จริง

- `[ ]` Borrow / return workflow
- `[ ]` Barcode scan + label print flow
- `[ ]` Notifications สำหรับ request / transfer / low stock
- `[ ]` Supply reports ขั้นพื้นฐาน: stock, movement, request summary, exports

### P1 — ถ้าหน้างานมีของหมดอายุหรือ trace lot

- `[ ]` Lot / batch / expiry model
- `[ ]` FIFO deduction
- `[ ]` Expiry alerts + near-expiry report

### P2 — เพิ่มความลื่นในการใช้งานและการกำกับดูแล

- `[ ]` Draft editing flow ให้ครบ
- `[ ]` Better timeline / history UI
- `[ ]` Print documents สำหรับ requisition / transfer
- `[ ]` Scheduled email summaries

## Recommended Porting Order from WMS-Script

1. Barcode/QR flow
2. Borrow/return flow
3. Notification + low stock alerts
4. Reports + CSV/PDF export
5. Lot/FIFO/expiry
6. Non-stock requisition

## Recommendation

ข้อแนะนำหลักคือ:

- **อย่าย้ายกลับไปใช้ WMS-Script เป็นฐาน**
- ให้ใช้ **Supply ปัจจุบันเป็น core**
- แล้วเลือก **port เฉพาะ feature ที่ขาดจาก WMS-Script**

เหตุผลคือระบบปัจจุบันมีฐานโครงสร้างที่สะอาดกว่า, testable กว่า, และเข้ากับ repo หลักอยู่แล้ว ส่วน WMS-Script เหมาะเป็นแหล่งอ้างอิง behavior และ feature checklist มากกว่า
