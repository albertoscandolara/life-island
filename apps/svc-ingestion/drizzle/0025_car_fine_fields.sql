-- A fine filed as a car expense gains what Cars needs for its deadlines: the
-- day of the violation and of the notification (every deadline runs from it),
-- the rule broken, the licence points and the amount within 5 days (30% off).
-- Each field only when the template does not have it yet, so your own edits
-- stay. They fill in from the next parse. Data only.
-- Rollback: drizzle/rollback/0025_car_fine_fields.down.sql.
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(
         coalesce(c."template_json", '{}'::jsonb),
         '{fields}',
         coalesce(c."template_json" -> 'fields', '[]'::jsonb) || coalesce((
           SELECT jsonb_agg(n.f ORDER BY n.i)
             FROM jsonb_array_elements(jsonb_build_array(
               '{"key": "violation_date", "label": "Violation date", "type": "date", "description": "Fine only: the day of the violation (data della violazione)", "required": false}'::jsonb,
               '{"key": "notification_date", "label": "Notification date", "type": "date", "description": "Fine only: the day the verbale was notified (data di notifica), when printed; null when handed over on the spot or not printed", "required": false}'::jsonb,
               '{"key": "violation_article", "label": "Rule broken", "type": "string", "description": "Fine only: the article of the Codice della Strada, as printed (art. 142 c. 8)", "required": false}'::jsonb,
               '{"key": "licence_points", "label": "Licence points", "type": "integer", "description": "Fine only: points taken from the licence (decurtazione punti); null when none", "required": false}'::jsonb,
               '{"key": "reduced_amount", "label": "Amount within 5 days", "type": "amount", "description": "Fine only: the amount if paid within 5 days of notification (riduzione del 30%)", "required": false}'::jsonb
             )) WITH ORDINALITY AS n(f, i)
            WHERE NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(coalesce(c."template_json" -> 'fields', '[]'::jsonb)) e
               WHERE e ->> 'key' = n.f ->> 'key'
            )
         ), '[]'::jsonb)
       )
 WHERE c."id" = 'VEHICLE_EXPENSE';
