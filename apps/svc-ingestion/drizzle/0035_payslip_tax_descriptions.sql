-- The CU check compares the IRPEF a Certificazione Unica declares with the
-- payslips' IRPEF. Two PAYSLIP fields were read in ways that cannot match it:
-- 1. income_tax_withheld sometimes added the 5% substitute tax on a
--    productivity bonus, which the CU keeps apart (punto 576);
-- 2. tax_adjustment missed December's year-end conguaglio when it is printed
--    only in the yearly box (IRPEF CONGUAGLIO 684,98-).
-- Their descriptions now say so. Only descriptions you have not edited
-- change; they apply from the next parse.
-- Data only. Rollback: drizzle/rollback/0035_payslip_tax_descriptions.down.sql.
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
                   CASE WHEN d."key" IS NOT NULL THEN jsonb_set(f, '{description}', to_jsonb(d."new")) ELSE f END
                   ORDER BY t.n)
            FROM jsonb_array_elements(c."template_json" -> 'fields') WITH ORDINALITY AS t(f, n)
            LEFT JOIN descriptions d
              ON d."key" = f ->> 'key' AND d."old" = f ->> 'description')
       )
 WHERE c."id" = 'PAYSLIP'
   AND jsonb_array_length(coalesce(c."template_json" -> 'fields', '[]'::jsonb)) > 0;
