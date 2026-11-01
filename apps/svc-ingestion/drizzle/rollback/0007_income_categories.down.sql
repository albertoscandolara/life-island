-- Undoes 0007_income_categories. Not applied automatically (drizzle migrations
-- only go forward): run it by hand as ingestion_svc, then delete the last row of
-- ingestion.__drizzle_migrations. Only categories no document uses are removed;
-- delete the others from the Categories page, which also tells the review inbox.
BEGIN;
DELETE FROM "ingestion"."document_categories" c
 WHERE c.id IN ('INCOME', 'PAYSLIP', 'WORK')
   AND NOT EXISTS (SELECT 1 FROM "ingestion"."uploads" u WHERE c.id = ANY(u.categories))
   AND NOT EXISTS (SELECT 1 FROM "ingestion"."document_categories" child WHERE child.parent_id = c.id);
COMMIT;
