-- Parse now: when you last asked the worker to run outside its schedule.
-- Rollback: ALTER TABLE "ingestion"."parse_queue" DROP COLUMN "run_requested_at";
ALTER TABLE "ingestion"."parse_queue" ADD COLUMN "run_requested_at" timestamp with time zone;