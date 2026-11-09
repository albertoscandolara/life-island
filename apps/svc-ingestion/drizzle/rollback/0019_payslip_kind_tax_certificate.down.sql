-- Undoes 0019_payslip_kind_tax_certificate: drops `payslip_kind` from PAYSLIP and
-- the CERTIFICAZIONE_UNICA category, when no document uses it.
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
            WHERE f ->> 'key' <> 'payslip_kind'
         ), '[]'::jsonb)
       )
 WHERE c."id" = 'PAYSLIP';
DELETE FROM "ingestion"."document_categories" c
 WHERE c.id = 'CERTIFICAZIONE_UNICA'
   AND NOT EXISTS (SELECT 1 FROM "ingestion"."uploads" u WHERE c.id = ANY(u.categories))
   AND NOT EXISTS (SELECT 1 FROM "ingestion"."document_categories" child WHERE child.parent_id = c.id);
COMMIT;
