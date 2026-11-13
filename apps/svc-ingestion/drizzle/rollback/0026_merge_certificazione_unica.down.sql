-- 0026_merge_certificazione_unica is not undone: it moved your documents from
-- a category of your own into CERTIFICAZIONE_UNICA and deleted the old one,
-- and the CU fields read since then belong to the new category. To go back,
-- rename or move the category from Documents > Categories.
-- Run nothing by hand; delete the last row of ingestion.__drizzle_migrations
-- only if you also restore a backup taken before the migration.
SELECT 1;
