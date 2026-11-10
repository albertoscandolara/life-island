-- PAYSLIP gains what Work needs to explain the net month by month and to
-- follow the TFR: the regional and municipal surtaxes withheld, the IRPEF
-- adjustment (conguaglio), the tax credits paid in the net, and the pension
-- fund contributions with the TFR sent to the fund. Only the fields its
-- template does not have yet, so your own edits stay. They fill in from the
-- next parse.
-- Data only. Rollback: drizzle/rollback/0022_payslip_net_and_pension_fields.down.sql.
WITH extra ("position", "field") AS (
  VALUES
  (1, '{"key": "regional_surtax", "label": "Regional surtax", "type": "amount", "description": "Addizionale regionale IRPEF withheld this month (rata), all lines summed", "required": false}'::jsonb),
  (2, '{"key": "municipal_surtax", "label": "Municipal surtax", "type": "amount", "description": "Addizionale comunale IRPEF withheld this month (rata and acconto), all lines summed", "required": false}'::jsonb),
  (3, '{"key": "tax_adjustment", "label": "IRPEF adjustment", "type": "amount", "description": "IRPEF year-end or 730 adjustment this month (conguaglio IRPEF, rimborso or trattenuta 730): positive when more tax is withheld, negative when tax is refunded", "required": false}'::jsonb),
  (4, '{"key": "tax_credit", "label": "Tax credits paid", "type": "amount", "description": "Tax credits paid in the net this month (trattamento integrativo, ex bonus Renzi, somma esente or ulteriore detrazione cuneo fiscale), all lines summed", "required": false}'::jsonb),
  (5, '{"key": "pension_fund_employee", "label": "Pension fund, your contribution", "type": "amount", "description": "Your contribution to a pension fund this month (Cometa or other fondo pensione, quota a carico dipendente)", "required": false}'::jsonb),
  (6, '{"key": "pension_fund_employer", "label": "Pension fund, employer contribution", "type": "amount", "description": "The employer contribution to your pension fund this month (quota a carico azienda), when printed", "required": false}'::jsonb),
  (7, '{"key": "tfr_to_fund", "label": "TFR to the pension fund", "type": "amount", "description": "TFR of the month paid into a pension fund rather than kept by the company (TFR a fondo, TFR a previdenza complementare), when printed", "required": false}'::jsonb)
),
missing AS (
  SELECT jsonb_agg(e."field" ORDER BY e."position") AS "fields"
    FROM extra e
    JOIN "ingestion"."document_categories" c ON c."id" = 'PAYSLIP'
   WHERE NOT EXISTS (
     SELECT 1 FROM jsonb_array_elements(coalesce(c."template_json" -> 'fields', '[]'::jsonb)) f
      WHERE f ->> 'key' = e."field" ->> 'key'
   )
)
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(
         coalesce(c."template_json", '{}'::jsonb),
         '{fields}',
         coalesce(c."template_json" -> 'fields', '[]'::jsonb) || m."fields"
       )
  FROM missing m
 WHERE c."id" = 'PAYSLIP'
   AND m."fields" IS NOT NULL;
