-- Undoes 0012_bill_entity_fields. Not applied automatically (drizzle migrations
-- only go forward): run it by hand as ingestion_svc, then delete the last row of
-- ingestion.__drizzle_migrations. Fields already extracted on documents stay.
BEGIN;
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(
         c."template_json",
         '{fields}',
         coalesce((
           SELECT jsonb_agg(f ORDER BY n)
             FROM jsonb_array_elements(c."template_json" -> 'fields') WITH ORDINALITY AS t(f, n)
            WHERE f ->> 'key' NOT IN ('invoice_number', 'supplier_tax_code', 'supply_point_code',
                                      'customer_code', 'distributor', 'offer_name', 'total_due')
         ), '[]'::jsonb)
       )
 WHERE c."id" IN ('ELECTRICITY_BILL', 'GAS_BILL', 'WATER_BILL')
   AND c."template_json" ? 'fields';
COMMIT;
