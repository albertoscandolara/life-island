-- The Work area (svc-work): payslips, evaluations and employment contracts
-- suggest the data of a workplace (employer, work site, employment and pay),
-- so their templates ask for it with the keys of WORKPLACE_FIELD_DEFINITIONS
-- (libs/contracts/src/lib/work.ts). These mirror life-island-docs
-- (payslips/payslip.schema.json, entities/workplace, employment, organization).
-- 1. PAYSLIP gains the fields that tell a workplace and its pay apart; only
--    the fields its template does not have yet, so your own edits stay.
-- 2. PERFORMANCE_REVIEW (evaluations) and EMPLOYMENT_CONTRACT, two document
--    types; a category with the same id or title you created is kept as it is.
-- Data only. Rollback: drizzle/rollback/0014_work_document_categories.down.sql.
WITH extra ("category_id", "position", "field") AS (
  VALUES
  ('PAYSLIP', 1, '{"key": "employer_tax_code", "label": "Employer tax code", "type": "string", "description": "Codice fiscale or partita IVA of the employer, digits only (C.F. / P.IVA in the header)", "required": false}'::jsonb),
  ('PAYSLIP', 2, '{"key": "employer_address", "label": "Employer address", "type": "string", "description": "Registered office of the employer, as printed in the header", "required": false}'::jsonb),
  ('PAYSLIP', 3, '{"key": "workplace_address", "label": "Work site", "type": "string", "description": "Sede di lavoro, as printed", "required": false}'::jsonb),
  ('PAYSLIP', 4, '{"key": "employee_code", "label": "Employee code", "type": "string", "description": "COD.DIP. or matricola of the employee", "required": false}'::jsonb),
  ('PAYSLIP', 5, '{"key": "hire_date", "label": "Hire date", "type": "date", "description": "Data di assunzione (ASSUNZIONE)", "required": false}'::jsonb),
  ('PAYSLIP', 6, '{"key": "end_date", "label": "Contract end", "type": "date", "description": "Scadenza contratto or fine rapporto, only when printed", "required": false}'::jsonb),
  ('PAYSLIP', 7, '{"key": "qualification", "label": "Qualification", "type": "string", "description": "Descrizione qualifica (impiegato, quadro, operaio), as printed", "required": false}'::jsonb),
  ('PAYSLIP', 8, '{"key": "job_title", "label": "Job title", "type": "string", "description": "Mansione, as printed", "required": false}'::jsonb),
  ('PAYSLIP', 9, '{"key": "cost_center", "label": "Cost center", "type": "string", "description": "Centro di costo with its code, as printed", "required": false}'::jsonb),
  ('PAYSLIP', 10, '{"key": "part_time_percentage", "label": "Part time", "type": "number", "description": "% part time, only when printed", "required": false, "unit": "%"}'::jsonb),
  ('PAYSLIP', 11, '{"key": "monthly_salary", "label": "Monthly salary", "type": "amount", "description": "RETRIBUZIONE MENSILE: the full-time monthly gross of the contract (elementi retributivi), not the total of this month", "required": false}'::jsonb),
  ('PAYSLIP', 12, '{"key": "base_minimum", "label": "CCNL minimum", "type": "amount", "description": "MINIMO (paga base) among the elementi retributivi", "required": false}'::jsonb),
  ('PAYSLIP', 13, '{"key": "superminimum", "label": "Superminimum", "type": "amount", "description": "SUPERMINIMO or SUPERM. ASSORBIBILE among the elementi retributivi, when printed", "required": false}'::jsonb),
  ('PAYSLIP', 14, '{"key": "seniority_increments", "label": "Seniority increments", "type": "integer", "description": "Number of SCATTI ANZIANITA'' matured (N.)", "required": false}'::jsonb),
  ('PAYSLIP', 15, '{"key": "welfare_credits", "label": "Welfare credits", "type": "amount", "description": "Welfare or benefit credits shown on the payslip but not paid in the net (conversione welfare, art. 51), total of the month", "required": false}'::jsonb)
),
missing AS (
  SELECT e."category_id", jsonb_agg(e."field" ORDER BY e."position") AS "fields"
    FROM extra e
    JOIN "ingestion"."document_categories" c ON c."id" = e."category_id"
   WHERE NOT EXISTS (
     SELECT 1 FROM jsonb_array_elements(coalesce(c."template_json" -> 'fields', '[]'::jsonb)) f
      WHERE f ->> 'key' = e."field" ->> 'key'
   )
   GROUP BY e."category_id"
)
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(
         coalesce(c."template_json", '{}'::jsonb),
         '{fields}',
         coalesce(c."template_json" -> 'fields', '[]'::jsonb) || m."fields"
       )
  FROM missing m
 WHERE c."id" = m."category_id";--> statement-breakpoint
