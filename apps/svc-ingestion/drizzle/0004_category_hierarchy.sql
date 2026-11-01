-- Category hierarchies and metadata dimensions.
-- Additive only: every existing category keeps its id, title, description,
-- template and documents; parent_id and dimension start NULL for all of them,
-- so no category moves and no document gains or loses metadata. You place
-- categories in trees and give them dimensions yourself, from the Categories page.
-- Rollback: drizzle/rollback/0004_category_hierarchy.down.sql.
CREATE TYPE "ingestion"."category_dimension" AS ENUM('DOCUMENT_TYPE', 'SUBJECT', 'PROPERTY', 'PERSON', 'ISSUER', 'ATTRIBUTE');--> statement-breakpoint
ALTER TABLE "ingestion"."document_categories" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "ingestion"."document_categories" ADD COLUMN "dimension" "ingestion"."category_dimension";--> statement-breakpoint
ALTER TABLE "ingestion"."document_categories" ADD CONSTRAINT "document_categories_parent_id_document_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "ingestion"."document_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_categories_parent_idx" ON "ingestion"."document_categories" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "ingestion"."document_categories" ADD CONSTRAINT "document_categories_not_own_parent" CHECK ("ingestion"."document_categories"."parent_id" is null or "ingestion"."document_categories"."parent_id" <> "ingestion"."document_categories"."id");;--> statement-breakpoint
-- Safety net under the service's own checks: a category can never end up
-- below itself (directly or through its descendants).
CREATE FUNCTION "ingestion"."document_categories_prevent_cycle"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    WITH RECURSIVE up (id, parent_id) AS (
      SELECT c.id, c.parent_id FROM ingestion.document_categories c WHERE c.id = NEW.parent_id
      UNION
      SELECT c.id, c.parent_id FROM ingestion.document_categories c JOIN up ON c.id = up.parent_id
    )
    SELECT 1 FROM up WHERE up.id = NEW.id
  ) THEN
    RAISE EXCEPTION 'category % cannot be placed below its own descendant %', NEW.id, NEW.parent_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'document_categories_no_cycle';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "document_categories_prevent_cycle"
  BEFORE INSERT OR UPDATE OF "parent_id" ON "ingestion"."document_categories"
  FOR EACH ROW EXECUTE FUNCTION "ingestion"."document_categories_prevent_cycle"();--> statement-breakpoint
-- The review inbox keeps its own copy of the hierarchy, fed by category.changed@1.
-- Seed it with every existing category, through the outbox like any other event.
INSERT INTO "ingestion"."outbox" (event_type, payload)
SELECT 'category.changed@1',
       jsonb_build_object(
         'id', c.id,
         'title', c.title,
         'parentId', c.parent_id,
         'dimension', c.dimension,
         'deleted', false,
         'changedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       )
  FROM "ingestion"."document_categories" c;
