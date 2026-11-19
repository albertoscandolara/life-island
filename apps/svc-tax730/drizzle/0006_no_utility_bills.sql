-- A utility bill (electricity, gas, water, internet) is a household cost,
-- never a 730 deductible expense. A Wind Tre internet bill was read as one
-- (type "Other", no 730 row) because it is a "fattura" too. The classifier
-- and the loader now keep them out; this removes the ones already stored,
-- the same way "Remove expense" does: the documents stay in your archive,
-- and what was paired with them is counted on its own again.
-- Only expenses of type "other" filed as a utility bill (or a plain BILL)
-- are touched: a typed one (renovation, energy efficiency...) is one you or
-- the AI meant.
-- Data only; nothing to roll back to.
-- A transfer that paid it with other invoices keeps paying the others.
UPDATE "tax730"."expenses"
   SET "pays_too" = ARRAY(
         SELECT p FROM unnest("pays_too") AS p
          WHERE p NOT IN (SELECT e."id" FROM "tax730"."expenses" e
    JOIN "tax730"."documents" d ON d."upload_id" = e."upload_id"
   WHERE e."expense_type" = 'other'
     AND d."categories" && ARRAY['ELECTRICITY_BILL', 'GAS_BILL', 'WATER_BILL', 'INTERNET_BILL', 'BILL']::text[]))
 WHERE "pays_too" && ARRAY(SELECT e."id" FROM "tax730"."expenses" e
    JOIN "tax730"."documents" d ON d."upload_id" = e."upload_id"
   WHERE e."expense_type" = 'other'
     AND d."categories" && ARRAY['ELECTRICITY_BILL', 'GAS_BILL', 'WATER_BILL', 'INTERNET_BILL', 'BILL']::text[]);
--> statement-breakpoint
UPDATE "tax730"."expenses"
   SET "paired_with" = "pays_too"[1],
       "pays_too" = "pays_too"[2:]
 WHERE "paired_with" IN (SELECT e."id" FROM "tax730"."expenses" e
    JOIN "tax730"."documents" d ON d."upload_id" = e."upload_id"
   WHERE e."expense_type" = 'other'
     AND d."categories" && ARRAY['ELECTRICITY_BILL', 'GAS_BILL', 'WATER_BILL', 'INTERNET_BILL', 'BILL']::text[])
   AND cardinality("pays_too") > 0;
--> statement-breakpoint
-- Its other confirmed payments go back to being paired automatically.
UPDATE "tax730"."expenses"
   SET "paired_with" = NULL, "pairing" = NULL, "pays_too" = '{}'
 WHERE "paired_with" IN (SELECT e."id" FROM "tax730"."expenses" e
    JOIN "tax730"."documents" d ON d."upload_id" = e."upload_id"
   WHERE e."expense_type" = 'other'
     AND d."categories" && ARRAY['ELECTRICITY_BILL', 'GAS_BILL', 'WATER_BILL', 'INTERNET_BILL', 'BILL']::text[]);
--> statement-breakpoint
-- Its attachments go with it (ON DELETE CASCADE).
DELETE FROM "tax730"."expenses"
 WHERE "id" IN (SELECT e."id" FROM "tax730"."expenses" e
    JOIN "tax730"."documents" d ON d."upload_id" = e."upload_id"
   WHERE e."expense_type" = 'other'
     AND d."categories" && ARRAY['ELECTRICITY_BILL', 'GAS_BILL', 'WATER_BILL', 'INTERNET_BILL', 'BILL']::text[]);
