# Supply Module Production Merge Plan

**Last updated:** 2026-05-01

## Purpose

เอกสารนี้อธิบายว่าเมื่อพัฒนา Supply module เสร็จใน repo ที่คัดลอกออกมาแล้ว
จะนำกลับไปรวมกับ repo production เดิมอย่างไรให้เสี่ยงต่ำ, ตรวจสอบง่าย,
และไม่เผลอ overwrite งาน production ที่เดินต่ออยู่

## Important Constraint

โปรเจกต์นี้ถูกคัดลอกออกมาและสร้าง Git history ใหม่

ดังนั้น **ไม่ควร merge repo-to-repo ตรง ๆ**
และไม่ควรใช้ `--allow-unrelated-histories` เป็นวิธีหลัก

เหตุผล:

- ประวัติ commit คนละเส้น
- production อาจมี hotfix หรือ config เปลี่ยนไปแล้ว
- ถ้า merge ทั้งก้อน จะ review ยากมากและ rollback ยาก

แนวทางที่แนะนำคือ:

1. พัฒนา Supply module ให้แยก path ชัดที่สุด
2. ตอนรวมกลับ ให้ “ย้ายเข้า production เป็นชุดงานย่อย”
3. เปิด PR แยกตาม slice ของระบบ ไม่ย้ายทั้ง repo ในครั้งเดียว

## Merge Strategy Summary

วิธีที่แนะนำคือ **Patch-based transplant + PR แบบแยก phase**

ภาพรวม:

1. Freeze จุดตั้งต้นของ production
2. เทียบ diff เฉพาะไฟล์ของ Supply module
3. ย้ายเข้า production ทีละชุด
4. รัน schema rollout ก่อนเปิด UI
5. เปิดใช้งานแบบ staged rollout

## File Groups

เวลาย้ายกลับเข้า production ให้คิดเป็น 5 ชุดไฟล์

### Group A — Schema + Core Supply Domain

ไฟล์หลัก:

- `src/shared/db/schema/index.ts`
- `src/shared/db/schema/core.ts`
- `src/shared/db/schema/supply.ts`
- `src/shared/db/schema/supply-entry.ts`
- `src/lib/supply/stock-engine.ts`
- `src/lib/supply/request-engine.ts`
- `src/lib/supply/transfer-engine.ts`
- `src/lib/__tests__/stock-engine.test.ts`
- `src/lib/__tests__/request-engine.test.ts`
- `src/lib/__tests__/transfer-engine.test.ts`

เป้าหมาย:

- เพิ่ม enum / table / relation ของ Supply โดยแยกออกจาก schema ของ POS
- เพิ่ม business logic ที่ยังไม่ผูกกับ UI
- ทำให้ production repo “รู้จัก supply domain” ก่อน

### Group B — Supply API

ไฟล์เป้าหมายในอนาคต:

- `src/app/api/supply/items/route.ts`
- `src/app/api/supply/items/[id]/route.ts`
- `src/app/api/supply/stock/route.ts`
- `src/app/api/supply/stock/adjust/route.ts`
- `src/app/api/supply/requests/route.ts`
- `src/app/api/supply/requests/[id]/route.ts`
- `src/app/api/supply/transfers/route.ts`
- `src/app/api/supply/transfers/[id]/route.ts`

ไฟล์ช่วยที่อาจแตะ:

- `src/lib/api-auth.ts`
- `src/lib/factory-context.ts`
- `src/lib/audit.ts`

เป้าหมาย:

- ให้ backend พร้อมใช้งานก่อน
- เปิด test API ได้โดยยังไม่ต้องเปิดหน้า UI จริง

### Group C — Supply UI

ไฟล์เป้าหมายในอนาคต:

- `src/app/(supply)/layout.tsx`
- `src/app/(supply)/supply/page.tsx`
- `src/app/(supply)/supply/stock/page.tsx`
- `src/app/(supply)/supply/items/page.tsx`
- `src/app/(supply)/supply/requests/page.tsx`
- `src/app/(supply)/supply/requests/[id]/page.tsx`
- `src/app/(supply)/supply/transfers/page.tsx`
- `src/app/(supply)/supply/transfers/[id]/page.tsx`

ไฟล์ shared UI ที่อาจแตะ:

- `src/components/nav.tsx`
- `src/components/ui/*` เฉพาะที่จำเป็น

เป้าหมาย:

- เปิดใช้งานหน้าจอ supply แบบไม่ชนกับ POS เดิม
- ให้ reviewer เห็นขอบเขตชัดว่าเป็น “โมดูลใหม่”

### Group D — POS Bridge Points

ไฟล์ที่ plan ระบุว่าจะยอมแตะ:

- `src/app/(dashboard)/bags/page.tsx`
- อื่น ๆ เฉพาะจุดที่ถูกอนุมัติใน plan

