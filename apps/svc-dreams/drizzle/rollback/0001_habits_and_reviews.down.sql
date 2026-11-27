-- Undoes 0001_habits_and_reviews. Not applied automatically: run it by
-- hand as dreams_svc, then delete the last row of dreams.__drizzle_migrations.
-- The habits, their ticks, the weekly reviews and the "how I will know" and
-- target date of each dream are lost (the goals schema, if still there,
-- keeps the copies they were moved from).
BEGIN;
DROP TABLE IF EXISTS "dreams"."habit_checks";
DROP TABLE IF EXISTS "dreams"."habits";
DROP TABLE IF EXISTS "dreams"."weekly_reviews";
ALTER TABLE "dreams"."dreams" DROP COLUMN IF EXISTS "measure";
ALTER TABLE "dreams"."dreams" DROP COLUMN IF EXISTS "target_date";
COMMIT;
