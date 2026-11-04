-- Starter categories for the Home area's Bills: electricity and gas bills sit
-- beside WATER_BILL, with the fields Bills charts (period, consumption, total)
-- and the supply address and code that tell your homes apart.
-- Data only; a category with the same id or title that you created already is
-- kept as it is. Rollback: drizzle/rollback/0009_utility_bill_categories.down.sql.
WITH inserted AS (
  INSERT INTO "ingestion"."document_categories" ("id", "title", "description", "template_json", "dimension") VALUES
  ('ELECTRICITY_BILL', 'Electricity bill', 'A bill from an electricity supplier (luce), usually showing the POD and the consumption in kWh for a billing period.', '{"fields": [{"key": "provider", "label": "Provider", "type": "string", "description": "Company that issued the bill", "required": true}, {"key": "customer_id", "label": "Supply point code", "type": "string", "description": "POD code of the electricity supply point (e.g. IT001E12345678), or the customer code", "required": false}, {"key": "supply_address", "label": "Supply address", "type": "string", "description": "Address of the home supplied, as printed", "required": false}, {"key": "billing_period", "label": "Billing period", "type": "period", "description": "First and last day billed", "required": false}, {"key": "issue_date", "label": "Issue date", "type": "date", "description": "Date the document was issued", "required": false}, {"key": "due_date", "label": "Due date", "type": "date", "description": "Date by which it must be paid", "required": false}, {"key": "electricity_consumption", "label": "Electricity consumption", "type": "number", "description": "Electricity billed in the period, actual or estimated", "required": false, "unit": "kWh"}, {"key": "total_amount", "label": "Total amount", "type": "amount", "description": "Total to pay or paid, as printed", "required": true}, {"key": "currency", "label": "Currency", "type": "currency", "description": "ISO 4217 code, e.g. EUR", "required": false}]}'::jsonb, (SELECT "dimension" FROM "ingestion"."document_categories" WHERE "id" = 'WATER_BILL')),
  ('GAS_BILL', 'Gas bill', 'A bill from a natural gas supplier, usually showing the PDR and the consumption in standard cubic metres (Smc) for a billing period.', '{"fields": [{"key": "provider", "label": "Provider", "type": "string", "description": "Company that issued the bill", "required": true}, {"key": "customer_id", "label": "Supply point code", "type": "string", "description": "PDR code of the gas supply point (14 digits), or the customer code", "required": false}, {"key": "supply_address", "label": "Supply address", "type": "string", "description": "Address of the home supplied, as printed", "required": false}, {"key": "billing_period", "label": "Billing period", "type": "period", "description": "First and last day billed", "required": false}, {"key": "issue_date", "label": "Issue date", "type": "date", "description": "Date the document was issued", "required": false}, {"key": "due_date", "label": "Due date", "type": "date", "description": "Date by which it must be paid", "required": false}, {"key": "gas_consumption", "label": "Gas consumption", "type": "number", "description": "Gas billed in the period, in standard cubic metres", "required": false, "unit": "Smc"}, {"key": "total_amount", "label": "Total amount", "type": "amount", "description": "Total to pay or paid, as printed", "required": true}, {"key": "currency", "label": "Currency", "type": "currency", "description": "ISO 4217 code, e.g. EUR", "required": false}]}'::jsonb, (SELECT "dimension" FROM "ingestion"."document_categories" WHERE "id" = 'WATER_BILL'))
  ON CONFLICT DO NOTHING
  RETURNING "id", "title", "parent_id", "dimension"
)
-- Modules that keep their own copy of the categories (review inbox, Home) learn them from category.changed@1.
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
