import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import {
  identifiesSomeone,
  PERSON_FIELDS,
  type ApproveReviewRequest,
  type IdDocumentStatus,
  type IdDocumentType,
  type MarkDocumentRequest,
  type MergePeopleRequest,
  type PeopleAttentionDto,
  type PeopleOverviewDto,
  type PendingReviewDto,
  type PersonDto,
  type PersonSummaryDto,
  type PersonValues,
  type RelationDto,
  type SetRelationRequest,
  type UpdatePersonRequest,
} from '@life-island/contracts';
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { SERVICE_DB } from '../config.js';
import {
  categoryTree,
  documents,
  persons,
  relations,
  reviews,
  type DecidedChange,
  type DocumentRow,
  type PersonRow,
  type RelationRow,
} from '../db/schema.js';
import {
  ageOn,
  buildSeries,
  expiryAlerts,
  idDocumentType,
  isOutdated,
  licenceSummary,
  matchPerson,
  mergedValues,
  personNotices,
  proposeChanges,
  readIdDocument,
  todayIso,
  type IdDocumentReading,
  type NoticeDocument,
  type ParentOf,
} from './id-documents.js';
import { checkTaxCode } from './tax-code.js';

interface IdDocument {
  row: DocumentRow;
  type: IdDocumentType | null;
  reading: IdDocumentReading;
}

interface ApprovedIdDocument extends NoticeDocument {
  doc: IdDocument;
  decidedAt: Date;
}

/** What the other person is to `personId`, from a stored pair. */
export function relationOf(
  row: Pick<RelationRow, 'personId' | 'relatedId' | 'kind'>,
  personId: string,
): RelationDto | null {
  if (row.personId === personId)
    return {
      personId: row.relatedId,
      kind: row.kind === 'parent' ? 'child' : row.kind,
    };
  if (row.relatedId === personId)
    return { personId: row.personId, kind: row.kind };
  return null;
}

/** How a relation is stored: once per pair, a parent always first. */
export function storedRelation(
  personId: string,
  request: SetRelationRequest,
): Pick<RelationRow, 'personId' | 'relatedId' | 'kind'> {
  const other = request.personId;
  if (request.kind === 'parent')
    return { personId: other, relatedId: personId, kind: 'parent' };
  if (request.kind === 'child')
    return { personId, relatedId: other, kind: 'parent' };
  const [a, b] = [personId, other].sort();
  return { personId: a, relatedId: b, kind: request.kind };
}

const UNIQUE_VIOLATION = '23505';

function valuesOf(row: PersonRow): PersonValues {
  return Object.fromEntries(
    PERSON_FIELDS.map((field) => [field, row[field]]),
  ) as PersonValues;
}

/**
 * ID documents are read, on every request, from the documents you filed under
 * an ID category; what is stored here is the people and your decisions. A
 * document you have not decided on waits for review, matched to a person and
 * compared with them field by field; nothing changes a person until you
 * approve it.
 */
@Injectable()
export class PeopleService {
  constructor(@Inject(SERVICE_DB) private readonly svc: ServiceDb) {}

