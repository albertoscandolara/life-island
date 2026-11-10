CREATE TABLE "cars"."fines" (
	"upload_id" uuid PRIMARY KEY NOT NULL,
	"notified_on" text,
	"paid_on" text,
	"points" integer,
	"driver_person_id" uuid,
	"driver_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cars"."quote_comparisons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"files" text[] DEFAULT '{}' NOT NULL,
	"note" text,
	"output" jsonb NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cars"."settings_replica" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cars"."tyre_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"season" text NOT NULL,
	"label" text,
	"size" text,
	"dot" text,
	"purchased_on" text,
	"tread_mm" real,
	"mounted" boolean DEFAULT false NOT NULL,
	"stored_at" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cars"."quote_comparisons" ADD CONSTRAINT "quote_comparisons_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "cars"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cars"."tyre_sets" ADD CONSTRAINT "tyre_sets_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "cars"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_comparisons_vehicle_idx" ON "cars"."quote_comparisons" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "tyre_sets_vehicle_idx" ON "cars"."tyre_sets" USING btree ("vehicle_id");