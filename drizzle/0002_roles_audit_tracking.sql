-- Phase 1A: Expand user_role enum and add new roles
-- Step 1: Add new enum values
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'office';
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'manager';
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'factory';

-- Step 2: Convert existing 'user' role to 'office'
-- Note: This requires a workaround since you can't remove enum values in PG.
-- We need to rename the type, create a new one, and migrate.
-- However since we already added the new values above, and 'user' still exists,
-- we simply UPDATE the rows:
UPDATE users SET role = 'office' WHERE role = 'user';

-- Phase 1A: Add tracking columns to transactions
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id");
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "voided_by" integer REFERENCES "users"("id");
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "void_reason" text;

-- Phase 1A: Add tracking columns to production_logs
ALTER TABLE "production_logs" ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id");

-- Phase 1A: Add tracking columns to bag_ledger
ALTER TABLE "bag_ledger" ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id");

-- Phase 1A: Create audit_log table
CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer REFERENCES "users"("id"),
  "username" text NOT NULL,
  "action" text NOT NULL,
  "entity" text NOT NULL,
  "entity_id" integer,
  "details" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Phase 1A: Create indexes for audit_log
CREATE INDEX IF NOT EXISTS "idx_audit_log_entity" ON "audit_log" ("entity", "entity_id");
CREATE INDEX IF NOT EXISTS "idx_audit_log_user" ON "audit_log" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_audit_log_created" ON "audit_log" ("created_at");

-- Change default for users.role from 'user' to 'office'
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'office';
