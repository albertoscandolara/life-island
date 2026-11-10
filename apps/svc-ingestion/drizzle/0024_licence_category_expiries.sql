-- DRIVING_LICENCE gains the categories whose own expiry date (field 11 on the
-- back) differs from the licence's, so People warns for each of them, and its
-- restriction codes are asked one by one. Only when the template does not
-- have the field yet, so your own edits stay. They fill in from the next parse.
-- Data only. Rollback: drizzle/rollback/0024_licence_category_expiries.down.sql.
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(
         coalesce(c."template_json", '{}'::jsonb),
         '{fields}',
         coalesce(c."template_json" -> 'fields', '[]'::jsonb) || jsonb_build_array(
           '{"key": "category_expiries", "label": "Category expiry dates", "type": "string", "description": "From the table on the back (fields 9 and 11): each category whose expiry date differs from the licence''s own (field 4b), as CATEGORY: YYYY-MM-DD, comma separated, e.g. C: 2028-05-01, CE: 2028-05-01. Empty when every category expires with the licence", "required": false}'::jsonb
         )
       )
 WHERE c."id" = 'DRIVING_LICENCE'
   AND NOT EXISTS (
     SELECT 1 FROM jsonb_array_elements(coalesce(c."template_json" -> 'fields', '[]'::jsonb)) f
      WHERE f ->> 'key' = 'category_expiries'
   );
