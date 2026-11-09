-- Undoes 0016_document_links. Not applied automatically (drizzle
-- migrations only go forward): run it by hand as ingestion_svc, then delete the
-- last row of ingestion.__drizzle_migrations.
DROP TABLE IF EXISTS "ingestion"."document_links";
DROP TYPE IF EXISTS "ingestion"."document_link_status";
ALTER TABLE "ingestion"."uploads" DROP COLUMN IF EXISTS "transaction_facts";
