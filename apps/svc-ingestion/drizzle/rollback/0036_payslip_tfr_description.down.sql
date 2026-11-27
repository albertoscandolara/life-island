-- Undoes 0036_payslip_tfr_description: the PAYSLIP description it wrote goes back to the earlier
-- one (yours, if you edited it since, stays).
-- Run it by hand as ingestion_svc, then delete the last row of
-- ingestion.__drizzle_migrations.
BEGIN;
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
                   CASE WHEN d."key" IS NOT NULL THEN jsonb_set(f, '{description}', to_jsonb(d."old")) ELSE f END
                   ORDER BY t.n)
            FROM jsonb_array_elements(c."template_json" -> 'fields') WITH ORDINALITY AS t(f, n)
            LEFT JOIN descriptions d
              ON d."key" = f ->> 'key' AND d."new" = f ->> 'description')
       )
 WHERE c."id" = 'PAYSLIP'
   AND jsonb_array_length(coalesce(c."template_json" -> 'fields', '[]'::jsonb)) > 0;
COMMIT;
