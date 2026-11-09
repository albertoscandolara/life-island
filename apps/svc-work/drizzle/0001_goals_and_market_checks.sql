CREATE TABLE "work"."goal_statuses" (
	"upload_id" uuid NOT NULL,
	"goal_key" text NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_statuses_upload_id_goal_key_pk" PRIMARY KEY("upload_id","goal_key")
);
--> statement-breakpoint
CREATE TABLE "work"."market_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model" text,
	"ral" numeric(12, 2),
	"output" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
