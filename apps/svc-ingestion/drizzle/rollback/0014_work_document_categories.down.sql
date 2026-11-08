-- Undoes 0014_work_document_categories. Not applied automatically (drizzle migrations
-- only go forward): run it by hand as ingestion_svc, then delete the last row of
-- ingestion.__drizzle_migrations. Only categories no document uses are removed;
-- delete the others from the Categories page, which also tells the review inbox.
-- The fields added to PAYSLIP are removed by their key.
BEGIN;
DELETE FROM "ingestion"."document_categories" c
 WHERE c.id IN ('PERFORMANCE_REVIEW', 'EMPLOYMENT_CONTRACT')
   AND NOT EXISTS (SELECT 1 FROM "ingestion"."uploads" u WHERE c.id = ANY(u.categories))
   AND NOT EXISTS (SELECT 1 FROM "ingestion"."document_categories" child WHERE child.parent_id = c.id);
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(
         c."template_json",
         '{fields}',
         coalesce((
           SELECT jsonb_agg(f ORDER BY n)
             FROM jsonb_array_elements(c."template_json" -> 'fields') WITH ORDINALITY AS t(f, n)
            WHERE f ->> 'key' NOT IN ('employer_tax_code', 'employer_address', 'workplace_address',
              'employee_code', 'hire_date', 'end_date', 'qualification', 'job_title', 'cost_center',
              'part_time_percentage', 'monthly_salary', 'base_minimum', 'superminimum',
              'seniority_increments', 'welfare_credits')
         ), '[]'::jsonb)
       )
 WHERE c.id = 'PAYSLIP';
COMMIT;
