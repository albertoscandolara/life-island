-- Bollo and revisione read as they are printed. Built on real receipts and
-- certificates: a tobacconist's bollo receipt (Lottomatica) prints the last
-- month it covers before its months ("APR 2020 12 mesi"), the tax, interest,
-- penalty and fee apart, the payer's codice fiscale and the payment date at
-- the bottom; a Certificato di revisione prints numbered boxes, from (1) VIN
-- to (8) the next revisione, and a codice antifalsificazione as its number.
-- ROAD_TAX gains the tax, penalty, interest and fee, the reduction, who paid
-- and where; VEHICLE_INSPECTION the category, deficiencies and inspector.
-- Descriptions change only where they are still as 0013 wrote them, and a
-- field is added only when missing, so your own edits stay. They fill in from
-- the next parse. Data only.
-- Rollback: drizzle/rollback/0033_road_tax_inspection_fields.down.sql.
-- ROAD_TAX: clearer field descriptions (only those still as 0013 wrote them).
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(c."template_json", '{fields}', (
         SELECT jsonb_agg(
                  CASE WHEN d.key IS NOT NULL AND e.f ->> 'description' = d.old
                       THEN jsonb_set(e.f, '{description}', to_jsonb(d.new))
                       ELSE e.f END
                  ORDER BY e.i)
           FROM jsonb_array_elements(c."template_json" -> 'fields') WITH ORDINALITY AS e(f, i)
           LEFT JOIN (VALUES
           ('region', 'Regione the tax is paid to', 'Regione the tax is paid to, name only (VENETO is Veneto)'),
           ('receipt_number', 'Numero ricevuta, IUV or codice avviso pagoPA', 'The number of the payment: Versamento n., Cod. Transazione, Numero ricevuta, IUV or codice avviso pagoPA. Not the barcode number'),
           ('payment_date', 'Data di pagamento', 'Day it was paid: Data, or the date and time printed at the bottom of a tobacconist''s receipt (28/05/2014 16:55 is 2014-05-28)'),
           ('expiry_month', 'Mese di scadenza as YYYY-MM: the last month this payment covers', 'The last month this payment covers, as YYYY-MM: Scadenza, or the month printed before the months of validity (APR 2020 12 mesi is 2020-04). Never the payment date'),
           ('power_kw', 'kW the tax was computed on, if printed', 'kW the tax was computed on (Pot. Kw 57, POTENZA KW 57), if printed'),
           ('total_amount', 'Totale pagato, penalty and fees included', 'Total paid (Importo, the € amount next to Riduzione del), tax, penalty, interest and fee included')
           ) AS d(key, old, new) ON d.key = e.f ->> 'key'
       ))
 WHERE c."id" = 'ROAD_TAX' AND jsonb_typeof(c."template_json" -> 'fields') = 'array';
-- ROAD_TAX: the new fields, each only when the template does not have it yet.
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(
         coalesce(c."template_json", '{}'::jsonb),
         '{fields}',
         coalesce(c."template_json" -> 'fields', '[]'::jsonb) || coalesce((
           SELECT jsonb_agg(n.f ORDER BY n.i)
             FROM jsonb_array_elements(jsonb_build_array(
               '{"key": "tax_amount", "label": "Tax", "type": "amount", "description": "The tax alone (Tassa), without penalty, interest or fee", "required": false}'::jsonb,
               '{"key": "penalty_amount", "label": "Penalty", "type": "amount", "description": "Sanzioni: the penalty for paying late; 0 when paid on time", "required": false}'::jsonb,
               '{"key": "interest_amount", "label": "Interest", "type": "amount", "description": "Interessi for paying late; 0 when paid on time", "required": false}'::jsonb,
               '{"key": "fee_amount", "label": "Fee", "type": "amount", "description": "Fee of the payment channel (Dir., Diritti, Commissione)", "required": false}'::jsonb,
               '{"key": "reduction_percent", "label": "Reduction", "type": "number", "description": "Riduzione del ... %: the reduction applied, 0 when none", "required": false, "unit": "%"}'::jsonb,
               '{"key": "payer_tax_code", "label": "Paid by", "type": "string", "description": "Codice fiscale printed on the receipt (CF:), the person who paid or owes it", "required": false}'::jsonb,
               '{"key": "payment_channel", "label": "Paid at", "type": "string", "description": "Where it was paid: Lottomatica, SISAL, ACI, pagoPA, the bank or the post office, as printed", "required": false}'::jsonb
             )) WITH ORDINALITY AS n(f, i)
            WHERE NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(coalesce(c."template_json" -> 'fields', '[]'::jsonb)) e
               WHERE e ->> 'key' = n.f ->> 'key'
            )
         ), '[]'::jsonb)
       )
 WHERE c."id" = 'ROAD_TAX';
