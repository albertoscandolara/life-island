-- Undoes 0033_road_tax_inspection_fields: drops the new ROAD_TAX and
-- VEHICLE_INSPECTION fields and puts back the descriptions of 0013.
-- Documents keep what was read into them.
-- Run it by hand as ingestion_svc, then delete the last row of
-- ingestion.__drizzle_migrations.
BEGIN;
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(c."template_json", '{fields}', coalesce((
         SELECT jsonb_agg(
                  CASE WHEN d.key IS NOT NULL AND e.f ->> 'description' = d.new
                       THEN jsonb_set(e.f, '{description}', to_jsonb(d.old))
                       ELSE e.f END
                  ORDER BY e.i)
           FROM jsonb_array_elements(c."template_json" -> 'fields') WITH ORDINALITY AS e(f, i)
           LEFT JOIN (VALUES
           ('region', 'Regione the tax is paid to, name only (VENETO is Veneto)', 'Regione the tax is paid to'),
           ('receipt_number', 'The number of the payment: Versamento n., Cod. Transazione, Numero ricevuta, IUV or codice avviso pagoPA. Not the barcode number', 'Numero ricevuta, IUV or codice avviso pagoPA'),
           ('payment_date', 'Day it was paid: Data, or the date and time printed at the bottom of a tobacconist''s receipt (28/05/2014 16:55 is 2014-05-28)', 'Data di pagamento'),
           ('expiry_month', 'The last month this payment covers, as YYYY-MM: Scadenza, or the month printed before the months of validity (APR 2020 12 mesi is 2020-04). Never the payment date', 'Mese di scadenza as YYYY-MM: the last month this payment covers'),
           ('power_kw', 'kW the tax was computed on (Pot. Kw 57, POTENZA KW 57), if printed', 'kW the tax was computed on, if printed'),
           ('total_amount', 'Total paid (Importo, the € amount next to Riduzione del), tax, penalty, interest and fee included', 'Totale pagato, penalty and fees included')
           ) AS d(key, new, old) ON d.key = e.f ->> 'key'
          WHERE e.f ->> 'key' NOT IN ('tax_amount', 'penalty_amount', 'interest_amount', 'fee_amount', 'reduction_percent', 'payer_tax_code', 'payment_channel')
       ), '[]'::jsonb))
 WHERE c."id" = 'ROAD_TAX' AND jsonb_typeof(c."template_json" -> 'fields') = 'array';
UPDATE "ingestion"."document_categories"
   SET "description" = 'The receipt of the tassa automobilistica (bollo auto) paid to the Regione, through pagoPA, ACI, a tobacconist or the bank: plate, expiry month, months of validity and amount.'
 WHERE "id" = 'ROAD_TAX' AND "description" = 'The receipt of the tassa automobilistica (bollo auto) paid to the Regione, through pagoPA, ACI, a tobacconist (Lottomatica, SISAL) or the bank: plate, the last month it covers and its months of validity, region, power, the tax with any penalty, interest and fee, who paid and when.';
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(c."template_json", '{fields}', coalesce((
         SELECT jsonb_agg(
                  CASE WHEN d.key IS NOT NULL AND e.f ->> 'description' = d.new
                       THEN jsonb_set(e.f, '{description}', to_jsonb(d.old))
                       ELSE e.f END
                  ORDER BY e.i)
           FROM jsonb_array_elements(c."template_json" -> 'fields') WITH ORDINALITY AS e(f, i)
           LEFT JOIN (VALUES
           ('inspection_centre', 'Centro di controllo: its Ragione sociale and town (AUTOFFICINA ROSSI SNC, Verona (VR)), or the Motorizzazione office', 'Centro revisioni or Motorizzazione office, as printed'),
           ('report_number', 'Codice antifalsificazione of the Certificato di revisione (VRAB1CD2EFG), else the number of the certificate or protocol', 'Numero del certificato / protocollo'),
           ('inspection_date', '(3) Data: the day of the revisione', 'Data della revisione'),
           ('outcome', '(7) Risultato controllo tecnico, Esito: REGOLARE is passed, RIPETERE is repeat, SOSPESO is suspended', 'Esito: regolare is passed, ripetere is repeat, sospeso is suspended'),
           ('odometer_km', '(4) km read at the revisione', 'Km rilevati'),
           ('next_due_date', '(8) Data del successivo controllo, Entro il 30/06/2027: only if printed', 'Prossima revisione entro, only if printed')
           ) AS d(key, new, old) ON d.key = e.f ->> 'key'
          WHERE e.f ->> 'key' NOT IN ('vehicle_category', 'deficiencies', 'inspector')
       ), '[]'::jsonb))
 WHERE c."id" = 'VEHICLE_INSPECTION' AND jsonb_typeof(c."template_json" -> 'fields') = 'array';
UPDATE "ingestion"."document_categories"
   SET "description" = 'The report or receipt of a revisione at a centro revisioni or the Motorizzazione: date, outcome, km read and amount.'
 WHERE "id" = 'VEHICLE_INSPECTION' AND "description" = 'The Certificato di revisione (or the receipt) of a revisione at a centro revisioni or the Motorizzazione: date, outcome, km read, next revisione by, centre, codice antifalsificazione, deficiencies and amount.';
COMMIT;
