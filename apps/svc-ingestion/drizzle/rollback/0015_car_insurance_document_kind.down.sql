-- Undoes 0015_car_insurance_document_kind. Not applied automatically (drizzle
-- migrations only go forward): run it by hand as ingestion_svc, then delete the
-- last row of ingestion.__drizzle_migrations. Fields already extracted on
-- documents stay.
BEGIN;
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(
         c."template_json",
         '{fields}',
         coalesce((
           SELECT jsonb_agg(
                    CASE WHEN f ->> 'key' = 'total_amount'
                         THEN f || '{"required": true, "description": "Premio totale of the period"}'::jsonb
                         ELSE f END
                    ORDER BY n)
             FROM jsonb_array_elements(c."template_json" -> 'fields') WITH ORDINALITY AS t(f, n)
            WHERE f ->> 'key' <> 'document_kind'
         ), '[]'::jsonb)
       )
 WHERE c."id" = 'CAR_INSURANCE'
   AND c."template_json" ? 'fields';
UPDATE "ingestion"."document_categories"
   SET "description" = 'A motor insurance policy or certificate (polizza RCA auto) with its extra cover: insurer, policy number, start and end of the cover, bonus-malus class and premium.'
 WHERE "id" = 'CAR_INSURANCE'
   AND "description" = 'A document of a motor insurance (polizza RCA auto) with its extra cover: the policy, the certificate of insurance (also the international one, ex carta verde) or the receipt of a premium payment. Insurer, policy number, start and end of the cover, bonus-malus class and premium.';
COMMIT;
