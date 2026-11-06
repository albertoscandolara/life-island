import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import {
  PERSON_FIELDS,
  type ApproveReviewRequest,
  type IdDocumentStatus,
  type IdDocumentType,
  type MarkDocumentRequest,
  type PeopleOverviewDto,
  type PendingReviewDto,
  type PersonDto,
  type PersonValues,
  type UpdatePersonRequest,
} from '@life-island/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import { SERVICE_DB } from '../config.js';
import {
  categoryTree,
  documents,
  persons,
  reviews,
  type DecidedChange,
  type DocumentRow,
  type PersonRow,
} from '../db/schema.js';
import {
  buildSeries,
  expiryAlerts,
  idDocumentType,
  isOutdated,
  matchPerson,
  proposeChanges,
  readIdDocument,
  todayIso,
  type ApprovedDocument,
  type IdDocumentReading,
  type ParentOf,
} from './id-documents.js';

interface IdDocument {
  row: DocumentRow;
  type: IdDocumentType | null;
  reading: IdDocumentReading;
}

interface ApprovedIdDocument extends ApprovedDocument {
  doc: IdDocument;
  decidedAt: Date;
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
    const [docs, people, decided] = await Promise.all([
      this.idDocuments(),
      this.svc.db.select().from(persons),
      this.svc.db.select().from(reviews),
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
      });
      approvedOf.set(review.personId, list);
    }

    const peopleDtos: PersonDto[] = people
      .map((person) => {
        const series = buildSeries(approvedOf.get(person.id) ?? [], today);
        return {
          id: person.id,
          ...valuesOf(person),
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
            })),
          })),
          alerts: expiryAlerts(person, series, today),
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
        };
      })
      .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));

    const docOf = new Map(docs.map((d) => [d.row.uploadId, d]));
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

  /**
   * Files the document under a person: an existing one (taking the printed
   * values you accept) or a new one made from everything it prints.
   */
  async approve(uploadId: string, request: ApproveReviewRequest) {
    const doc = await this.idDocument(uploadId);
    const accept = new Set(request.accept ?? []);
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
          const update = Object.fromEntries(
            changes
              .filter((c) => c.decision === 'accepted')
              .map((c) => [c.field, c.proposed]),
          );
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
    try {
      const updated = await this.svc.db
        .update(persons)
        .set({ ...request, updatedAt: new Date() })
        .where(eq(persons.id, id))
        .returning();
      if (!updated.length) throw new NotFoundException('Person not found');
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
