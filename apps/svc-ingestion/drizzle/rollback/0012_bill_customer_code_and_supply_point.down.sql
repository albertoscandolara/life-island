-- Undoes 0012_bill_customer_code_and_supply_point. Not applied automatically
-- (drizzle migrations only go forward): run it by hand as ingestion_svc, then
-- delete the last row of ingestion.__drizzle_migrations. Puts back the one
-- "customer_id" field where the customer code was, and drops POD/PDR and offer.
BEGIN;
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(c."template_json", '{fields}', (
         SELECT jsonb_agg(
                  CASE WHEN f.field->>'key' = 'customer_code' THEN jsonb_build_object(
                         'key', 'customer_id', 'label', 'Supply point code', 'type', 'string',
                         'description', CASE WHEN c.id = 'ELECTRICITY_BILL'
                           THEN 'POD code of the electricity supply point (e.g. IT001E12345678), or the customer code'
                           ELSE 'PDR code of the gas supply point (14 digits), or the customer code' END,
                         'required', false)
                       ELSE f.field END
                  ORDER BY f.position)
           FROM jsonb_array_elements(c."template_json"->'fields') WITH ORDINALITY AS f(field, position)
          WHERE f.field->>'key' NOT IN ('pod', 'pdr', 'offer_name')
       ))
 WHERE c.id IN ('ELECTRICITY_BILL', 'GAS_BILL')
   AND jsonb_path_exists(c."template_json", '$.fields[*] ? (@.key == "customer_code")');
COMMIT;
