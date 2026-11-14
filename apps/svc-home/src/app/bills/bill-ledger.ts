import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import {
  matchName,
  UTILITIES,
  UTILITY_KINDS,
  type OrganizationRole,
} from '@life-island/contracts';
import { randomUUID } from 'node:crypto';
import {
  and,
  arrayOverlaps,
  eq,
  inArray,
  isNull,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { SERVICE_DB } from '../config.js';
import { syncOrganizationsIn } from '../organizations/organization-ledger.js';
import {
  billOverrides,
  bills,
  categoryTree,
  documents,
  organizations,
  properties,
  supplyContracts,
  supplyPoints,
  type BillRow,
  type OrganizationRow,
  type SupplyContractRow,
  type SupplyPointRow,
} from '../db/schema.js';
import {
  normalizeCode,
  organizationKey,
  organizationKeys,
  readBill,
  readBillFacts,
  withAncestors,
  type ParentOf,
} from './bill-reader.js';

type Db = Pick<
  NodePgDatabase,
  'select' | 'insert' | 'update' | 'delete' | 'execute'
>;

const BILL_ROOTS = [
  'BILL',
  ...UTILITY_KINDS.map((k) => UTILITIES[k].categoryId),
];

/** One sync at a time, across the API and the event consumer. */
const LOCK = 'home.bill_ledger';

/** The hierarchy, and every category that is a bill or sits under one. */
export async function billCategories(db: Db): Promise<{
  parentOf: ParentOf;
  billCategories: string[];
}> {
  // Deleted categories stay as tombstones and still link old documents up.
  const rows = await db
    .select({ id: categoryTree.id, parentId: categoryTree.parentId })
    .from(categoryTree);
  const parentOf = new Map(rows.map((row) => [row.id, row.parentId]));
  const all = new Set(BILL_ROOTS);
  for (const row of rows)
    if (withAncestors(row.id, parentOf).some((id) => BILL_ROOTS.includes(id)))
      all.add(row.id);
  return { parentOf, billCategories: [...all] };
}

/** The bill columns a sync writes (all but the id and the time). */
type BillValues = Omit<BillRow, 'id' | 'updatedAt'>;

const sameValues = (row: BillRow, values: BillValues) =>
  (Object.keys(values) as (keyof BillValues)[]).every(
    (key) => row[key] === values[key],
  );

/**
 * Keeps the bill entities in step with your bill documents: every bill of
 * electricity, gas or water becomes a row of `bills`, tied to its supplier
 * (an organization, by tax code or else by name), its supply point (by POD,
 * PDR or water code) and its supply contract (supplier × customer code ×
 * supply point). Idempotent: run it as often as anything changes.
 *
 * A new supply point takes the house its first bill matched; from then on
 * the house belongs to the supply point, and its bills follow it, unless you
 * put a bill on a house by hand. The same invoice uploaded twice (same
 * supplier and number) counts once: the later copies are marked duplicates.
 *
 * Runs inside the caller's transaction.
 */
export async function syncBillsIn(db: Db): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${LOCK}))`);
  const { parentOf, billCategories: categories } = await billCategories(db);
  const [props, overrides, orgs, points, contracts, existing] =
    await Promise.all([
      db.select().from(properties),
      db.select().from(billOverrides),
      db.select().from(organizations),
      db.select().from(supplyPoints),
      db.select().from(supplyContracts),
      db.select().from(bills),
    ]);
  const overrideOf = new Map(overrides.map((o) => [o.uploadId, o]));
  const withUtility = overrides
    .filter((o) => o.utility !== null)
    .map((o) => o.uploadId);
  const rows = (
    await db
      .select()
      .from(documents)
      .where(
        and(
          isNull(documents.deletedAt),
          or(
            arrayOverlaps(documents.categories, categories),
            withUtility.length
              ? inArray(documents.uploadId, withUtility)
              : undefined,
          ),
        ),
      )
  ).sort(
    (a, b) =>
      a.uploadedAt.getTime() - b.uploadedAt.getTime() ||
      a.uploadId.localeCompare(b.uploadId),
  );

  const orgsByTax = new Map<string, OrganizationRow>();
  const orgsByKey = new Map<string, OrganizationRow>();
  for (const o of orgs) {
    if (o.taxCode) orgsByTax.set(o.taxCode, o);
    // Read every name again: the key may have improved since it was stored.
    for (const key of organizationKeys(o))
      if (!orgsByKey.has(key) || !o.taxCode) orgsByKey.set(key, o);
  }
  const pointByCode = new Map<string, SupplyPointRow>(
    points.map((p) => [p.code, p]),
  );
  const contractByKey = new Map<string, SupplyContractRow>(
    contracts.map((c) => [c.naturalKey, c]),
  );
  const billOf = new Map(existing.map((b) => [b.uploadId, b]));

  /** The organization by tax code, else by name; created when none matches. */
  const organization = async (
    name: string | null,
    taxCode: string | null,
    role: OrganizationRole,
  ): Promise<OrganizationRow | null> => {
    const label = name ?? taxCode;
    if (!label) return null;
    const key = name ? organizationKey(name) : null;
    let org = taxCode ? orgsByTax.get(taxCode) : undefined;
    if (!org && key) {
      const byName = orgsByKey.get(key);
      // A name match is the same company unless both print a different tax code.
      if (byName && (!taxCode || !byName.taxCode)) org = byName;
    }
    if (!org && name) {
      // Printed a little differently ("BancaWidiba", "Elektrosistem").
      const similar = matchName(
        name,
        [...new Set(orgsByKey.values())].filter((o) => !taxCode || !o.taxCode),
        (o) => [o.name, ...o.aliases],
        { prefer: (o) => o.status === 'CONFIRMED' },
      );
      if (similar) org = similar.found;
    }
    if (!org) {
      [org] = await db
        .insert(organizations)
        .values({
          name: label,
          nameKey: key ?? label,
          taxCode,
          roles: [role],
        })
        .returning();
    } else if ((taxCode && !org.taxCode) || !org.roles.includes(role)) {
      [org] = await db
        .update(organizations)
        .set({
          taxCode: org.taxCode ?? taxCode,
          roles: org.roles.includes(role) ? org.roles : [...org.roles, role],
        })
        .where(eq(organizations.id, org.id))
        .returning();
    }
    if (org.taxCode) orgsByTax.set(org.taxCode, org);
    for (const k of organizationKeys(org)) orgsByKey.set(k, org);
    return org;
  };

  const seen = new Set<string>();
  const usedContracts = new Set<string>();
  /** The first bill of each invoice: supplier and invoice number. */
  const invoices = new Map<string, string>();
  for (const row of rows) {
    const override = overrideOf.get(row.uploadId) ?? null;
    const read = readBill(row, props, parentOf, override);
    if (!read) continue;
    const facts = readBillFacts(row.fields ?? {}, read.utility);
    const manual = override?.manualProperty ?? false;

    const supplier = await organization(
      facts.supplierName,
      facts.supplierTaxCode,
      'ENERGY_SUPPLIER',
    );

    let point: SupplyPointRow | null = null;
    if (facts.supplyPointCode) {
      const distributor = await organization(
        facts.distributorName,
        null,
        'DISTRIBUTOR',
      );
      const house = manual ? (override?.propertyId ?? null) : read.propertyId;
      point = pointByCode.get(facts.supplyPointCode) ?? null;
      if (!point) {
        [point] = await db
          .insert(supplyPoints)
          .values({
            utility: read.utility,
            code: facts.supplyPointCode,
            propertyId: house,
            distributorId: distributor?.id ?? null,
          })
          .returning();
      } else if (
        (!point.propertyId && house) ||
        (!point.distributorId && distributor)
      ) {
        [point] = await db
          .update(supplyPoints)
          .set({
            propertyId: point.propertyId ?? house,
            distributorId: point.distributorId ?? distributor?.id ?? null,
          })
          .where(eq(supplyPoints.id, point.id))
          .returning();
      }
      pointByCode.set(point.code, point);
    }

    let contract: SupplyContractRow | null = null;
    if (supplier && (point || facts.customerCode)) {
      const naturalKey = [
        supplier.id,
        facts.customerCode ? normalizeCode(facts.customerCode) : '',
        point?.id ?? '',
      ].join('|');
      contract = contractByKey.get(naturalKey) ?? null;
      if (!contract && point) {
        // A bill that does not print the customer code is under the contract
        // its supplier has on that supply point; one that prints it names the
        // contract a code-less bill opened.
        const same = [...contractByKey.values()].filter(
          (c) => c.supplierId === supplier.id && c.supplyPointId === point.id,
        );
        const match = facts.customerCode
          ? same.find((c) => c.customerCode === null)
          : (same.find((c) => usedContracts.has(c.id)) ?? same[0]);
        if (match && facts.customerCode) {
          contractByKey.delete(match.naturalKey);
          [contract] = await db
            .update(supplyContracts)
            .set({ customerCode: facts.customerCode, naturalKey })
            .where(eq(supplyContracts.id, match.id))
            .returning();
        } else if (match) contract = match;
      }
      if (!contract) {
        [contract] = await db
          .insert(supplyContracts)
          .values({
            naturalKey,
            supplierId: supplier.id,
            supplyPointId: point?.id ?? null,
            customerCode: facts.customerCode,
            offerName: facts.offerName,
          })
          .returning();
      } else if (facts.offerName && facts.offerName !== contract.offerName) {
        // Bills come oldest first: the newest bill's offer stays.
        [contract] = await db
          .update(supplyContracts)
          .set({ offerName: facts.offerName })
          .where(eq(supplyContracts.id, contract.id))
          .returning();
      }
      contractByKey.set(naturalKey, contract);
      usedContracts.add(contract.id);
    }

    const current = billOf.get(row.uploadId);
    const id = current?.id ?? randomUUID();
    let duplicateOf: string | null = null;
    if (facts.invoiceNumber) {
      const invoice = `${supplier?.id ?? ''}|${normalizeCode(facts.invoiceNumber)}`;
      duplicateOf = invoices.get(invoice) ?? null;
      if (!duplicateOf) invoices.set(invoice, id);
    }

    const values: BillValues = {
      uploadId: row.uploadId,
      title: read.title,
      utility: read.utility,
      utilityOverridden: read.utilityOverridden,
      supplierId: supplier?.id ?? null,
      supplyPointId: point?.id ?? null,
      contractId: contract?.id ?? null,
      // With a supply point the house is read through it, never copied.
      propertyId: manual || !point ? read.propertyId : null,
      manualProperty: manual,
      assignment: manual || !point ? read.assignment : null,
      invoiceNumber: facts.invoiceNumber,
      duplicateOf,
      issueDate: read.issueDate,
      dueDate: read.dueDate,
      periodStart: read.periodStart,
      periodEnd: read.periodEnd,
      amount: read.amount,
      totalDue: facts.totalDue,
      currency: read.currency,
      consumption: read.consumption,
      unit: read.unit,
      provider: read.provider,
      customerId: read.customerId,
    };
    seen.add(row.uploadId);
    if (!current) await db.insert(bills).values({ id, ...values });
    else if (!sameValues(current, values))
      await db
        .update(bills)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(bills.id, id));
  }

  // A customer code names a supply contract, never a house: one that reached
  // a house's supply codes (from an older review or a bill put there by hand)
  // leaves it. A POD, PDR or water code stays.
  const contractCodes = new Set(
    [...contractByKey.values()]
      .map((c) => (c.customerCode ? normalizeCode(c.customerCode) : null))
      .filter((code): code is string => !!code && !pointByCode.has(code)),
  );
  if (contractCodes.size)
    for (const house of props) {
      const kept = house.supplyCodes.filter(
        (code) => !contractCodes.has(normalizeCode(code)),
      );
      if (kept.length !== house.supplyCodes.length)
        await db
          .update(properties)
          .set({ supplyCodes: kept })
          .where(eq(properties.id, house.id));
    }

  // A document no longer a bill (deleted, excluded, recategorised) leaves.
  const gone = existing.filter((b) => !seen.has(b.uploadId)).map((b) => b.id);
  if (gone.length) await db.delete(bills).where(inArray(bills.id, gone));
  // A contract no bill speaks of any more goes too; supply points stay with their house.
  await db
    .delete(supplyContracts)
    .where(
      usedContracts.size
        ? notInArray(supplyContracts.id, [...usedContracts])
        : undefined,
    );
}

/** The API's handle on the ledger: syncs in its own transaction, and once at start. */
@Injectable()
export class BillLedger implements OnApplicationBootstrap {
  private readonly logger = new Logger(BillLedger.name);

  constructor(@Inject(SERVICE_DB) private readonly svc: ServiceDb) {}

  async onApplicationBootstrap(): Promise<void> {
    // Bills read before this module stored them, and any event missed.
    try {
      await this.sync();
    } catch (error) {
      this.logger.error(`Bill sync at start failed: ${String(error)}`);
    }
  }

  sync(): Promise<void> {
    return this.svc.db.transaction(async (tx) => {
      await syncBillsIn(tx);
      await syncOrganizationsIn(tx);
    });
  }
}
