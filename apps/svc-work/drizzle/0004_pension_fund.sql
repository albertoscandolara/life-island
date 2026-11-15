-- Pension fund (fondo pensione) in Work: the funds you belong to, the value
-- of your position on each statement, the payments you made yourself, the
-- years you told the fund what you did not deduct, and the fund statement
-- documents you chose not to use. Contributions on payslips stay where they
-- are read: the documents.
-- Rollback: drizzle/rollback/0004_pension_fund.down.sql.
CREATE TABLE "work"."pension_dismissed_documents" (
	"upload_id" uuid PRIMARY KEY NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."pension_funds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'negotiated' NOT NULL,
	"member_since" date,
	"investment_line" text,
	"employee_pct" numeric(5, 2),
	"employer_pct" numeric(5, 2),
	"tfr_pct" numeric(5, 2),
	"first_job" boolean DEFAULT false NOT NULL,
	"member_code" text,
	"url" text,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."pension_notices" (
	"year" integer PRIMARY KEY NOT NULL,
	"sent_at" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."pension_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fund_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"kind" text DEFAULT 'direct' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."pension_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fund_id" uuid NOT NULL,
	"date" date NOT NULL,
	"value" numeric(12, 2) NOT NULL,
	"paid_in" numeric(12, 2),
	"employee" numeric(12, 2),
	"employer" numeric(12, 2),
	"tfr" numeric(12, 2),
	"return_pct" numeric(6, 2),
	"source_upload_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pension_statements_source_upload_id_unique" UNIQUE("source_upload_id")
);
--> statement-breakpoint
ALTER TABLE "work"."pension_payments" ADD CONSTRAINT "pension_payments_fund_id_pension_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "work"."pension_funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."pension_statements" ADD CONSTRAINT "pension_statements_fund_id_pension_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "work"."pension_funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pension_payments_fund_idx" ON "work"."pension_payments" USING btree ("fund_id");--> statement-breakpoint
CREATE INDEX "pension_statements_fund_idx" ON "work"."pension_statements" USING btree ("fund_id");