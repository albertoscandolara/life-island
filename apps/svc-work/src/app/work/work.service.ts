import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import {
  PLATFORM_STALE_DAYS,
  type ApproveWorkReviewRequest,
  type CareerEventRequest,
  type CareerFeedbackDto,
  type CreateWorkplaceRequest,
  type HiringPlatformDto,
  type HiringPlatformRequest,
  type PendingWorkReviewDto,
  type UpdateWorkplaceRequest,
  type CareerDocumentDto,
  type WorkDocumentType,
  type WorkOverviewDto,
  type WorkplaceDto,
  type WorkplaceField,
  type WorkplaceValue,
} from '@life-island/contracts';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { SERVICE_DB } from '../config.js';
import {
  careerEvents,
  careerFeedback,
  categoryTree,
  documents,
  hiringPlatforms,
  reviews,
  workplaces,
  type CareerFeedbackRow,
  type DecidedWorkplaceChange,
  type DocumentRow,
  type HiringPlatformRow,
  type WorkplaceRow,
} from '../db/schema.js';
import { CareerAdvisor } from './career-advisor.js';
import {
  buildStats,
  buildTimeline,
  documentIdentity,
  monthsBetween,
  type ApprovedWorkDocument,
  type CareerWorkplace,
} from './career.js';
import type { CareerDossierInput } from './career-feedback.js';
import { buildCertificates } from './certificates.js';
import { buildEvaluationStats } from './evaluations.js';
import {
  cleanValue,
  completeValues,
  isOutdated,
  matchWorkplace,
  namesEmployer,
  normalizeName,
  normalizeTaxCode,
  proposeWorkplaceChanges,
  readWorkDocument,
  todayIso,
  workDocumentType,
  type ParentOf,
  type StoredValues,
  type WorkDocumentReading,
} from './work-documents.js';

interface WorkDocument {
  row: DocumentRow;
  type: WorkDocumentType | null;
  reading: WorkDocumentReading;
}

/** Your name for the workplace, else the employer as printed. */
export function workplaceName(
  row: Pick<WorkplaceRow, 'label' | 'values'>,
): string {
  return (
    row.label || (row.values.employerName as string) || 'Unnamed workplace'
  );
}

/**
 * Work documents are read, on every request, from the documents you filed
 * under a work category; what is stored here is the workplaces, your
 * decisions, the events you added, your hiring platforms and the feedback
 * you asked for. A document you have not decided on waits for review,
 * matched to a workplace (by the employer's tax code, else its name) and
 * compared with it field by field; one whose employer you do not have is the
 * suggestion of a new workplace. Nothing changes a workplace until you approve.
 */
@Injectable()
export class WorkService {
  constructor(
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
    @Inject(CareerAdvisor) private readonly advisor: CareerAdvisor,
  ) {}

