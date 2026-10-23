-- The schema itself is created by infra/postgres/init (owned by ingestion_svc).
CREATE TYPE "ingestion"."file_format" AS ENUM('JPG', 'PNG', 'WEBP', 'PDF', 'XLSX', 'CSV', 'DOCX', 'TXT');--> statement-breakpoint
CREATE TYPE "ingestion"."upload_status" AS ENUM('UPLOADING', 'UPLOADED', 'PARSING', 'PARSED', 'FAILED');--> statement-breakpoint
CREATE TABLE "ingestion"."parse_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" uuid NOT NULL,
	"step" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"raw_output" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion"."uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" varchar(255),
	"original_filename" text NOT NULL,
	"declared_mime" text,
	"detected_mime" text,
	"file_format" "ingestion"."file_format",
	"size_bytes" bigint,
	"sha256" char(64),
	"storage_key" text NOT NULL,
	"status" "ingestion"."upload_status" DEFAULT 'UPLOADING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"category" text,
	"target_key" text,
	"details" jsonb,
	"confidence" numeric(3, 2),
	"flags" text[] DEFAULT '{}' NOT NULL,
	"uploaded_at" timestamp with time zone,
	"parsed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingestion"."parse_runs" ADD CONSTRAINT "parse_runs_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "ingestion"."uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "uploads_claim_idx" ON "ingestion"."uploads" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "uploads_created_at_idx" ON "ingestion"."uploads" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uploads_sha256_idx" ON "ingestion"."uploads" USING btree ("sha256");