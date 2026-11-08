-- A house keeps only its supply points: the POD (electricity, IT001E36435004)
-- and PDR (gas, 14 digits) of its meters, which never change with the
-- supplier. A customer code (codice cliente) belongs to one supply contract
-- with one supplier, and a new supplier, subentro or voltura gives a new one:
-- it is now read from the bills as a supply contract, never stored on a house.
-- Data only. Bills that matched a house through a customer code now follow the
-- other bills of their contract, their supply point, or their supply address.
UPDATE "home"."properties"
   SET "supply_codes" = ARRAY(
         SELECT code FROM unnest("supply_codes") AS code
          WHERE upper(regexp_replace(code, '[\s./-]', '', 'g')) ~ '^IT[0-9]{3}E[0-9A-Z]{7,9}$'
             OR regexp_replace(code, '[\s./-]', '', 'g') ~ '^[0-9]{14}$'
       )
 WHERE EXISTS (
         SELECT 1 FROM unnest("supply_codes") AS code
          WHERE NOT (
                upper(regexp_replace(code, '[\s./-]', '', 'g')) ~ '^IT[0-9]{3}E[0-9A-Z]{7,9}$'
             OR regexp_replace(code, '[\s./-]', '', 'g') ~ '^[0-9]{14}$')
       );
