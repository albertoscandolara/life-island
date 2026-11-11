-- The schema itself is created by infra/postgres/init (owned by health_svc).
CREATE TABLE "health"."checkups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person" text NOT NULL,
	"name" text NOT NULL,
	"every_months" integer NOT NULL,
	"last_done_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health"."explanations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person" text,
	"question" text,
	"output" jsonb NOT NULL,
	"source" text NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health"."medicines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person" text NOT NULL,
	"name" text NOT NULL,
	"dose" text,
	"schedule" text,
	"start_on" date,
	"end_on" date,
	"refill_on" date,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health"."settings_replica" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health"."test_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"person" text NOT NULL,
	"test" text NOT NULL,
	"value" double precision NOT NULL,
	"unit" text,
	"low" double precision,
	"high" double precision,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health"."vaccinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person" text NOT NULL,
	"name" text NOT NULL,
	"date" date NOT NULL,
	"next_due_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health"."visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"person" text NOT NULL,
	"kind" text DEFAULT 'gp' NOT NULL,
	"doctor" text,
	"reason" text,
	"outcome" text,
	"cost" numeric(10, 2),
	"deductible" boolean DEFAULT true NOT NULL,
	"follow_up_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
