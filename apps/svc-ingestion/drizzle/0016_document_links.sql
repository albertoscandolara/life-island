-- Invoices and their payments. The parse worker reads each parsed document's
-- money facts (invoice, quote, payment or none: amounts, supplier or
-- beneficiary, IBAN, references) into uploads.transaction_facts, and the
-- matcher links payments to the invoices and quotes they settle. AUTO and
-- SUGGESTED rows are recomputed from all documents; CONFIRMED and REJECTED
-- are your decisions. Documents parsed before this migration get their facts
-- read on the worker's next run.
-- Rollback: drizzle/rollback/0016_document_links.down.sql.
CREATE TYPE "ingestion"."document_link_status" AS ENUM('AUTO', 'SUGGESTED', 'CONFIRMED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "ingestion"."document_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_upload_id" uuid NOT NULL,
	"payment_upload_id" uuid NOT NULL,
	"status" "ingestion"."document_link_status" NOT NULL,
	"score" numeric(6, 2) DEFAULT 0 NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_links_two_documents" CHECK ("ingestion"."document_links"."invoice_upload_id" <> "ingestion"."document_links"."payment_upload_id")
);
--> statement-breakpoint
ALTER TABLE "ingestion"."uploads" ADD COLUMN "transaction_facts" jsonb;--> statement-breakpoint
ALTER TABLE "ingestion"."document_links" ADD CONSTRAINT "document_links_invoice_upload_id_uploads_id_fk" FOREIGN KEY ("invoice_upload_id") REFERENCES "ingestion"."uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion"."document_links" ADD CONSTRAINT "document_links_payment_upload_id_uploads_id_fk" FOREIGN KEY ("payment_upload_id") REFERENCES "ingestion"."uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_links_pair_idx" ON "ingestion"."document_links" USING btree ("invoice_upload_id","payment_upload_id");--> statement-breakpoint
CREATE INDEX "document_links_payment_idx" ON "ingestion"."document_links" USING btree ("payment_upload_id");--> statement-breakpoint
CREATE INDEX "document_links_status_idx" ON "ingestion"."document_links" USING btree ("status");