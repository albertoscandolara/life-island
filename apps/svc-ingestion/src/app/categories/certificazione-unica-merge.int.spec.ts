import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['INGESTION_DATABASE_URL'];

const MIGRATION = readFileSync(
  fileURLToPath(
    new URL(
      '../../../drizzle/0026_merge_certificazione_unica.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

const CU_UPLOAD = '0c0c0c0c-0026-4000-8000-000000000001';
const OTHER_UPLOAD = '0c0c0c0c-0026-4000-8000-000000000002';

/**
 * Migration 0026 on the database as 0019 left it when a category of your own
 * already had the title "Certificazione Unica". Everything runs in one
 * transaction that is rolled back, so the shared database is left as it was.
 */
describe.skipIf(!configured)(
  'migration 0026: merge Certificazione Unica',
  () => {
    let pool: pg.Pool;
    let client: pg.PoolClient;

    beforeAll(() => {
      pool = new pg.Pool({
        connectionString: process.env['INGESTION_DATABASE_URL'],
      });
    });

    afterAll(async () => {
      await pool.end();
    });

    beforeEach(async () => {
      client = await pool.connect();
      await client.query('begin');
      // As 0019 left it: no CERTIFICAZIONE_UNICA, your own CU instead.
      await client.query(
        `update ingestion.document_categories set parent_id = null
        where parent_id = 'CERTIFICAZIONE_UNICA'`,
      );
      await client.query(
        `delete from ingestion.document_categories where id = 'CERTIFICAZIONE_UNICA'`,
      );
    });

    afterEach(async () => {
      await client.query('rollback');
      client.release();
    });

    const run = () => client.query(MIGRATION);

    it('moves the documents of the clashing category to CERTIFICAZIONE_UNICA and reads their fields again', async () => {
      await client.query(
        `insert into ingestion.document_categories
         (id, title, description, template_json, taxonomy_version)
       values ('T0026_CU', 'certificazione unica', 'Mine',
               '{"fields": [{"key": "my_note", "label": "Note", "type": "string", "description": "", "required": false},
                            {"key": "income_year", "label": "Year", "type": "string", "description": "", "required": false}]}',
               17),
              ('T0026_CU_CHILD', 'T0026 CU child', 'Child', '{"fields": []}', 0)`,
      );
      await client.query(
        `update ingestion.document_categories set parent_id = 'T0026_CU' where id = 'T0026_CU_CHILD'`,
      );
      await client.query(
        `insert into ingestion.uploads
         (id, title, original_filename, storage_key, status, file_format,
          categories, completed_steps, rejected_categories, extracted_fields,
          historical_suggestions)
       values ($1, 'CU 2024', 'cu.pdf', 't0026/cu', 'PARSED', 'PDF',
               '{T0026_CU}', '{CLASSIFY,DISCOVER,EXTRACT}', '{}',
               '{"fields": {"tax_year": {"value": 2023}}}',
               '[{"categoryId": "T0026_CU", "evidence": "CU", "confidence": 0.9}]'),
              ($2, 'Other', 'other.pdf', 't0026/other', 'PARSED', 'PDF',
               '{}', '{CLASSIFY,DISCOVER,EXTRACT}', '{T0026_CU}', null, '[]')`,
        [CU_UPLOAD, OTHER_UPLOAD],
      );

      await run();

      const { rows: categories } = await client.query<{
        id: string;
        parent_id: string | null;
        dimension: string | null;
        taxonomy_version: number;
        keys: string[];
      }>(
        `select id, parent_id, dimension, taxonomy_version,
              array(select f ->> 'key' from jsonb_array_elements(template_json -> 'fields') f) as keys
         from ingestion.document_categories
        where id in ('CERTIFICAZIONE_UNICA', 'T0026_CU', 'T0026_CU_CHILD')
        order by id`,
      );
      expect(categories.map((c) => c.id)).toEqual([
        'CERTIFICAZIONE_UNICA',
        'T0026_CU_CHILD',
      ]);
      const [cu, child] = categories;
      expect(cu).toMatchObject({
        parent_id: null,
        dimension: 'DOCUMENT_TYPE',
        taxonomy_version: 17,
      });
      // The CU template first, then your own fields it does not have.
      expect(cu.keys).toContain('net_tax');
      expect(cu.keys.at(-1)).toBe('my_note');
      expect(cu.keys.filter((k) => k === 'income_year')).toHaveLength(1);
      expect(child.parent_id).toBe('CERTIFICAZIONE_UNICA');

      const { rows: uploads } = await client.query(
        `select id, status, categories, completed_steps, rejected_categories,
              historical_suggestions -> 0 ->> 'categoryId' as historical
         from ingestion.uploads where id = any($1::uuid[]) order by id`,
        [[CU_UPLOAD, OTHER_UPLOAD]],
      );
      expect(uploads[0]).toMatchObject({
        status: 'TO_BE_PARSED',
        categories: ['CERTIFICAZIONE_UNICA'],
        completed_steps: ['CLASSIFY', 'DISCOVER'],
        historical: 'CERTIFICAZIONE_UNICA',
      });
      expect(uploads[1]).toMatchObject({
        status: 'PARSED',
        rejected_categories: ['CERTIFICAZIONE_UNICA'],
      });

      const { rows: events } = await client.query<{
        event_type: string;
        payload: Record<string, unknown>;
      }>(
        `select event_type, payload from ingestion.outbox
        where created_at = now() -- this transaction's
          and (payload ->> 'id' in ('CERTIFICAZIONE_UNICA', 'T0026_CU', 'T0026_CU_CHILD')
               or payload ->> 'uploadId' = $1)`,
        [CU_UPLOAD],
      );
      const summary = events.map((e) =>
        e.event_type === 'upload.updated@1'
          ? `upload ${(e.payload['categories'] as string[]).join(',')}`
          : `${e.payload['id']}${e.payload['deleted'] ? ' deleted' : ''}`,
      );
      expect(summary.sort()).toEqual([
        'CERTIFICAZIONE_UNICA',
        'T0026_CU deleted',
        'T0026_CU_CHILD',
        'upload CERTIFICAZIONE_UNICA',
      ]);
    });

    it('adds CERTIFICAZIONE_UNICA when nothing clashes, and then changes nothing', async () => {
      await run();
      await run();
      const { rows } = await client.query<{ n: number }>(
        `select count(*)::int as n from ingestion.document_categories
        where id = 'CERTIFICAZIONE_UNICA'
          and template_json -> 'fields' @> '[{"key": "income_year"}]'`,
      );
      expect(rows[0].n).toBe(1);
    });
  },
);
