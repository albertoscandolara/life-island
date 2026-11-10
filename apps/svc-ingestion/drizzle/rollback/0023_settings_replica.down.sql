-- Undoes 0023_settings_replica: the parse worker goes back to its .env
-- settings and every document AI tool is on.
-- Run it by hand as ingestion_svc, then delete the last row of
-- ingestion.__drizzle_migrations.
DROP TABLE IF EXISTS "ingestion"."settings_replica";
