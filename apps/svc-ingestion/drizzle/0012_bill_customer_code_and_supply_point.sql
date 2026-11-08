-- Electricity and gas bills print two different codes, and they were read into
-- one "customer_id" field. They mean different things:
-- - the POD (electricity) or PDR (gas) names the meter: it belongs to the home
--   and stays the same whatever the supplier or contract;
-- - the customer code (codice cliente) is given by the supplier to one supply
--   contract: a new supplier, a subentro or a voltura gives a new one, an
--   offer change with the same supplier keeps it.
-- From now on they are read apart, with the offer billed. Documents read
-- before keep "customer_id"; Home tells the two codes apart by their shape.
-- Data only, and only on templates still as 0009 made them.
-- Rollback: drizzle/rollback/0012_bill_customer_code_and_supply_point.down.sql.
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(c."template_json", '{fields}', (
         SELECT jsonb_agg(r.field ORDER BY f.position, r.position)
           FROM jsonb_array_elements(c."template_json"->'fields') WITH ORDINALITY AS f(field, position)
          CROSS JOIN LATERAL jsonb_array_elements(
                CASE WHEN f.field->>'key' <> 'customer_id' THEN jsonb_build_array(f.field)
                     WHEN c.id = 'ELECTRICITY_BILL' THEN jsonb_build_array(
                       jsonb_build_object('key', 'customer_code', 'label', 'Customer code', 'type', 'string', 'description', 'Codice cliente: the code the supplier gives to this supply contract (not the POD)', 'required', false),
                       jsonb_build_object('key', 'pod', 'label', 'POD', 'type', 'string', 'description', 'POD of the electricity supply point, e.g. IT001E12345678', 'required', false),
                       jsonb_build_object('key', 'offer_name', 'label', 'Offer', 'type', 'string', 'description', 'Name of the offer or price plan billed, as printed', 'required', false))
                     ELSE jsonb_build_array(
                       jsonb_build_object('key', 'customer_code', 'label', 'Customer code', 'type', 'string', 'description', 'Codice cliente: the code the supplier gives to this supply contract (not the PDR)', 'required', false),
                       jsonb_build_object('key', 'pdr', 'label', 'PDR', 'type', 'string', 'description', 'PDR of the gas supply point: 14 digits, e.g. 01680102015791', 'required', false),
                       jsonb_build_object('key', 'offer_name', 'label', 'Offer', 'type', 'string', 'description', 'Name of the offer or price plan billed, as printed', 'required', false))
                END) WITH ORDINALITY AS r(field, position)
       ))
 WHERE c.id IN ('ELECTRICITY_BILL', 'GAS_BILL')
   AND jsonb_path_exists(c."template_json", '$.fields[*] ? (@.key == "customer_id")')
   AND NOT jsonb_path_exists(c."template_json", '$.fields[*] ? (@.key == "customer_code")');
