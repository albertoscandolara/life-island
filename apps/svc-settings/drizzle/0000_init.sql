-- The schema itself is created by infra/postgres/init (owned by settings_svc).
CREATE TABLE "settings"."ai_tool_requests" (
	"tool_id" text PRIMARY KEY NOT NULL,
	"service" text NOT NULL,
	"available" boolean NOT NULL,
	"prompt_version" text,
	"steps" jsonb NOT NULL,
	"described_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings"."ai_tool_uses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tool_id" text NOT NULL,
	"service" text NOT NULL,
	"outcome" text NOT NULL,
	"error" text,
	"cost_usd" numeric(12, 6) NOT NULL,
	"steps" jsonb NOT NULL,
	"used_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings"."setting_values" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_tool_uses_tool_idx" ON "settings"."ai_tool_uses" USING btree ("tool_id","used_at");