import { compareNames, CORE_FIELDS, matchName } from '@life-island/contracts';
import { eq, isNotNull, isNull, and, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { organizationKey } from '../bills/bill-reader.js';
import {
  documents,
  organizations,
  type DocumentRow,
  type OrganizationRow,
} from '../db/schema.js';
import { mergeOrganizations } from './organization-merge.js';

type Db = Pick<
  NodePgDatabase,
  'select' | 'insert' | 'update' | 'delete' | 'execute'
>;

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
  const [rows, docs] = await Promise.all([
    db.select().from(organizations),
    db
      .select({ fields: documents.fields })
      .from(documents)
      .where(and(isNull(documents.deletedAt), isNotNull(documents.fields))),
  ]);
  for (const org of rows) {
    const key = organizationKey(org.name);
    if (key && key !== org.nameKey) {
      await db
        .update(organizations)
        .set({ nameKey: key })
        .where(eq(organizations.id, org.id));
      org.nameKey = key;
    }
  }
  const orgs = await mergeSameNames(db, rows);

  let added = 0;
  for (const { fields } of docs) {
    const issuer = issuerOf(fields);
    if (!issuer || !organizationKey(issuer)) continue;
    const match = matchName(issuer, orgs, namesOf, { prefer: isConfirmed });
    if (match) {
      // The same company printed a little differently ("Arcoda", "ARKODA
      // srl"): it keeps the new spelling, so its documents find it.
      if (match.how !== 'same' && !namesOf(match.found).includes(issuer)) {
        match.found.aliases = [...match.found.aliases, issuer];
        await db
          .update(organizations)
          .set({ aliases: match.found.aliases })
          .where(eq(organizations.id, match.found.id));
      }
      continue;
    }
    const [row] = await db
      .insert(organizations)
      .values({
        name: issuer,
        nameKey: organizationKey(issuer),
        status: 'PENDING',
        roles: [],
      })
      .returning();
    orgs.push(row);
    added++;
  }
  return added;
}

const namesOf = (o: OrganizationRow): string[] => [o.name, ...o.aliases];
const isConfirmed = (o: OrganizationRow) => o.status === 'CONFIRMED';

/** Which of two copies of a company stays: the confirmed one, the one with a tax code, the older. */
function keeps(a: OrganizationRow, b: OrganizationRow): boolean {
  const rank = (o: OrganizationRow) => [
    o.status === 'CONFIRMED' ? 0 : o.status === 'PENDING' ? 1 : 2,
    o.taxCode ? 0 : 1,
    o.createdAt.getTime(),
  ];
  const [ra, rb] = [rank(a), rank(b)];
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] < rb[i];
  return a.id < b.id;
}

/**
 * Companies whose names differ only in case, accents, punctuation, legal
 * form or spacing ("Arcoda", "ARCODA S.R.L.") are one company: the copies
 * merge into the one that stays. Two different tax codes are two companies,
 * and a dismissed name never absorbs a real one. Names a typo apart are only
 * suggested (see `possibleDuplicates`): that is for you to decide.
 */
async function mergeSameNames(
  db: Db,
  rows: OrganizationRow[],
): Promise<OrganizationRow[]> {
  const order = [...rows].sort((a, b) => (keeps(a, b) ? -1 : 1));
  const kept: OrganizationRow[] = [];
  for (const org of order) {
    const into = kept.find(
      (k) =>
        !(k.taxCode && org.taxCode && k.taxCode !== org.taxCode) &&
        (k.status === 'DISMISSED') === (org.status === 'DISMISSED') &&
        namesOf(k).some((a) =>
          namesOf(org).some((b) => {
            const how = compareNames(a, b);
            return how === 'same' || how === 'compact';
          }),
        ),
    );
    if (!into) {
      kept.push(org);
      continue;
    }
    await mergeOrganizations(db, into.id, org.id, { confirm: false });
    const [fresh] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, into.id));
    Object.assign(into, fresh);
  }
  return kept;
}
