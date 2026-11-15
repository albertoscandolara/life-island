CREATE TABLE "home"."house_document_overrides" (
	"upload_id" uuid PRIMARY KEY NOT NULL,
	"manual_property" boolean DEFAULT false NOT NULL,
	"property_id" uuid,
	"excluded" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "home"."tax_expense_links" (
	"expense_id" uuid PRIMARY KEY NOT NULL,
	"manual_property" boolean DEFAULT false NOT NULL,
	"property_id" uuid,
	"work_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "home"."house_document_overrides" ADD CONSTRAINT "house_document_overrides_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "home"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home"."tax_expense_links" ADD CONSTRAINT "tax_expense_links_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "home"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home"."tax_expense_links" ADD CONSTRAINT "tax_expense_links_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "home"."works"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tax_expense_links_property_idx" ON "home"."tax_expense_links" USING btree ("property_id");