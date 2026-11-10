-- Household (relations, fiscal dependents), the history of your edits and
-- merges, the renewal guides Claude wrote, and the copy of the settings
-- svc-people reads (settings.changed@1).
CREATE TABLE "people"."person_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people"."relations" (
	"person_id" uuid NOT NULL,
	"related_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relations_person_id_related_id_pk" PRIMARY KEY("person_id","related_id")
);
--> statement-breakpoint
CREATE TABLE "people"."renewal_guides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"type" text NOT NULL,
	"town" text NOT NULL,
	"output" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people"."settings_replica" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "people"."persons" ADD COLUMN "tax_dependent_of" uuid;--> statement-breakpoint
ALTER TABLE "people"."person_edits" ADD CONSTRAINT "person_edits_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "people"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people"."relations" ADD CONSTRAINT "relations_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "people"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people"."relations" ADD CONSTRAINT "relations_related_id_persons_id_fk" FOREIGN KEY ("related_id") REFERENCES "people"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people"."renewal_guides" ADD CONSTRAINT "renewal_guides_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "people"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_edits_person_idx" ON "people"."person_edits" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "relations_related_idx" ON "people"."relations" USING btree ("related_id");--> statement-breakpoint
CREATE INDEX "renewal_guides_person_idx" ON "people"."renewal_guides" USING btree ("person_id");--> statement-breakpoint
ALTER TABLE "people"."persons" ADD CONSTRAINT "persons_tax_dependent_of_persons_id_fk" FOREIGN KEY ("tax_dependent_of") REFERENCES "people"."persons"("id") ON DELETE set null ON UPDATE no action;