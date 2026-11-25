-- Undoes 0034_car_ownership_category. Not applied automatically (drizzle
-- migrations only go forward): run it by hand as ingestion_svc, then delete
-- the last row of ingestion.__drizzle_migrations. VEHICLE_OWNERSHIP is
-- removed only when no document uses it; otherwise delete it from the
-- Categories page, which also tells the other modules.
BEGIN;
DELETE FROM "ingestion"."document_categories" c
 WHERE c.id = 'VEHICLE_OWNERSHIP'
   AND NOT EXISTS (SELECT 1 FROM "ingestion"."uploads" u WHERE c.id = ANY(u.categories))
   AND NOT EXISTS (SELECT 1 FROM "ingestion"."document_categories" child WHERE child.parent_id = c.id);
UPDATE "ingestion"."document_categories"
   SET "description" = 'The carta di circolazione (libretto) or the documento unico di circolazione e di proprietà: every field next to its EU code (A, B, C.1, D.1, E, F.1, J, K, P.1, V.7...). Its car data is checked against the car before it is kept.'
 WHERE "id" = 'VEHICLE_REGISTRATION' AND "description" = 'The carta di circolazione (libretto) or the documento unico di circolazione e di proprietà: every field next to its EU code (A, B, C.1, D.1, E, F.1, J, K, P.1, V.7...). Its car data is checked against the car before it is kept. Not the certificato di proprietà of the PRA, which is a document of its own.';
COMMIT;
