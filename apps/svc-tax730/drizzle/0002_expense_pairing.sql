ALTER TABLE "tax730"."expenses" ADD COLUMN "paired_with" uuid;--> statement-breakpoint
ALTER TABLE "tax730"."expenses" ADD COLUMN "pairing" text;--> statement-breakpoint
ALTER TABLE "tax730"."expenses" ADD CONSTRAINT "expenses_paired_with_expenses_id_fk" FOREIGN KEY ("paired_with") REFERENCES "tax730"."expenses"("id") ON DELETE set null ON UPDATE no action;