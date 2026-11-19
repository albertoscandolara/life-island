-- A filed tax return (730 or Redditi PF) is your own yearly filing, the same
-- with or without a job: it belongs to the 730 area, never to Work. The
-- classifier reads these descriptions, so WORK now says a tax return is not
-- one of its documents, and TAX_RETURN says how the Agenzia delle Entrate
-- names its telematic copy ("UNI T2311131450352240926 <codice fiscale>").
-- Only the built-in descriptions are changed: one you edited is kept.
-- Data only. Rollback: drizzle/rollback/0031_tax_return_not_work.down.sql.
UPDATE "ingestion"."document_categories"
   SET "description" = 'Documents about your job: payslips, employment contracts, certifications of income (CU), expense claims, leave. Never a tax return (Modello 730, Redditi PF): that is your own yearly filing, with or without a job, even when it prints your employment income.',
       "updated_at" = now()
 WHERE "id" = 'WORK'
   AND "description" = 'Documents about your job: payslips, employment contracts, certifications of income (CU), expense claims, leave.';
--> statement-breakpoint
UPDATE "ingestion"."document_categories"
   SET "description" = 'A filed Italian tax return (dichiarazione dei redditi): a Modello 730 or a Modello Redditi Persone Fisiche (Redditi PF, once Unico), as downloaded from the Agenzia delle Entrate site or given by the CAF or commercialista. Its telematic copy is named by its protocol and your codice fiscale (UNI T2311131450352240926 RSSMRA80A01H501U). It is your own filing, whatever your job: never a work document and never issued by your employer. Not the precompilata draft, not an F24, not the ricevuta di trasmissione alone. The 730 area reads its figures and marks the year''s filing as done.',
       "updated_at" = now()
 WHERE "id" = 'TAX_RETURN'
   AND "description" = 'A filed Italian tax return (dichiarazione dei redditi): a Modello 730 or a Modello Redditi Persone Fisiche (Redditi PF, once Unico), as downloaded from the Agenzia delle Entrate site or given by the CAF or commercialista. Not the precompilata draft, not an F24, not the ricevuta di trasmissione alone. The 730 area reads its figures and marks the year''s filing as done.';
