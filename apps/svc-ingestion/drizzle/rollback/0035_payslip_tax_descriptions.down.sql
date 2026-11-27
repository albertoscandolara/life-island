-- Undoes 0035_payslip_tax_descriptions: the PAYSLIP descriptions it wrote go back to the earlier
-- ones (yours, if you edited them since, stay).
-- Run it by hand as ingestion_svc, then delete the last row of
-- ingestion.__drizzle_migrations.
BEGIN;
WITH descriptions ("key", "old", "new") AS (
  VALUES
  ('income_tax_withheld',
   'Income tax withheld this month (IRPEF netta or trattenuta)',
   'Ordinary income tax withheld this month: IRPEF netta of the month (or IRPEF trattenuta). Not the 5% substitute tax on a productivity bonus (imposta sostitutiva), not the regional or municipal surtax, and not the year-end conguaglio, which is tax_adjustment. Missing when the month''s IRPEF box is blank'),
  ('tax_adjustment',
   'IRPEF year-end or 730 adjustment this month (conguaglio IRPEF, rimborso or trattenuta 730): positive when more tax is withheld, negative when tax is refunded',
   'IRPEF year-end or 730 adjustment this month (conguaglio IRPEF, rimborso or trattenuta 730): positive when more tax is withheld, negative when tax is refunded. December''s year-end conguaglio is often printed only in the yearly (ANNO) box as IRPEF CONGUAGLIO, with a trailing minus for a refund: 684,98- is -684.98')
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