UPDATE "ingestion"."document_categories"
   SET "description" = 'The receipt of the tassa automobilistica (bollo auto) paid to the Regione, through pagoPA, ACI, a tobacconist (Lottomatica, SISAL) or the bank: plate, the last month it covers and its months of validity, region, power, the tax with any penalty, interest and fee, who paid and when.'
 WHERE "id" = 'ROAD_TAX' AND "description" = 'The receipt of the tassa automobilistica (bollo auto) paid to the Regione, through pagoPA, ACI, a tobacconist or the bank: plate, expiry month, months of validity and amount.';
-- VEHICLE_INSPECTION: clearer field descriptions (only those still as 0013 wrote them).
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(c."template_json", '{fields}', (
         SELECT jsonb_agg(
                  CASE WHEN d.key IS NOT NULL AND e.f ->> 'description' = d.old
                       THEN jsonb_set(e.f, '{description}', to_jsonb(d.new))
                       ELSE e.f END
                  ORDER BY e.i)
           FROM jsonb_array_elements(c."template_json" -> 'fields') WITH ORDINALITY AS e(f, i)
           LEFT JOIN (VALUES
           ('inspection_centre', 'Centro revisioni or Motorizzazione office, as printed', 'Centro di controllo: its Ragione sociale and town (AUTOFFICINA ROSSI SNC, Verona (VR)), or the Motorizzazione office'),
           ('report_number', 'Numero del certificato / protocollo', 'Codice antifalsificazione of the Certificato di revisione (VRAB1CD2EFG), else the number of the certificate or protocol'),
           ('inspection_date', 'Data della revisione', '(3) Data: the day of the revisione'),
           ('outcome', 'Esito: regolare is passed, ripetere is repeat, sospeso is suspended', '(7) Risultato controllo tecnico, Esito: REGOLARE is passed, RIPETERE is repeat, SOSPESO is suspended'),
           ('odometer_km', 'Km rilevati', '(4) km read at the revisione'),
           ('next_due_date', 'Prossima revisione entro, only if printed', '(8) Data del successivo controllo, Entro il 30/06/2027: only if printed')
           ) AS d(key, old, new) ON d.key = e.f ->> 'key'
       ))
 WHERE c."id" = 'VEHICLE_INSPECTION' AND jsonb_typeof(c."template_json" -> 'fields') = 'array';
-- VEHICLE_INSPECTION: the new fields, each only when the template does not have it yet.
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(
         coalesce(c."template_json", '{}'::jsonb),
         '{fields}',
         coalesce(c."template_json" -> 'fields', '[]'::jsonb) || coalesce((
           SELECT jsonb_agg(n.f ORDER BY n.i)
             FROM jsonb_array_elements(jsonb_build_array(
               '{"key": "vehicle_category", "label": "Category", "type": "string", "description": "(5) Categoria of the vehicle (M1 for a car)", "required": false}'::jsonb,
               '{"key": "deficiencies", "label": "Deficiencies", "type": "string", "description": "(6) Carenze constatate, as written; null when the box is empty", "required": false}'::jsonb,
               '{"key": "inspector", "label": "Inspector", "type": "string", "description": "(9) Identit\u00e0 ispettore: name and surname", "required": false}'::jsonb
             )) WITH ORDINALITY AS n(f, i)
            WHERE NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(coalesce(c."template_json" -> 'fields', '[]'::jsonb)) e
               WHERE e ->> 'key' = n.f ->> 'key'
            )
         ), '[]'::jsonb)
       )
 WHERE c."id" = 'VEHICLE_INSPECTION';
UPDATE "ingestion"."document_categories"
   SET "description" = 'The Certificato di revisione (or the receipt) of a revisione at a centro revisioni or the Motorizzazione: date, outcome, km read, next revisione by, centre, codice antifalsificazione, deficiencies and amount.'
 WHERE "id" = 'VEHICLE_INSPECTION' AND "description" = 'The report or receipt of a revisione at a centro revisioni or the Motorizzazione: date, outcome, km read and amount.';
