-- Undoes 0021_payslip_workload_fields: drops the overtime and travel fields
-- from PAYSLIP and gives PERFORMANCE_REVIEW's goals their old description.
-- Documents keep what was read into them.
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
            WHERE f ->> 'key' NOT IN ('overtime_hours', 'overtime_pay', 'travel_days', 'travel_allowance')
         ), '[]'::jsonb)
       )
 WHERE c."id" = 'PAYSLIP';
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(
         c."template_json",
         '{fields}',
         (SELECT jsonb_agg(
                   CASE WHEN f ->> 'key' = 'goals'
                         AND f ->> 'description' = 'Goals set for the next period, one per line, each in a short sentence'
                        THEN jsonb_set(f, '{description}', to_jsonb('Goals set for the next period, in a few short sentences'::text))
                        ELSE f END
                   ORDER BY t.n)
            FROM jsonb_array_elements(c."template_json" -> 'fields') WITH ORDINALITY AS t(f, n))
       )
 WHERE c."id" = 'PERFORMANCE_REVIEW'
   AND jsonb_array_length(coalesce(c."template_json" -> 'fields', '[]'::jsonb)) > 0;
COMMIT;
