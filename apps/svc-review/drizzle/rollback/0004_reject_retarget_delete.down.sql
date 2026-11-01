-- Undoes 0004_reject_retarget_delete. Not applied automatically: run it by hand
-- as review_svc, then delete the last row of review.__drizzle_migrations.
-- Postgres cannot drop an enum value, so 'REJECTED' stays in the type; rejected
-- records go back to PARSED (or UPLOADED when they were never parsed) first.
BEGIN;
UPDATE "review"."staging_records"
   SET "status" = CASE WHEN "parsed_at" IS NULL THEN 'UPLOADED'::review.record_status ELSE 'PARSED'::review.record_status END
 WHERE "status" = 'REJECTED';
DELETE FROM "review"."staging_records" WHERE "deleted_at" IS NOT NULL;
ALTER TABLE "review"."staging_records" DROP COLUMN IF EXISTS "deleted_at";
ALTER TABLE "review"."staging_records" DROP COLUMN IF EXISTS "reject_reason";
ALTER TABLE "review"."staging_records" DROP COLUMN IF EXISTS "rejected_at";
ALTER TABLE "review"."staging_records" DROP COLUMN IF EXISTS "document_fields";
ALTER TABLE "review"."staging_records" DROP COLUMN IF EXISTS "ai_target_key";
COMMIT;
