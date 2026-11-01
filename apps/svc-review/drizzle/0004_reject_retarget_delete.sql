-- Reject a record, move it to another target (module), delete its document,
-- and keep the document's template fields so Confirm sends them along.
-- Rollback: drizzle/rollback/0004_reject_retarget_delete.down.sql.
ALTER TYPE "review"."record_status" ADD VALUE 'REJECTED';--> statement-breakpoint
ALTER TABLE "review"."staging_records" ADD COLUMN "ai_target_key" text;--> statement-breakpoint
ALTER TABLE "review"."staging_records" ADD COLUMN "document_fields" jsonb;--> statement-breakpoint
ALTER TABLE "review"."staging_records" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review"."staging_records" ADD COLUMN "reject_reason" text;--> statement-breakpoint
ALTER TABLE "review"."staging_records" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
UPDATE "review"."staging_records" SET "ai_target_key" = "target_key" WHERE "target_key" IS NOT NULL;