  async overview(today = todayIso()): Promise<WorkOverviewDto> {
    const [docs, rows, decided, manual, platformRows, feedbackRows] =
      await Promise.all([
        this.workDocuments(),
        this.svc.db.select().from(workplaces),
        this.svc.db.select().from(reviews),
        this.svc.db.select().from(careerEvents),
        this.svc.db.select().from(hiringPlatforms),
        this.svc.db
          .select()
          .from(careerFeedback)
          .orderBy(desc(careerFeedback.createdAt))
          .limit(20),
      ]);
    const career = this.career(
      docs,
      rows,
      decided,
      manual,
      platformRows,
      today,
    );
    const reviewOf = new Map(decided.map((r) => [r.uploadId, r]));
    const docOf = new Map(docs.map((d) => [d.row.uploadId, d]));

    const workplaceDtos: WorkplaceDto[] = rows
      .map((row) => {
        const own = career.approved
          .filter((d) => d.workplaceId === row.id)
          .map((d) => {
            const doc = docOf.get(d.uploadId)!;
            return {
              uploadId: d.uploadId,
              title: d.title,
              type: doc.type,
              period: d.reading.period ?? d.reading.date,
              gross: d.reading.gross,
              net: d.reading.net,
              facts: d.reading.facts,
              uploadedAt: doc.row.uploadedAt.toISOString(),
              reviewedAt: reviewOf.get(d.uploadId)!.decidedAt.toISOString(),
            } satisfies CareerDocumentDto;
          })
          .sort((a, b) => (b.period ?? '').localeCompare(a.period ?? ''));
        const latestPeriod =
          own.find((d) => d.type === 'PAYSLIP')?.period?.slice(0, 7) ?? null;
        const start =
          (row.values.hireDate as string | undefined) ??
          own.filter((d) => d.type === 'PAYSLIP').at(-1)?.period ??
          null;
        const end =
          (row.values.endDate as string | undefined) ??
          (row.status === 'past' ? latestPeriod : null) ??
          today;
        return {
          id: row.id,
          label: row.label,
          status: row.status,
          values: completeValues(row.values),
          notes: row.notes,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          documents: own,
          tenureMonths: start
            ? monthsBetween(start, end < today ? end : today)
            : null,
          latestPeriod,
        };
      })
      .sort(
        (a, b) =>
          Number(a.status !== 'current') - Number(b.status !== 'current') ||
          (b.values.hireDate ?? '')
            .toString()
            .localeCompare((a.values.hireDate ?? '').toString()) ||
          workplaceName(a).localeCompare(workplaceName(b)),
      );

    const known = rows.map((r) => ({ id: r.id, values: r.values }));
    // What you have, to tell a copy: approved documents, then the ones
    // waiting, oldest first (the later copy is the one flagged).
    const have = new Map<string, { uploadId: string; title: string }>();
    for (const d of career.approved) {
      const identity = documentIdentity(d.workplaceId, d.reading);
      if (identity && !have.has(identity.key))
        have.set(identity.key, { uploadId: d.uploadId, title: d.title });
    }
    const waiting = docs
      .filter((doc) => !reviewOf.has(doc.row.uploadId))
      .sort((a, b) => a.row.uploadedAt.getTime() - b.row.uploadedAt.getTime());
    const copyOf = new Map<string, PendingWorkReviewDto['alreadyHave']>();
    for (const doc of waiting) {
      const { workplace } = matchWorkplace(doc.reading, known);
      const workplaceKey =
        workplace?.id ??
        `new:${normalizeTaxCode(doc.reading.employerTaxCode) ?? normalizeName(doc.reading.employerName) ?? ''}`;
      const identity = documentIdentity(workplaceKey, doc.reading);
      if (!identity) continue;
      const earlier = have.get(identity.key);
      if (earlier)
        copyOf.set(doc.row.uploadId, { ...earlier, what: identity.what });
      else
        have.set(identity.key, {
          uploadId: doc.row.uploadId,
          title: doc.row.title,
        });
    }
    const pending: PendingWorkReviewDto[] = waiting
      .map((doc) => {
        const { workplace, match } = matchWorkplace(doc.reading, known);
        const outdated = isOutdated(
          doc.reading,
          workplace
            ? career.approved.filter((d) => d.workplaceId === workplace.id)
            : [],
        );
        return {
          uploadId: doc.row.uploadId,
          title: doc.row.title,
          type: doc.type,
          uploadedAt: doc.row.uploadedAt.toISOString(),
          employerName: doc.reading.employerName,
          employerTaxCode: doc.reading.employerTaxCode,
          facts: doc.reading.facts,
          printed: Object.entries(doc.reading.values).map(([field, value]) => ({
            field: field as WorkplaceField,
            value: value as string | number,
          })),
          workplaceId: workplace?.id ?? null,
          match,
          changes: proposeWorkplaceChanges(
            doc.reading.values,
            workplace?.values ?? null,
            outdated,
          ),
          outdated,
          alreadyHave: copyOf.get(doc.row.uploadId) ?? null,
        };
      })
      .sort(
        (a, b) =>
          (docOf.get(a.uploadId)!.reading.date ?? a.uploadedAt).localeCompare(
            docOf.get(b.uploadId)!.reading.date ?? b.uploadedAt,
          ) || a.uploadedAt.localeCompare(b.uploadedAt),
      );

    return {
      workplaces: workplaceDtos,
      reviews: pending,
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
      timeline: career.timeline,
      stats: career.stats,
      evaluations: buildEvaluationStats(
        career.approved,
        career.workplaces,
        career.stats.years,
      ),
      certificates: buildCertificates(career.workplaces, career.approved),
      platforms: career.platforms,
      feedback: feedbackRows.map(feedbackDto),
      aiFeedback: this.advisor.usesAi,
    };
  }

