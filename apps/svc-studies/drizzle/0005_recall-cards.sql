CREATE TABLE "studies"."recall_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"step_id" text NOT NULL,
	"path_id" text NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"due_on" date NOT NULL,
	"last_result" text,
	"ai" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studies"."recall_learned" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"step_id" text NOT NULL,
	"learned_on" date NOT NULL
);
--> statement-breakpoint
CREATE INDEX "recall_cards_due_idx" ON "studies"."recall_cards" USING btree ("due_on");--> statement-breakpoint
CREATE INDEX "recall_cards_step_idx" ON "studies"."recall_cards" USING btree ("step_id");