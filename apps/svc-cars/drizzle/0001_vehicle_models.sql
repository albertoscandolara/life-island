ALTER TABLE "cars"."vehicles" ADD COLUMN "model_key" text;--> statement-breakpoint
ALTER TABLE "cars"."vehicles" ADD COLUMN "model_filename" text;--> statement-breakpoint
ALTER TABLE "cars"."vehicles" ADD COLUMN "model_format" text;--> statement-breakpoint
ALTER TABLE "cars"."vehicles" ADD COLUMN "model_size" bigint;--> statement-breakpoint
ALTER TABLE "cars"."vehicles" ADD COLUMN "model_uploaded_at" timestamp with time zone;