CREATE TABLE "money"."match_rejections" (
	"transaction_id" uuid NOT NULL,
	"payable_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_rejections_pair" UNIQUE("transaction_id","payable_key")
);
--> statement-breakpoint
CREATE TABLE "money"."movement_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"payable_key" text NOT NULL,
	"module" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"title" text NOT NULL,
	"path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movement_links_pair" UNIQUE("transaction_id","payable_key")
);
--> statement-breakpoint
ALTER TABLE "money"."match_rejections" ADD CONSTRAINT "match_rejections_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "money"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money"."movement_links" ADD CONSTRAINT "movement_links_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "money"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "movement_links_payable_idx" ON "money"."movement_links" USING btree ("payable_key");