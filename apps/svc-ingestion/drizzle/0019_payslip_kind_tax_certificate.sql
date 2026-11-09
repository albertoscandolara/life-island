-- 1. PAYSLIP gains `payslip_kind`, so a separate tredicesima or quattordicesima
--    payslip (same month as the regular one) counts as extra pay, not as a
--    second copy of the month. Only added when the template does not have it.
-- 2. CERTIFICAZIONE_UNICA, a new document type: the yearly income and taxes
--    of an employer, read by Work (against your payslips) and by the 730
--    (income and tax owed). A category with the same id you created is kept.
-- Data only. Rollback: drizzle/rollback/0019_payslip_kind_tax_certificate.down.sql.
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(
         coalesce(c."template_json", '{}'::jsonb),
         '{fields}',
         coalesce(c."template_json" -> 'fields', '[]'::jsonb) || jsonb_build_array('{"key": "payslip_kind", "label": "Kind", "type": "enum", "description": "regular for the monthly payslip; thirteenth for a separate tredicesima payslip (13.MA MENSILITA'', gratifica natalizia); fourteenth for a quattordicesima (14.MA MENSILITA''); other for a separate payslip of only a bonus, arrears or settlement. A monthly payslip that also pays the tredicesima is regular", "required": false, "options": ["regular", "thirteenth", "fourteenth", "other"]}'::jsonb)
       )
 WHERE c."id" = 'PAYSLIP'
   AND NOT EXISTS (
     SELECT 1 FROM jsonb_array_elements(coalesce(c."template_json" -> 'fields', '[]'::jsonb)) f
      WHERE f ->> 'key' = 'payslip_kind'
   );--> statement-breakpoint
WITH inserted AS (
  INSERT INTO "ingestion"."document_categories" ("id", "title", "description", "template_json", "dimension") VALUES
  ('CERTIFICAZIONE_UNICA', 'Certificazione Unica', 'A Certificazione Unica (CU): the yearly statement of an employer or pension body of the income it paid you, the taxes it withheld and the tax credits it applied. Needed for the 730.', '{"fields": [{"key": "employer", "label": "Employer", "type": "string", "description": "Sostituto d''imposta (the employer or pension body), as printed", "required": true}, {"key": "employer_tax_code", "label": "Employer tax code", "type": "string", "description": "Codice fiscale of the sostituto d''imposta, digits only", "required": false}, {"key": "income_year", "label": "Income year", "type": "integer", "description": "The year the income is about (RELATIVA ALL''ANNO 2025 is 2025), not the year in the form''s name", "required": true}, {"key": "issue_date", "label": "Signed on", "type": "date", "description": "Data firma del sostituto d''imposta", "required": false}, {"key": "employment_income", "label": "Employment income", "type": "amount", "description": "Redditi di lavoro dipendente: punto 1 (tempo indeterminato) plus punto 2 (tempo determinato)", "required": false}, {"key": "pension_income", "label": "Pension and other income", "type": "amount", "description": "Punti 3, 4 and 5 together, when printed", "required": false}, {"key": "days_worked", "label": "Days", "type": "integer", "description": "Numero di giorni per i quali spettano le detrazioni (punto 6)", "required": false}, {"key": "hire_date", "label": "Start date", "type": "date", "description": "Data di inizio del rapporto (punto 9), when printed", "required": false}, {"key": "end_date", "label": "End date", "type": "date", "description": "Data di cessazione (punto 10), only when printed", "required": false}, {"key": "irpef_withheld", "label": "IRPEF withheld", "type": "amount", "description": "Ritenute Irpef (punto 21)", "required": false}, {"key": "regional_surtax", "label": "Regional surtax", "type": "amount", "description": "Addizionale regionale all''Irpef (punto 22)", "required": false}, {"key": "municipal_surtax", "label": "Municipal surtax", "type": "amount", "description": "Addizionale comunale for the income year: acconto plus saldo (punti 26 and 27)", "required": false}, {"key": "gross_tax", "label": "Gross tax", "type": "amount", "description": "Imposta lorda (punto 361)", "required": false}, {"key": "work_deductions", "label": "Employment tax credits", "type": "amount", "description": "Detrazioni per lavoro dipendente (punto 367) plus ulteriore detrazione (punto 368)", "required": false}, {"key": "family_deductions", "label": "Family tax credits", "type": "amount", "description": "Detrazioni per carichi di famiglia (punto 362)", "required": false}, {"key": "total_deductions", "label": "Total tax credits", "type": "amount", "description": "Totale detrazioni (punto 374)", "required": false}, {"key": "net_tax", "label": "Net tax", "type": "amount", "description": "Imposta netta (punto 375)", "required": false}, {"key": "integrative_treatment", "label": "Trattamento integrativo", "type": "amount", "description": "Trattamento integrativo erogato (punto 391), when printed", "required": false}, {"key": "deductible_expenses_by_employer", "label": "Deductions already applied", "type": "amount", "description": "Oneri deducibili already excluded from income by the employer (punto 431), when printed", "required": false}, {"key": "health_fund_contributions", "label": "Health fund contributions", "type": "amount", "description": "Contributi a enti o casse con fini assistenziali (punto 441, e.g. the CCNL health fund)", "required": false}, {"key": "productivity_bonus", "label": "Productivity bonus", "type": "amount", "description": "Premi di risultato at imposta sostitutiva (punto 571), when printed", "required": false}, {"key": "productivity_bonus_tax", "label": "Productivity bonus tax", "type": "amount", "description": "Imposta sostitutiva on the premi di risultato (punto 576), when printed", "required": false}, {"key": "severance", "label": "TFR", "type": "amount", "description": "TFR or arrears paid in the year (separate taxation), when printed", "required": false}]}'::jsonb, 'DOCUMENT_TYPE')
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
