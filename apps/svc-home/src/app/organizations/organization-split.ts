import { compareNames } from '@life-island/contracts';
import { eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { BILL_LOCK, syncBillsIn } from '../bills/bill-ledger.js';
import {
  organizationKey,
  organizationKeys,
  readBillFacts,
} from '../bills/bill-reader.js';
import {
  bills,
  documents,
  organizations,
  supplyPoints,
  type OrganizationRow,
} from '../db/schema.js';
import {
  ORGANIZATION_LOCK,
  syncOrganizationsIn,
} from './organization-ledger.js';

type Db = Pick<
  NodePgDatabase,
  'select' | 'insert' | 'update' | 'delete' | 'execute'
>;

/** Why a name cannot be split off a company. */
export class SplitError extends Error {
  constructor(
    message: string,
    readonly reason: 'not-found' | 'not-an-alias' | 'reads-the-same' | 'into',
  ) {
    super(message);
  }
}

/**
 * Undoes a merge, or a name read as the wrong company: `name`, one of the
 * names company `id` is also printed as, stops being its name. It goes to
 * the company `intoId` (as one of its names), or to the company already
 * called that, or to a new confirmed company of that name. Everything
 * printed with that name follows it: the documents, the bills (and their
 * contracts), the supply points it distributes, and the tax codes those
 * bills print, which a merge had kept as this company's.
 *
 * Runs inside the caller's transaction; both syncs run again at the end.
 * Returns the id of the company that now has the name.
 */
export async function splitOrganization(
  db: Db,
  id: string,
  name: string,
  intoId: string | null = null,
): Promise<string> {
  // The syncs' locks, in their order: no sync runs halfway through this.
  for (const lock of [BILL_LOCK, ORGANIZATION_LOCK])
    await db.execute(sql`select pg_advisory_xact_lock(hashtext(${lock}))`);

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, id));
  if (!org) throw new SplitError(`Organization ${id} not found`, 'not-found');
  const key = organizationKey(name);
  const alias = org.aliases.find((a) => organizationKey(a) === key);
  if (!key || !alias || key === organizationKey(org.name))
    throw new SplitError(
      `"${name}" is not one of the names this company is also printed as`,
      'not-an-alias',
    );
  const kept = org.aliases.filter((a) => organizationKey(a) !== key);
  // A name that reads the same as one it keeps would be joined again by the
  // next sync ("BancaWidiba" and "Banca Widiba"): it cannot go alone.
  if (
    [org.name, ...kept].some((n) => {
      const how = compareNames(n, alias);
      return how === 'same' || how === 'compact';
    })
  )
    throw new SplitError(
      `"${alias}" reads the same as another name of this company: rename it instead`,
      'reads-the-same',
    );

  let into: OrganizationRow | undefined;
  if (intoId) {
    if (intoId === id)
      throw new SplitError('The name is already this company’s', 'into');
    [into] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, intoId));
    if (!into) throw new SplitError(`Organization ${intoId} not found`, 'into');
  } else {
    const others = await db
      .select()
      .from(organizations)
      .where(ne(organizations.id, id));
    into = others.find(
      (o) => o.status !== 'DISMISSED' && organizationKeys(o).includes(key),
    );
  }

  // The bills of this company, with what they print.
  const mine = await db
    .select({
      utility: bills.utility,
      supplierId: bills.supplierId,
      supplyPointId: bills.supplyPointId,
      fields: documents.fields,
    })
    .from(bills)
    .innerJoin(documents, eq(documents.uploadId, bills.uploadId))
    .where(isNull(documents.deletedAt));
  const points = await db
    .select({ id: supplyPoints.id })
    .from(supplyPoints)
    .where(eq(supplyPoints.distributorId, id));
  const distributed = new Set(points.map((p) => p.id));
  const printedBy = { split: new Set<string>(), kept: new Set<string>() };
  const freed = new Set<string>();
  for (const bill of mine) {
    const facts = readBillFacts(bill.fields ?? {}, bill.utility);
    if (bill.supplierId === id) {
      const theirs =
        !!facts.supplierName && organizationKey(facts.supplierName) === key;
      for (const code of facts.supplierCodes)
        printedBy[theirs ? 'split' : 'kept'].add(code);
    }
    if (
      bill.supplyPointId &&
      distributed.has(bill.supplyPointId) &&
      facts.distributorName &&
      organizationKey(facts.distributorName) === key
    )
      freed.add(bill.supplyPointId);
  }
  // The codes only the bills printing that name print go with it.
  const codes = [...printedBy.split].filter((c) => !printedBy.kept.has(c));
  const gone = (code: string | null) =>
    code !== null && codes.includes(code) ? null : code;

  await db
    .update(organizations)
    .set({
      aliases: kept,
      taxCode: gone(org.taxCode),
      vatNumber: gone(org.vatNumber),
      mergedCodes: org.mergedCodes.filter((c) => !codes.includes(c)),
    })
    .where(eq(organizations.id, id));
  // Its supply points find their distributor again on the bill sync.
  if (freed.size)
    await db
      .update(supplyPoints)
      .set({ distributorId: null })
      .where(inArray(supplyPoints.id, [...freed]));

  let targetId: string;
  if (into) {
    const intoKeys = organizationKeys(into);
    const [taxCode, ...rest] = into.taxCode ? [into.taxCode, ...codes] : codes;
    await db
      .update(organizations)
      .set({
        aliases: intoKeys.includes(key)
          ? into.aliases
          : [...into.aliases, alias],
        taxCode: taxCode ?? null,
        mergedCodes: [...new Set([...into.mergedCodes, ...rest])].filter(
          (c) => c !== taxCode && c !== into?.vatNumber,
        ),
        status: into.status === 'DISMISSED' ? into.status : 'CONFIRMED',
      })
      .where(eq(organizations.id, into.id));
    targetId = into.id;
  } else {
    const [taxCode, ...rest] = codes;
    const [row] = await db
      .insert(organizations)
      .values({
        name: alias,
        nameKey: key,
        taxCode: taxCode ?? null,
        mergedCodes: rest,
        status: 'CONFIRMED',
      })
      .returning();
    targetId = row.id;
  }

  // Bills, contracts and supply points find their company again, and the
  // documents' roles go to the company that issued them.
  await syncBillsIn(db);
  await syncOrganizationsIn(db);
  return targetId;
}
