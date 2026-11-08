-- The schema itself is created by infra/postgres/init (owned by work_svc).
CREATE TABLE "work"."career_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"workplace_id" uuid,
	"amount" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."career_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text,
	"source" text NOT NULL,
	"model" text,
	"output" jsonb NOT NULL,
	"documents_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."category_tree" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"parent_id" text,
	"dimension" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."documents" (
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
CREATE TABLE "work"."hiring_platforms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"account" text,
	"status" text DEFAULT 'active' NOT NULL,
	"profile_updated_at" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."reviews" (
	"upload_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"workplace_id" uuid,
	"created_workplace" boolean DEFAULT false NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."workplaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text,
	"status" text DEFAULT 'current' NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work"."career_events" ADD CONSTRAINT "career_events_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "work"."workplaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."reviews" ADD CONSTRAINT "reviews_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "work"."workplaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_categories_idx" ON "work"."documents" USING gin ("categories");--> statement-breakpoint
CREATE INDEX "reviews_workplace_idx" ON "work"."reviews" USING btree ("workplace_id");