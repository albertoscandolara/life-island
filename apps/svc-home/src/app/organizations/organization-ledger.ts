import { CORE_FIELDS } from '@life-island/contracts';
import { eq, isNotNull, isNull, and, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { organizationKey, organizationKeys } from '../bills/bill-reader.js';
import { documents, organizations, type DocumentRow } from '../db/schema.js';

type Db = Pick<NodePgDatabase, 'select' | 'insert' | 'update' | 'execute'>;

/** One sync at a time, across the API and the event consumer. */
const LOCK = 'home.organization_ledger';

const ISSUER = CORE_FIELDS.find((f) => f.key === 'issuer');
/** The fields a document prints its issuer in, in order of preference. */
const ISSUER_KEYS = ['issuer', ...(ISSUER?.aliases ?? [])];

/** Who issued a document, as printed; null when nothing was read. */
export function issuerOf(fields: DocumentRow['fields']): string | null {
  if (!fields) return null;
  for (const key of ISSUER_KEYS) {
    const value = fields[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Every company a document names becomes an organization: the issuer of an
 * invoice, a receipt, a bank transfer. One that matches a company you have
 * (by its name, or a name it was merged from) is that company; any other is
 * added as PENDING, and waits for you to confirm it, merge it into the one
 * it is, or dismiss it. A dismissed name is never suggested again.
 *
 * Also refreshes the stored keys, so a company found under an older reading
 * of its name is still found. Idempotent; runs inside the caller's
 * transaction.
 */
export async function syncOrganizationsIn(db: Db): Promise<number> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${LOCK}))`);
  const [orgs, docs] = await Promise.all([
    db.select().from(organizations),
    db
      .select({ fields: documents.fields })
      .from(documents)
      .where(and(isNull(documents.deletedAt), isNotNull(documents.fields))),
  ]);
  const known = new Set<string>();
  for (const org of orgs) {
    const key = organizationKey(org.name);
    if (key && key !== org.nameKey)
      await db
        .update(organizations)
        .set({ nameKey: key })
        .where(eq(organizations.id, org.id));
    for (const k of organizationKeys({ ...org, nameKey: key || org.nameKey }))
      known.add(k);
  }

  let added = 0;
  for (const { fields } of docs) {
    const issuer = issuerOf(fields);
    const key = issuer ? organizationKey(issuer) : '';
    if (!issuer || !key || known.has(key)) continue;
    await db
      .insert(organizations)
      .values({ name: issuer, nameKey: key, status: 'PENDING', roles: [] });
    known.add(key);
    added++;
  }
  return added;
}
