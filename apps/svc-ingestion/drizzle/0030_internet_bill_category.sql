-- INTERNET_BILL, a fourth utility bill beside electricity, gas and water:
-- the bill of a home internet line (fibra, ADSL, FWA, landline). Home reads
-- it as a bill of the house the line is in, with no meter: the line (its
-- number, else its migration code) is its supply point, the monthly fee is
-- printed apart from the extras, and the subscription period (paid a month
-- ahead) is the month the fee counts in.
-- A category with the same id is kept as it is. When one of your own already
-- has the title "Internet bill", this one is added as "Internet bill (home
-- line)" instead (titles are unique). It sits where WATER_BILL sits.
-- Data only. Rollback: drizzle/rollback/0030_internet_bill_category.down.sql.
WITH inserted AS (
  INSERT INTO "ingestion"."document_categories" ("id", "title", "description", "template_json", "dimension", "parent_id")
  SELECT 'INTERNET_BILL',
         CASE WHEN EXISTS (SELECT 1 FROM "ingestion"."document_categories" WHERE lower("title") = 'internet bill')
              THEN 'Internet bill (home line)' ELSE 'Internet bill' END,
         'A bill from a home internet or landline provider (fibra, ADSL, FWA): a flat monthly fee for the line, with its number or migration code, the offer and its start date, and extras such as calls, options or router installments. Not a mobile phone bill. Home reads it like an electricity, gas or water bill, with no consumption.',
         '{"fields": [{"key": "provider", "label": "Provider", "type": "string", "description": "Company that issued the bill (the internet or phone provider), e.g. WINDTRE, TIM, Fastweb, Iliad", "required": true}, {"key": "supplier_tax_code", "label": "Supplier tax code", "type": "string", "description": "Codice fiscale or VAT number (partita IVA) of the provider", "required": false}, {"key": "invoice_number", "label": "Invoice number", "type": "string", "description": "Number of the invoice (numero documento / conto telefonico / fattura), as printed", "required": false}, {"key": "customer_code", "label": "Customer code", "type": "string", "description": "Customer or contract code given by the provider (codice cliente), as printed", "required": false}, {"key": "line_number", "label": "Line number", "type": "string", "description": "Phone number of the fixed line the bill is for (numero di telefono / numero linea), when printed", "required": false}, {"key": "migration_code", "label": "Migration code", "type": "string", "description": "Codice di migrazione of the line (to move to another provider), as printed", "required": false}, {"key": "supply_address", "label": "Line address", "type": "string", "description": "Address where the line is installed (indirizzo di attivazione / sede impianto), only when printed apart from the holder''s mailing address", "required": false}, {"key": "offer_name", "label": "Offer", "type": "string", "description": "Name of the offer billed, e.g. Internet 200, Fibra 2.5 Giga", "required": false}, {"key": "offer_start_date", "label": "Offer start", "type": "date", "description": "Day the offer started, as printed next to it (OFFERTA Internet 200 dal 18/06/2020)", "required": false}, {"key": "billing_period", "label": "Billing period", "type": "period", "description": "First and last day of the traffic billed (periodo di fatturazione)", "required": false}, {"key": "subscription_period", "label": "Subscription period", "type": "period", "description": "First and last day the subscription fee pays for (periodo abbonamento), often the month after the billing period", "required": false}, {"key": "issue_date", "label": "Issue date", "type": "date", "description": "Date the document was issued (data emissione)", "required": false}, {"key": "due_date", "label": "Due date", "type": "date", "description": "Date by which it must be paid (data di scadenza)", "required": false}, {"key": "subscription_fee", "label": "Subscription fee", "type": "amount", "description": "The recurring fee of the offer in this bill, VAT included (abbonamento / canone), without extras", "required": false}, {"key": "total_amount", "label": "Total amount", "type": "amount", "description": "Total to pay, VAT included (importo da pagare / totale)", "required": true}, {"key": "total_due", "label": "Amount due", "type": "amount", "description": "What is left to pay, when it differs from the bill total (credits, earlier bills)", "required": false}, {"key": "payment_method", "label": "Payment method", "type": "string", "description": "How the bill is paid, as printed: e.g. domiciliazione bancaria, addebito diretto SEPA (SDD), carta di credito, bollettino", "required": false}, {"key": "currency", "label": "Currency", "type": "currency", "description": "ISO 4217 code, e.g. EUR", "required": false}]}'::jsonb,
         (SELECT "dimension" FROM "ingestion"."document_categories" WHERE "id" = 'WATER_BILL'),
         (SELECT "parent_id" FROM "ingestion"."document_categories" WHERE "id" = 'WATER_BILL')
  ON CONFLICT DO NOTHING
  RETURNING "id", "title", "parent_id", "dimension"
)
-- Modules that keep their own copy of the categories (review inbox, Home) learn it from category.changed@1.
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
