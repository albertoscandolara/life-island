-- The pension fund (fondo pensione) in Work:
-- 1. CERTIFICAZIONE_UNICA gains the pension fund points of the CU: the
--    contributions the employer took off your taxable income (punto 412) and
--    the ones it did not (punto 413). Work and the 730 read them for rigo E27.
--    Only the fields its template does not have yet, so your own edits stay.
-- 2. PENSION_FUND_STATEMENT, a document type for the yearly statement of a
--    pension fund (comunicazione periodica, estratto conto): Work offers its
--    figures for you to confirm. A category with the same id or title you
--    created is kept as it is.
-- Data only. Rollback: drizzle/rollback/0027_pension_fund_fields.down.sql.
WITH extra ("position", "field") AS (
  VALUES
  (1, '{"key": "pension_fund_deducted", "label": "Pension fund, deducted", "type": "amount", "description": "Previdenza complementare: contributi dedotti dal sostituto (punto 412), when printed", "required": false}'::jsonb),
  (2, '{"key": "pension_fund_not_deducted", "label": "Pension fund, not deducted", "type": "amount", "description": "Previdenza complementare: contributi non dedotti dal sostituto (punto 413), when printed", "required": false}'::jsonb)
),
missing AS (
  SELECT jsonb_agg(e."field" ORDER BY e."position") AS "fields"
    FROM extra e
    JOIN "ingestion"."document_categories" c ON c."id" = 'CERTIFICAZIONE_UNICA'
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
 WHERE c."id" = 'CERTIFICAZIONE_UNICA'
   AND m."fields" IS NOT NULL;--> statement-breakpoint
WITH inserted AS (
  INSERT INTO "ingestion"."document_categories" ("id", "title", "description", "template_json", "dimension") VALUES
  ('PENSION_FUND_STATEMENT', 'Pension fund statement', 'The statement of a pension fund (fondo pensione, previdenza complementare): the yearly comunicazione periodica or an estratto conto, with the value of your position, the contributions paid in the year and in total, and the investment line.', '{"fields": [{"key": "fund_name", "label": "Fund", "type": "string", "description": "Name of the pension fund (Fondo Cometa, Fon.Te., a fondo aperto or PIP), as printed", "required": true}, {"key": "statement_date", "label": "Value date", "type": "date", "description": "The date the position is valued at (posizione al 31/12)", "required": false}, {"key": "statement_year", "label": "Year", "type": "integer", "description": "The year the statement covers", "required": false}, {"key": "position_value", "label": "Position value", "type": "amount", "description": "Valore della posizione individuale (what your position is worth) at the value date", "required": true}, {"key": "total_paid_in", "label": "Paid in since joining", "type": "amount", "description": "Total contributions paid in since you joined (contributi versati complessivi), TFR included, when printed", "required": false}, {"key": "employee_contributions", "label": "Your contributions in the year", "type": "amount", "description": "Contributions of the year at your charge (a carico aderente), when printed", "required": false}, {"key": "employer_contributions", "label": "Employer contributions in the year", "type": "amount", "description": "Contributions of the year at the employer''s charge (a carico azienda), when printed", "required": false}, {"key": "tfr_contributions", "label": "TFR in the year", "type": "amount", "description": "TFR paid into the fund in the year, when printed", "required": false}, {"key": "investment_line", "label": "Investment line", "type": "string", "description": "Comparto or linea di investimento, as printed", "required": false}, {"key": "member_since", "label": "Member since", "type": "date", "description": "Data di iscrizione (or of first enrolment in a pension fund), when printed", "required": false}, {"key": "year_return", "label": "Return of the year", "type": "number", "description": "Rendimento of the investment line in the year, in percent, when printed", "required": false, "unit": "%"}]}'::jsonb, 'DOCUMENT_TYPE')
  ON CONFLICT DO NOTHING
  RETURNING "id", "title", "parent_id", "dimension"
)
-- Modules that keep their own copy of the categories (review inbox, Work, the 730…) learn it from category.changed@1.
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
