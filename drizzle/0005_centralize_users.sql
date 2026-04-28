-- Centralize user management into the main app database (DATABASE_URL).
-- Factory databases will only store sales/customer/operational data.

-- Step 1: Add factory_key column to users table (main DB)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "factory_key" text;

-- Step 2: Drop FK constraints that reference users(id) from factory tables.
-- These columns remain as plain integers but without cross-database FK enforcement.
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_created_by_users_id_fk";
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_voided_by_users_id_fk";
ALTER TABLE "production_logs" DROP CONSTRAINT IF EXISTS "production_logs_created_by_users_id_fk";
ALTER TABLE "bag_ledger" DROP CONSTRAINT IF EXISTS "bag_ledger_created_by_users_id_fk";
ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_user_id_users_id_fk";
