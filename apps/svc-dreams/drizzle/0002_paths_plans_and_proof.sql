CREATE TABLE "dreams"."dream_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dream_id" uuid NOT NULL,
	"title" text NOT NULL,
	"why" text,
	"position" integer DEFAULT 0 NOT NULL,
	"reached_on" date,
	"source" text DEFAULT 'you' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dreams"."dream_check_ins" ADD COLUMN "actual_hard" integer;--> statement-breakpoint
ALTER TABLE "dreams"."dream_check_ins" ADD COLUMN "learned" text;--> statement-breakpoint
ALTER TABLE "dreams"."dream_steps" ADD COLUMN "milestone_id" uuid;--> statement-breakpoint
ALTER TABLE "dreams"."dream_steps" ADD COLUMN "cue" text;--> statement-breakpoint
ALTER TABLE "dreams"."dream_steps" ADD COLUMN "if_then" text;--> statement-breakpoint
ALTER TABLE "dreams"."dream_steps" ADD COLUMN "expected_hard" integer;--> statement-breakpoint
ALTER TABLE "dreams"."dream_milestones" ADD CONSTRAINT "dream_milestones_dream_id_dreams_id_fk" FOREIGN KEY ("dream_id") REFERENCES "dreams"."dreams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dreams"."dream_steps" ADD CONSTRAINT "dream_steps_milestone_id_dream_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "dreams"."dream_milestones"("id") ON DELETE set null ON UPDATE no action;