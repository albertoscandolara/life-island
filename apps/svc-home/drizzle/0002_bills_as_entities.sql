CREATE TABLE "home"."bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" uuid NOT NULL,
	"title" text NOT NULL,
	"utility" text NOT NULL,
	"utility_overridden" boolean DEFAULT false NOT NULL,
	"supplier_id" uuid,
	"supply_point_id" uuid,
	"contract_id" uuid,
	"property_id" uuid,
	"manual_property" boolean DEFAULT false NOT NULL,
	"assignment" text,
	"invoice_number" text,
	"duplicate_of" uuid,
	"issue_date" date,
	"due_date" date,
	"period_start" date,
	"period_end" date,
	"amount" numeric(14, 2) NOT NULL,
	"total_due" numeric(14, 2),
	"currency" text DEFAULT 'EUR' NOT NULL,
	"consumption" numeric(14, 3),
	"unit" text NOT NULL,
	"provider" text,
	"customer_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bills_upload_id_unique" UNIQUE("upload_id")
);
--> statement-breakpoint
CREATE TABLE "home"."organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"tax_code" text,
	"vat_number" text,
	"roles" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "home"."supply_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supply_point_id" uuid,
	"supplier_id" uuid,
	"customer_code" text,
	"offer_name" text,
	"natural_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supply_contracts_natural_key_unique" UNIQUE("natural_key")
);
--> statement-breakpoint
CREATE TABLE "home"."supply_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"utility" text NOT NULL,
	"code" text NOT NULL,
	"property_id" uuid,
	"distributor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supply_points_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "home"."bills" ADD CONSTRAINT "bills_supplier_id_organizations_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "home"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home"."bills" ADD CONSTRAINT "bills_supply_point_id_supply_points_id_fk" FOREIGN KEY ("supply_point_id") REFERENCES "home"."supply_points"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home"."bills" ADD CONSTRAINT "bills_contract_id_supply_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "home"."supply_contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home"."bills" ADD CONSTRAINT "bills_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "home"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home"."supply_contracts" ADD CONSTRAINT "supply_contracts_supply_point_id_supply_points_id_fk" FOREIGN KEY ("supply_point_id") REFERENCES "home"."supply_points"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home"."supply_contracts" ADD CONSTRAINT "supply_contracts_supplier_id_organizations_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "home"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home"."supply_points" ADD CONSTRAINT "supply_points_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "home"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home"."supply_points" ADD CONSTRAINT "supply_points_distributor_id_organizations_id_fk" FOREIGN KEY ("distributor_id") REFERENCES "home"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bills_property_idx" ON "home"."bills" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "bills_supply_point_idx" ON "home"."bills" USING btree ("supply_point_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_tax_code_idx" ON "home"."organizations" USING btree ("tax_code") WHERE "home"."organizations"."tax_code" is not null;--> statement-breakpoint
CREATE INDEX "organizations_name_key_idx" ON "home"."organizations" USING btree ("name_key");--> statement-breakpoint
CREATE INDEX "supply_contracts_point_idx" ON "home"."supply_contracts" USING btree ("supply_point_id");--> statement-breakpoint
CREATE INDEX "supply_points_property_idx" ON "home"."supply_points" USING btree ("property_id");