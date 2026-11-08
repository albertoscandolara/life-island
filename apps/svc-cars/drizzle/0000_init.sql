-- The schema itself is created by infra/postgres/init (owned by cars_svc).
CREATE TABLE "cars"."category_tree" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"parent_id" text,
	"dimension" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cars"."documents" (
	"upload_id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"original_filename" text NOT NULL,
	"categories" text[] DEFAULT '{}' NOT NULL,
	"fields" jsonb,
	"uploaded_at" timestamp with time zone NOT NULL,
	"metadata_updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cars"."reviews" (
	"upload_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"vehicle_id" uuid,
	"created_vehicle" boolean DEFAULT false NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"marked_status" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cars"."vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text,
	"status" text DEFAULT 'active' NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cars"."reviews" ADD CONSTRAINT "reviews_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "cars"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_categories_idx" ON "cars"."documents" USING gin ("categories");--> statement-breakpoint
CREATE INDEX "reviews_vehicle_idx" ON "cars"."reviews" USING btree ("vehicle_id");