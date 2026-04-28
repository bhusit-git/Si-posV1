CREATE TABLE IF NOT EXISTS "forecast_event_overrides" (
  "id" serial PRIMARY KEY NOT NULL,
  "factory_key" text NOT NULL,
  "target_date" date NOT NULL,
  "event_type" text NOT NULL,
  "product_type_id" integer,
  "scope" text DEFAULT 'factory' NOT NULL,
  "strength" double precision DEFAULT 1 NOT NULL,
  "notes" text,
  "source" text DEFAULT 'manual' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "forecast_event_overrides"
  ADD CONSTRAINT "forecast_event_overrides_product_type_id_product_types_id_fk"
  FOREIGN KEY ("product_type_id") REFERENCES "public"."product_types"("id")
  ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "idx_forecast_event_overrides_factory_date"
  ON "forecast_event_overrides" ("factory_key", "target_date");
CREATE INDEX IF NOT EXISTS "idx_forecast_event_overrides_type"
  ON "forecast_event_overrides" ("event_type", "target_date");

ALTER TABLE "forecast_outputs"
  ADD COLUMN IF NOT EXISTS "model_family" text DEFAULT '' NOT NULL;
ALTER TABLE "forecast_outputs"
  ADD COLUMN IF NOT EXISTS "data_end_date" date;
ALTER TABLE "forecast_outputs"
  ADD COLUMN IF NOT EXISTS "signal_coverage" jsonb;
