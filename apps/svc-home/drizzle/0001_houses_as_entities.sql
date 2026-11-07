CREATE TABLE "home"."house_reviews" (
	"upload_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"property_id" uuid,
	"created_property" boolean DEFAULT false NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "type" text DEFAULT 'HOUSE' NOT NULL;--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "tenure" text DEFAULT 'OWNED' NOT NULL;--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "is_residence" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "province" text;--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "area_sqm" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "rooms" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "year_built" integer;--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "cadastral_sheet" text;--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "cadastral_parcel" text;--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "cadastral_subunit" text;--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "cadastral_category" text;--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "cadastral_income" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "purchase_date" date;--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "purchase_price" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "owners" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "electricity_supplier" text;--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "gas_supplier" text;--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "water_supplier" text;--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "condo_manager" text;--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "insurer" text;--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "model_key" text;--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "model_filename" text;--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "model_format" text;--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "model_size" bigint;--> statement-breakpoint
ALTER TABLE "home"."properties" ADD COLUMN "model_uploaded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "home"."house_reviews" ADD CONSTRAINT "house_reviews_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "home"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "house_reviews_property_idx" ON "home"."house_reviews" USING btree ("property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "properties_one_residence_idx" ON "home"."properties" USING btree ("is_residence") WHERE "home"."properties"."is_residence";