-- Bills are entities in the Home area: each one points to its supplier, its
-- supply point and its supply contract. The utility bill templates gain the
-- fields that tell them apart: invoice number (with the supplier, the bill's
-- natural key), supplier tax code, the POD/PDR apart from the customer code,
-- the distributor, the offer and what is left to pay.
-- Data only, and only fields a template does not have yet: your own edits stay.
-- Rollback: drizzle/rollback/0012_bill_entity_fields.down.sql.
WITH extra ("category_id", "position", "field") AS (
  VALUES
  ('ELECTRICITY_BILL', 1, '{"key": "invoice_number", "label": "Invoice number", "type": "string", "description": "Number of the invoice (numero fattura / bolletta), as printed", "required": false}'::jsonb),
  ('ELECTRICITY_BILL', 2, '{"key": "supplier_tax_code", "label": "Supplier tax code", "type": "string", "description": "Codice fiscale or VAT number (partita IVA) of the supplier that issued the bill", "required": false}'::jsonb),
  ('ELECTRICITY_BILL', 3, '{"key": "supply_point_code", "label": "POD", "type": "string", "description": "POD code of the electricity supply point, e.g. IT001E12345678", "required": false}'::jsonb),
  ('ELECTRICITY_BILL', 4, '{"key": "customer_code", "label": "Customer code", "type": "string", "description": "Customer or contract code (codice cliente) given by the supplier", "required": false}'::jsonb),
  ('ELECTRICITY_BILL', 5, '{"key": "distributor", "label": "Distributor", "type": "string", "description": "Company that runs the grid at the supply point (distributore locale)", "required": false}'::jsonb),
  ('ELECTRICITY_BILL', 6, '{"key": "offer_name", "label": "Offer", "type": "string", "description": "Name of the commercial offer billed", "required": false}'::jsonb),
  ('ELECTRICITY_BILL', 7, '{"key": "total_due", "label": "Amount due", "type": "amount", "description": "What is left to pay, when it differs from the bill total (credits, earlier bills)", "required": false}'::jsonb),
  ('GAS_BILL', 1, '{"key": "invoice_number", "label": "Invoice number", "type": "string", "description": "Number of the invoice (numero fattura / bolletta), as printed", "required": false}'::jsonb),
  ('GAS_BILL', 2, '{"key": "supplier_tax_code", "label": "Supplier tax code", "type": "string", "description": "Codice fiscale or VAT number (partita IVA) of the supplier that issued the bill", "required": false}'::jsonb),
  ('GAS_BILL', 3, '{"key": "supply_point_code", "label": "PDR", "type": "string", "description": "PDR code of the gas supply point (14 digits)", "required": false}'::jsonb),
  ('GAS_BILL', 4, '{"key": "customer_code", "label": "Customer code", "type": "string", "description": "Customer or contract code (codice cliente) given by the supplier", "required": false}'::jsonb),
  ('GAS_BILL', 5, '{"key": "distributor", "label": "Distributor", "type": "string", "description": "Company that runs the gas network at the supply point (distributore locale)", "required": false}'::jsonb),
  ('GAS_BILL', 6, '{"key": "offer_name", "label": "Offer", "type": "string", "description": "Name of the commercial offer billed", "required": false}'::jsonb),
  ('GAS_BILL', 7, '{"key": "total_due", "label": "Amount due", "type": "amount", "description": "What is left to pay, when it differs from the bill total (credits, earlier bills)", "required": false}'::jsonb),
  ('WATER_BILL', 1, '{"key": "invoice_number", "label": "Invoice number", "type": "string", "description": "Number of the invoice (numero fattura / bolletta), as printed", "required": false}'::jsonb),
  ('WATER_BILL', 2, '{"key": "supplier_tax_code", "label": "Supplier tax code", "type": "string", "description": "Codice fiscale or VAT number (partita IVA) of the utility that issued the bill", "required": false}'::jsonb),
  ('WATER_BILL', 3, '{"key": "total_due", "label": "Amount due", "type": "amount", "description": "What is left to pay, when it differs from the bill total (credits, earlier bills)", "required": false}'::jsonb)
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
 WHERE c."id" = m."category_id";
