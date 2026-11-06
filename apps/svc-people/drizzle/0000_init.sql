-- The schema itself is created by infra/postgres/init (owned by people_svc).
CREATE TABLE "people"."category_tree" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"parent_id" text,
	"dimension" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people"."documents" (
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
CREATE TABLE "people"."persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"last_name" text,
	"first_name" text,
	"tax_code" text,
	"birth_date" date,
	"birth_place" text,
	"sex" text,
	"citizenship" text,
	"residence_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persons_tax_code_unique" UNIQUE("tax_code")
);
--> statement-breakpoint
CREATE TABLE "people"."reviews" (
	"upload_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"person_id" uuid,
	"created_person" boolean DEFAULT false NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"marked_status" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "people"."reviews" ADD CONSTRAINT "reviews_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "people"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_categories_idx" ON "people"."documents" USING gin ("categories");--> statement-breakpoint
CREATE INDEX "reviews_person_idx" ON "people"."reviews" USING btree ("person_id");