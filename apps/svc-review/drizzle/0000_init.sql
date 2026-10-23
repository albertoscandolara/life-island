-- The schema itself is created by infra/postgres/init (owned by review_svc).
CREATE TYPE "review"."record_status" AS ENUM('UPLOADED', 'PARSING', 'PARSED', 'PARSE_FAILED', 'CONFIRMED', 'LOADED', 'LOAD_FAILED');--> statement-breakpoint
CREATE TABLE "review"."staging_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" varchar(255),
	"original_filename" text NOT NULL,
	"file_format" text,
	"status" "review"."record_status" DEFAULT 'UPLOADED' NOT NULL,
	"category" text,
	"target_key" text,
	"ai_payload" jsonb,
	"reviewed_payload" jsonb,
	"confidence" numeric(3, 2),
	"flags" text[] DEFAULT '{}' NOT NULL,
	"parse_error" text,
	"load_error" text,
	"domain_record_id" text,
	"uploaded_at" timestamp with time zone NOT NULL,
	"parsed_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"loaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "staging_records_upload_id_idx" ON "review"."staging_records" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "staging_records_status_category_idx" ON "review"."staging_records" USING btree ("status","category");--> statement-breakpoint
CREATE INDEX "staging_records_uploaded_at_idx" ON "review"."staging_records" USING btree ("uploaded_at");