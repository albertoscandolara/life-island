-- Document categories (a reusable taxonomy with extraction templates), AI category
-- suggestions waiting for approval, per-step parse progress on each upload, and
-- the parse queue's durable state (quota and rate-limit pauses).
CREATE TYPE "ingestion"."parse_queue_status" AS ENUM('IDLE', 'RUNNING', 'PAUSED_QUOTA', 'PAUSED_RATE_LIMIT', 'BLOCKED_CREDENTIALS');--> statement-breakpoint
CREATE TYPE "ingestion"."suggestion_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
ALTER TYPE "ingestion"."upload_status" ADD VALUE 'PAUSED_QUOTA';--> statement-breakpoint
ALTER TYPE "ingestion"."upload_status" ADD VALUE 'PAUSED_RATE_LIMIT';--> statement-breakpoint
CREATE TABLE "ingestion"."category_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" text NOT NULL,
	"title" varchar(100) NOT NULL,
	"description" text NOT NULL,
	"template_json" jsonb NOT NULL,
	"reason" text,
	"status" "ingestion"."suggestion_status" DEFAULT 'PENDING' NOT NULL,
	"upload_ids" uuid[] DEFAULT '{}' NOT NULL,
	"approved_category_id" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion"."document_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"title" varchar(100) NOT NULL,
	"description" text NOT NULL,
	"template_json" jsonb DEFAULT '{"fields":[]}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_categories_id_format" CHECK ("ingestion"."document_categories"."id" ~ '^[A-Z][A-Z0-9_]{1,63}$')
);
--> statement-breakpoint
CREATE TABLE "ingestion"."parse_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"status" "ingestion"."parse_queue_status" DEFAULT 'IDLE' NOT NULL,
	"pause_reason" text,
	"provider_error" jsonb,
	"paused_at" timestamp with time zone,
	"resume_at" timestamp with time zone,
	"resume_at_reliable" boolean DEFAULT false NOT NULL,
	"resume_attempts" integer DEFAULT 0 NOT NULL,
	"run_started_at" timestamp with time zone,
	"run_finished_at" timestamp with time zone,
	"next_scheduled_run_at" timestamp with time zone,
	"last_run_summary" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingestion"."uploads" ADD COLUMN "lock_token" uuid;--> statement-breakpoint
