-- Undoes 0024_licence_category_expiries: drops the category expiry dates
-- from DRIVING_LICENCE. Documents keep what was read into them.
-- Run it by hand as ingestion_svc, then delete the last row of
-- ingestion.__drizzle_migrations.
BEGIN;
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(
         c."template_json",
         '{fields}',
         coalesce((
           SELECT jsonb_agg(f ORDER BY n)
             FROM jsonb_array_elements(c."template_json" -> 'fields') WITH ORDINALITY AS t(f, n)
            WHERE f ->> 'key' <> 'category_expiries'
         ), '[]'::jsonb)
       )
 WHERE c."id" = 'DRIVING_LICENCE';
COMMIT;
