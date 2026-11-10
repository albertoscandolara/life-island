-- Undoes 0025_car_fine_fields: drops the fine fields from VEHICLE_EXPENSE.
-- Documents keep what was read into them.
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
            WHERE f ->> 'key' NOT IN ('violation_date', 'notification_date', 'violation_article', 'licence_points', 'reduced_amount')
         ), '[]'::jsonb)
       )
 WHERE c."id" = 'VEHICLE_EXPENSE';
COMMIT;
