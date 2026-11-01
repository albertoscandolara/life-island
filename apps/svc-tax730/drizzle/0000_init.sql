-- The schema itself is created by infra/postgres/init (owned by tax730_svc).
CREATE TABLE "tax730"."expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_staging_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"tax_year" integer NOT NULL,
	"expense_type" text NOT NULL,
	"frame730" text,
	"date" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"beneficiary_fiscal_code" text,
	"traceable_payment" boolean,
	"issuer" text NOT NULL,
	"document_number" text,
	"document_fields" jsonb,
	"approved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax730"."tax_years" (
	"tax_year" integer PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tax730"."expenses" ADD CONSTRAINT "expenses_tax_year_tax_years_tax_year_fk" FOREIGN KEY ("tax_year") REFERENCES "tax730"."tax_years"("tax_year") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_source_staging_id_idx" ON "tax730"."expenses" USING btree ("source_staging_id");--> statement-breakpoint
CREATE INDEX "expenses_tax_year_type_idx" ON "tax730"."expenses" USING btree ("tax_year","expense_type");