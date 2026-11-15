-- Undoes 0004_pension_fund. Not applied automatically: run it by hand as
-- work_svc, then delete the last row of work.__drizzle_migrations. The funds,
-- statements, payments and notices you recorded are lost; the payslips keep
-- their pension fund lines.
BEGIN;
DROP TABLE IF EXISTS "work"."pension_statements";
DROP TABLE IF EXISTS "work"."pension_payments";
DROP TABLE IF EXISTS "work"."pension_notices";
DROP TABLE IF EXISTS "work"."pension_dismissed_documents";
DROP TABLE IF EXISTS "work"."pension_funds";
COMMIT;
