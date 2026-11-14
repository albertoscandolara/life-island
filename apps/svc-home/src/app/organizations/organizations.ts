import type {
  OrganizationDetailDto,
  OrganizationDocumentDto,
  OrganizationDto,
  OrganizationHouseDto,
  UtilityKind,
} from '@life-island/contracts';
import { sameName, UTILITIES } from '@life-island/contracts';
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
  const duplicates = possibleDuplicates(orgs);
  return orgs
    .map((o) => ({
      ...toDto(o, countOf.get(o.id) ?? 0, docCount.get(o.id) ?? 0),
      possibleDuplicates: duplicates.get(o.id) ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * For each company, the others whose name (or a name it was printed as) is
 * close enough to be the same company: a typo or two apart. Never two with
 * different tax codes, and never a dismissed one.
 */
export function possibleDuplicates(
  orgs: readonly OrganizationRow[],
): Map<string, { id: string; name: string }[]> {
  const live = orgs.filter((o) => o.status !== 'DISMISSED');
  const found = new Map<string, { id: string; name: string }[]>();
  for (const a of live)
    for (const b of live) {
      if (a.id === b.id) continue;
      if (a.taxCode && b.taxCode && a.taxCode !== b.taxCode) continue;
      const close = [a.name, ...a.aliases].some((x) =>
        [b.name, ...b.aliases].some((y) => sameName(x, y)),
      );
      if (close)
        found.set(a.id, [
          ...(found.get(a.id) ?? []),
          { id: b.id, name: b.name },
        ]);
    }
  return found;
}

function toDto(
  o: OrganizationRow,
  billCount: number,
  documentCount: number,
): Omit<OrganizationDto, 'possibleDuplicates'> {
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
