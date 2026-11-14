import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { organizationKey } from '../bills/bill-reader.js';
import {
  bills,
  organizations,
  supplyContracts,
  supplyPoints,
} from '../db/schema.js';

type Db = Pick<NodePgDatabase, 'select' | 'update' | 'delete'>;

/**
 * Moves everything of `fromId` to `intoId`: bills, supply contracts (joining
 * the contract the target already has for the same customer code and supply
 * point), supply points it distributes. Its name, aliases and missing tax
 * data go to the target, and it is removed. Runs inside a transaction.
 */
export async function mergeOrganizations(
  db: Db,
  intoId: string,
  fromId: string,
  options: { confirm?: boolean } = {},
): Promise<void> {
  const [[into], [from]] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, intoId)),
    db.select().from(organizations).where(eq(organizations.id, fromId)),
  ]);
  if (!into || !from) throw new Error('not found');

  const targetContracts = await db
    .select()
    .from(supplyContracts)
    .where(eq(supplyContracts.supplierId, intoId));
  const targetByKey = new Map(targetContracts.map((c) => [c.naturalKey, c]));
  const moved = await db
    .select()
    .from(supplyContracts)
    .where(eq(supplyContracts.supplierId, fromId));
  for (const contract of moved) {
    const naturalKey = [
      intoId,
      ...contract.naturalKey.split('|').slice(1),
    ].join('|');
    const same = targetByKey.get(naturalKey);
    if (same) {
      await db
        .update(bills)
        .set({ contractId: same.id })
        .where(eq(bills.contractId, contract.id));
      await db
        .delete(supplyContracts)
        .where(eq(supplyContracts.id, contract.id));
    } else {
      await db
        .update(supplyContracts)
        .set({ supplierId: intoId, naturalKey })
        .where(eq(supplyContracts.id, contract.id));
    }
  }
  await db
    .update(bills)
    .set({ supplierId: intoId })
    .where(eq(bills.supplierId, fromId));
  await db
    .update(supplyPoints)
    .set({ distributorId: intoId })
    .where(eq(supplyPoints.distributorId, fromId));

  const aliases = [
    ...new Set([...into.aliases, from.name, ...from.aliases]),
  ].filter((a) => organizationKey(a) !== organizationKey(into.name));
  // The tax code is unique: free it before the target takes it.
  await db.delete(organizations).where(eq(organizations.id, fromId));
  await db
    .update(organizations)
    .set({
      aliases,
      taxCode: into.taxCode ?? from.taxCode,
      vatNumber: into.vatNumber ?? from.vatNumber,
      roles: [...new Set([...into.roles, ...from.roles])],
      // Your merge says what the company is: it is confirmed. An automatic
      // one (the same name printed differently) keeps the status it had.
      status:
        options.confirm === false
          ? into.status === 'CONFIRMED' || from.status === 'CONFIRMED'
            ? 'CONFIRMED'
            : into.status
          : 'CONFIRMED',
    })
    .where(eq(organizations.id, intoId));
}
