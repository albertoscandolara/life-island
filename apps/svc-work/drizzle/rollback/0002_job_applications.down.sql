-- Undoes 0002_job_applications. Not applied automatically: run it by hand
-- as work_svc, then delete the last row of work.__drizzle_migrations. The
-- job applications you tracked are lost.
BEGIN;
DROP TABLE IF EXISTS "work"."job_applications";
COMMIT;
