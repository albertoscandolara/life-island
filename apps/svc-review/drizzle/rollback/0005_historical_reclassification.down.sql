-- Undoes 0005_historical_reclassification. Not applied automatically: run it by
-- hand as review_svc, then delete the last row of review.__drizzle_migrations.
BEGIN;
ALTER TABLE "review"."staging_records"
  DROP COLUMN IF EXISTS "historical_status",
  DROP COLUMN IF EXISTS "historical_suggestions";
COMMIT;
