-- The schema itself is created by infra/postgres/init (owned by subscriptions_svc).
CREATE TABLE "subscriptions"."contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"provider" text,
	"kind" text DEFAULT 'other' NOT NULL,
	"cost" numeric(10, 2) NOT NULL,
	"cycle" text DEFAULT 'monthly' NOT NULL,
	"start_on" date,
	"renews_on" date,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"notice_days" integer DEFAULT 0 NOT NULL,
	"locked_until" date,
	"status" text DEFAULT 'active' NOT NULL,
	"usage" text,
	"paid_with" text,
	"cancel_url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions"."price_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"date" date NOT NULL,
	"from_cost" numeric(10, 2) NOT NULL,
	"to_cost" numeric(10, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions"."renewal_advice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text,
	"output" jsonb NOT NULL,
	"source" text NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions"."settings_replica" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions"."price_changes" ADD CONSTRAINT "price_changes_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "subscriptions"."contracts"("id") ON DELETE cascade ON UPDATE no action;