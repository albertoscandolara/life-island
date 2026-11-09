-- Evaluations (PERFORMANCE_REVIEW) gain the fields that Work's statistics
-- read: the period and its scores, the role and team, the bonus they convert
-- to and the reviewer's comments. Score lists are text, one "name: score" per
-- line, so they fit any company's form. Only the fields the template does not
-- have yet are added, so your own edits stay. Evaluations parsed before this
-- get them by parsing them again. Then a new document type, EVALUATION_RULES.
-- Data only. Rollback: drizzle/rollback/0018_evaluation_scores.down.sql.
WITH extra ("category_id", "position", "field") AS (
  VALUES
  ('PERFORMANCE_REVIEW', 1, '{"key": "review_cycle", "label": "Cycle", "type": "string", "description": "Which part of the year is evaluated, as printed with its year (1° quadrimestre 2026, H1 2025, Q3 2024, annual 2024). When the form holds several, the latest one that has a score", "required": false}'::jsonb),
  ('PERFORMANCE_REVIEW', 2, '{"key": "role", "label": "Role", "type": "string", "description": "Role or job title the form states (RUOLO), even when it does not change", "required": false}'::jsonb),
  ('PERFORMANCE_REVIEW', 3, '{"key": "team", "label": "Team", "type": "string", "description": "Team, department or direzione, as printed", "required": false}'::jsonb),
  ('PERFORMANCE_REVIEW', 4, '{"key": "overall_score", "label": "Total score", "type": "number", "description": "Total score of the cycle above, as a number (PUNTEGGIO TOTALE of that period, not the yearly average)", "required": false}'::jsonb),
  ('PERFORMANCE_REVIEW', 5, '{"key": "max_score", "label": "Highest score", "type": "number", "description": "Highest total score possible, only when printed or stated", "required": false}'::jsonb),
  ('PERFORMANCE_REVIEW', 6, '{"key": "section_scores", "label": "Section scores", "type": "text", "description": "Score of each section in the cycle above, one per line as \"Section: score\" (e.g. \"Team objective: 29.4\"), names as printed", "required": false}'::jsonb),
  ('PERFORMANCE_REVIEW', 7, '{"key": "criteria_scores", "label": "Criteria scores", "type": "text", "description": "Score of each single criterion or indicator in the cycle above, one per line as \"Criterion: score\" or \"Criterion: score/max\" (e.g. \"Gestione task: 4\"), names as printed", "required": false}'::jsonb),
  ('PERFORMANCE_REVIEW', 8, '{"key": "payout_percent", "label": "Bonus conversion", "type": "number", "description": "Share of the bonus target the score converts to in the cycle above (% di conversione)", "required": false, "unit": "%"}'::jsonb),
  ('PERFORMANCE_REVIEW', 9, '{"key": "bonus_target", "label": "Bonus target", "type": "amount", "description": "Yearly bonus target (TARGET), when printed", "required": false}'::jsonb),
  ('PERFORMANCE_REVIEW', 10, '{"key": "comments", "label": "Comments", "type": "text", "description": "What the reviewer wrote about the cycle above (motivazioni, esempi), in a few short sentences", "required": false}'::jsonb)
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
-- EVALUATION_RULES: the rules of an employer's evaluations, one document per
-- version, so each company keeps its own and a new revision replaces the old
-- from the day it applies. A category with the same id you created is kept.
WITH inserted AS (
  INSERT INTO "ingestion"."document_categories" ("id", "title", "description", "template_json", "dimension") VALUES
  ('EVALUATION_RULES', 'Evaluation rules', 'The rules an employer scores its evaluations and pays its bonus by: an incentive plan, sistema incentivante, premio di produttività or scheda obiettivi, with its sections, scale and score to bonus conversion.', '{"fields": [{"key": "employer", "label": "Employer", "type": "string", "description": "Company the rules are for, as printed", "required": true}, {"key": "employer_tax_code", "label": "Employer tax code", "type": "string", "description": "Codice fiscale or partita IVA of the employer, if printed", "required": false}, {"key": "version", "label": "Version", "type": "string", "description": "Version or revision as printed (V22, Rev. 08/08/2023), else the year it is for", "required": false}, {"key": "issue_date", "label": "Date", "type": "date", "description": "Date of the document or of its revision", "required": false}, {"key": "effective_from", "label": "Applies from", "type": "date", "description": "First day the rules apply to (start of the year or period they are for)", "required": false}, {"key": "max_score", "label": "Highest score", "type": "number", "description": "Highest total score an evaluation can reach under these rules", "required": false}, {"key": "bonus_target_rule", "label": "Bonus target", "type": "string", "description": "How the yearly bonus target is set, in a few words (10% of the RAL, a fixed amount)", "required": false}, {"key": "max_payout_percent", "label": "Highest payout", "type": "number", "description": "Highest share of the target the bonus can reach, all extras included (e.g. 110)", "required": false, "unit": "%"}, {"key": "sections", "label": "Sections", "type": "text", "description": "Each part of the evaluation, one per line as \"Section: highest score – how it is scored\" (e.g. \"Performance objective: 40 – 4 criteria from 1 to 5, times 2\"), names as printed", "required": false}, {"key": "score_scale", "label": "Scale", "type": "text", "description": "What each mark of a criterion means, one per line as \"mark: meaning\" in a short sentence (e.g. \"3: adequate and steady, no help needed\")", "required": false}, {"key": "conversion_table", "label": "Conversion table", "type": "text", "description": "How the total score converts to a share of the bonus target, one band per line as \"from-to: percent\" (e.g. \"116-120: 100\", \"< 60: 0\")", "required": false}, {"key": "payout_schedule", "label": "Payout schedule", "type": "text", "description": "Each period evaluated and when it is paid, one per line (e.g. \"January-April: paid 10 May\"), with how the year is settled", "required": false}, {"key": "eligibility", "label": "Who it applies to", "type": "text", "description": "Who gets the bonus and when not (new hires, part time, notice period), one rule per line", "required": false}, {"key": "notes", "label": "Notes", "type": "text", "description": "Anything else needed to read the marks: extra points, company objective, how the yearly result is computed, one per line", "required": false}]}'::jsonb, 'DOCUMENT_TYPE')
  ON CONFLICT DO NOTHING
  RETURNING "id", "title", "parent_id", "dimension"
)
-- Modules that keep their own copy of the categories learn it from category.changed@1.
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
