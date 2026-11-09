-- Undoes 0018_evaluation_scores: drops the fields it added to PERFORMANCE_REVIEW
-- and the EVALUATION_RULES category, when no document uses it.
-- Run it by hand as ingestion_svc, then delete the last row of
-- ingestion.__drizzle_migrations.
BEGIN;
UPDATE "ingestion"."document_categories" c
   SET "template_json" = jsonb_set(
         c."template_json",
         '{fields}',
         coalesce((
           SELECT jsonb_agg(f ORDER BY n)
             FROM jsonb_array_elements(c."template_json" -> 'fields') WITH ORDINALITY AS t(f, n)
            WHERE f ->> 'key' NOT IN ('review_cycle', 'role', 'team', 'overall_score', 'max_score',
                                      'section_scores', 'criteria_scores', 'payout_percent',
                                      'bonus_target', 'comments')
         ), '[]'::jsonb)
       )
 WHERE c."id" = 'PERFORMANCE_REVIEW';
DELETE FROM "ingestion"."document_categories" c
 WHERE c.id = 'EVALUATION_RULES'
   AND NOT EXISTS (SELECT 1 FROM "ingestion"."uploads" u WHERE c.id = ANY(u.categories))
   AND NOT EXISTS (SELECT 1 FROM "ingestion"."document_categories" child WHERE child.parent_id = c.id);
COMMIT;
