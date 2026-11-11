-- The schema itself is created by infra/postgres/init (owned by fitness_svc).
CREATE TABLE "fitness"."events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"date" date NOT NULL,
	"target" text,
	"done" boolean DEFAULT false NOT NULL,
	"result" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fitness"."measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"weight_kg" double precision,
	"waist_cm" double precision,
	"resting_hr" integer,
	"sleep_hours" double precision,
	"steps" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fitness"."settings_replica" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fitness"."training_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text,
	"output" jsonb NOT NULL,
	"source" text NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fitness"."workouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"kind" text DEFAULT 'walk' NOT NULL,
	"minutes" integer NOT NULL,
	"distance_km" double precision,
	"intensity" text DEFAULT 'moderate' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
