-- Undoes 0004_category_hierarchy. Not applied automatically (drizzle migrations
-- only go forward): run it by hand as ingestion_svc, then delete the last row of
-- ingestion.__drizzle_migrations. Categories, their templates and every
-- document's categories are untouched; only the parents and dimensions you set
-- since are lost. Run the review rollback (apps/svc-review/drizzle/rollback) too.
BEGIN;
DROP TRIGGER IF EXISTS "document_categories_prevent_cycle" ON "ingestion"."document_categories";
DROP FUNCTION IF EXISTS "ingestion"."document_categories_prevent_cycle"();
ALTER TABLE "ingestion"."document_categories" DROP CONSTRAINT IF EXISTS "document_categories_not_own_parent";
ALTER TABLE "ingestion"."document_categories" DROP CONSTRAINT IF EXISTS "document_categories_parent_id_document_categories_id_fk";
DROP INDEX IF EXISTS "ingestion"."document_categories_parent_idx";
ALTER TABLE "ingestion"."document_categories" DROP COLUMN IF EXISTS "dimension";
ALTER TABLE "ingestion"."document_categories" DROP COLUMN IF EXISTS "parent_id";
DROP TYPE IF EXISTS "ingestion"."category_dimension";
COMMIT;
