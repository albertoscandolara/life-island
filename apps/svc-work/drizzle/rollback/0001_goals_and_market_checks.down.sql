-- Undoes 0001_goals_and_market_checks. Not applied automatically: run it by
-- hand as work_svc, then delete the last row of work.__drizzle_migrations.
-- The goal statuses you set and the market checks you ran are lost.
BEGIN;
DROP TABLE IF EXISTS "work"."market_checks";
DROP TABLE IF EXISTS "work"."goal_statuses";
COMMIT;
