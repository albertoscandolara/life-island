-- Bills paid on their own: ELECTRICITY_BILL, GAS_BILL and WATER_BILL gain
-- the payment method printed on the bill (domiciliazione bancaria / SDD,
-- bollettino, bank transfer…). Home reads it to tell bills charged to your
-- bank account, whose due dates are no warning in the agenda.
-- Only templates that do not have the field yet, so your own edits stay.
-- Data only. Rollback: drizzle/rollback/0028_bill_payment_method.down.sql.
WITH field AS (
  SELECT '{"key": "payment_method", "label": "Payment method", "type": "string", "description": "How the bill is paid, as printed (modalità di pagamento): e.g. domiciliazione bancaria, addebito diretto SEPA (SDD), bollettino, bonifico, carta", "required": false}'::jsonb AS "field"
)
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(
         coalesce(c."template_json", '{}'::jsonb),
         '{fields}',
         coalesce(c."template_json" -> 'fields', '[]'::jsonb) || jsonb_build_array(f."field")
       )
  FROM field f
 WHERE c."id" IN ('ELECTRICITY_BILL', 'GAS_BILL', 'WATER_BILL')
   AND NOT EXISTS (
     SELECT 1 FROM jsonb_array_elements(coalesce(c."template_json" -> 'fields', '[]'::jsonb)) e
      WHERE e ->> 'key' = 'payment_method'
   );
