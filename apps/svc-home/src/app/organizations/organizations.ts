import type {
  OrganizationDetailDto,
  OrganizationDocumentDto,
  OrganizationDto,
  OrganizationHouseDto,
  UtilityKind,
} from '@life-island/contracts';
import { UTILITIES } from '@life-island/contracts';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { organizationKey, organizationKeys } from '../bills/bill-reader.js';
import {
  bills,
  documents,
  organizations,
  properties,
  supplyContracts,
  supplyPoints,
  works,
  type OrganizationRow,
} from '../db/schema.js';
import { issuerOf } from './organization-ledger.js';

type Db = Pick<NodePgDatabase, 'select' | 'insert' | 'update' | 'delete'>;

const DATE_KEYS = [
  'issue_date',
  'document_date',
  'invoice_date',
  'purchase_date',
  'expense_date',
];

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** The documents still on file with the issuer they print, keyed for matching. */
async function issuedDocuments(db: Db) {
  const rows = await db
    .select({
      uploadId: documents.uploadId,
      title: documents.title,
      fields: documents.fields,
      uploadedAt: documents.uploadedAt,
    })
    .from(documents)
    .where(and(isNull(documents.deletedAt), isNotNull(documents.fields)));
  return rows.flatMap((row) => {
    const issuer = issuerOf(row.fields);
    if (!issuer) return [];
    const fields = row.fields ?? {};
    const date =
      DATE_KEYS.map((k) => text(fields[k])).find(
        (d) => d && /^\d{4}-\d{2}-\d{2}/.test(d),
      ) ?? row.uploadedAt.toISOString();
    const amount = Number(fields['total_amount']);
    const doc: OrganizationDocumentDto = {
      uploadId: row.uploadId,
      title: row.title,
      date: date.slice(0, 10),
      amount:
        fields['total_amount'] != null && Number.isFinite(amount)
          ? amount
          : null,
    };
    return [{ key: organizationKey(issuer), doc }];
  });
}

/** Which organization each key finds: the confirmed one first, then the rest. */
function byKey(orgs: readonly OrganizationRow[]): Map<string, OrganizationRow> {
  const map = new Map<string, OrganizationRow>();
  const order = [...orgs].sort(
    (a, b) =>
      Number(b.status === 'CONFIRMED') - Number(a.status === 'CONFIRMED'),
  );
  for (const org of order)
    for (const key of organizationKeys(org))
      if (!map.has(key)) map.set(key, org);
  return map;
}

/** Every organization, with how many bills and documents it issued. */
export async function listOrganizations(db: Db): Promise<OrganizationDto[]> {
  const [orgs, counts, docs] = await Promise.all([
    db.select().from(organizations),
    db
      .select({
        id: bills.supplierId,
        count: sql<number>`count(*)::int`,
      })
      .from(bills)
      .where(sql`${bills.duplicateOf} is null`)
      .groupBy(bills.supplierId),
    issuedDocuments(db),
  ]);
  const countOf = new Map(counts.map((c) => [c.id, c.count]));
  const orgOf = byKey(orgs);
  const docCount = new Map<string, number>();
  for (const { key } of docs) {
    const org = orgOf.get(key);
    if (org) docCount.set(org.id, (docCount.get(org.id) ?? 0) + 1);
  }
  return orgs
    .map((o) => toDto(o, countOf.get(o.id) ?? 0, docCount.get(o.id) ?? 0))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function toDto(
  o: OrganizationRow,
  billCount: number,
  documentCount: number,
): OrganizationDto {
  return {
    id: o.id,
    name: o.name,
    taxCode: o.taxCode,
    vatNumber: o.vatNumber,
    roles: o.roles,
    status: o.status,
    aliases: o.aliases,
    billCount,
    documentCount,
  };
}

/** A company's page: its documents, newest first, and the houses it is tied to. */
export async function organizationDetail(
  db: Db,
  id: string,
): Promise<OrganizationDetailDto | null> {
  const all = await listOrganizations(db);
  const found = all.find((o) => o.id === id);
  if (!found) return null;
  const [orgs, docs, points, contracts, props, contractorWorks] =
    await Promise.all([
      db.select().from(organizations),
      issuedDocuments(db),
      db.select().from(supplyPoints),
      db
        .select()
        .from(supplyContracts)
        .where(eq(supplyContracts.supplierId, id)),
      db.select({ id: properties.id, name: properties.name }).from(properties),
      db
        .select({ propertyId: works.propertyId, contractor: works.contractor })
        .from(works)
        .where(isNotNull(works.contractor)),
    ]);
  const orgOf = byKey(orgs);
  const mine = (key: string) => orgOf.get(key)?.id === id;
  const nameOf = new Map(props.map((p) => [p.id, p.name]));
  const pointOf = new Map(points.map((p) => [p.id, p]));

  const houses = new Map<string, OrganizationHouseDto>();
  const addHouse = (propertyId: string | null, role: string) => {
    const name = propertyId ? nameOf.get(propertyId) : undefined;
    if (!propertyId || !name) return;
    const key = `${propertyId}|${role}`;
    if (!houses.has(key)) houses.set(key, { id: propertyId, name, role });
  };
  const utilityLabel = (utility: UtilityKind) =>
    UTILITIES[utility].label.toLowerCase();
  for (const contract of contracts) {
    const point = contract.supplyPointId
      ? pointOf.get(contract.supplyPointId)
      : undefined;
    if (point)
      addHouse(point.propertyId, `Supplies ${utilityLabel(point.utility)}`);
  }
  for (const point of points)
    if (point.distributorId === id)
      addHouse(point.propertyId, `Distributes ${utilityLabel(point.utility)}`);
  for (const work of contractorWorks)
    if (work.contractor && mine(organizationKey(work.contractor)))
      addHouse(work.propertyId, 'Worked on it');

  return {
    ...found,
    documents: docs
      .filter((d) => mine(d.key))
      .map((d) => d.doc)
      .sort((a, b) => b.date.localeCompare(a.date)),
    houses: [...houses.values()],
  };
}

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
      // Merging into a company says what it is: it is confirmed.
      status: 'CONFIRMED',
    })
    .where(eq(organizations.id, intoId));
}