ALTER TABLE "ingestion"."uploads" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ingestion"."uploads" ADD COLUMN "completed_steps" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "ingestion"."uploads" ADD COLUMN "current_step" text;--> statement-breakpoint
ALTER TABLE "ingestion"."uploads" ADD COLUMN "analysis" jsonb;--> statement-breakpoint
ALTER TABLE "ingestion"."uploads" ADD COLUMN "extracted_fields" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "category_suggestions_pending_idx" ON "ingestion"."category_suggestions" USING btree ("category_id") WHERE "ingestion"."category_suggestions"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "category_suggestions_upload_ids_idx" ON "ingestion"."category_suggestions" USING gin ("upload_ids");--> statement-breakpoint
CREATE UNIQUE INDEX "document_categories_title_idx" ON "ingestion"."document_categories" USING btree (lower("title"));--> statement-breakpoint
-- Starter categories: broad ones the AI can always fall back on, plus the two
-- templates from the spec (INVOICE, WATER_BILL). New ones come from approved suggestions.
INSERT INTO "ingestion"."document_categories" ("id", "title", "description", "template_json") VALUES
  ('EXPENSE', 'Expense', 'Any document that proves money spent or owed by you: receipts, bills, invoices addressed to you.', '{"fields": [{"key": "total_amount", "label": "Total amount", "type": "amount", "description": "Total to pay or paid, as printed", "required": true}, {"key": "currency", "label": "Currency", "type": "currency", "description": "ISO 4217 code, e.g. EUR", "required": false}, {"key": "payment_date", "label": "Payment date", "type": "date", "description": "Date the money was paid, if stated", "required": false}, {"key": "payment_method", "label": "Payment method", "type": "enum", "description": "How it was or will be paid", "required": false, "options": ["cash", "card", "bank_transfer", "direct_debit", "other"]}, {"key": "payee", "label": "Paid to", "type": "string", "description": "Who receives the money", "required": false}]}'::jsonb),
  ('BILL', 'Bill', 'A recurring bill for a service or utility (water, electricity, gas, phone, internet, waste), usually for a billing period.', '{"fields": [{"key": "provider", "label": "Provider", "type": "string", "description": "Company that issued the bill", "required": true}, {"key": "customer_id", "label": "Customer or account id", "type": "string", "description": "Customer, contract or supply point code (e.g. codice cliente, POD, PDR)", "required": false}, {"key": "billing_period", "label": "Billing period", "type": "period", "description": "First and last day billed", "required": false}, {"key": "issue_date", "label": "Issue date", "type": "date", "description": "Date the document was issued", "required": false}, {"key": "due_date", "label": "Due date", "type": "date", "description": "Date by which it must be paid", "required": false}, {"key": "total_amount", "label": "Total amount", "type": "amount", "description": "Total to pay or paid, as printed", "required": true}, {"key": "currency", "label": "Currency", "type": "currency", "description": "ISO 4217 code, e.g. EUR", "required": false}]}'::jsonb),
  ('WATER_BILL', 'Water bill', 'A bill from a water utility for water supply and sewage, usually showing consumption in cubic metres.', '{"fields": [{"key": "provider", "label": "Provider", "type": "string", "description": "Company that issued the bill", "required": true}, {"key": "customer_id", "label": "Customer or account id", "type": "string", "description": "Customer, contract or supply point code (e.g. codice cliente, POD, PDR)", "required": false}, {"key": "billing_period", "label": "Billing period", "type": "period", "description": "First and last day billed", "required": false}, {"key": "issue_date", "label": "Issue date", "type": "date", "description": "Date the document was issued", "required": false}, {"key": "due_date", "label": "Due date", "type": "date", "description": "Date by which it must be paid", "required": false}, {"key": "water_consumption", "label": "Water consumption", "type": "number", "description": "Water billed in the period", "required": false, "unit": "m3"}, {"key": "total_amount", "label": "Total amount", "type": "amount", "description": "Total to pay or paid, as printed", "required": true}, {"key": "currency", "label": "Currency", "type": "currency", "description": "ISO 4217 code, e.g. EUR", "required": false}]}'::jsonb),
  ('INVOICE', 'Invoice', 'An invoice (fattura) issued by a supplier, with an invoice number, the supplier''s VAT number and taxes.', '{"fields": [{"key": "invoice_number", "label": "Invoice number", "type": "string", "description": "Number of the invoice as printed", "required": true}, {"key": "issue_date", "label": "Issue date", "type": "date", "description": "Date the document was issued", "required": false}, {"key": "supplier_name", "label": "Supplier", "type": "string", "description": "Who issued the invoice", "required": true}, {"key": "supplier_vat_number", "label": "Supplier VAT number", "type": "string", "description": "Partita IVA of the supplier, 11 digits, optionally prefixed with IT", "required": false, "pattern": "^(IT)?[0-9]{11}$"}, {"key": "customer_name", "label": "Customer", "type": "string", "description": "Who the invoice is addressed to", "required": false}, {"key": "total_amount", "label": "Total amount", "type": "amount", "description": "Total to pay or paid, as printed", "required": true}, {"key": "currency", "label": "Currency", "type": "currency", "description": "ISO 4217 code, e.g. EUR", "required": false}, {"key": "tax_amount", "label": "Tax amount", "type": "amount", "description": "VAT (IVA) included in the total", "required": false}, {"key": "due_date", "label": "Due date", "type": "date", "description": "Date by which it must be paid", "required": false}]}'::jsonb),
  ('RECEIPT', 'Receipt', 'A sales receipt (scontrino) from a shop, restaurant or pharmacy, proving a purchase that was already paid.', '{"fields": [{"key": "merchant_name", "label": "Merchant", "type": "string", "description": "Shop name as printed", "required": true}, {"key": "purchase_date", "label": "Purchase date", "type": "date", "description": "Date of the purchase", "required": true}, {"key": "total_amount", "label": "Total amount", "type": "amount", "description": "Total to pay or paid, as printed", "required": true}, {"key": "currency", "label": "Currency", "type": "currency", "description": "ISO 4217 code, e.g. EUR", "required": false}, {"key": "payment_method", "label": "Payment method", "type": "enum", "description": "How it was or will be paid", "required": false, "options": ["cash", "card", "bank_transfer", "direct_debit", "other"]}]}'::jsonb),
  ('GROCERIES', 'Groceries', 'Food and household shopping at a supermarket or grocery store.', '{"fields": [{"key": "merchant_name", "label": "Merchant", "type": "string", "description": "Shop name as printed", "required": true}, {"key": "purchase_date", "label": "Purchase date", "type": "date", "description": "Date of the purchase", "required": true}, {"key": "total_amount", "label": "Total amount", "type": "amount", "description": "Total to pay or paid, as printed", "required": true}, {"key": "currency", "label": "Currency", "type": "currency", "description": "ISO 4217 code, e.g. EUR", "required": false}, {"key": "item_count", "label": "Number of items", "type": "integer", "description": "How many lines or articles the receipt lists", "required": false}]}'::jsonb),
  ('HOME', 'Home', 'Documents about the home: utilities, rent, condominium fees, maintenance, home insurance.', '{"fields": [{"key": "property_address", "label": "Property address", "type": "string", "description": "Address of the home the document refers to", "required": false}]}'::jsonb),
  ('MEDICAL', 'Medical', 'Medical visits, tests, prescriptions and pharmacy purchases for medicines.', '{"fields": [{"key": "healthcare_provider", "label": "Healthcare provider", "type": "string", "description": "Doctor, clinic or pharmacy", "required": false}, {"key": "patient_name", "label": "Patient", "type": "string", "description": "Who received the care", "required": false}, {"key": "service_date", "label": "Date of service", "type": "date", "description": "Date of the visit, test or purchase", "required": false}]}'::jsonb),
  ('TAX_DEDUCTIBLE', 'Tax deductible', 'An expense that may be deductible in the Italian 730 tax return (medical, school, sport for kids, insurance, mortgage interest, renovations).', '{"fields": [{"key": "beneficiary_fiscal_code", "label": "Beneficiary fiscal code", "type": "string", "description": "Codice fiscale printed on the document", "required": false, "pattern": "^[A-Z0-9]{16}$"}, {"key": "traceable_payment", "label": "Traceable payment", "type": "boolean", "description": "True when paid by card or bank transfer", "required": false}, {"key": "total_amount", "label": "Total amount", "type": "amount", "description": "Total to pay or paid, as printed", "required": true}, {"key": "expense_date", "label": "Expense date", "type": "date", "description": "Date of the expense", "required": false}]}'::jsonb)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- `categories` held module names (groceries, tax730, other); it now holds category ids.
UPDATE "ingestion"."uploads" SET "categories" = ARRAY(
  SELECT DISTINCT CASE c WHEN 'groceries' THEN 'GROCERIES' WHEN 'tax730' THEN 'TAX_DEDUCTIBLE' END
  FROM unnest("categories") AS c WHERE c IN ('groceries', 'tax730')
) WHERE "categories" <> '{}';--> statement-breakpoint
-- Documents parsed before this migration ran every step there was.
UPDATE "ingestion"."uploads" SET "completed_steps" = '{CLASSIFY,EXTRACT,DISCOVER}' WHERE "status" = 'PARSED';--> statement-breakpoint
INSERT INTO "ingestion"."parse_queue" ("id") VALUES ('documents') ON CONFLICT DO NOTHING;