  async overview(today = todayIso()): Promise<PeopleOverviewDto> {
    const [docs, people, decided, pairs] = await Promise.all([
      this.idDocuments(),
      this.svc.db.select().from(persons),
      this.svc.db.select().from(reviews),
      this.svc.db.select().from(relations),
    ]);
    const reviewOf = new Map(decided.map((r) => [r.uploadId, r]));
    const approvedOf = new Map<string, ApprovedIdDocument[]>();
    for (const doc of docs) {
      const review = reviewOf.get(doc.row.uploadId);
      if (review?.status !== 'approved' || !review.personId) continue;
      const list = approvedOf.get(review.personId) ?? [];
      list.push({
        doc,
        decidedAt: review.decidedAt,
        uploadId: doc.row.uploadId,
        type: doc.type,
        issueDate: doc.reading.issueDate,
        expiryDate: doc.reading.expiryDate,
        uploadedAt: doc.row.uploadedAt.toISOString(),
        markedStatus: review.markedStatus as IdDocumentStatus | null,
        categories: doc.reading.details.licenceCategories,
        validForTravel: doc.reading.details.validForTravel,
      });
      approvedOf.set(review.personId, list);
    }
    const docOf = new Map(docs.map((d) => [d.row.uploadId, d]));

    const peopleDtos: PersonDto[] = people
      .map((person) => {
        const series = buildSeries(approvedOf.get(person.id) ?? [], today);
        return {
          id: person.id,
          ...valuesOf(person),
          residencePropertyId: person.residencePropertyId,
          createdAt: person.createdAt.toISOString(),
          updatedAt: person.updatedAt.toISOString(),
          series: series.map(({ type, versions }) => ({
            type,
            versions: versions.map(({ document: d, version, status }) => ({
              uploadId: d.uploadId,
              title: d.doc.row.title,
              type,
              version,
              status,
              documentNumber: d.doc.reading.documentNumber,
              issuer: d.doc.reading.issuer,
              issueDate: d.issueDate,
              expiryDate: d.expiryDate,
              uploadedAt: d.uploadedAt,
              reviewedAt: d.decidedAt.toISOString(),
              details: d.doc.reading.details,
            })),
          })),
          alerts: expiryAlerts(person, series, today),
          taxCodeCheck: checkTaxCode(person),
          age: ageOn(person.birthDate, today),
          relations: pairs.flatMap((row) => relationOf(row, person.id) ?? []),
          taxDependentOf: person.taxDependentOf,
          notices: personNotices(person, series, today),
        };
      })
      .sort((a, b) =>
        `${a.lastName ?? ''} ${a.firstName ?? ''}`.localeCompare(
          `${b.lastName ?? ''} ${b.firstName ?? ''}`,
        ),
      );

    const known = people.map((p) => ({ id: p.id, ...valuesOf(p) }));
    const pending: PendingReviewDto[] = docs
      .filter((doc) => !reviewOf.has(doc.row.uploadId))
      .map((doc) => {
        const { person, match } = matchPerson(doc.reading.holder, known);
        // Who the code is checked against: what is printed, else the person's.
        const holder = doc.reading.holder;
        const checked = {
          taxCode: holder.taxCode,
          lastName: holder.lastName ?? person?.lastName ?? null,
          firstName: holder.firstName ?? person?.firstName ?? null,
          birthDate: holder.birthDate ?? person?.birthDate ?? null,
          sex: holder.sex ?? person?.sex ?? null,
        };
        const outdated = isOutdated(
          doc.reading,
          doc.type,
          person ? (approvedOf.get(person.id) ?? []) : [],
          today,
        );
        return {
          uploadId: doc.row.uploadId,
          title: doc.row.title,
          type: doc.type,
          uploadedAt: doc.row.uploadedAt.toISOString(),
          holder: doc.reading.holder,
          documentNumber: doc.reading.documentNumber,
          issueDate: doc.reading.issueDate,
          expiryDate: doc.reading.expiryDate,
          personId: person?.id ?? null,
          match,
          changes: proposeChanges(doc.reading.holder, person, outdated),
          outdated,
          taxCodeCheck: checkTaxCode(checked),
        };
      })
      .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));

    return {
      people: peopleDtos,
      reviews: pending,
      alerts: peopleDtos
        .flatMap((p) => p.alerts)
        .sort((a, b) => a.daysLeft - b.daysLeft),
      rejected: decided.flatMap((r) => {
        const doc = docOf.get(r.uploadId);
        return r.status === 'rejected' && doc
          ? [
              {
                uploadId: r.uploadId,
                title: doc.row.title,
                type: doc.type,
                decidedAt: r.decidedAt.toISOString(),
              },
            ]
          : [];
      }),
    };
  }

  /** Everyone in short, with their driving licence, for the Houses and Cars areas. */
  async summaries(today = todayIso()): Promise<PersonSummaryDto[]> {
    const { people } = await this.overview(today);
    return people.map((p) => ({
      id: p.id,
      lastName: p.lastName,
      firstName: p.firstName,
      taxCode: p.taxCode,
      residencePropertyId: p.residencePropertyId,
      taxDependentOf: p.taxDependentOf,
      drivingLicence: licenceSummary(
        p.series.map((s) => ({
          type: s.type,
          versions: s.versions.map((v) => ({
            version: v.version,
            status: v.status,
            document: {
              uploadId: v.uploadId,
              type: v.type,
              issueDate: v.issueDate,
              expiryDate: v.expiryDate,
              uploadedAt: v.uploadedAt,
              markedStatus: null,
              categories: v.details.licenceCategories,
            },
          })),
        })),
        today,
      ),
    }));
  }

  /** What needs you, for the island hub's People card. */
  async attention(today = todayIso()): Promise<PeopleAttentionDto> {
    const { alerts, reviews: pending } = await this.overview(today);
    return {
      expired: alerts.filter((a) => a.level === 'expired').length,
      expiring: alerts.filter((a) => a.level === 'expiring').length,
      toReview: pending.length,
    };
  }

  /** Sets how another person is related to this one, replacing what was there. */
  async setRelation(id: string, request: SetRelationRequest): Promise<void> {
    if (request.personId === id)
      throw new UnprocessableEntityException(
        'Pick someone else: a person is not related to themselves',
      );
    await this.svc.db.transaction(async (tx) => {
      const found = await tx
        .select({ id: persons.id })
        .from(persons)
        .where(inArray(persons.id, [id, request.personId]));
      if (found.length !== 2) throw new NotFoundException('Person not found');
      await tx.delete(relations).where(pairOf(id, request.personId));
      await tx.insert(relations).values(storedRelation(id, request));
    });
  }

  async removeRelation(id: string, otherId: string): Promise<void> {
    const deleted = await this.svc.db
      .delete(relations)
      .where(pairOf(id, otherId))
      .returning();
    if (!deleted.length)
      throw new NotFoundException('These two people are not related');
  }

  /**
   * Files the document under a person: an existing one (taking the printed
   * values you accept) or a new one made from everything it prints.
   */
  async approve(uploadId: string, request: ApproveReviewRequest) {
    const doc = await this.idDocument(uploadId);
    const accept = new Set(request.accept ?? []);
    if (request.personId === null && !identifiesSomeone(doc.reading.holder))
      throw new UnprocessableEntityException(
        'Nothing on this document says who it belongs to yet: fill in its name in the documents app, or parse it again, before adding a person',
      );
    try {
      return await this.svc.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(reviews)
          .where(eq(reviews.uploadId, uploadId))
          .for('update');
        if (existing)
          throw new ConflictException('This document was already reviewed');

        const holder = doc.reading.holder;
        let personId: string;
        let changes: DecidedChange[];
        if (request.personId === null) {
          const [created] = await tx
            .insert(persons)
            .values({ ...holder })
            .returning();
          personId = created.id;
          changes = proposeChanges(holder, null, false).map((c) => ({
            field: c.field,
            previous: null,
            proposed: c.proposed,
            decision: 'accepted',
          }));
        } else {
          const [person] = await tx
            .select()
            .from(persons)
            .where(eq(persons.id, request.personId))
            .for('update');
          if (!person) throw new NotFoundException('Person not found');
          personId = person.id;
          changes = proposeChanges(holder, valuesOf(person), false).map(
            (c) => ({
              field: c.field,
              previous: c.current,
              proposed: c.proposed,
              decision: accept.has(c.field) ? 'accepted' : 'kept_current',
            }),
          );
          const update: Record<string, string | null> = Object.fromEntries(
            changes
              .filter((c) => c.decision === 'accepted')
              .map((c) => [c.field, c.proposed]),
          );
          // A printed residence replaces the house you picked.
          if ('residenceAddress' in update)
            update['residencePropertyId'] = null;
          if (Object.keys(update).length)
            await tx
              .update(persons)
              .set({ ...update, updatedAt: new Date() })
              .where(eq(persons.id, personId));
        }
        await tx.insert(reviews).values({
          uploadId,
          status: 'approved',
          personId,
          createdPerson: request.personId === null,
          changes,
        });
        return { personId, changes };
      });
    } catch (error) {
      if (
        (error as { cause?: { code?: string } }).cause?.code ===
          UNIQUE_VIOLATION ||
        (error as { code?: string }).code === UNIQUE_VIOLATION
      )
        throw new ConflictException(
          'Someone else already has this tax code: file the document under that person',
        );
      throw error;
    }
  }

  /** Not anybody's ID document: it stays out of People until you reopen it. */
  async reject(uploadId: string): Promise<void> {
    await this.idDocument(uploadId);
    const inserted = await this.svc.db
      .insert(reviews)
      .values({ uploadId, status: 'rejected' })
      .onConflictDoNothing()
      .returning();
    if (!inserted.length)
      throw new ConflictException('This document was already reviewed');
  }

  /** Puts a rejected document back to review. */
  async reopen(uploadId: string): Promise<void> {
    const deleted = await this.svc.db
      .delete(reviews)
      .where(
        and(eq(reviews.uploadId, uploadId), eq(reviews.status, 'rejected')),
      )
      .returning();
    if (!deleted.length)
      throw new NotFoundException('No rejected document with this id');
  }

  async mark(uploadId: string, request: MarkDocumentRequest): Promise<void> {
    const updated = await this.svc.db
      .update(reviews)
      .set({ markedStatus: request.status })
      .where(
        and(eq(reviews.uploadId, uploadId), eq(reviews.status, 'approved')),
      )
      .returning();
    if (!updated.length)
      throw new NotFoundException('No approved ID document with this id');
  }

  async updatePerson(id: string, request: UpdatePersonRequest): Promise<void> {
    if (request.taxDependentOf === id)
      throw new UnprocessableEntityException(
        'A person cannot be their own fiscal dependent',
      );
    try {
      // A typed residence unlinks the house, unless a house comes with it.
      const residence =
        'residenceAddress' in request && !('residencePropertyId' in request)
          ? { residencePropertyId: null }
          : {};
      await this.svc.db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(persons)
          .where(eq(persons.id, id))
          .for('update');
        if (!before) throw new NotFoundException('Person not found');
        if (request.taxDependentOf) {
          const [other] = await tx
            .select({ taxDependentOf: persons.taxDependentOf })
            .from(persons)
            .where(eq(persons.id, request.taxDependentOf));
          if (!other) throw new NotFoundException('Person not found');
          if (other.taxDependentOf === id)
            throw new UnprocessableEntityException(
              'That person is already a fiscal dependent of this one',
            );
        }
        await tx
          .update(persons)
          .set({ ...request, ...residence, updatedAt: new Date() })
          .where(eq(persons.id, id));
      });
    } catch (error) {
      if (
        (error as { cause?: { code?: string } }).cause?.code ===
          UNIQUE_VIOLATION ||
        (error as { code?: string }).code === UNIQUE_VIOLATION
      )
        throw new ConflictException('Someone else already has this tax code');
      throw error;
    }
  }

  /**
   * Removes a person. Their approved ID documents are not deleted: they go
   * back to review, where you can file them under someone else or reject them.
   */
  async removePerson(id: string): Promise<void> {
    // reviews.person_id cascades: the person's decisions go with them.
    const deleted = await this.svc.db
      .delete(persons)
      .where(eq(persons.id, id))
      .returning({ id: persons.id });
    if (!deleted.length) throw new NotFoundException('Person not found');
  }

  /**
   * Merges a duplicate into this person: every document of the duplicate is
   * filed here, this person keeps their details and takes only the unknown
   * ones from the duplicate, which is then removed.
   */
  async mergePeople(id: string, request: MergePeopleRequest): Promise<void> {
    if (request.from === id)
      throw new UnprocessableEntityException(
        'Pick another person to merge with',
      );
    await this.svc.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(persons)
        .where(inArray(persons.id, [id, request.from]))
        .for('update');
      const into = rows.find((r) => r.id === id);
      const from = rows.find((r) => r.id === request.from);
      if (!into || !from) throw new NotFoundException('Person not found');
      const merged = mergedValues(valuesOf(into), valuesOf(from));
      if ('conflict' in merged)
        throw new ConflictException(
          'These two people have different tax codes, so they are different people. Correct the wrong tax code with Edit first if one of them is a mistake.',
        );
      await tx
        .update(reviews)
        .set({ personId: id })
        .where(eq(reviews.personId, from.id));
      // Whoever depended on the duplicate depends on this person now (never on themselves).
      await tx
        .update(persons)
        .set({ taxDependentOf: id })
        .where(and(eq(persons.taxDependentOf, from.id), ne(persons.id, id)));
      if (into.taxDependentOf === from.id)
        await tx
          .update(persons)
          .set({ taxDependentOf: null })
          .where(eq(persons.id, id));
      // The duplicate's relations move here, unless this person already has one with that person.
      const theirs = await tx
        .select()
        .from(relations)
        .where(
          or(eq(relations.personId, from.id), eq(relations.relatedId, from.id)),
        );
      const mine = await tx
        .select()
        .from(relations)
        .where(or(eq(relations.personId, id), eq(relations.relatedId, id)));
      const known = new Set(
        mine.flatMap((r) => relationOf(r, id)?.personId ?? []),
      );
      for (const row of theirs) {
        const relation = relationOf(row, from.id);
        if (
          !relation ||
          relation.personId === id ||
          known.has(relation.personId)
        )
          continue;
        known.add(relation.personId);
        await tx.insert(relations).values(storedRelation(id, relation));
      }
      // The duplicate goes first: its tax code may move to the person kept.
      await tx.delete(persons).where(eq(persons.id, from.id));
      if (merged.taken.length)
        await tx
          .update(persons)
          .set({
            ...merged.values,
            // The duplicate's residence comes with its house, if it had one.
            ...(merged.taken.includes('residenceAddress')
              ? { residencePropertyId: from.residencePropertyId }
              : {}),
            ...(!into.taxDependentOf && from.taxDependentOf !== id
              ? { taxDependentOf: from.taxDependentOf }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(persons.id, id));
    });
  }

  private async parentOf(): Promise<ParentOf> {
    const rows = await this.svc.db.select().from(categoryTree);
    return new Map(
      rows.filter((c) => !c.deleted).map((c) => [c.id, c.parentId]),
    );
  }

  private async idDocuments(): Promise<IdDocument[]> {
    const [parentOf, rows] = await Promise.all([
      this.parentOf(),
      this.svc.db.select().from(documents).where(isNull(documents.deletedAt)),
    ]);
    return rows.flatMap((row) => {
      const { isId, type } = idDocumentType(row.categories, parentOf);
      return isId ? [{ row, type, reading: readIdDocument(row.fields) }] : [];
    });
  }

  private async idDocument(uploadId: string): Promise<IdDocument> {
    const doc = (await this.idDocuments()).find(
      (d) => d.row.uploadId === uploadId,
    );
    if (!doc) throw new NotFoundException('No ID document with this id');
    return doc;
  }
}

function pairOf(a: string, b: string) {
  return or(
    and(eq(relations.personId, a), eq(relations.relatedId, b)),
    and(eq(relations.personId, b), eq(relations.relatedId, a)),
  );
}
