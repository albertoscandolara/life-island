-- The review inbox's copy of the category hierarchy (filled from ingestion's
-- category.changed@1 events), so filtering by a category includes its
-- descendants in one query; and a GIN index for category filters.
-- Rollback: drizzle/rollback/0003_category_tree.down.sql.
CREATE TABLE "review"."category_tree" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"parent_id" text,
	"dimension" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "category_tree_parent_idx" ON "review"."category_tree" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "staging_records_categories_idx" ON "review"."staging_records" USING gin ("categories");