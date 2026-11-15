ALTER TABLE "home"."organizations" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "home"."organizations" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "home"."organizations" ADD COLUMN "logo_key" text;--> statement-breakpoint
ALTER TABLE "home"."organizations" ADD COLUMN "logo_type" text;--> statement-breakpoint
ALTER TABLE "home"."organizations" ADD COLUMN "logo_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "home"."organizations" ADD COLUMN "cover_key" text;--> statement-breakpoint
ALTER TABLE "home"."organizations" ADD COLUMN "cover_type" text;--> statement-breakpoint
ALTER TABLE "home"."organizations" ADD COLUMN "cover_updated_at" timestamp with time zone;