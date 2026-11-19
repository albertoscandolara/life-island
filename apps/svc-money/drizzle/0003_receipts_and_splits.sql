CREATE TABLE "money"."transaction_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_attachments_pair" UNIQUE("transaction_id","upload_id")
);
--> statement-breakpoint
ALTER TABLE "money"."transactions" ADD COLUMN "splits" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "money"."transactions" ADD COLUMN "channel" text;--> statement-breakpoint
ALTER TABLE "money"."transaction_attachments" ADD CONSTRAINT "transaction_attachments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "money"."transactions"("id") ON DELETE cascade ON UPDATE no action;