-- The schema itself is created by infra/postgres/init (owned by dreams_svc).
CREATE TABLE "dreams"."dream_check_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dream_id" uuid NOT NULL,
	"step_id" uuid,
	"outcome" text,
	"feeling" integer NOT NULL,
	"note" text,
	"next_pace" text DEFAULT 'same' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dreams"."dream_guidance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dream_id" uuid NOT NULL,
	"reflection" text NOT NULL,
	"not_yet" jsonb NOT NULL,
	"care" text,
	"source" text NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dreams"."dream_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dream_id" uuid NOT NULL,
	"question" text NOT NULL,
	"why" text,
	"answer" text,
	"source" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dreams"."dream_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dream_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'reflect' NOT NULL,
	"why" text,
	"minutes" integer,
	"cost_euro" numeric(12, 2),
	"cost" text,
	"stretch" text DEFAULT 'tiny' NOT NULL,
	"undo" text,
	"smaller" text,
	"status" text DEFAULT 'chosen' NOT NULL,
	"due_date" date,
	"done_on" date,
	"source" text DEFAULT 'you' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dreams"."dreams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"area" text DEFAULT 'other' NOT NULL,
	"story" text,
	"why" text,
	"today" text,
	"fears" text,
	"must_keep" text,
	"pace" text DEFAULT 'gentle' NOT NULL,
	"status" text DEFAULT 'dreaming' NOT NULL,
	"context_areas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"opening" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dreams"."settings_replica" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dreams"."dream_check_ins" ADD CONSTRAINT "dream_check_ins_dream_id_dreams_id_fk" FOREIGN KEY ("dream_id") REFERENCES "dreams"."dreams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dreams"."dream_check_ins" ADD CONSTRAINT "dream_check_ins_step_id_dream_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "dreams"."dream_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dreams"."dream_guidance" ADD CONSTRAINT "dream_guidance_dream_id_dreams_id_fk" FOREIGN KEY ("dream_id") REFERENCES "dreams"."dreams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dreams"."dream_questions" ADD CONSTRAINT "dream_questions_dream_id_dreams_id_fk" FOREIGN KEY ("dream_id") REFERENCES "dreams"."dreams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dreams"."dream_steps" ADD CONSTRAINT "dream_steps_dream_id_dreams_id_fk" FOREIGN KEY ("dream_id") REFERENCES "dreams"."dreams"("id") ON DELETE cascade ON UPDATE no action;