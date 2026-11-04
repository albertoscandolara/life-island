-- Undoes 0008_historical_reclassification. Not applied automatically (drizzle
-- migrations only go forward): run it by hand as ingestion_svc, then delete the
-- last row of ingestion.__drizzle_migrations. Historical findings waiting for
-- review and per-document declined categories are lost.
BEGIN;
DROP INDEX IF EXISTS "ingestion"."uploads_historical_status_idx";
DROP INDEX IF EXISTS "ingestion"."document_categories_version_idx";
ALTER TABLE "ingestion"."uploads"
  DROP COLUMN IF EXISTS "classified_category_version",
  DROP COLUMN IF EXISTS "historical_reviewed_version",
  DROP COLUMN IF EXISTS "historical_processing_version",
  DROP COLUMN IF EXISTS "historical_status",
  DROP COLUMN IF EXISTS "historical_suggestions",
  DROP COLUMN IF EXISTS "historical_run_id",
  DROP COLUMN IF EXISTS "rejected_categories";
ALTER TABLE "ingestion"."document_categories" DROP COLUMN IF EXISTS "taxonomy_version";
DROP TABLE IF EXISTS "ingestion"."reclassification_runs";
DROP TABLE IF EXISTS "ingestion"."taxonomy_state";
DROP TYPE IF EXISTS "ingestion"."reclassification_run_status";
DROP TYPE IF EXISTS "ingestion"."historical_status";
COMMIT;
