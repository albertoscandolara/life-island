CREATE TABLE "dreams"."habit_checks" (
	"habit_id" uuid NOT NULL,
	"date" date NOT NULL,
	CONSTRAINT "habit_checks_habit_id_date_pk" PRIMARY KEY("habit_id","date")
);
--> statement-breakpoint
CREATE TABLE "dreams"."habits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"dream_id" uuid,
	"per_week" integer DEFAULT 7 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dreams"."weekly_reviews" (
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
ALTER TABLE "dreams"."dreams" ADD COLUMN "measure" text;--> statement-breakpoint
ALTER TABLE "dreams"."dreams" ADD COLUMN "target_date" date;--> statement-breakpoint
ALTER TABLE "dreams"."habit_checks" ADD CONSTRAINT "habit_checks_habit_id_habits_id_fk" FOREIGN KEY ("habit_id") REFERENCES "dreams"."habits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dreams"."habits" ADD CONSTRAINT "habits_dream_id_dreams_id_fk" FOREIGN KEY ("dream_id") REFERENCES "dreams"."dreams"("id") ON DELETE set null ON UPDATE no action;