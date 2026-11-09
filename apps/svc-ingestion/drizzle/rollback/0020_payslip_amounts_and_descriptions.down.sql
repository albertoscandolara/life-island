-- Undoes 0020_payslip_amounts_and_descriptions: the PAYSLIP descriptions it
-- wrote go back to the earlier ones (yours, if you edited them since, stay).
-- The amounts it took back are correct readings of the document and stay.
-- Run it by hand as ingestion_svc, then delete the last row of
-- ingestion.__drizzle_migrations.
BEGIN;
WITH descriptions ("key", "old", "new") AS (
  VALUES
  ('vacation_left',
   'Remaining paid vacation (ferie residue)',
   'Remaining paid vacation (ferie residue), in hours. When the payslip prints it split into previous years (anni precedenti, AP) and the current year (anno corrente, AC), report the sum of the two'),
  ('leave_left',
   'Remaining paid leave hours (permessi, ROL residui)',
   'Remaining paid leave hours (permessi, ROL, ex festività residui). When the payslip prints several residual figures (previous years and current year, or ROL and permessi), report their sum'),
  ('superminimum',
   'SUPERMINIMO or SUPERM. ASSORBIBILE among the elementi retributivi, when printed',
   'Superminimo among the elementi retributivi: SUPERMINIMO, SUPERM. ASSORBIBILE or both, summed when more than one superminimo item is printed'),
  ('welfare_credits',
   'Welfare or benefit credits shown on the payslip but not paid in the net (conversione welfare, art. 51), total of the month',
   'Welfare or benefit credits shown on the payslip but not paid in the net (conversione welfare art. 51 or art. 100, welfare CCNL, flexible benefits, buoni or ticket compliments): the sum of every such line of the month'),
  ('taxable_income',
   'Income subject to income tax this month (imponibile fiscale)',
   'Income subject to ordinary income tax this month (imponibile fiscale, imp. a tassazione ordinaria). A separate detassata or agevolata base, taxed with a substitute tax, is not included'),
  ('job_level',
   'Level or grade (livello)',
   'Level or grade (livello): only its code on the CCNL scale, such as C3, B1, 5S or Q, without prefixes such as IMP.LIV. or notes such as L. 56/87'),
  ('payslip_kind',
   'regular for the monthly payslip; thirteenth for a separate tredicesima payslip (13.MA MENSILITA'', gratifica natalizia); fourteenth for a quattordicesima (14.MA MENSILITA''); other for a separate payslip of only a bonus, arrears or settlement. A monthly payslip that also pays the tredicesima is regular',
   'regular for the monthly payslip; thirteenth for a separate tredicesima payslip (13.MA MENSILITA'', MENS. SUPPLEMENTARE or mensilità aggiuntiva of December, gratifica natalizia); fourteenth for a quattordicesima (14.MA MENSILITA'', mensilità supplementare of June or July); other for a separate payslip of only a bonus, arrears or settlement. A monthly payslip that also pays the tredicesima is regular')
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
