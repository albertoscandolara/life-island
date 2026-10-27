-- "Waiting for the daily parse run" is now called TO_BE_PARSED, and a document
-- can belong to several categories (one per module that uses its data).
ALTER TYPE "ingestion"."upload_status" RENAME VALUE 'UPLOADED' TO 'TO_BE_PARSED';--> statement-breakpoint
ALTER TABLE "ingestion"."uploads" ADD COLUMN "categories" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
UPDATE "ingestion"."uploads" SET "categories" = ARRAY["category"] WHERE "category" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "ingestion"."uploads" DROP COLUMN "category";--> statement-breakpoint
CREATE INDEX "uploads_categories_idx" ON "ingestion"."uploads" USING gin ("categories");
