CREATE TABLE "settings"."ai_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_id" text NOT NULL,
	"service" text NOT NULL,
	"user_id" text,
	"reserved_usd" numeric(12, 6) NOT NULL,
	"actual_usd" numeric(12, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "ai_reservations_created_idx" ON "settings"."ai_reservations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_reservations_user_idx" ON "settings"."ai_reservations" USING btree ("user_id","created_at");