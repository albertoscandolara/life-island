-- The parse worker's heartbeat: it writes worker_seen_at every few seconds
-- while it runs, so the review inbox can say when it is not running (and
-- Parse now would wait for nothing). Rollback:
-- drizzle/rollback/0011_parse_worker_heartbeat.down.sql.
ALTER TABLE "ingestion"."parse_queue" ADD COLUMN "worker_seen_at" timestamp with time zone;