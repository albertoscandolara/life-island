-- Undoes 0028_bill_payment_method. Not applied automatically (drizzle
-- migrations only go forward): run it by hand as ingestion_svc, then delete
-- the last row of ingestion.__drizzle_migrations. The field is removed by its
-- key; documents keep what was read into it.
BEGIN;
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(
         c."template_json",
         '{fields}',
         coalesce((
           SELECT jsonb_agg(f ORDER BY n)
             FROM jsonb_array_elements(c."template_json" -> 'fields') WITH ORDINALITY AS t(f, n)
            WHERE f ->> 'key' <> 'payment_method'
         ), '[]'::jsonb)
       )
 WHERE c.id IN ('ELECTRICITY_BILL', 'GAS_BILL', 'WATER_BILL');
COMMIT;
