-- The schema itself is created by infra/postgres/init (owned by goals_svc).
CREATE TABLE "goals"."coach_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text,
	"output" jsonb NOT NULL,
	"source" text NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals"."goal_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"title" text NOT NULL,
	"due_date" date,
	"done" boolean DEFAULT false NOT NULL,
	"done_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals"."goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"area" text DEFAULT 'other' NOT NULL,
	"why" text,
	"measure" text,
	"target_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals"."habit_checks" (
	"habit_id" uuid NOT NULL,
	"date" date NOT NULL,
	CONSTRAINT "habit_checks_habit_id_date_pk" PRIMARY KEY("habit_id","date")
);
--> statement-breakpoint
CREATE TABLE "goals"."habits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"goal_id" uuid,
	"per_week" integer DEFAULT 7 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals"."settings_replica" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals"."weekly_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_start" date NOT NULL,
	"mood" integer,
	"wins" text,
	"stuck" text,
	"next" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_reviews_week_start_unique" UNIQUE("week_start")
);
--> statement-breakpoint
ALTER TABLE "goals"."goal_steps" ADD CONSTRAINT "goal_steps_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "goals"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals"."habit_checks" ADD CONSTRAINT "habit_checks_habit_id_habits_id_fk" FOREIGN KEY ("habit_id") REFERENCES "goals"."habits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals"."habits" ADD CONSTRAINT "habits_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "goals"."goals"("id") ON DELETE set null ON UPDATE no action;