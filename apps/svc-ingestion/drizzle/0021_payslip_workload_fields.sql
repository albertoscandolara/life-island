-- PAYSLIP gains the fields of the workload view in Work: overtime hours and
-- pay, and travel days and allowances. Only the fields its template does not
-- have yet, so your own edits stay. They fill in from the next parse.
-- PERFORMANCE_REVIEW's goals are asked one per line, for the goals tracker,
-- only where the description is still the original one.
-- Data only. Rollback: drizzle/rollback/0021_payslip_workload_fields.down.sql.
WITH extra ("position", "field") AS (
  VALUES
  (1, '{"key": "overtime_hours", "label": "Overtime hours", "type": "number", "description": "Hours of overtime (straordinario, lavoro supplementare) paid this month, all rates summed", "required": false, "unit": "h"}'::jsonb),
  (2, '{"key": "overtime_pay", "label": "Overtime pay", "type": "amount", "description": "Gross paid for overtime this month (straordinari, maggiorazioni), all lines summed", "required": false}'::jsonb),
  (3, '{"key": "travel_days", "label": "Travel days", "type": "number", "description": "Days of business travel paid this month (giorni di trasferta), when printed", "required": false, "unit": "d"}'::jsonb),
  (4, '{"key": "travel_allowance", "label": "Travel allowances", "type": "amount", "description": "Travel allowances and reimbursements this month (indennità di trasferta, diaria, rimborso km), all lines summed", "required": false}'::jsonb)
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
   AND m."fields" IS NOT NULL;--> statement-breakpoint
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(
         c."template_json",
         '{fields}',
         (SELECT jsonb_agg(
                   CASE WHEN f ->> 'key' = 'goals'
                         AND f ->> 'description' = 'Goals set for the next period, in a few short sentences'
                        THEN jsonb_set(f, '{description}', to_jsonb('Goals set for the next period, one per line, each in a short sentence'::text))
                        ELSE f END
                   ORDER BY t.n)
            FROM jsonb_array_elements(c."template_json" -> 'fields') WITH ORDINALITY AS t(f, n))
       )
 WHERE c."id" = 'PERFORMANCE_REVIEW'
   AND jsonb_array_length(coalesce(c."template_json" -> 'fields', '[]'::jsonb)) > 0;
