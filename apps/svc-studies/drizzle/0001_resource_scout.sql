CREATE TABLE "studies"."outline_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"path_id" text NOT NULL,
	"kind" text NOT NULL,
	"stage_id" text NOT NULL,
	"step_id" text NOT NULL,
	"title" text,
	"detail" text,
	"outcome" text,
	"step_kind" text,
	"hours" integer,
	"reason" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"scan_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "studies"."scout_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"path_id" text NOT NULL,
	"step_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"published_on" text,
	"free" boolean DEFAULT true NOT NULL,
	"why" text NOT NULL,
	"status" text NOT NULL,
	"outdated" text,
	"scan_id" uuid,
	"found_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "studies"."scout_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"path_id" text NOT NULL,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"step_ids" text[] DEFAULT '{}' NOT NULL,
	"found" integer DEFAULT 0 NOT NULL,
	"flagged" integer DEFAULT 0 NOT NULL,
	"proposed" integer DEFAULT 0 NOT NULL,
	"error" text,
	"model" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "studies"."scout_steps" (
	"step_id" text PRIMARY KEY NOT NULL,
	"path_id" text NOT NULL,
	"pace" text NOT NULL,
	"scanned_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "scout_resources_step_url_idx" ON "studies"."scout_resources" USING btree ("step_id","url");--> statement-breakpoint
CREATE INDEX "scout_scans_path_idx" ON "studies"."scout_scans" USING btree ("path_id","started_at");