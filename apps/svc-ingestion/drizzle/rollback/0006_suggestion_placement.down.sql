-- Undoes 0006_suggestion_placement. Not applied automatically (drizzle migrations
-- only go forward): run it by hand as ingestion_svc, then delete the last row of
-- ingestion.__drizzle_migrations. Suggestions keep everything else; only the
-- parent and dimension the AI proposed for them are lost.
BEGIN;
ALTER TABLE "ingestion"."category_suggestions" DROP COLUMN IF EXISTS "dimension";
ALTER TABLE "ingestion"."category_suggestions" DROP COLUMN IF EXISTS "parent_id";
COMMIT;
