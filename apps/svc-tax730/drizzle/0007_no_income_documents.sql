-- A Certificazione Unica, a tax return or a payslip certifies income: it is
-- never one deductible expense, whatever figure it prints (a CU's fondo
-- sanitario read as a "Medical" expense of 156 €, a Redditi PF's building
-- bonus instalments read as a renovation). The classifier (categories-6)
-- and the loader (with 0006) now keep them out; this removes the ones
-- stored before, of any type, the way "Remove expense" does. The documents stay in
-- your archive and still count as the year's CU, return or payslip.
-- Data only; nothing to roll back to.
-- A transfer that paid it with other invoices keeps paying the others.
UPDATE "tax730"."expenses"
   SET "pays_too" = ARRAY(
         SELECT p FROM unnest("pays_too") AS p
          WHERE p NOT IN (SELECT e."id" FROM "tax730"."expenses" e
    JOIN "tax730"."documents" d ON d."upload_id" = e."upload_id"
   WHERE d."categories" && ARRAY['CERTIFICAZIONE_UNICA', 'TAX_RETURN', 'PAYSLIP']::text[]))
 WHERE "pays_too" && ARRAY(SELECT e."id" FROM "tax730"."expenses" e
    JOIN "tax730"."documents" d ON d."upload_id" = e."upload_id"
   WHERE d."categories" && ARRAY['CERTIFICAZIONE_UNICA', 'TAX_RETURN', 'PAYSLIP']::text[]);
--> statement-breakpoint
UPDATE "tax730"."expenses"
   SET "paired_with" = "pays_too"[1],
       "pays_too" = "pays_too"[2:]
 WHERE "paired_with" IN (SELECT e."id" FROM "tax730"."expenses" e
    JOIN "tax730"."documents" d ON d."upload_id" = e."upload_id"
   WHERE d."categories" && ARRAY['CERTIFICAZIONE_UNICA', 'TAX_RETURN', 'PAYSLIP']::text[])
   AND cardinality("pays_too") > 0;
--> statement-breakpoint
-- Its other confirmed payments go back to being paired automatically.
UPDATE "tax730"."expenses"
   SET "paired_with" = NULL, "pairing" = NULL, "pays_too" = '{}'
 WHERE "paired_with" IN (SELECT e."id" FROM "tax730"."expenses" e
    JOIN "tax730"."documents" d ON d."upload_id" = e."upload_id"
   WHERE d."categories" && ARRAY['CERTIFICAZIONE_UNICA', 'TAX_RETURN', 'PAYSLIP']::text[]);
--> statement-breakpoint
-- Its attachments go with it (ON DELETE CASCADE).
DELETE FROM "tax730"."expenses"
 WHERE "id" IN (SELECT e."id" FROM "tax730"."expenses" e
    JOIN "tax730"."documents" d ON d."upload_id" = e."upload_id"
   WHERE d."categories" && ARRAY['CERTIFICAZIONE_UNICA', 'TAX_RETURN', 'PAYSLIP']::text[]);
