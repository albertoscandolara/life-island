CREATE TABLE "tax730"."payments" (
	"link_id" uuid PRIMARY KEY NOT NULL,
	"payable_key" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"paid_on" date,
	"account_name" text,
	"description" text,
	"unlinked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "payments_payable_idx" ON "tax730"."payments" USING btree ("payable_key");