WITH inserted AS (
  INSERT INTO "ingestion"."document_categories" ("id", "title", "description", "template_json", "dimension") VALUES
  ('PERFORMANCE_REVIEW', 'Evaluation', 'An evaluation of your work by an employer: a performance review, scheda di valutazione, appraisal or feedback form, with its rating, strengths, goals and any new level or pay it grants.', '{"fields": [{"key": "employer", "label": "Employer", "type": "string", "description": "Company the evaluation is for, as printed", "required": true}, {"key": "employer_tax_code", "label": "Employer tax code", "type": "string", "description": "Codice fiscale or partita IVA of the employer, if printed", "required": false}, {"key": "employee_name", "label": "Employee", "type": "string", "description": "Who is evaluated, as printed", "required": false}, {"key": "review_date", "label": "Date", "type": "date", "description": "Date of the evaluation or of the meeting", "required": true}, {"key": "review_period", "label": "Period evaluated", "type": "period", "description": "First and last day of the period evaluated, if printed", "required": false}, {"key": "reviewer", "label": "Reviewer", "type": "string", "description": "Manager or evaluator, as printed", "required": false}, {"key": "overall_rating", "label": "Overall rating", "type": "string", "description": "Overall score or judgement as printed (4/5, Exceeds expectations, B)", "required": false}, {"key": "rating_scale", "label": "Rating scale", "type": "string", "description": "The scale of the score, if printed (1-5, A-E)", "required": false}, {"key": "strengths", "label": "Strengths", "type": "text", "description": "Strengths and achievements noted, in a few short sentences", "required": false}, {"key": "improvements", "label": "To improve", "type": "text", "description": "Areas to improve noted, in a few short sentences", "required": false}, {"key": "goals", "label": "Goals", "type": "text", "description": "Goals set for the next period, in a few short sentences", "required": false}, {"key": "job_level", "label": "New level", "type": "string", "description": "Level or grade granted by this evaluation, only when it changes", "required": false}, {"key": "job_title", "label": "New job title", "type": "string", "description": "Role granted by this evaluation, only when it changes", "required": false}, {"key": "monthly_salary", "label": "New monthly salary", "type": "amount", "description": "Monthly gross pay granted by this evaluation, only when stated", "required": false}, {"key": "annual_gross_salary", "label": "New annual gross (RAL)", "type": "amount", "description": "Annual gross pay granted by this evaluation, only when stated", "required": false}, {"key": "bonus_amount", "label": "Bonus", "type": "amount", "description": "One-off bonus or premio granted, when stated", "required": false}]}'::jsonb, 'DOCUMENT_TYPE'),
  ('EMPLOYMENT_CONTRACT', 'Employment contract', 'An employment contract, lettera di assunzione, proroga or trasformazione: who hires you, from when, under which contract, level and pay.', '{"fields": [{"key": "employer", "label": "Employer", "type": "string", "description": "Company that hires, as printed", "required": true}, {"key": "employer_tax_code", "label": "Employer tax code", "type": "string", "description": "Codice fiscale or partita IVA of the employer", "required": false}, {"key": "employer_address", "label": "Employer address", "type": "string", "description": "Registered office of the employer", "required": false}, {"key": "workplace_address", "label": "Work site", "type": "string", "description": "Sede di lavoro, as printed", "required": false}, {"key": "employee_name", "label": "Employee", "type": "string", "description": "Who is hired, as printed", "required": false}, {"key": "signing_date", "label": "Signed on", "type": "date", "description": "Date the contract or letter was signed or issued", "required": false}, {"key": "hire_date", "label": "Start date", "type": "date", "description": "Data di assunzione or start of the contract", "required": true}, {"key": "end_date", "label": "End date", "type": "date", "description": "End of a fixed-term contract, only when printed", "required": false}, {"key": "contract_kind", "label": "Contract", "type": "enum", "description": "tempo indeterminato is permanent, tempo determinato fixed_term, apprendistato apprenticeship, tirocinio internship, partita IVA freelance, somministrazione agency", "required": false, "options": ["permanent", "fixed_term", "apprenticeship", "internship", "freelance", "agency", "other"]}, {"key": "contract_type", "label": "Collective agreement", "type": "string", "description": "CCNL applied, as printed", "required": false}, {"key": "qualification", "label": "Qualification", "type": "string", "description": "Impiegato, quadro, operaio...", "required": false}, {"key": "job_level", "label": "Level", "type": "string", "description": "Livello or grade", "required": false}, {"key": "job_title", "label": "Job title", "type": "string", "description": "Mansione or role", "required": false}, {"key": "weekly_hours", "label": "Weekly hours", "type": "number", "description": "Hours per week", "required": false, "unit": "h"}, {"key": "part_time_percentage", "label": "Part time", "type": "number", "description": "% part time, only when printed", "required": false, "unit": "%"}, {"key": "monthly_salary", "label": "Monthly salary", "type": "amount", "description": "Monthly gross pay, when stated", "required": false}, {"key": "annual_gross_salary", "label": "Annual gross (RAL)", "type": "amount", "description": "Retribuzione annua lorda, when stated", "required": false}, {"key": "probation_end", "label": "Probation until", "type": "date", "description": "End of the trial period (periodo di prova), when printed", "required": false}]}'::jsonb, 'DOCUMENT_TYPE')
  ON CONFLICT DO NOTHING
  RETURNING "id", "title", "parent_id", "dimension"
)
-- Modules that keep their own copy of the categories (review inbox, Home, People, Cars, Work) learn them from category.changed@1.
INSERT INTO "ingestion"."outbox" (event_type, payload)
SELECT 'category.changed@1',
       jsonb_build_object(
         'id', i.id,
         'title', i.title,
         'parentId', i.parent_id,
         'dimension', i.dimension,
         'deleted', false,
         'changedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       )
  FROM inserted i;
