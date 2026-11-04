-- The schema itself is created by infra/postgres/init (owned by home_svc).
CREATE TABLE "home"."bill_overrides" (
	"upload_id" uuid PRIMARY KEY NOT NULL,
	"manual_property" boolean DEFAULT false NOT NULL,
	"property_id" uuid,
	"utility" text,
	"excluded" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "home"."category_tree" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"parent_id" text,
	"dimension" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "home"."documents" (
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
CREATE TABLE "home"."properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"city" text,
	"color_slot" integer NOT NULL,
	"match_terms" text[] DEFAULT '{}' NOT NULL,
	"supply_codes" text[] DEFAULT '{}' NOT NULL,
	"category_ids" text[] DEFAULT '{}' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "home"."work_documents" (
	"work_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_documents_work_id_upload_id_pk" PRIMARY KEY("work_id","upload_id")
);
--> statement-breakpoint
CREATE TABLE "home"."works" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"area" text,
	"contractor" text,
	"start_date" date,
	"end_date" date,
	"estimated_cost" numeric(12, 2),
	"actual_cost" numeric(12, 2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "home"."bill_overrides" ADD CONSTRAINT "bill_overrides_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "home"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home"."work_documents" ADD CONSTRAINT "work_documents_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "home"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home"."works" ADD CONSTRAINT "works_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "home"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_categories_idx" ON "home"."documents" USING gin ("categories");--> statement-breakpoint
CREATE INDEX "works_property_idx" ON "home"."works" USING btree ("property_id");--> statement-breakpoint
-- Your two homes to start with; rename them, add their address and supply codes, or add more from the app.
INSERT INTO "home"."properties" ("name", "color_slot", "match_terms") VALUES
  ('Via Ponzilovo', 0, '{"ponzilovo"}'),
  ('Via dei Bandi', 1, '{"dei bandi"}');