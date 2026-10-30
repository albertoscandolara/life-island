ALTER TABLE "review"."staging_records" ADD COLUMN "categories" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "review"."staging_records" ADD COLUMN "suggested_categories" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "review"."staging_records" ADD COLUMN "metadata_updated_at" timestamp with time zone;