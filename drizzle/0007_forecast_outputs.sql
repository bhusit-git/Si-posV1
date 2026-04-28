CREATE TABLE IF NOT EXISTS "forecast_outputs" (
  "id" serial PRIMARY KEY NOT NULL,
  "factory_key" text NOT NULL,
  "target_date" date NOT NULL,
  "product_key" text NOT NULL,
  "product_type_id" integer,
  "product_name" text,
  "predicted_units" double precision DEFAULT 0 NOT NULL,
  "predicted_units_lower" double precision DEFAULT 0 NOT NULL,
  "predicted_units_upper" double precision DEFAULT 0 NOT NULL,
  "predicted_revenue" double precision DEFAULT 0 NOT NULL,
  "predicted_revenue_lower" double precision DEFAULT 0 NOT NULL,
  "predicted_revenue_upper" double precision DEFAULT 0 NOT NULL,
  "confidence" text DEFAULT 'medium' NOT NULL,
  "key_drivers" jsonb,
  "model_version" text NOT NULL,
  "feature_snapshot_hash" text NOT NULL,
  "source_generated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "forecast_outputs"
  ADD CONSTRAINT "forecast_outputs_product_type_id_product_types_id_fk"
  FOREIGN KEY ("product_type_id") REFERENCES "public"."product_types"("id")
  ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "idx_forecast_outputs_factory_date" ON "forecast_outputs" ("factory_key", "target_date");
CREATE INDEX IF NOT EXISTS "idx_forecast_outputs_model_version" ON "forecast_outputs" ("model_version");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_forecast_outputs_factory_date_product" ON "forecast_outputs" ("factory_key", "target_date", "product_key");
