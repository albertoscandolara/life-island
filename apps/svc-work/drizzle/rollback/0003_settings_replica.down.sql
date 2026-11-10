-- Undoes 0003_settings_replica. Not applied automatically: run it by hand
-- as work_svc, then delete the last row of work.__drizzle_migrations. The
-- Work AI tools go back to on.
DROP TABLE IF EXISTS "work"."settings_replica";
