-- Undoes 0006_auto_confirm. Not applied automatically: run it by
-- hand as review_svc, then delete the last row of review.__drizzle_migrations.
BEGIN;
ALTER TABLE "review"."staging_records"
  DROP COLUMN IF EXISTS "review_reasons",
  DROP COLUMN IF EXISTS "auto_confirmed_at";
COMMIT;
