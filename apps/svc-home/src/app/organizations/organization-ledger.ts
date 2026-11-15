import {
  compareNames,
  CORE_FIELDS,
  matchName,
  type OrganizationRole,
} from '@life-island/contracts';
import { eq, isNotNull, isNull, and, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  expandCategories,
  organizationKey,
  type ParentOf,
} from '../bills/bill-reader.js';
import {
  categoryTree,
  documents,
  organizations,
  type DocumentRow,
  type OrganizationRow,
} from '../db/schema.js';
import { codesDiffer } from './organization-codes.js';
import { mergeOrganizations } from './organization-merge.js';

type Db = Pick<
  NodePgDatabase,
  'select' | 'insert' | 'update' | 'delete' | 'execute'
>;

/**
 * One sync at a time, across the API and the event consumer. The bill sync
 * takes it too before it adds a company, so two syncs never add the same
 * company twice.
 */
export const ORGANIZATION_LOCK = 'home.organization_ledger';
const LOCK = ORGANIZATION_LOCK;

const ISSUER = CORE_FIELDS.find((f) => f.key === 'issuer');
/** The fields a document prints its issuer in, in order of preference. */
const ISSUER_KEYS = ['issuer', ...(ISSUER?.aliases ?? [])];

/**
 * Documents only your employer issues: their issuer is your employer, also
 * when filed under a subcategory of these.
 */
const EMPLOYER_CATEGORIES = [
  'PAYSLIP',
  'CERTIFICAZIONE_UNICA',
  'EMPLOYMENT_CONTRACT',
];

/** Whether a document's issuer is your employer: it prints it as such, or it is a payslip, CU or employment contract. */
export function issuedByEmployer(
  doc: Pick<DocumentRow, 'fields' | 'categories'>,
  parentOf: ParentOf,
): boolean {
  const employer = doc.fields?.['employer'];
  if (
    issuerOf(doc.fields) &&
    typeof employer === 'string' &&
    employer.trim() === issuerOf(doc.fields)
  )
    return true;
  const all = expandCategories(doc.categories, parentOf);
  return EMPLOYER_CATEGORIES.some((c) => all.has(c));
}

/**
 * A name that says it is a bank: "Banca Widiba", "Banco BPM", "FinecoBank",
 * "BCC di Roma", "Cassa di Risparmio di Asti", "Credito Emiliano", "Poste
 * Italiane - BancoPosta".
 */
const BANK_NAME =
  /\b(banca|banco|bancaria|bancoposta|bank|bcc)\b|bank\b|\bcassa (di risparmio|rurale)|\bcredito (cooperativo|emiliano|valtellinese)/i;

/** Whether a company's name says it is a bank. */
export function looksLikeBank(name: string): boolean {
  return BANK_NAME.test(name);
}

/** Categories of bank statements (estratto conto), however you named them. */
const BANK_STATEMENT_CATEGORY =
  /^(BANK_STATEMENT|BANK_ACCOUNT_STATEMENT|ESTRATTO_CONTO|CONTO_CORRENTE|BANK_ACCOUNT)$/;

/** Whether a document is a statement of your bank account: its issuer is your bank. */
export function issuedByBank(
  doc: Pick<DocumentRow, 'categories'>,
  parentOf: ParentOf,
): boolean {
  return [...expandCategories(doc.categories, parentOf)].some((c) =>
    BANK_STATEMENT_CATEGORY.test(c),
  );
}

/**
 * A name that says it is an insurer: "Generali Italia", "UnipolSai
 * Assicurazioni", "Allianz Direct", "AXA", "Zurich", "Reale Mutua", "Genertel",
 * "Prima Assicurazioni", "Verti", "Quixa", "Groupama", "Helvetia".
 */
const INSURER_NAME =
  /assicura|\b(insurance|assurance|assurances|versicherung)\b|\b(generali|allianz|unipol|unipolsai|axa|zurich|reale mutua|cattolica|groupama|helvetia|genertel|genialloyd|verti|quixa|linear|conte\.it|direct line|itas|hdi|bene assicurazioni)\b/i;

