-- Undoes 0030_internet_bill_category. Not applied automatically (drizzle
-- migrations only go forward): run it by hand as ingestion_svc, then delete
-- the last row of ingestion.__drizzle_migrations. INTERNET_BILL is removed
-- only when no document uses it; otherwise delete it from the Categories
-- page, which also tells the other modules.
BEGIN;
DELETE FROM "ingestion"."document_categories" c
 WHERE c.id = 'INTERNET_BILL'
   AND NOT EXISTS (SELECT 1 FROM "ingestion"."uploads" u WHERE c.id = ANY(u.categories))
   AND NOT EXISTS (SELECT 1 FROM "ingestion"."document_categories" child WHERE child.parent_id = c.id);
COMMIT;
