-- An insurer sends one insurance as several files: the policy, the certificate
-- (also the international one, ex carta verde) and the receipt of the premium.
-- Cars puts the documents with the same policy number in one record; to tell
-- them apart there, the car insurance template gains document_kind, and its
-- premium is no longer required (a certificate prints none). The category's
-- description names the three files, so a receipt is filed under it too.
-- Data only: a field you already have and a description you changed stay.
-- Rollback: drizzle/rollback/0015_car_insurance_document_kind.down.sql.
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(
         coalesce(c."template_json", '{}'::jsonb),
         '{fields}',
         coalesce(c."template_json" -> 'fields', '[]'::jsonb) || jsonb_build_array(
           '{"key": "document_kind", "label": "Document", "type": "enum", "description": "Which document of the insurance this is: policy (polizza, the contract with its cover and conditions), certificate (certificato di assicurazione, also the international one, ex carta verde), receipt (ricevuta or quietanza of a premium payment), other", "required": false, "options": ["policy", "certificate", "receipt", "other"]}'::jsonb
         )
       )
 WHERE c."id" = 'CAR_INSURANCE'
   AND NOT EXISTS (
     SELECT 1 FROM jsonb_array_elements(coalesce(c."template_json" -> 'fields', '[]'::jsonb)) f
      WHERE f ->> 'key' = 'document_kind'
   );--> statement-breakpoint
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(
         c."template_json",
         '{fields}',
         (
           SELECT jsonb_agg(
                    CASE WHEN f ->> 'key' = 'total_amount'
                         THEN f || '{"required": false, "description": "Premio totale of the period, or the amount paid on a receipt; null when the document prints none (a certificate)"}'::jsonb
                         ELSE f END
                    ORDER BY n)
             FROM jsonb_array_elements(c."template_json" -> 'fields') WITH ORDINALITY AS t(f, n)
         )
       )
 WHERE c."id" = 'CAR_INSURANCE'
   AND c."template_json" -> 'fields' @> '[{"key": "total_amount", "description": "Premio totale of the period", "required": true}]'::jsonb;--> statement-breakpoint
UPDATE "ingestion"."document_categories"
   SET "description" = 'A document of a motor insurance (polizza RCA auto) with its extra cover: the policy, the certificate of insurance (also the international one, ex carta verde) or the receipt of a premium payment. Insurer, policy number, start and end of the cover, bonus-malus class and premium.'
 WHERE "id" = 'CAR_INSURANCE'
   AND "description" = 'A motor insurance policy or certificate (polizza RCA auto) with its extra cover: insurer, policy number, start and end of the cover, bonus-malus class and premium.';
