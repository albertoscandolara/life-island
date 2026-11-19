CREATE TABLE "grocery"."products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_key" text NOT NULL,
	"name" text NOT NULL,
	"link" text,
	"image_key" text,
	"image_type" text,
	"image_updated_at" timestamp with time zone,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grocery"."receipts" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "grocery"."receipts" ADD COLUMN "not_groceries" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "products_name_key_idx" ON "grocery"."products" USING btree ("name_key");--> statement-breakpoint
-- One product per item name already on a receipt, named as its latest line.
INSERT INTO "grocery"."products" ("name_key", "name")
SELECT DISTINCT ON (lower(btrim(i."normalized_name")))
       lower(btrim(i."normalized_name")), btrim(i."normalized_name")
  FROM "grocery"."receipt_items" i
  JOIN "grocery"."receipts" r ON r."id" = i."receipt_id"
 ORDER BY lower(btrim(i."normalized_name")), r."purchased_at" DESC
ON CONFLICT ("name_key") DO NOTHING;
