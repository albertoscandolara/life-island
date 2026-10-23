import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServiceDb, type ServiceDb } from './db.js';
import { migrateServiceSchema } from './migrations.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const databaseUrl = process.env['GROCERY_DATABASE_URL'];

function writeMigrations(
  folder: string,
  migrations: { tag: string; when: number; sql: string }[],
) {
  mkdirSync(join(folder, 'meta'), { recursive: true });
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'postgresql',
      entries: migrations.map((m, idx) => ({
        idx,
        version: '7',
        when: m.when,
        tag: m.tag,
        breakpoints: true,
      })),
    }),
  );
  for (const m of migrations)
    writeFileSync(join(folder, `${m.tag}.sql`), m.sql);
}

describe.skipIf(!databaseUrl)('migrateServiceSchema', () => {
  let svc: ServiceDb;
  let folder: string;

  beforeAll(async () => {
    svc = createServiceDb({
      connectionString: databaseUrl as string,
      schema: 'grocery',
    });
    await svc.pool.query(
      'drop table if exists grocery.int_migration_test, grocery.__drizzle_migrations',
    );
    folder = mkdtempSync(join(tmpdir(), 'migrations-'));
  });

  afterAll(async () => {
    await svc.pool.query(
      'drop table if exists grocery.int_migration_test, grocery.__drizzle_migrations',
    );
    await svc.close();
    rmSync(folder, { recursive: true, force: true });
  });

  it('applies pending migrations once, inside the service schema only', async () => {
    writeMigrations(folder, [
      {
        tag: '0000_a',
        when: 1000,
        sql: 'create table grocery.int_migration_test (id int);',
      },
    ]);
    expect(await migrateServiceSchema(svc.pool, 'grocery', folder)).toBe(1);
    expect(await migrateServiceSchema(svc.pool, 'grocery', folder)).toBe(0);

    writeMigrations(folder, [
      {
        tag: '0000_a',
        when: 1000,
        sql: 'create table grocery.int_migration_test (id int);',
      },
      {
        tag: '0001_b',
        when: 2000,
        sql: "alter table grocery.int_migration_test add column name text;\n--> statement-breakpoint\ninsert into grocery.int_migration_test values (1, 'x');",
      },
    ]);
    expect(await migrateServiceSchema(svc.pool, 'grocery', folder)).toBe(1);
    const { rows } = await svc.pool.query(
      'select name from grocery.int_migration_test',
    );
    expect(rows).toEqual([{ name: 'x' }]);
  });

  it('rolls back a failing migration completely', async () => {
    writeMigrations(folder, [
      { tag: '0000_a', when: 1000, sql: 'select 1;' },
      { tag: '0001_b', when: 2000, sql: 'select 1;' },
      {
        tag: '0002_c',
        when: 3000,
        sql: "insert into grocery.int_migration_test values (2, 'y');\n--> statement-breakpoint\nselect * from not_a_table;",
      },
    ]);
    await expect(
      migrateServiceSchema(svc.pool, 'grocery', folder),
    ).rejects.toThrow();
    const { rows } = await svc.pool.query(
      'select count(*)::int as n from grocery.int_migration_test',
    );
    expect(rows[0].n).toBe(1);
  });
});