กฎ:

- แตะเฉพาะ additive bridge
- ห้าม refactor POS ใหญ่ใน PR เดียวกับ Supply

### Group E — Rollout / Docs / Scripts

ไฟล์เอกสารและ script:

- `supply-module-plan.md`
- `docs/supply-production-merge-plan.md`
- `scripts/push-schema.ts`
- `package.json`
- scripts อื่นที่ช่วย migrate / verify ถ้าจำเป็น

เป้าหมาย:

- ทำให้ทีม production deploy ตามเอกสารได้
- ลดการพึ่งความจำของคนทำ

## Recommended Reintegration Order

ลำดับที่แนะนำ:

1. Group A
2. Group B
3. Schema push + DB verify บน dev/staging
4. Group C
5. Group D
6. Production rollout

เหตุผล:

- ถ้า schema กับ engine ยังไม่นิ่ง UI จะเปลี่ยนซ้ำ
- ถ้า API ยังไม่เข้า production ก่อน UI, หน้าเว็บจะทดสอบยาก
- bridge กับ POS ควรเข้าทีหลังสุด เพราะเป็นจุดเสี่ยง regression

## Branch Plan In Production Repo

เมื่อถึงเวลาย้ายกลับ ให้ทำใน production repo แบบนี้:

1. `codex/supply-phase0-schema-core`
2. `codex/supply-phase1-api`
3. `codex/supply-phase2-ui`
4. `codex/supply-phase3-pos-bridge`
5. `codex/supply-phase4-rollout`

แต่ละ branch ต้อง review และ merge แยกกัน

## How To Move Changes Between Unrelated Repos

วิธีที่แนะนำมี 2 แบบ

### Option A — Patch transplant (Recommended)

ใช้เมื่อ production repo ยังโครงสร้างใกล้กับ repo นี้

ใน supply repo:

```bash
git diff --binary <baseline_commit>..HEAD -- \
  src/shared/db/schema/index.ts \
  src/shared/db/schema/core.ts \
  src/shared/db/schema/supply.ts \
  src/shared/db/schema/supply-entry.ts \
  src/lib/supply \
  src/lib/__tests__/stock-engine.test.ts \
  src/lib/__tests__/request-engine.test.ts \
  src/lib/__tests__/transfer-engine.test.ts \
  scripts/push-schema.ts \
  package.json \
  > /tmp/supply-phase0.patch
```

ใน production repo:

```bash
git apply --3way /tmp/supply-phase0.patch
```

ข้อดี:

- เก็บ diff เฉพาะส่วน
- เห็น conflict ชัด
- ไม่ลาก history ทั้ง repo มาปนกัน

### Option B — Manual transplant by file group

ใช้เมื่อ production repo drift ไปเยอะแล้ว

วิธี:

1. เปิด repo สองฝั่งคู่กัน
2. คัดลอกเฉพาะไฟล์ในแต่ละ group
3. ตรวจ type, test, lint ใน production repo
4. commit แยกตาม phase

ข้อดี:

- คุม conflict ได้ดีกว่า
- เหมาะกับเคสที่ production มี hotfix เพิ่มเองหลายจุด

## Baseline Rules Before Merging Back

ก่อนย้าย code จาก repo นี้เข้า production ต้องทำ 4 อย่าง

1. Tag จุดเริ่มต้นของ production

ตัวอย่าง:

```bash
git tag production-pre-supply-merge-2026-04-30
```

2. Freeze งานที่แตะ path เดียวกันชั่วคราว

โดยเฉพาะ:

- `src/shared/db/schema/index.ts`
- `src/shared/db/schema/core.ts`
- `src/shared/db/schema/supply.ts`
- `src/shared/db/schema/supply-entry.ts`
- `src/components/nav.tsx`
- `src/app/(dashboard)/bags/page.tsx`

3. Export file manifest

ต้องมีรายการชัดว่า PR นี้แตะไฟล์ไหนบ้าง

4. Rebase logic mentally against current production

แม้จะไม่ได้ rebase git ตรง ๆ
แต่ต้องเช็กว่า production มีการเปลี่ยน behavior ใน path เหล่านั้นแล้วหรือยัง

## Database Rollout Plan

Supply module พึ่ง schema ใหม่
ดังนั้น rollout database ต้องมาก่อนเปิดใช้งานจริง

### Step 1 — Backup

สำรองทุกฐานก่อน:

- `DATABASE_URL`
- `DATABASE_URL_SI`
- `DATABASE_URL_BEARING`
- `DATABASE_URL_KTK`

### Step 2 — Apply schema in non-production first

เริ่มจาก dev/staging ก่อน แล้วค่อย production

ถ้าจะ rollout เฉพาะ Supply module ให้ใช้:

```bash
npm run db:push:supply
```

คำสั่งนี้ตั้งค่า:

