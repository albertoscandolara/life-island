-- Undoes 0011_parse_worker_heartbeat. Not applied automatically (drizzle
-- migrations only go forward): run it by hand as ingestion_svc, then delete the
-- last row of ingestion.__drizzle_migrations.
ALTER TABLE "ingestion"."parse_queue" DROP COLUMN IF EXISTS "worker_seen_at";