  /**
   * Files the document under a workplace: an existing one (taking the printed
   * values you accept) or a new one made from everything it prints.
   */
  async approve(uploadId: string, request: ApproveWorkReviewRequest) {
    const doc = await this.workDocument(uploadId);
    const accept = new Set(request.accept ?? []);
    if (request.workplaceId === null && !namesEmployer(doc.reading))
      throw new UnprocessableEntityException(
        'This document names no employer, so it cannot make a new workplace: file it under one of your workplaces, or fill in the employer in the documents app',
      );
    return this.svc.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(reviews)
        .where(eq(reviews.uploadId, uploadId))
        .for('update');
      if (existing)
        throw new ConflictException('This document was already reviewed');

      const printed = doc.reading.values;
      let workplaceId: string;
      let changes: DecidedWorkplaceChange[];
      if (request.workplaceId === null) {
        await this.assertNoOtherWorkplace(
          tx,
          (printed.employerTaxCode as string) ?? null,
          null,
        );
        const [created] = await tx
          .insert(workplaces)
          .values({
            label: request.label ?? null,
            status:
              printed.endDate && printed.endDate < todayIso()
                ? 'past'
                : 'current',
            values: { ...printed },
          })
          .returning();
        workplaceId = created.id;
        changes = proposeWorkplaceChanges(printed, null, false).map((c) => ({
          field: c.field,
          previous: null,
          proposed: c.proposed,
          decision: 'accepted',
        }));
      } else {
        const [workplace] = await tx
          .select()
          .from(workplaces)
          .where(eq(workplaces.id, request.workplaceId))
          .for('update');
        if (!workplace) throw new NotFoundException('Workplace not found');
        workplaceId = workplace.id;
        changes = proposeWorkplaceChanges(printed, workplace.values, false).map(
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
        if (Object.keys(update).length) {
          if ('employerTaxCode' in update)
            await this.assertNoOtherWorkplace(
              tx,
              String(update['employerTaxCode']),
              workplaceId,
            );
          await tx
            .update(workplaces)
            .set({
              values: { ...workplace.values, ...update },
              updatedAt: new Date(),
            })
            .where(eq(workplaces.id, workplaceId));
        }
      }
      await tx.insert(reviews).values({
        uploadId,
        status: 'approved',
        workplaceId,
        createdWorkplace: request.workplaceId === null,
        changes,
      });
      return { workplaceId, changes };
    });
  }

  /** Not about any of your workplaces: it stays out of Work until you reopen it. */
  async reject(uploadId: string): Promise<void> {
    await this.workDocument(uploadId);
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

  /** A workplace added by hand, before any of its documents (or one with none). */
  async createWorkplace(
    request: CreateWorkplaceRequest,
  ): Promise<{ id: string }> {
    const rows = await this.svc.db.select().from(workplaces);
    const name = normalizeName(request.employerName);
    if (
      rows.some(
        (r) =>
          normalizeName((r.values.employerName as string) ?? null) === name,
      )
    )
      throw new ConflictException(
        'You already have a workplace with this employer',
      );
    const [created] = await this.svc.db
      .insert(workplaces)
      .values({
        label: request.label ?? null,
        status: request.status ?? 'current',
        values: { employerName: request.employerName.trim() },
      })
      .returning({ id: workplaces.id });
    return created;
  }

  async updateWorkplace(
    id: string,
    request: UpdateWorkplaceRequest,
  ): Promise<void> {
    await this.svc.db.transaction(async (tx) => {
      const [workplace] = await tx
        .select()
        .from(workplaces)
        .where(eq(workplaces.id, id))
        .for('update');
      if (!workplace) throw new NotFoundException('Workplace not found');
      const values: StoredValues = { ...workplace.values };
      for (const [field, value] of Object.entries(request.values ?? {})) {
        const key = field as WorkplaceField;
        const cleaned: WorkplaceValue = cleanValue(key, value ?? null);
        if (cleaned === null) delete values[key];
        else values[key] = cleaned;
      }
      if (request.values && 'employerTaxCode' in request.values)
        await this.assertNoOtherWorkplace(
          tx,
          (values.employerTaxCode as string) ?? null,
          id,
        );
      await tx
        .update(workplaces)
        .set({
          ...(request.label !== undefined ? { label: request.label } : {}),
          ...(request.status ? { status: request.status } : {}),
          ...(request.notes !== undefined ? { notes: request.notes } : {}),
          values,
          updatedAt: new Date(),
        })
        .where(eq(workplaces.id, id));
    });
  }

  /** Removes the workplace; its documents are not deleted, they go back to review. */
  async removeWorkplace(id: string): Promise<void> {
    // reviews.workplace_id cascades: the workplace's decisions go with it.
    const deleted = await this.svc.db
      .delete(workplaces)
      .where(eq(workplaces.id, id))
      .returning({ id: workplaces.id });
    if (!deleted.length) throw new NotFoundException('Workplace not found');
  }

  // ---- events you add ------------------------------------------------------

  async addEvent(request: CareerEventRequest): Promise<{ id: string }> {
    if (request.workplaceId) await this.assertWorkplace(request.workplaceId);
    const [created] = await this.svc.db
      .insert(careerEvents)
      .values({
        date: request.date,
        kind: request.kind,
        title: request.title,
        detail: request.detail ?? null,
        workplaceId: request.workplaceId ?? null,
        amount: request.amount ?? null,
      })
      .returning({ id: careerEvents.id });
    return created;
  }

  async removeEvent(id: string): Promise<void> {
    const deleted = await this.svc.db
      .delete(careerEvents)
      .where(eq(careerEvents.id, id))
      .returning({ id: careerEvents.id });
    if (!deleted.length)
      throw new NotFoundException('No event you added with this id');
  }

  // ---- hiring platforms ----------------------------------------------------

  async addPlatform(request: HiringPlatformRequest): Promise<{ id: string }> {
    const [created] = await this.svc.db
      .insert(hiringPlatforms)
      .values(platformValues(request))
      .returning({ id: hiringPlatforms.id });
    return created;
  }

  async updatePlatform(
    id: string,
    request: HiringPlatformRequest,
  ): Promise<void> {
    const updated = await this.svc.db
      .update(hiringPlatforms)
      .set(platformValues(request))
      .where(eq(hiringPlatforms.id, id))
      .returning({ id: hiringPlatforms.id });
    if (!updated.length) throw new NotFoundException('Platform not found');
  }

  async removePlatform(id: string): Promise<void> {
    const deleted = await this.svc.db
      .delete(hiringPlatforms)
      .where(eq(hiringPlatforms.id, id))
      .returning({ id: hiringPlatforms.id });
    if (!deleted.length) throw new NotFoundException('Platform not found');
  }

  // ---- career feedback -----------------------------------------------------

  /** Asks for a feedback on your career, from everything you approved; it is kept. */
  async askFeedback(
    question: string | null,
    today = todayIso(),
  ): Promise<CareerFeedbackDto> {
    const [docs, rows, decided, manual, platformRows] = await Promise.all([
      this.workDocuments(),
      this.svc.db.select().from(workplaces),
      this.svc.db.select().from(reviews),
      this.svc.db.select().from(careerEvents),
      this.svc.db.select().from(hiringPlatforms),
    ]);
    const career = this.career(
      docs,
      rows,
      decided,
      manual,
      platformRows,
      today,
    );
    const input: CareerDossierInput = {
      workplaces: career.workplaces,
      documents: career.approved,
      timeline: career.timeline,
      stats: career.stats,
      evaluations: buildEvaluationStats(
        career.approved,
        career.workplaces,
        career.stats.years,
      ),
      platforms: career.platforms,
      today,
    };
    const written = await this.advisor.write(input, question || null);
    const [row] = await this.svc.db
      .insert(careerFeedback)
      .values({
        question: question || null,
        source: written.source,
        model: written.model,
        output: written.output,
        documentsUsed: career.approved.length,
      })
      .returning();
    return feedbackDto(row);
  }

  async removeFeedback(id: string): Promise<void> {
    const deleted = await this.svc.db
      .delete(careerFeedback)
      .where(eq(careerFeedback.id, id))
      .returning({ id: careerFeedback.id });
    if (!deleted.length) throw new NotFoundException('Feedback not found');
  }

  // ---- reading -------------------------------------------------------------

  private career(
    docs: WorkDocument[],
    rows: WorkplaceRow[],
    decided: (typeof reviews.$inferSelect)[],
    manual: (typeof careerEvents.$inferSelect)[],
    platformRows: HiringPlatformRow[],
    today: string,
  ) {
    const docOf = new Map(docs.map((d) => [d.row.uploadId, d]));
    // In the order you approved them: of two copies, the first counts.
    const approved: ApprovedWorkDocument[] = [...decided]
      .sort((a, b) => a.decidedAt.getTime() - b.decidedAt.getTime())
      .flatMap((r) => {
        const doc = docOf.get(r.uploadId);
        return r.status === 'approved' && r.workplaceId && doc
          ? [
              {
                uploadId: r.uploadId,
                title: doc.row.title,
                workplaceId: r.workplaceId,
                reading: doc.reading,
              },
            ]
          : [];
      });
    const careerWorkplaces: CareerWorkplace[] = rows.map((r) => ({
      id: r.id,
      name: workplaceName(r),
      status: r.status,
      values: r.values,
    }));
    const timeline = buildTimeline(
      careerWorkplaces,
      approved,
      manual.map((e) => ({
        id: e.id,
        date: e.date,
        kind: e.kind,
        title: e.title,
        detail: e.detail,
        workplaceId: e.workplaceId,
        amount: e.amount,
      })),
    );
    return {
      approved,
      workplaces: careerWorkplaces,
      timeline,
      stats: buildStats(careerWorkplaces, approved, timeline, today),
      platforms: platformRows
        .map((p) => platformDto(p, today))
        .sort(
          (a, b) =>
            Number(a.status !== 'active') - Number(b.status !== 'active') ||
            a.name.localeCompare(b.name),
        ),
    };
  }

  /** One employer tax code, one workplace. */
  private async assertNoOtherWorkplace(
    tx: Pick<ServiceDb['db'], 'select'>,
    taxCode: string | null,
    except: string | null,
  ): Promise<void> {
    const code = normalizeTaxCode(taxCode);
    if (!code) return;
    const rows = await tx.select().from(workplaces);
    if (
      rows.some(
        (r) =>
          r.id !== except &&
          normalizeTaxCode((r.values.employerTaxCode as string) ?? null) ===
            code,
      )
    )
      throw new ConflictException(
        'Another of your workplaces has this employer tax code: file the document under that workplace',
      );
  }

  private async assertWorkplace(id: string): Promise<void> {
    const [row] = await this.svc.db
      .select({ id: workplaces.id })
      .from(workplaces)
      .where(eq(workplaces.id, id));
    if (!row) throw new NotFoundException('Workplace not found');
  }

  private async parentOf(): Promise<ParentOf> {
    const rows = await this.svc.db.select().from(categoryTree);
    return new Map(
      rows.filter((c) => !c.deleted).map((c) => [c.id, c.parentId]),
    );
  }

  private async workDocuments(): Promise<WorkDocument[]> {
    const [parentOf, rows] = await Promise.all([
      this.parentOf(),
      this.svc.db.select().from(documents).where(isNull(documents.deletedAt)),
    ]);
    return rows.flatMap((row) => {
      const { isWork, type } = workDocumentType(row.categories, parentOf);
      return isWork
        ? [{ row, type, reading: readWorkDocument(type, row.fields) }]
        : [];
    });
  }

  private async workDocument(uploadId: string): Promise<WorkDocument> {
    const doc = (await this.workDocuments()).find(
      (d) => d.row.uploadId === uploadId,
    );
    if (!doc) throw new NotFoundException('No work document with this id');
    return doc;
  }
}

function platformValues(request: HiringPlatformRequest) {
  return {
    name: request.name.trim(),
    url: request.url.trim(),
    account: request.account?.trim() || null,
    status: request.status ?? 'active',
    profileUpdatedAt: request.profileUpdatedAt ?? null,
    notes: request.notes?.trim() || null,
  };
}

export function platformDto(
  row: HiringPlatformRow,
  today: string,
): HiringPlatformDto {
  const days = row.profileUpdatedAt
    ? Math.round(
        (Date.parse(today) - Date.parse(row.profileUpdatedAt)) / 86_400_000,
      )
    : null;
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    account: row.account,
    status: row.status,
    profileUpdatedAt: row.profileUpdatedAt,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    stale:
      row.status === 'active' && (days === null || days > PLATFORM_STALE_DAYS),
  };
}

function feedbackDto(row: CareerFeedbackRow): CareerFeedbackDto {
  return {
    id: row.id,
    question: row.question,
    source: row.source,
    model: row.model,
    documentsUsed: row.documentsUsed,
    createdAt: row.createdAt.toISOString(),
    ...row.output,
  };
}
