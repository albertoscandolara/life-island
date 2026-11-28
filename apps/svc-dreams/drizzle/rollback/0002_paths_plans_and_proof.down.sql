-- Undoes 0002_paths_plans_and_proof. Not applied automatically: run it by
-- hand as dreams_svc, then delete the last row of dreams.__drizzle_migrations.
-- The paths (milestones), the plans of each step (when, where, if-then and
-- how hard you expected it) and what each check-in showed you are lost.
BEGIN;
ALTER TABLE "dreams"."dream_steps" DROP COLUMN IF EXISTS "milestone_id";
ALTER TABLE "dreams"."dream_steps" DROP COLUMN IF EXISTS "cue";
ALTER TABLE "dreams"."dream_steps" DROP COLUMN IF EXISTS "if_then";
ALTER TABLE "dreams"."dream_steps" DROP COLUMN IF EXISTS "expected_hard";
ALTER TABLE "dreams"."dream_check_ins" DROP COLUMN IF EXISTS "actual_hard";
ALTER TABLE "dreams"."dream_check_ins" DROP COLUMN IF EXISTS "learned";
DROP TABLE IF EXISTS "dreams"."dream_milestones";
COMMIT;
