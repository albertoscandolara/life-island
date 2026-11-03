CREATE TABLE "tax730"."attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tax_year" integer NOT NULL,
	"expense_id" uuid,
	"upload_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax730"."documents" (
	"upload_id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"original_filename" text NOT NULL,
	"file_format" text,
	"categories" text[] DEFAULT '{}' NOT NULL,
	"fields" jsonb,
	"uploaded_at" timestamp with time zone NOT NULL,
	"metadata_updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tax730"."expenses" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "tax730"."expenses" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "tax730"."attachments" ADD CONSTRAINT "attachments_tax_year_tax_years_tax_year_fk" FOREIGN KEY ("tax_year") REFERENCES "tax730"."tax_years"("tax_year") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax730"."attachments" ADD CONSTRAINT "attachments_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "tax730"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_expense_upload_idx" ON "tax730"."attachments" USING btree ("expense_id","upload_id") WHERE "tax730"."attachments"."expense_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_year_upload_idx" ON "tax730"."attachments" USING btree ("tax_year","upload_id") WHERE "tax730"."attachments"."expense_id" is null;--> statement-breakpoint
CREATE INDEX "attachments_tax_year_idx" ON "tax730"."attachments" USING btree ("tax_year");--> statement-breakpoint
-- Every expense already loaded came from its invoice: file it as one.
INSERT INTO "tax730"."attachments" ("tax_year", "expense_id", "upload_id", "role")
SELECT "tax_year", "id", "upload_id", 'INVOICE' FROM "tax730"."expenses"
ON CONFLICT DO NOTHING;
