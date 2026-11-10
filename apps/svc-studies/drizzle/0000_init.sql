-- The schema itself is created by infra/postgres/init (owned by studies_svc).
CREATE TABLE "studies"."certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"provider" text,
	"topic" text DEFAULT 'other' NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"exam_on" date,
	"cost" numeric(10, 2),
	"obtained_on" date,
	"expires_on" date,
	"credential_url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studies"."courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"platform_id" uuid,
	"url" text,
	"topic" text DEFAULT 'other' NOT NULL,
	"step_id" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"hours" numeric(7, 1),
	"cost" numeric(10, 2),
	"started_on" date,
	"completed_on" date,
	"certificate_url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studies"."path_progress" (
	"path_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"started_on" date NOT NULL,
	"target_on" date
);
--> statement-breakpoint
CREATE TABLE "studies"."settings_replica" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studies"."step_progress" (
	"step_id" text PRIMARY KEY NOT NULL,
	"path_id" text NOT NULL,
	"status" text NOT NULL,
	"started_on" date,
	"done_on" date,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "studies"."study_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text,
	"output" jsonb NOT NULL,
	"source" text NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studies"."study_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"minutes" integer NOT NULL,
	"topic" text DEFAULT 'other' NOT NULL,
	"path_id" text,
	"step_id" text,
	"course_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studies"."training_platforms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"account" text,
	"plan" text DEFAULT 'free' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"price" numeric(10, 2),
	"billing_period" text,
	"renews_on" date,
	"topics" text[] DEFAULT '{}' NOT NULL,
	"notes" text,
	"last_opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "studies"."courses" ADD CONSTRAINT "courses_platform_id_training_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "studies"."training_platforms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studies"."study_sessions" ADD CONSTRAINT "study_sessions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "studies"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "study_sessions_date_idx" ON "studies"."study_sessions" USING btree ("date");