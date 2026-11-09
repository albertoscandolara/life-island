-- Payslips read with gaps, though every payslip prints the same boxes.
-- 1. Amounts with cents were rejected as "more than two decimals" (2378.20,
--    2158.26, 162.36...): the check compared value * 100 with its rounding,
--    and in floating point 2378.2 * 100 is 237819.99999999997. The parse
--    worker now checks with a tolerance; this takes back every amount that
--    was rejected for that reason only, from the raw value the AI read, and
--    tells the other modules (Work, 730...) with `upload.updated`.
-- 2. The PAYSLIP fields the AI found ambiguous on every payslip say how to
--    read them: vacation and leave printed as previous years plus current
--    year are summed, two superminimo items are summed, the level is only its
--    code, a separate detassata base is not taxable income, and a December
--    "mens. supplementare" is a tredicesima. Only descriptions you have not
--    edited change; they apply from the next parse.
-- Data only. Rollback: drizzle/rollback/0020_payslip_amounts_and_descriptions.down.sql.
WITH fixed AS (
  UPDATE "ingestion"."uploads" u
     SET "extracted_fields" = jsonb_set(
           jsonb_set(
             u."extracted_fields",
             '{fields}',
             (SELECT jsonb_object_agg(
                       e.key,
                       CASE
                         WHEN e.value ->> 'status' = 'invalid'
                          AND e.value ->> 'type' = 'amount'
                          AND e.value ->> 'note' = 'more than two decimals for an amount'
                          AND btrim(e.value ->> 'raw') ~ '^-?[0-9]+(\.[0-9]{1,2})?$'
                         THEN e.value || jsonb_build_object(
                                'value', btrim(e.value ->> 'raw')::numeric,
                                'status', 'found',
                                'note', NULL)
                         ELSE e.value
                       END)
                FROM jsonb_each(u."extracted_fields" -> 'fields') AS e)
           ),
           '{warnings}',
           coalesce(
             (SELECT jsonb_agg(w.value ORDER BY w.n)
                FROM jsonb_array_elements_text(coalesce(u."extracted_fields" -> 'warnings', '[]'::jsonb))
                     WITH ORDINALITY AS w(value, n)
               WHERE w.value !~ ': "-?[0-9]+(\.[0-9]{1,2})?" more than two decimals for an amount$'),
             '[]'::jsonb)
         )
   WHERE jsonb_typeof(u."extracted_fields" -> 'fields') = 'object'
     AND EXISTS (
       SELECT 1 FROM jsonb_each(u."extracted_fields" -> 'fields') AS e
        WHERE e.value ->> 'status' = 'invalid'
          AND e.value ->> 'type' = 'amount'
          AND e.value ->> 'note' = 'more than two decimals for an amount'
          AND btrim(e.value ->> 'raw') ~ '^-?[0-9]+(\.[0-9]{1,2})?$'
     )
  RETURNING u.*
)
-- The new snapshot of each document it fixed, as 0017 sends it.
INSERT INTO "ingestion"."outbox" (event_type, payload)
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
              FROM "ingestion"."category_suggestions" s
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
         'updatedAt', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       )
  FROM fixed u
 WHERE u.status <> 'UPLOADING'
   AND u.file_format IS NOT NULL;--> statement-breakpoint
WITH descriptions ("key", "old", "new") AS (
  VALUES
  ('vacation_left',
   'Remaining paid vacation (ferie residue)',
   'Remaining paid vacation (ferie residue), in hours. When the payslip prints it split into previous years (anni precedenti, AP) and the current year (anno corrente, AC), report the sum of the two'),
  ('leave_left',
   'Remaining paid leave hours (permessi, ROL residui)',
   'Remaining paid leave hours (permessi, ROL, ex festività residui). When the payslip prints several residual figures (previous years and current year, or ROL and permessi), report their sum'),
  ('superminimum',
   'SUPERMINIMO or SUPERM. ASSORBIBILE among the elementi retributivi, when printed',
   'Superminimo among the elementi retributivi: SUPERMINIMO, SUPERM. ASSORBIBILE or both, summed when more than one superminimo item is printed'),
  ('welfare_credits',
   'Welfare or benefit credits shown on the payslip but not paid in the net (conversione welfare, art. 51), total of the month',
   'Welfare or benefit credits shown on the payslip but not paid in the net (conversione welfare art. 51 or art. 100, welfare CCNL, flexible benefits, buoni or ticket compliments): the sum of every such line of the month'),
  ('taxable_income',
   'Income subject to income tax this month (imponibile fiscale)',
   'Income subject to ordinary income tax this month (imponibile fiscale, imp. a tassazione ordinaria). A separate detassata or agevolata base, taxed with a substitute tax, is not included'),
  ('job_level',
   'Level or grade (livello)',
   'Level or grade (livello): only its code on the CCNL scale, such as C3, B1, 5S or Q, without prefixes such as IMP.LIV. or notes such as L. 56/87'),
  ('payslip_kind',
   'regular for the monthly payslip; thirteenth for a separate tredicesima payslip (13.MA MENSILITA'', gratifica natalizia); fourteenth for a quattordicesima (14.MA MENSILITA''); other for a separate payslip of only a bonus, arrears or settlement. A monthly payslip that also pays the tredicesima is regular',
   'regular for the monthly payslip; thirteenth for a separate tredicesima payslip (13.MA MENSILITA'', MENS. SUPPLEMENTARE or mensilità aggiuntiva of December, gratifica natalizia); fourteenth for a quattordicesima (14.MA MENSILITA'', mensilità supplementare of June or July); other for a separate payslip of only a bonus, arrears or settlement. A monthly payslip that also pays the tredicesima is regular')
)
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(
         c."template_json",
         '{fields}',
         (SELECT jsonb_agg(
                   CASE WHEN d."key" IS NOT NULL THEN jsonb_set(f, '{description}', to_jsonb(d."new")) ELSE f END
                   ORDER BY t.n)
            FROM jsonb_array_elements(c."template_json" -> 'fields') WITH ORDINALITY AS t(f, n)
            LEFT JOIN descriptions d
              ON d."key" = f ->> 'key' AND d."old" = f ->> 'description')
       )
 WHERE c."id" = 'PAYSLIP'
   AND jsonb_array_length(coalesce(c."template_json" -> 'fields', '[]'::jsonb)) > 0;
