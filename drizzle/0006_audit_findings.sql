CREATE TABLE IF NOT EXISTS "audit_findings" (
  "id" serial PRIMARY KEY NOT NULL,
  "fingerprint" text NOT NULL,
  "rule_key" text NOT NULL,
  "category" text NOT NULL,
  "severity" text NOT NULL,
  "risk_score" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'open',
  "entity" text NOT NULL,
  "entity_id" integer,
  "user_id" integer,
  "username" text,
  "customer_id" integer,
  "transaction_id" integer,
  "title" text NOT NULL,
  "reason" text NOT NULL,
  "evidence" jsonb,
  "review_note" text,
  "first_seen_at" timestamptz NOT NULL DEFAULT now(),
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_audit_findings_fingerprint" ON "audit_findings" ("fingerprint");
CREATE INDEX IF NOT EXISTS "idx_audit_findings_status_severity" ON "audit_findings" ("status", "severity");
CREATE INDEX IF NOT EXISTS "idx_audit_findings_category_status" ON "audit_findings" ("category", "status");
CREATE INDEX IF NOT EXISTS "idx_audit_findings_transaction" ON "audit_findings" ("transaction_id", "last_seen_at");
CREATE INDEX IF NOT EXISTS "idx_audit_findings_customer" ON "audit_findings" ("customer_id", "last_seen_at");
CREATE INDEX IF NOT EXISTS "idx_audit_findings_last_seen" ON "audit_findings" ("last_seen_at");
