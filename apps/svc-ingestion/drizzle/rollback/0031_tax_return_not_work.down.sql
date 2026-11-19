-- Undoes 0031_tax_return_not_work. Not applied automatically (drizzle
-- migrations only go forward): run it by hand as ingestion_svc, then delete
-- the last row of ingestion.__drizzle_migrations.
BEGIN;
UPDATE "ingestion"."document_categories"
   SET "description" = 'Documents about your job: payslips, employment contracts, certifications of income (CU), expense claims, leave.',
       "updated_at" = now()
 WHERE "id" = 'WORK'
   AND "description" LIKE 'Documents about your job: % Never a tax return %';
UPDATE "ingestion"."document_categories"
   SET "description" = 'A filed Italian tax return (dichiarazione dei redditi): a Modello 730 or a Modello Redditi Persone Fisiche (Redditi PF, once Unico), as downloaded from the Agenzia delle Entrate site or given by the CAF or commercialista. Not the precompilata draft, not an F24, not the ricevuta di trasmissione alone. The 730 area reads its figures and marks the year''s filing as done.',
       "updated_at" = now()
 WHERE "id" = 'TAX_RETURN'
   AND "description" LIKE '% Its telematic copy is named by its protocol %';
COMMIT;