- `SCHEMA_PATH_OVERRIDE=./src/shared/db/schema/supply-entry.ts`
- `SCHEMA_PUSH_SANITIZE=false`

เพื่อ push เฉพาะ schema entry ของ Supply โดยไม่พา schema bundle ของ POS ทั้งก้อน
และไม่รัน legacy sanitize step ของ `db:push`

ถ้าต้อง rollout แบบค่อยเป็นค่อยไปตาม database target ให้ใช้ `SCHEMA_PUSH_TARGETS`
ร่วมกับ script ที่เหมาะกับงาน:

- ใช้ `npm run db:push:supply` เมื่อ rollout เฉพาะ Supply
- ใช้ `npm run db:push` เฉพาะกรณีที่ตั้งใจ rollout schema หลักทั้งระบบ

ตัวอย่าง:

```env
SCHEMA_PUSH_TARGETS=DATABASE_URL,DATABASE_URL_SI
```

### Step 3 — Verify supply tables exist on every factory DB

ต้องตรวจว่าทุก DB มีเหมือนกัน:

- `supply_items`
- `supply_stock_thresholds`
- `supply_stock_ledger`
- `supply_requests`
- `supply_request_items`
- `supply_transfers`
- `supply_transfer_items`

และ enum ใหม่:

- `supply_stock_ledger_type`
- `supply_request_status`
- `supply_transfer_status`

### Step 4 — Seed / bootstrap only if needed

ถ้ามี seed เริ่มต้นของ supply items
ให้แยกเป็น script ชัดเจน ห้ามแอบ seed ระหว่าง route runtime

## Production Rollout Sequence

### Phase 1 — Dark launch

- merge schema + engine + API ก่อน
- ยังไม่เปิด menu ให้ user ทั่วไป
- ให้ admin ทดลองผ่าน route หรือ hidden entry point ก่อน

### Phase 2 — Internal pilot

- เปิดใช้กับ 1 โรงงานก่อน เช่น `si`
- ทดลอง create request, approve, transfer, receive
- ตรวจ ledger และ audit log

### Phase 3 — Multi-factory pilot

- เปิด `bearing`
- ทดสอบ cross-factory transfer จริง
- เช็กว่า `transferRef` ผูกสองฝั่งได้ถูก

### Phase 4 — Full rollout

- เปิด UI ให้ role ที่เกี่ยวข้อง
- เปิด bridge จาก POS เฉพาะจุดที่ plan อนุมัติ

## Merge Readiness Checklist

จะถือว่า “พร้อมย้ายเข้า production” เมื่อครบทั้งหมดนี้

- schema เป็น additive เท่านั้น
- file ownership ของ Supply ชัด อยู่ใน `src/lib/supply`, `src/app/(supply)`, `src/app/api/supply`
- POS touch points มีน้อยและระบุชัด
- มี test สำหรับ engine อย่างน้อย stock/request/transfer
- รัน lint ผ่านใน production repo
- รัน targeted tests ได้ใน production repo
- มี rollback plan สำหรับ schema และ feature flag / menu visibility
- มี SQL verification checklist หลัง deploy

## Rollback Plan

ถ้า merge code แล้วแต่ยังไม่เปิด UI:

- ปิด route/menu visibility
- หยุด rollout ไว้ที่ schema only

ถ้าเปิดใช้แล้วพบปัญหา:

1. ปิด menu / hidden navigation ก่อน
2. หยุด create/approve/transfer route ชั่วคราว
3. เก็บ snapshot ของ `supply_*` tables
4. แก้ data inconsistency ตาม `transferRef`
5. ค่อยออก hotfix

หมายเหตุ:

- schema additive rollback ไม่ควรเริ่มจาก `DROP TABLE` ทันที
- ให้หยุด feature ก่อน แล้วค่อยประเมิน data rollback

## Recommended Companion Files

เมื่อ Supply module ใกล้เสร็จ ควรมีเอกสารเพิ่มอีก 2 ไฟล์

1. `docs/supply-integration-manifest.md`

ใช้ list ไฟล์จริงที่จะย้ายเข้า production แยกตาม phase

2. `docs/supply-production-checklist.md`

ใช้เป็นวัน deploy จริง:

- backup
- schema push
- verify DB
- verify API
- verify UI
- verify cross-factory transfer

## Decision

สรุปแนวทางที่ควรใช้สำหรับโปรเจกต์นี้:

- **ไม่ merge repo ทั้งก้อน**
- **ไม่ใช้ unrelated histories เป็นทางหลัก**
- **ย้ายกลับเข้า production เป็น phase**
- **แยกตาม file groups**
- **schema/API/UI/POS bridge ต้องเข้าเป็นคนละช่วง**

นี่คือแนวทางที่ review ง่ายสุด, rollback ง่ายสุด, และเสี่ยงกับ production ต่ำสุด
