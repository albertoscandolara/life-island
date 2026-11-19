ALTER TABLE "money"."transactions" ADD COLUMN "splits" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "money"."transactions" ADD COLUMN "channel" text;