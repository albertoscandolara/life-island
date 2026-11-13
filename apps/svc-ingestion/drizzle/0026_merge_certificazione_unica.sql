-- 0019 added the CERTIFICAZIONE_UNICA document type with ON CONFLICT DO
-- NOTHING, so a category of your own titled "Certificazione Unica" (under
-- another id, such as CU) made it skip without a word: titles are unique.
-- Your CUs stayed in that category, with no income_year or other CU field,
-- so Work and the 730 never saw them (no 730 year, no tax estimate).
-- This merges that category into CERTIFICAZIONE_UNICA: same documents,
-- subcategories and declines, its own template fields kept after the CU
-- ones. The moved documents that are already read go back to the parse
-- queue for the EXTRACT step only (their categories stay), so the next
-- parse run reads the CU fields. Nothing happens when CERTIFICAZIONE_UNICA
-- exists or no category has its title. Data only.
-- Rollback: drizzle/rollback/0026_merge_certificazione_unica.down.sql.
DO $$
DECLARE
  old ingestion.document_categories%ROWTYPE;
  stamp text := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  moved uuid[];
BEGIN
  IF EXISTS (SELECT 1 FROM ingestion.document_categories WHERE id = 'CERTIFICAZIONE_UNICA') THEN
    RETURN;
  END IF;
  SELECT * INTO old FROM ingestion.document_categories
   WHERE lower(title) = lower('Certificazione Unica');
  IF NOT FOUND THEN
    -- No clash: add it as 0019 meant to.
    INSERT INTO ingestion.document_categories (id, title, description, template_json, dimension)
    VALUES ('CERTIFICAZIONE_UNICA', 'Certificazione Unica', 'A Certificazione Unica (CU): the yearly statement of an employer or pension body of the income it paid you, the taxes it withheld and the tax credits it applied. Needed for the 730.', '{"fields": [{"key": "employer", "label": "Employer", "type": "string", "description": "Sostituto d''imposta (the employer or pension body), as printed", "required": true}, {"key": "employer_tax_code", "label": "Employer tax code", "type": "string", "description": "Codice fiscale of the sostituto d''imposta, digits only", "required": false}, {"key": "income_year", "label": "Income year", "type": "integer", "description": "The year the income is about (RELATIVA ALL''ANNO 2025 is 2025), not the year in the form''s name", "required": true}, {"key": "issue_date", "label": "Signed on", "type": "date", "description": "Data firma del sostituto d''imposta", "required": false}, {"key": "employment_income", "label": "Employment income", "type": "amount", "description": "Redditi di lavoro dipendente: punto 1 (tempo indeterminato) plus punto 2 (tempo determinato)", "required": false}, {"key": "pension_income", "label": "Pension and other income", "type": "amount", "description": "Punti 3, 4 and 5 together, when printed", "required": false}, {"key": "days_worked", "label": "Days", "type": "integer", "description": "Numero di giorni per i quali spettano le detrazioni (punto 6)", "required": false}, {"key": "hire_date", "label": "Start date", "type": "date", "description": "Data di inizio del rapporto (punto 9), when printed", "required": false}, {"key": "end_date", "label": "End date", "type": "date", "description": "Data di cessazione (punto 10), only when printed", "required": false}, {"key": "irpef_withheld", "label": "IRPEF withheld", "type": "amount", "description": "Ritenute Irpef (punto 21)", "required": false}, {"key": "regional_surtax", "label": "Regional surtax", "type": "amount", "description": "Addizionale regionale all''Irpef (punto 22)", "required": false}, {"key": "municipal_surtax", "label": "Municipal surtax", "type": "amount", "description": "Addizionale comunale for the income year: acconto plus saldo (punti 26 and 27)", "required": false}, {"key": "gross_tax", "label": "Gross tax", "type": "amount", "description": "Imposta lorda (punto 361)", "required": false}, {"key": "work_deductions", "label": "Employment tax credits", "type": "amount", "description": "Detrazioni per lavoro dipendente (punto 367) plus ulteriore detrazione (punto 368)", "required": false}, {"key": "family_deductions", "label": "Family tax credits", "type": "amount", "description": "Detrazioni per carichi di famiglia (punto 362)", "required": false}, {"key": "total_deductions", "label": "Total tax credits", "type": "amount", "description": "Totale detrazioni (punto 374)", "required": false}, {"key": "net_tax", "label": "Net tax", "type": "amount", "description": "Imposta netta (punto 375)", "required": false}, {"key": "integrative_treatment", "label": "Trattamento integrativo", "type": "amount", "description": "Trattamento integrativo erogato (punto 391), when printed", "required": false}, {"key": "deductible_expenses_by_employer", "label": "Deductions already applied", "type": "amount", "description": "Oneri deducibili already excluded from income by the employer (punto 431), when printed", "required": false}, {"key": "health_fund_contributions", "label": "Health fund contributions", "type": "amount", "description": "Contributi a enti o casse con fini assistenziali (punto 441, e.g. the CCNL health fund)", "required": false}, {"key": "productivity_bonus", "label": "Productivity bonus", "type": "amount", "description": "Premi di risultato at imposta sostitutiva (punto 571), when printed", "required": false}, {"key": "productivity_bonus_tax", "label": "Productivity bonus tax", "type": "amount", "description": "Imposta sostitutiva on the premi di risultato (punto 576), when printed", "required": false}, {"key": "severance", "label": "TFR", "type": "amount", "description": "TFR or arrears paid in the year (separate taxation), when printed", "required": false}]}'::jsonb, 'DOCUMENT_TYPE');
    INSERT INTO ingestion.outbox (event_type, payload)
    VALUES ('category.changed@1', jsonb_build_object(
      'id', 'CERTIFICAZIONE_UNICA', 'title', 'Certificazione Unica', 'parentId', null,
      'dimension', 'DOCUMENT_TYPE', 'deleted', false, 'changedAt', stamp));
    RETURN;
  END IF;

  -- Free the title, then take the old category's place in the tree.
  UPDATE ingestion.document_categories
     SET title = left(old.title, 90) || ' (merged)', updated_at = now()
   WHERE id = old.id;
  INSERT INTO ingestion.document_categories
    (id, title, description, template_json, parent_id, dimension, taxonomy_version)
  VALUES (
    'CERTIFICAZIONE_UNICA', 'Certificazione Unica', 'A Certificazione Unica (CU): the yearly statement of an employer or pension body of the income it paid you, the taxes it withheld and the tax credits it applied. Needed for the 730.',
    jsonb_build_object('fields',
      ('{"fields": [{"key": "employer", "label": "Employer", "type": "string", "description": "Sostituto d''imposta (the employer or pension body), as printed", "required": true}, {"key": "employer_tax_code", "label": "Employer tax code", "type": "string", "description": "Codice fiscale of the sostituto d''imposta, digits only", "required": false}, {"key": "income_year", "label": "Income year", "type": "integer", "description": "The year the income is about (RELATIVA ALL''ANNO 2025 is 2025), not the year in the form''s name", "required": true}, {"key": "issue_date", "label": "Signed on", "type": "date", "description": "Data firma del sostituto d''imposta", "required": false}, {"key": "employment_income", "label": "Employment income", "type": "amount", "description": "Redditi di lavoro dipendente: punto 1 (tempo indeterminato) plus punto 2 (tempo determinato)", "required": false}, {"key": "pension_income", "label": "Pension and other income", "type": "amount", "description": "Punti 3, 4 and 5 together, when printed", "required": false}, {"key": "days_worked", "label": "Days", "type": "integer", "description": "Numero di giorni per i quali spettano le detrazioni (punto 6)", "required": false}, {"key": "hire_date", "label": "Start date", "type": "date", "description": "Data di inizio del rapporto (punto 9), when printed", "required": false}, {"key": "end_date", "label": "End date", "type": "date", "description": "Data di cessazione (punto 10), only when printed", "required": false}, {"key": "irpef_withheld", "label": "IRPEF withheld", "type": "amount", "description": "Ritenute Irpef (punto 21)", "required": false}, {"key": "regional_surtax", "label": "Regional surtax", "type": "amount", "description": "Addizionale regionale all''Irpef (punto 22)", "required": false}, {"key": "municipal_surtax", "label": "Municipal surtax", "type": "amount", "description": "Addizionale comunale for the income year: acconto plus saldo (punti 26 and 27)", "required": false}, {"key": "gross_tax", "label": "Gross tax", "type": "amount", "description": "Imposta lorda (punto 361)", "required": false}, {"key": "work_deductions", "label": "Employment tax credits", "type": "amount", "description": "Detrazioni per lavoro dipendente (punto 367) plus ulteriore detrazione (punto 368)", "required": false}, {"key": "family_deductions", "label": "Family tax credits", "type": "amount", "description": "Detrazioni per carichi di famiglia (punto 362)", "required": false}, {"key": "total_deductions", "label": "Total tax credits", "type": "amount", "description": "Totale detrazioni (punto 374)", "required": false}, {"key": "net_tax", "label": "Net tax", "type": "amount", "description": "Imposta netta (punto 375)", "required": false}, {"key": "integrative_treatment", "label": "Trattamento integrativo", "type": "amount", "description": "Trattamento integrativo erogato (punto 391), when printed", "required": false}, {"key": "deductible_expenses_by_employer", "label": "Deductions already applied", "type": "amount", "description": "Oneri deducibili already excluded from income by the employer (punto 431), when printed", "required": false}, {"key": "health_fund_contributions", "label": "Health fund contributions", "type": "amount", "description": "Contributi a enti o casse con fini assistenziali (punto 441, e.g. the CCNL health fund)", "required": false}, {"key": "productivity_bonus", "label": "Productivity bonus", "type": "amount", "description": "Premi di risultato at imposta sostitutiva (punto 571), when printed", "required": false}, {"key": "productivity_bonus_tax", "label": "Productivity bonus tax", "type": "amount", "description": "Imposta sostitutiva on the premi di risultato (punto 576), when printed", "required": false}, {"key": "severance", "label": "TFR", "type": "amount", "description": "TFR or arrears paid in the year (separate taxation), when printed", "required": false}]}'::jsonb -> 'fields') || coalesce((
        SELECT jsonb_agg(f ORDER BY n)
          FROM jsonb_array_elements(coalesce(old.template_json -> 'fields', '[]'::jsonb)) WITH ORDINALITY AS t(f, n)
         WHERE NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements('{"fields": [{"key": "employer", "label": "Employer", "type": "string", "description": "Sostituto d''imposta (the employer or pension body), as printed", "required": true}, {"key": "employer_tax_code", "label": "Employer tax code", "type": "string", "description": "Codice fiscale of the sostituto d''imposta, digits only", "required": false}, {"key": "income_year", "label": "Income year", "type": "integer", "description": "The year the income is about (RELATIVA ALL''ANNO 2025 is 2025), not the year in the form''s name", "required": true}, {"key": "issue_date", "label": "Signed on", "type": "date", "description": "Data firma del sostituto d''imposta", "required": false}, {"key": "employment_income", "label": "Employment income", "type": "amount", "description": "Redditi di lavoro dipendente: punto 1 (tempo indeterminato) plus punto 2 (tempo determinato)", "required": false}, {"key": "pension_income", "label": "Pension and other income", "type": "amount", "description": "Punti 3, 4 and 5 together, when printed", "required": false}, {"key": "days_worked", "label": "Days", "type": "integer", "description": "Numero di giorni per i quali spettano le detrazioni (punto 6)", "required": false}, {"key": "hire_date", "label": "Start date", "type": "date", "description": "Data di inizio del rapporto (punto 9), when printed", "required": false}, {"key": "end_date", "label": "End date", "type": "date", "description": "Data di cessazione (punto 10), only when printed", "required": false}, {"key": "irpef_withheld", "label": "IRPEF withheld", "type": "amount", "description": "Ritenute Irpef (punto 21)", "required": false}, {"key": "regional_surtax", "label": "Regional surtax", "type": "amount", "description": "Addizionale regionale all''Irpef (punto 22)", "required": false}, {"key": "municipal_surtax", "label": "Municipal surtax", "type": "amount", "description": "Addizionale comunale for the income year: acconto plus saldo (punti 26 and 27)", "required": false}, {"key": "gross_tax", "label": "Gross tax", "type": "amount", "description": "Imposta lorda (punto 361)", "required": false}, {"key": "work_deductions", "label": "Employment tax credits", "type": "amount", "description": "Detrazioni per lavoro dipendente (punto 367) plus ulteriore detrazione (punto 368)", "required": false}, {"key": "family_deductions", "label": "Family tax credits", "type": "amount", "description": "Detrazioni per carichi di famiglia (punto 362)", "required": false}, {"key": "total_deductions", "label": "Total tax credits", "type": "amount", "description": "Totale detrazioni (punto 374)", "required": false}, {"key": "net_tax", "label": "Net tax", "type": "amount", "description": "Imposta netta (punto 375)", "required": false}, {"key": "integrative_treatment", "label": "Trattamento integrativo", "type": "amount", "description": "Trattamento integrativo erogato (punto 391), when printed", "required": false}, {"key": "deductible_expenses_by_employer", "label": "Deductions already applied", "type": "amount", "description": "Oneri deducibili already excluded from income by the employer (punto 431), when printed", "required": false}, {"key": "health_fund_contributions", "label": "Health fund contributions", "type": "amount", "description": "Contributi a enti o casse con fini assistenziali (punto 441, e.g. the CCNL health fund)", "required": false}, {"key": "productivity_bonus", "label": "Productivity bonus", "type": "amount", "description": "Premi di risultato at imposta sostitutiva (punto 571), when printed", "required": false}, {"key": "productivity_bonus_tax", "label": "Productivity bonus tax", "type": "amount", "description": "Imposta sostitutiva on the premi di risultato (punto 576), when printed", "required": false}, {"key": "severance", "label": "TFR", "type": "amount", "description": "TFR or arrears paid in the year (separate taxation), when printed", "required": false}]}'::jsonb -> 'fields') e
            WHERE e ->> 'key' = f ->> 'key')
      ), '[]'::jsonb)),
    old.parent_id,
    CASE WHEN old.parent_id IS NULL THEN 'DOCUMENT_TYPE'::ingestion.category_dimension ELSE old.dimension END,
    old.taxonomy_version
  );
  UPDATE ingestion.document_categories
     SET parent_id = 'CERTIFICAZIONE_UNICA', updated_at = now()
   WHERE parent_id = old.id;

  -- Its documents, declines and history follow it.
  WITH changed AS (
    UPDATE ingestion.uploads
       SET categories = array_replace(categories, old.id, 'CERTIFICAZIONE_UNICA'),
           updated_at = now()
     WHERE old.id = ANY(categories)
    RETURNING id
  )
  SELECT coalesce(array_agg(id), '{}') INTO moved FROM changed;
  UPDATE ingestion.uploads
     SET rejected_categories = array_replace(rejected_categories, old.id, 'CERTIFICAZIONE_UNICA')
   WHERE old.id = ANY(rejected_categories);
  UPDATE ingestion.uploads u
     SET historical_suggestions = (
           SELECT jsonb_agg(CASE WHEN h ->> 'categoryId' = old.id
                                 THEN jsonb_set(h, '{categoryId}', '"CERTIFICAZIONE_UNICA"')
                                 ELSE h END ORDER BY n)
             FROM jsonb_array_elements(u.historical_suggestions) WITH ORDINALITY AS t(h, n))
   WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(u.historical_suggestions) h
                  WHERE h ->> 'categoryId' = old.id);
  UPDATE ingestion.category_suggestions
     SET approved_category_id = 'CERTIFICAZIONE_UNICA'
   WHERE approved_category_id = old.id;
  DELETE FROM ingestion.document_categories WHERE id = old.id;

  -- Read the CU fields: only the EXTRACT step runs again.
  UPDATE ingestion.uploads
     SET status = 'TO_BE_PARSED',
         completed_steps = array_remove(completed_steps, 'EXTRACT'),
         attempts = 0,
         next_attempt_at = now(),
         last_attempt_at = null,
         last_error = null,
         current_step = null,
         updated_at = now()
   WHERE id = ANY(moved) AND status = 'PARSED';

  -- Tell the modules that keep a copy: the old category goes, the new one comes, then each document.
  INSERT INTO ingestion.outbox (event_type, payload)
  VALUES ('category.changed@1', jsonb_build_object(
    'id', old.id, 'title', old.title, 'parentId', null,
    'dimension', null, 'deleted', true, 'changedAt', stamp));
  INSERT INTO ingestion.outbox (event_type, payload)
  SELECT 'category.changed@1', jsonb_build_object(
           'id', c.id, 'title', c.title, 'parentId', c.parent_id,
           'dimension', c.dimension, 'deleted', false, 'changedAt', stamp)
    FROM ingestion.document_categories c
   WHERE c.id = 'CERTIFICAZIONE_UNICA' OR c.parent_id = 'CERTIFICAZIONE_UNICA';
  INSERT INTO ingestion.outbox (event_type, payload)
  SELECT 'upload.updated@1',
         jsonb_build_object(
           'uploadId', u.id,
           'title', u.title,
           'description', u.description,
           'originalFilename', u.original_filename,
           'fileFormat', u.file_format,
           'uploadedAt', to_char(coalesce(u.uploaded_at, u.created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'categories', to_jsonb(u.categories),
           'suggestedCategories', coalesce(
             (SELECT jsonb_agg(s.category_id ORDER BY s.created_at)
                FROM ingestion.category_suggestions s
               WHERE s.status = 'PENDING' AND u.id = ANY(s.upload_ids)),
             '[]'::jsonb),
           'fields', coalesce(
             (SELECT jsonb_object_agg(f.key, coalesce(f.value -> 'value', 'null'::jsonb))
                FROM jsonb_each(u.extracted_fields -> 'fields') AS f),
             '{}'::jsonb),
           'historicalStatus', u.historical_status,
           'historicalSuggestions', coalesce(
             (SELECT jsonb_agg(h ->> 'categoryId')
                FROM jsonb_array_elements(u.historical_suggestions) AS h),
             '[]'::jsonb),
           'updatedAt', stamp
         )
    FROM ingestion.uploads u
   WHERE u.id = ANY(moved) AND u.file_format IS NOT NULL;
END
$$;
