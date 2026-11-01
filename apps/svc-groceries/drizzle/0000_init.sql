-- The schema itself is created by infra/postgres/init (owned by grocery_svc).
CREATE TABLE "grocery"."merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_key" text NOT NULL,
	"name" text NOT NULL,
	"vat_number" text,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grocery"."receipt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"raw_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"category" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_price" numeric(12, 2),
	"line_total" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grocery"."receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_staging_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"purchased_at" timestamp with time zone NOT NULL,
	"currency" text NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"payment_method" text,
	"document_fields" jsonb,
	"approved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grocery"."receipt_items" ADD CONSTRAINT "receipt_items_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "grocery"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery"."receipts" ADD CONSTRAINT "receipts_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "grocery"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchants_key_idx" ON "grocery"."merchants" USING btree ("merchant_key");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_items_position_idx" ON "grocery"."receipt_items" USING btree ("receipt_id","position");--> statement-breakpoint
CREATE INDEX "receipt_items_category_idx" ON "grocery"."receipt_items" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_source_staging_id_idx" ON "grocery"."receipts" USING btree ("source_staging_id");--> statement-breakpoint
CREATE INDEX "receipts_purchased_at_idx" ON "grocery"."receipts" USING btree ("purchased_at");