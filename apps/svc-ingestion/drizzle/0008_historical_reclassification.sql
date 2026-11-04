CREATE TYPE "ingestion"."historical_status" AS ENUM('RECLASSIFYING', 'PENDING_REVIEW');--> statement-breakpoint
CREATE TYPE "ingestion"."reclassification_run_status" AS ENUM('RUNNING', 'COMPLETED', 'FAILED', 'INTERRUPTED', 'BLOCKED');--> statement-breakpoint
CREATE TABLE "ingestion"."reclassification_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" text NOT NULL,
	"status" "ingestion"."reclassification_run_status" NOT NULL,
	"target_version" integer,
	"blocked_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lease_until" timestamp with time zone,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "ingestion"."taxonomy_state" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"next_reclassification_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingestion"."document_categories" ADD COLUMN "taxonomy_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ingestion"."uploads" ADD COLUMN "classified_category_version" integer;--> statement-breakpoint
ALTER TABLE "ingestion"."uploads" ADD COLUMN "historical_reviewed_version" integer;--> statement-breakpoint
ALTER TABLE "ingestion"."uploads" ADD COLUMN "historical_processing_version" integer;--> statement-breakpoint
ALTER TABLE "ingestion"."uploads" ADD COLUMN "historical_status" "ingestion"."historical_status";--> statement-breakpoint
ALTER TABLE "ingestion"."uploads" ADD COLUMN "historical_suggestions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ingestion"."uploads" ADD COLUMN "historical_run_id" uuid;--> statement-breakpoint
ALTER TABLE "ingestion"."uploads" ADD COLUMN "rejected_categories" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reclassification_runs_one_running_idx" ON "ingestion"."reclassification_runs" USING btree ((true)) WHERE "ingestion"."reclassification_runs"."status" = 'RUNNING';--> statement-breakpoint
CREATE INDEX "reclassification_runs_requested_at_idx" ON "ingestion"."reclassification_runs" USING btree ("requested_at");--> statement-breakpoint
CREATE INDEX "document_categories_version_idx" ON "ingestion"."document_categories" USING btree ("taxonomy_version");--> statement-breakpoint
CREATE INDEX "uploads_historical_status_idx" ON "ingestion"."uploads" USING btree ("historical_status") WHERE "ingestion"."uploads"."historical_status" is not null;--> statement-breakpoint
-- Backfill. Every existing category gets a taxonomy version in the order it
-- was created (categories created in the same transaction share one), and the
-- counter starts at the highest. Each parsed document's baseline is the
-- version its CLASSIFY step saw: the newest category created before its last
-- classification. So the first reclassification run checks each document only
-- against categories that appeared after it was read.
-- Rollback: drizzle/rollback/0008_historical_reclassification.down.sql.
WITH ranked AS (
  SELECT id, dense_rank() OVER (ORDER BY created_at) AS version
    FROM "ingestion"."document_categories"
)
UPDATE "ingestion"."document_categories" c
   SET taxonomy_version = r.version
  FROM ranked r
 WHERE r.id = c.id;--> statement-breakpoint
INSERT INTO "ingestion"."taxonomy_state" (id, version)
SELECT 'global', coalesce(max(taxonomy_version), 0) FROM "ingestion"."document_categories"
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint
UPDATE "ingestion"."uploads" u
   SET classified_category_version = coalesce((
         SELECT max(c.taxonomy_version)
           FROM "ingestion"."document_categories" c
          WHERE c.created_at <= coalesce(
                  (SELECT max(r.created_at) FROM "ingestion"."parse_runs" r
                    WHERE r.upload_id = u.id AND r.step = 'classify'),
                  u.parsed_at)
       ), 0)
 WHERE u.status = 'PARSED' OR 'CLASSIFY' = ANY(u.completed_steps);
