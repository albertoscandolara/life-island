-- Undoes 0027_pension_fund_fields. Not applied automatically (drizzle
-- migrations only go forward): run it by hand as ingestion_svc, then delete
-- the last row of ingestion.__drizzle_migrations. PENSION_FUND_STATEMENT is
-- removed only when no document uses it; otherwise delete it from the
-- Categories page, which also tells the other modules. The CU fields are
-- removed by their key; documents keep what was read into them.
BEGIN;
DELETE FROM "ingestion"."document_categories" c
 WHERE c.id = 'PENSION_FUND_STATEMENT'
   AND NOT EXISTS (SELECT 1 FROM "ingestion"."uploads" u WHERE c.id = ANY(u.categories))
   AND NOT EXISTS (SELECT 1 FROM "ingestion"."document_categories" child WHERE child.parent_id = c.id);
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(
         c."template_json",
         '{fields}',
         coalesce((
           SELECT jsonb_agg(f ORDER BY n)
             FROM jsonb_array_elements(c."template_json" -> 'fields') WITH ORDINALITY AS t(f, n)
            WHERE f ->> 'key' NOT IN ('pension_fund_deducted', 'pension_fund_not_deducted')
         ), '[]'::jsonb)
       )
 WHERE c.id = 'CERTIFICAZIONE_UNICA';
COMMIT;
