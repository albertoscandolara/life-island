-- Undoes 0013_car_document_categories. Not applied automatically (drizzle migrations
-- only go forward): run it by hand as ingestion_svc, then delete the last row of
-- ingestion.__drizzle_migrations. Only categories no document uses are removed,
-- children first; delete the others from the Categories page, which also tells
-- the review inbox.
BEGIN;
DELETE FROM "ingestion"."document_categories" c
 WHERE c.id IN ('VEHICLE_REGISTRATION', 'CAR_INSURANCE', 'ROAD_TAX', 'VEHICLE_INSPECTION', 'VEHICLE_EXPENSE')
   AND NOT EXISTS (SELECT 1 FROM "ingestion"."uploads" u WHERE c.id = ANY(u.categories))
   AND NOT EXISTS (SELECT 1 FROM "ingestion"."document_categories" child WHERE child.parent_id = c.id);
DELETE FROM "ingestion"."document_categories" c
 WHERE c.id = 'CAR_DOCUMENT'
   AND NOT EXISTS (SELECT 1 FROM "ingestion"."uploads" u WHERE c.id = ANY(u.categories))
   AND NOT EXISTS (SELECT 1 FROM "ingestion"."document_categories" child WHERE child.parent_id = c.id);
COMMIT;
