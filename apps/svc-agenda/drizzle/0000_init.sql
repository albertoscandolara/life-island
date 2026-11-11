-- The schema itself is created by infra/postgres/init (owned by agenda_svc).
CREATE TABLE "agenda"."agenda_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"date" date NOT NULL,
	"time" text,
	"repeat" text DEFAULT 'none' NOT NULL,
	"category" text DEFAULT 'personal' NOT NULL,
	"notes" text,
	"done" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agenda"."handled_entries" (
	"key" text PRIMARY KEY NOT NULL,
	"handled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agenda"."settings_replica" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agenda"."week_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text,
	"output" jsonb NOT NULL,
	"source" text NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
