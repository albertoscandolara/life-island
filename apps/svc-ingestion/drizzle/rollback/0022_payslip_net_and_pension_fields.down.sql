-- Undoes 0022_payslip_net_and_pension_fields: drops the surtax, IRPEF
-- adjustment, tax credit and pension fund fields from PAYSLIP. Documents
-- keep what was read into them.
-- Run it by hand as ingestion_svc, then delete the last row of
-- ingestion.__drizzle_migrations.
BEGIN;
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(
         c."template_json",
         '{fields}',
         coalesce((
           SELECT jsonb_agg(f ORDER BY n)
             FROM jsonb_array_elements(c."template_json" -> 'fields') WITH ORDINALITY AS t(f, n)
            WHERE f ->> 'key' NOT IN ('regional_surtax', 'municipal_surtax', 'tax_adjustment', 'tax_credit', 'pension_fund_employee', 'pension_fund_employer', 'tfr_to_fund')
         ), '[]'::jsonb)
       )
 WHERE c."id" = 'PAYSLIP';
COMMIT;