/** Whether a company's name says it is an insurer. */
export function looksLikeInsurer(name: string): boolean {
  return INSURER_NAME.test(name);
}

/** Whether a document is an insurance policy (car, house...): its issuer is the insurer. */
export function issuedByInsurer(
  doc: Pick<DocumentRow, 'categories'>,
  parentOf: ParentOf,
): boolean {
  return [...expandCategories(doc.categories, parentOf)].some((c) =>
    /INSURANCE|POLIZZA|ASSICURAZION/.test(c),
  );
}

/**
 * A name that says it is a public body: a ministry ("Ministero delle
 * Infrastrutture e dei Trasporti", or the misprint "MINISTRO AFFARI
 * ESTERI"), a town, region or province, a prefecture or police HQ, an
 * agency, a court, a health authority, INPS, INAIL, ACI, the Motorizzazione.
 */
const PUBLIC_BODY_NAME =
  /^\s*(ministero|ministro|ministry|comune|citta metropolitana|citt\u00e0 metropolitana|regione|provincia|prefettura|questura|tribunale|procura|consolato|ambasciata)\b|\b(agenzia (delle|del|per|italiana|nazionale)|inps|inail|aci|motorizzazione|presidenza del consiglio|camera di commercio|azienda (sanitaria|ospedaliera)|asl|ats|ulss|ausl|guardia di finanza|carabinieri|polizia (di stato|locale|municipale))\b/i;

/** Whether a company's name says it is a public body. */
export function looksLikePublicBody(name: string): boolean {
  return PUBLIC_BODY_NAME.test(name);
}

/**
 * The roles a document tells about the company that issued it: your
 * employer (payslips), your bank (statements, or a bank's name), your
 * insurer (policies, or an insurer's name), a public body (its name).
 */
function rolesFrom(
  doc: Pick<DocumentRow, 'fields' | 'categories'>,
  issuer: string,
  parentOf: ParentOf,
): OrganizationRole[] {
  const roles: OrganizationRole[] = [];
  if (issuedByEmployer(doc, parentOf)) roles.push('EMPLOYER');
  if (looksLikeBank(issuer) || issuedByBank(doc, parentOf)) roles.push('BANK');
  if (looksLikeInsurer(issuer) || issuedByInsurer(doc, parentOf))
    roles.push('INSURANCE');
  if (looksLikePublicBody(issuer)) roles.push('PUBLIC_BODY');
  return roles;
}

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
  const [rows, docs, tree] = await Promise.all([
    db.select().from(organizations),
    db
      .select({ fields: documents.fields, categories: documents.categories })
      .from(documents)
      .where(and(isNull(documents.deletedAt), isNotNull(documents.fields))),
    db
      .select({ id: categoryTree.id, parentId: categoryTree.parentId })
      .from(categoryTree),
  ]);
  const parentOf: ParentOf = new Map(tree.map((c) => [c.id, c.parentId]));
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
  for (const doc of docs) {
    const { fields } = doc;
    const issuer = issuerOf(fields);
    if (!issuer || !organizationKey(issuer)) continue;
    const roles = rolesFrom(doc, issuer, parentOf);
    const match = matchName(issuer, orgs, namesOf, { prefer: isConfirmed });
    if (match) {
      // Your payslips name your employer, your statements your bank: it is
      // one, like a bill's issuer is a supplier.
      if (looksLikeBank(match.found.name)) roles.push('BANK');
      if (looksLikeInsurer(match.found.name)) roles.push('INSURANCE');
      if (looksLikePublicBody(match.found.name)) roles.push('PUBLIC_BODY');
      const missing = roles.filter((r) => !match.found.roles.includes(r));
      if (missing.length) {
        match.found.roles = [...new Set([...match.found.roles, ...missing])];
        await db
          .update(organizations)
          .set({ roles: match.found.roles })
          .where(eq(organizations.id, match.found.id));
      }
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
        roles,
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
        !codesDiffer(k, org) &&
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
    // Copies read from documents have no images of their own: nothing to delete.
    await mergeOrganizations(db, into.id, org.id, { confirm: false });
    const [fresh] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, into.id));
    Object.assign(into, fresh);
  }
  return kept;
}
