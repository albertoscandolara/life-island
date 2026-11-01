-- Undoes 0003_category_tree. Not applied automatically: run it by hand as
-- review_svc, then delete the last row of review.__drizzle_migrations. No
-- record is touched; category filters go back to exact matches.
BEGIN;
DROP INDEX IF EXISTS "review"."staging_records_categories_idx";
DROP TABLE IF EXISTS "review"."category_tree";
COMMIT;
