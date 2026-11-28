CREATE TABLE "studies"."learning_paths" (
	"id" text PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"emblem" text NOT NULL,
	"name" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"why" text DEFAULT '' NOT NULL,
	"capstone" text DEFAULT '' NOT NULL,
	"certifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stages" jsonb NOT NULL,
	"template_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
