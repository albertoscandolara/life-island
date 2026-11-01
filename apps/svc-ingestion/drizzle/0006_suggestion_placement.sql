-- Where the AI would place a suggested category: its parent and its metadata
-- dimension (issuer, property...). Additive only: existing suggestions keep
-- NULL in both and are approved as before.
-- Rollback: drizzle/rollback/0006_suggestion_placement.down.sql.
ALTER TABLE "ingestion"."category_suggestions" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "ingestion"."category_suggestions" ADD COLUMN "dimension" "ingestion"."category_dimension";