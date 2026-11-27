-- The month's TFR was sometimes read as CONTR. AGG. TFR, the 0.5%
-- contribution printed next to TFR MESE (11,24 instead of 155,29), so the
-- year's TFR looked far too low. The description now says which box to read.
-- Only a description you have not edited changes; it applies from the next
-- parse. Data only. Rollback: drizzle/rollback/0036_payslip_tfr_description.down.sql.
WITH descriptions ("key", "old", "new") AS (
  VALUES
  ('severance_accrued',
   'Severance pay accrued this month (TFR mese)',
   'Severance pay accrued this month: TFR MESE (about 7% of the month''s pay). Not CONTR. AGG. TFR, the 0.5% contribution printed next to it, and not TFR ANNUO PROGR. or the fund total')
)
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(
         c."template_json",
         '{fields}',
         (SELECT jsonb_agg(
                   CASE WHEN d."key" IS NOT NULL THEN jsonb_set(f, '{description}', to_jsonb(d."new")) ELSE f END
                   ORDER BY t.n)
            FROM jsonb_array_elements(c."template_json" -> 'fields') WITH ORDINALITY AS t(f, n)
            LEFT JOIN descriptions d
              ON d."key" = f ->> 'key' AND d."old" = f ->> 'description')
       )
 WHERE c."id" = 'PAYSLIP'
   AND jsonb_array_length(coalesce(c."template_json" -> 'fields', '[]'::jsonb)) > 0;
