-- Companies known before confirmation existed were already in use by your bills: they stay confirmed.
ALTER TABLE "home"."organizations" ADD COLUMN "status" text DEFAULT 'CONFIRMED' NOT NULL;--> statement-breakpoint
ALTER TABLE "home"."organizations" ALTER COLUMN "status" SET DEFAULT 'PENDING';--> statement-breakpoint
ALTER TABLE "home"."organizations" ADD COLUMN "aliases" text[] DEFAULT '{}' NOT NULL;
