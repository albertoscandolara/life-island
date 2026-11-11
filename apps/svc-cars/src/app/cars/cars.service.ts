import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { readNumberSettings, type ServiceDb } from '@life-island/be-common';
import {
  carReminderSettingKey,
  RENEWABLE_KINDS,
  RENEWAL_WARNING_DAYS,
  type RenewableKind,
  identifiesVehicle,
  type ApproveCarReviewRequest,
  type CarDocumentStatus,
  type CarDocumentType,
  type CarsOverviewDto,
  type CarDocumentPartDto,
  type CreateVehicleRequest,
  type GroupCarDocumentRequest,
  type MarkCarDocumentRequest,
  type PendingCarReviewDto,
  type RenewalAlertDto,
  type UpdateVehicleRequest,
  type CreateTyreSetRequest,
  type QuoteComparisonDto,
  type QuoteComparisonOutput,
  type UpdateFineRequest,
  type UpdateTyreSetRequest,
  type VehicleDto,
  type VehicleField,
  type VehiclePartyField,
  type VehicleValue,
  VEHICLE_PARTY_FIELDS,
  deadlineWindow,
  inDeadlineWindow,
  type DeadlineDto,
  type DeadlinesQuery,
  RENEWABLE_LABELS,
} from '@life-island/contracts';
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { SERVICE_DB } from '../config.js';
import {
  categoryTree,
  documents,
  fines,
  quoteComparisons,
  reviews,
  tyreSets,
  vehicles,
  type DecidedVehicleChange,
  type DocumentRow,
  type QuoteComparisonRow,
  type TyreSetRow,
  type VehicleRow,
} from '../db/schema.js';
import { carFines, fineRenewals, type FineDetails } from './car-fines.js';
import { insuranceHistory } from './car-insurance.js';
import { tyreRenewals, tyreSetOf } from './car-tyres.js';
import { carUsage } from './car-usage.js';
import { quoteDossier } from './quote-dossier.js';
import {
  buildSeries,
  carDocumentType,
  codeOf,
  completeValues,
  costsOf,
  costTotals,
  groupDocuments,
  groupKeyOf,
  isOutdated,
  matchVehicle,
  normalizeCode,
  numberKey,
  proposeVehicleChanges,
  readCarDocument,
  renewalsOf,
  todayIso,
  type ApprovedCarDocument,
  type CarDocumentReading,
  type ParentOf,
} from './car-documents.js';

interface CarDocument {
  row: DocumentRow;
  type: CarDocumentType | null;
  reading: CarDocumentReading;
}

interface ApprovedDocument extends ApprovedCarDocument {
  title: string;
  decidedAt: Date;
}

/** "Panda · AB123CD": your name for the car, else make and model, with the plate. */
export function vehicleName(row: Pick<VehicleRow, 'label' | 'values'>): string {
  const plate = (row.values.registrationNumber as string) ?? null;
  const model = [row.values.make, row.values.commercialName]
    .filter(Boolean)
    .join(' ');
  const name = row.label || model || null;
  return [name, plate].filter(Boolean).join(' · ') || 'Unnamed car';
}

/**
 * Car documents are read, on every request, from the documents you filed
 * under a car category; what is stored here is the cars and your decisions.
 * A document you have not decided on waits for review, matched to a car (by
 * VIN, else plate) and compared with it field by field; one whose plate no car
 * has is the suggestion of a new car. Nothing changes a car until you approve.
 */
@Injectable()
export class CarsService {
  constructor(@Inject(SERVICE_DB) private readonly svc: ServiceDb) {}

  /**
   * How many days before each renewal its warning starts: Settings →
   * Reminders, from this service's replica; the defaults if it cannot be read.
   */
  private async warningWindows(): Promise<Record<RenewableKind, number>> {
    const kinds = RENEWABLE_KINDS.filter(
      (kind) => kind !== 'fine' && kind !== 'tyres',
    );
    try {
      return {
        ...RENEWAL_WARNING_DAYS,
        ...(await readNumberSettings(
          this.svc.pool,
          this.svc.schema,
          Object.fromEntries(
            kinds.map((kind) => [kind, carReminderSettingKey(kind)]),
          ) as Record<(typeof kinds)[number], string>,
        )),
      };
    } catch {
      return { ...RENEWAL_WARNING_DAYS };
    }
  }

  /** Every renewal date of the cars in use inside the window, for the Agenda (`GET /deadlines`). */
  async deadlines(
    query: DeadlinesQuery,
    today = todayIso(),
  ): Promise<DeadlineDto[]> {
    const window = deadlineWindow(query, today);
    const { vehicles: cars } = await this.overview(today);
    return cars
      .filter((car) => car.status === 'active')
      .flatMap((car) =>
        car.renewals.flatMap((renewal): DeadlineDto[] => {
          if (!inDeadlineWindow(renewal.dueDate, window)) return [];
          const name = vehicleName(car);
          const what = renewal.subject ?? RENEWABLE_LABELS[renewal.kind];
          return [
            {
              id: `${car.id}:${renewal.kind}:${renewal.subject ?? ''}:${renewal.dueDate}`,
              module: 'cars',
              kind: renewal.kind,
              title: `${what} · ${name}`,
              detail: renewal.basis || null,
              date: renewal.dueDate,
              amount: null,
              path: '/cars',
            },
          ];
        }),
      );
  }

  async overview(
    today = todayIso(),
    aiQuotes = false,
  ): Promise<CarsOverviewDto> {
    const [docs, rows, decided, fineRows, tyreRows, comparisonRows, windows] =
      await Promise.all([
        this.carDocuments(),
        this.svc.db.select().from(vehicles),
        this.svc.db.select().from(reviews),
        this.svc.db.select().from(fines),
        this.svc.db.select().from(tyreSets).orderBy(tyreSets.createdAt),
        this.svc.db
          .select()
          .from(quoteComparisons)
          .orderBy(desc(quoteComparisons.createdAt)),
        this.warningWindows(),
      ]);
    const fineDetails = new Map<string, FineDetails>(
      fineRows.map((f) => [f.uploadId, f]),
    );
    const tyresOf = groupBy(tyreRows, (t) => t.vehicleId);
    const comparisonsOf = groupBy(comparisonRows, (c) => c.vehicleId);
    const reviewOf = new Map(decided.map((r) => [r.uploadId, r]));
    const approvedOf = new Map<string, ApprovedDocument[]>();
    for (const doc of docs) {
      const review = reviewOf.get(doc.row.uploadId);
      if (review?.status !== 'approved' || !review.vehicleId) continue;
      const list = approvedOf.get(review.vehicleId) ?? [];
      list.push({
        uploadId: doc.row.uploadId,
        title: doc.row.title,
        type: doc.type,
        reading: doc.reading,
        uploadedAt: doc.row.uploadedAt.toISOString(),
        markedStatus: review.markedStatus as CarDocumentStatus | null,
        groupKey: review.groupKey,
        decidedAt: review.decidedAt,
      });
      approvedOf.set(review.vehicleId, list);
    }

    const vehicleDtos: VehicleDto[] = rows
      .map((row) => {
        const approved = approvedOf.get(row.id) ?? [];
        const series = buildSeries(approved, today);
        const costs = costsOf(approved);
        const { usage, trend } = carUsage(approved, costs, row.values, today);
        const maxSpeed =
          typeof row.values.maxSpeedKmh === 'number'
            ? row.values.maxSpeedKmh
            : null;
        const tyres = (tyresOf.get(row.id) ?? [])
          .map((t) => tyreSetOf(t, maxSpeed, today))
          .sort((a, b) => Number(b.mounted) - Number(a.mounted));
        const carFineList = carFines(approved, fineDetails, today);
        const renewals = [
          ...renewalsOf(
            row.values,
            series,
            approved.filter((d) => d.type === 'VEHICLE_EXPENSE'),
            today,
            trend,
            windows,
          ),
          ...fineRenewals(carFineList.fines, today),
          ...(row.status === 'active'
            ? tyreRenewals(tyres, maxSpeed, today)
            : []),
        ];
        const readings = approved
          .map((d) => d.reading.odometerKm)
          .filter((km): km is number => km !== null);
        // A fine is still to pay once the car is sold; the rest only counts while in use.
        const alerts: RenewalAlertDto[] = renewals
          .filter(
            (r) =>
              r.level !== 'ok' &&
              (row.status === 'active' || r.kind === 'fine'),
          )
          .map((r) => ({
            ...r,
            vehicleId: row.id,
            vehicleName: vehicleName(row),
          }));
        return {
          id: row.id,
          label: row.label,
          status: row.status,
          values: completeValues(row.values),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          series: series.map(({ type, versions }) => ({
            type,
            versions: versions.map(({ document: group, version, status }) => {
              const [main] = group.members;
              return {
                uploadId: group.uploadId,
                title: main.title,
                type,
                version,
                status,
                number: group.reading.number,
                issuer: group.reading.issuer,
                validFrom: group.reading.validFrom,
                validUntil: group.reading.validUntil,
                amount: group.reading.amount,
                uploadedAt: group.uploadedAt,
                reviewedAt: main.decidedAt.toISOString(),
                documents: group.members.map((m): CarDocumentPartDto => ({
                  uploadId: m.uploadId,
                  title: m.title,
                  role: m.reading.role,
                  amount: m.reading.amount,
                  uploadedAt: m.uploadedAt,
                  reviewedAt: m.decidedAt.toISOString(),
                  linkedByHand: m.groupKey !== null && m.groupKey !== undefined,
                })),
              };
            }),
          })),
          renewals,
          alerts,
          costs,
          costTotals: costTotals(costs),
          odometerKm: readings.length ? Math.max(...readings) : null,
          model: modelOf(row),
          people: row.people ?? {},
          usage,
          insurance: insuranceHistory(series, costs),
          fines: carFineList,
          tyres,
          quoteComparisons: (comparisonsOf.get(row.id) ?? []).map(comparisonOf),
        };
      })
      .sort(
        (a, b) =>
          Number(a.status !== 'active') - Number(b.status !== 'active') ||
          vehicleName(a).localeCompare(vehicleName(b)),
      );

    const known = rows.map((r) => ({ id: r.id, values: r.values }));
    const pending: PendingCarReviewDto[] = docs
      .filter((doc) => !reviewOf.has(doc.row.uploadId))
      .map((doc) => {
        const { vehicle, match } = matchVehicle(doc.reading, known);
        const ofVehicle = vehicle ? (approvedOf.get(vehicle.id) ?? []) : [];
        const outdated = isOutdated(doc.reading, ofVehicle);
        const key = numberKey(doc.reading.number);
        const record =
          key && doc.type !== 'VEHICLE_EXPENSE'
            ? groupDocuments(ofVehicle).find(
                (g) => g.key === `${doc.type ?? ''}|${key}`,
              )
            : undefined;
        return {
          uploadId: doc.row.uploadId,
          title: doc.row.title,
          type: doc.type,
          uploadedAt: doc.row.uploadedAt.toISOString(),
          registrationNumber: doc.reading.registrationNumber,
          vin: doc.reading.vin,
          make: doc.reading.make,
          commercialName: doc.reading.commercialName,
          facts: doc.reading.facts,
          printed: Object.entries(doc.reading.values).map(([field, value]) => ({
            field: field as VehicleField,
            code: codeOf(field as VehicleField),
            value: value as string | number,
          })),
          vehicleId: vehicle?.id ?? null,
          match,
          changes: proposeVehicleChanges(
            doc.reading.values,
            vehicle?.values ?? null,
            outdated,
          ),
          outdated,
          role: doc.reading.role,
          joins:
            record && doc.reading.number
              ? {
                  uploadId: record.uploadId,
                  number: doc.reading.number,
                  documentCount: record.members.length,
                }
              : null,
        };
      })
      .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));

    const docOf = new Map(docs.map((d) => [d.row.uploadId, d]));
    return {
      vehicles: vehicleDtos,
      reviews: pending,
      alerts: vehicleDtos
        .flatMap((v) => v.alerts)
        .sort((a, b) => alertRank(a) - alertRank(b)),
      aiQuotes,
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
   * Files the document under a car: an existing one (taking the printed values
   * you accept) or a new one made from everything it prints.
   */
  async approve(uploadId: string, request: ApproveCarReviewRequest) {
    const doc = await this.carDocument(uploadId);
    const accept = new Set(request.accept ?? []);
    if (request.vehicleId === null && !identifiesVehicle(doc.reading))
      throw new UnprocessableEntityException(
        'This document prints no plate or VIN, so it cannot make a new car: file it under one of your cars, or fill in the plate in the documents app',
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
      let vehicleId: string;
      let changes: DecidedVehicleChange[];
      if (request.vehicleId === null) {
        await this.assertNoOtherCar(tx, printed.vin ?? null, null);
        const [created] = await tx
          .insert(vehicles)
          .values({ label: request.label ?? null, values: { ...printed } })
          .returning();
        vehicleId = created.id;
        changes = proposeVehicleChanges(printed, null, false).map((c) => ({
          field: c.field,
          previous: null,
          proposed: c.proposed,
          decision: 'accepted',
        }));
      } else {
        const [vehicle] = await tx
          .select()
          .from(vehicles)
          .where(eq(vehicles.id, request.vehicleId))
          .for('update');
        if (!vehicle) throw new NotFoundException('Car not found');
        vehicleId = vehicle.id;
        changes = proposeVehicleChanges(printed, vehicle.values, false).map(
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
          if ('vin' in update)
            await this.assertNoOtherCar(tx, String(update['vin']), vehicleId);
          await tx
            .update(vehicles)
            .set({
              values: { ...vehicle.values, ...update },
              // A party whose name the document changes is no longer the person you picked.
              people: withoutChangedParties(vehicle.people, update),
              updatedAt: new Date(),
            })
            .where(eq(vehicles.id, vehicleId));
        }
      }
      await tx.insert(reviews).values({
        uploadId,
        status: 'approved',
        vehicleId,
        createdVehicle: request.vehicleId === null,
        changes,
      });
      return { vehicleId, changes };
    });
  }

  /** Not about any of your cars: it stays out of Cars until you reopen it. */
  async reject(uploadId: string): Promise<void> {
    await this.carDocument(uploadId);
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

  /** Marks the record the document is in: all its documents together. */
  async mark(uploadId: string, request: MarkCarDocumentRequest): Promise<void> {
    const { record } = await this.recordOf(uploadId);
    await this.svc.db
      .update(reviews)
      .set({ markedStatus: request.status })
      .where(
        and(
          inArray(
            reviews.uploadId,
            record.members.map((m) => m.uploadId),
          ),
          eq(reviews.status, 'approved'),
        ),
      );
  }

  /**
   * Puts an approved document in the record of another of the same car and
   * type, or (attachTo null) in a record of its own.
   */
  async group(
    uploadId: string,
    request: GroupCarDocumentRequest,
  ): Promise<void> {
    const { document, approved } = await this.recordOf(uploadId);
    let groupKey = `own:${uploadId}`;
    if (request.attachTo !== null) {
      if (request.attachTo === uploadId)
        throw new UnprocessableEntityException(
          'A document cannot be attached to itself',
        );
      const target = approved.find((d) => d.uploadId === request.attachTo);
      if (!target)
        throw new UnprocessableEntityException(
          'Attach it to an approved document of the same car',
        );
      if (target.type !== document.type)
        throw new UnprocessableEntityException(
          'Attach it to a document of the same kind',
        );
      groupKey = groupKeyOf(target);
    }
    await this.svc.db
      .update(reviews)
      .set({ groupKey })
      .where(eq(reviews.uploadId, uploadId));
  }

  /** An approved document, the record it is in, and every approved document of its car. */
  private async recordOf(uploadId: string) {
    const [review] = await this.svc.db
      .select()
      .from(reviews)
      .where(
        and(eq(reviews.uploadId, uploadId), eq(reviews.status, 'approved')),
      );
    if (!review?.vehicleId)
      throw new NotFoundException('No approved car document with this id');
    const [docs, decided] = await Promise.all([
      this.carDocuments(),
      this.svc.db
        .select()
        .from(reviews)
        .where(
          and(
            eq(reviews.vehicleId, review.vehicleId),
            eq(reviews.status, 'approved'),
          ),
        ),
    ]);
    const reviewOf = new Map(decided.map((r) => [r.uploadId, r]));
    const approved: ApprovedCarDocument[] = docs.flatMap((doc) => {
      const r = reviewOf.get(doc.row.uploadId);
      return r
        ? [
            {
              uploadId: doc.row.uploadId,
              type: doc.type,
              reading: doc.reading,
              uploadedAt: doc.row.uploadedAt.toISOString(),
              markedStatus: r.markedStatus as CarDocumentStatus | null,
              groupKey: r.groupKey,
            },
          ]
        : [];
    });
    const document = approved.find((d) => d.uploadId === uploadId);
    if (!document)
      throw new NotFoundException('No approved car document with this id');
    const record = groupDocuments(approved).find((g) =>
      g.members.some((m) => m.uploadId === uploadId),
    ) as ReturnType<typeof groupDocuments<ApprovedCarDocument>>[number];
    return { document, record, approved };
  }

  /** A car added by hand, before any of its documents. */
  async createVehicle(request: CreateVehicleRequest): Promise<{ id: string }> {
    const plate = normalizeCode(request.registrationNumber);
    const rows = await this.svc.db.select().from(vehicles);
    if (
      rows.some(
        (r) =>
          normalizeCode((r.values.registrationNumber as string) ?? null) ===
          plate,
      )
    )
      throw new ConflictException('You already have a car with this plate');
    const [created] = await this.svc.db
      .insert(vehicles)
      .values({
        label: request.label ?? null,
        values: { registrationNumber: plate },
      })
      .returning({ id: vehicles.id });
    return created;
  }

  async updateVehicle(
    id: string,
    request: UpdateVehicleRequest,
  ): Promise<void> {
    await this.svc.db.transaction(async (tx) => {
      const [vehicle] = await tx
        .select()
        .from(vehicles)
        .where(eq(vehicles.id, id))
        .for('update');
      if (!vehicle) throw new NotFoundException('Car not found');
      const values: Partial<Record<VehicleField, VehicleValue>> = {
        ...vehicle.values,
      };
      for (const [field, value] of Object.entries(request.values ?? {})) {
        const key = field as VehicleField;
        const cleaned =
          typeof value === 'string'
            ? key === 'registrationNumber' || key === 'vin'
              ? normalizeCode(value)
              : value.trim() || null
            : (value ?? null);
        if (cleaned === null) delete values[key];
        else values[key] = cleaned;
      }
      if (request.values && 'vin' in request.values && values.vin)
        await this.assertNoOtherCar(tx, String(values.vin), id);
      const people = withoutChangedParties(
        vehicle.people,
        Object.fromEntries(
          Object.entries(request.values ?? {}).filter(
            ([field]) => !(field in (request.people ?? {})),
          ),
        ),
      );
      for (const [field, personId] of Object.entries(request.people ?? {})) {
        const party = field as VehiclePartyField;
        if (personId) people[party] = personId;
        else delete people[party];
      }
      await tx
        .update(vehicles)
        .set({
          ...(request.label !== undefined ? { label: request.label } : {}),
          ...(request.status ? { status: request.status } : {}),
          values,
          people,
          updatedAt: new Date(),
        })
        .where(eq(vehicles.id, id));
    });
  }

  /** Removes a car; its documents are not deleted, they go back to review. */
  /** Removes the car; returns the key of its 3D model, for the caller to delete. */
  async removeVehicle(id: string): Promise<string | null> {
    // reviews.vehicle_id cascades: the car's decisions go with it.
    const deleted = await this.svc.db
      .delete(vehicles)
      .where(eq(vehicles.id, id))
      .returning({ id: vehicles.id, modelKey: vehicles.modelKey });
    if (!deleted.length) throw new NotFoundException('Car not found');
    return deleted[0].modelKey;
  }

  /** One VIN, one car. */
  // ---- fines ---------------------------------------------------------------

  /** What you add to a fine by hand: when it reached you, when you paid, who drove. */
  async updateFine(
    uploadId: string,
    request: UpdateFineRequest,
  ): Promise<void> {
    const doc = await this.carDocument(uploadId);
    if (doc.type !== 'VEHICLE_EXPENSE' || doc.reading.expenseKind !== 'fine')
      throw new UnprocessableEntityException('This document is not a fine');
    const [current] = await this.svc.db
      .select()
      .from(fines)
      .where(eq(fines.uploadId, uploadId));
    const next = {
      notifiedOn: current?.notifiedOn ?? null,
      paidOn: current?.paidOn ?? null,
      points: current?.points ?? null,
      driverPersonId: current?.driverPersonId ?? null,
      driverName: current?.driverName ?? null,
    };
    for (const key of Object.keys(next) as (keyof typeof next)[])
      if (request[key] !== undefined)
        (next as Record<string, unknown>)[key] = request[key];
    if (
      request.driverName !== undefined &&
      request.driverPersonId === undefined
    )
      next.driverPersonId = null;
    await this.svc.db
      .insert(fines)
      .values({ uploadId, ...next, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: fines.uploadId,
        set: { ...next, updatedAt: new Date() },
      });
  }

  // ---- tyres ---------------------------------------------------------------

  async createTyreSet(
    vehicleId: string,
    request: CreateTyreSetRequest,
  ): Promise<{ id: string }> {
    await this.vehicleRow(vehicleId);
    return this.svc.db.transaction(async (tx) => {
      if (request.mounted)
        await tx
          .update(tyreSets)
          .set({ mounted: false, updatedAt: new Date() })
          .where(eq(tyreSets.vehicleId, vehicleId));
      const [row] = await tx
        .insert(tyreSets)
        .values({
          vehicleId,
          season: request.season,
          label: request.label ?? null,
          size: request.size ?? null,
          dot: request.dot ?? null,
          purchasedOn: request.purchasedOn ?? null,
          treadMm: request.treadMm ?? null,
          mounted: request.mounted ?? false,
          storedAt: request.storedAt ?? null,
          notes: request.notes ?? null,
        })
        .returning({ id: tyreSets.id });
      return { id: row.id };
    });
  }

  /** A change to a tyre set; mounting it takes the others off the car. */
  async updateTyreSet(
    id: string,
    request: UpdateTyreSetRequest,
  ): Promise<void> {
    const set = await this.tyreSetRow(id);
    await this.svc.db.transaction(async (tx) => {
      if (request.mounted)
        await tx
          .update(tyreSets)
          .set({ mounted: false, updatedAt: new Date() })
          .where(
            and(eq(tyreSets.vehicleId, set.vehicleId), ne(tyreSets.id, id)),
          );
      const change: Partial<TyreSetRow> = { updatedAt: new Date() };
      for (const [key, value] of Object.entries(request))
        if (value !== undefined)
          (change as Record<string, unknown>)[key] = value;
      await tx.update(tyreSets).set(change).where(eq(tyreSets.id, id));
    });
  }

  async removeTyreSet(id: string): Promise<void> {
    await this.tyreSetRow(id);
    await this.svc.db.delete(tyreSets).where(eq(tyreSets.id, id));
  }

  private async tyreSetRow(id: string): Promise<TyreSetRow> {
    const [row] = await this.svc.db
      .select()
      .from(tyreSets)
      .where(eq(tyreSets.id, id));
    if (!row) throw new NotFoundException('Tyre set not found');
    return row;
  }

  private async vehicleRow(id: string): Promise<VehicleRow> {
    const [row] = await this.svc.db
      .select()
      .from(vehicles)
      .where(eq(vehicles.id, id));
    if (!row) throw new NotFoundException('Car not found');
    return row;
  }

  // ---- insurance quotes ----------------------------------------------------

  /**
   * What the quote comparison is told about a car: the car and its insurance
   * history as text, and the documents of its current policy to send along.
   */
  async quoteContext(
    vehicleId: string,
    note: string | null,
  ): Promise<{ dossier: string; policyUploadIds: string[] }> {
    await this.vehicleRow(vehicleId);
    const vehicle = (await this.overview()).vehicles.find(
      (v) => v.id === vehicleId,
    );
    if (!vehicle) throw new NotFoundException('Car not found');
    const latest = vehicle.series
      .find((s) => s.type === 'CAR_INSURANCE')
      ?.versions.find((v) => v.status !== 'cancelled');
    const policies = latest?.documents.filter((d) => d.role === 'policy') ?? [];
    const policyUploadIds = (
      policies.length ? policies : (latest?.documents.slice(0, 1) ?? [])
    )
      .slice(0, 2)
      .map((d) => d.uploadId);
    return { dossier: quoteDossier(vehicle, note), policyUploadIds };
  }

  async saveComparison(
    vehicleId: string,
    files: string[],
    note: string | null,
    output: QuoteComparisonOutput,
    model: string | null,
  ): Promise<QuoteComparisonDto> {
    const [row] = await this.svc.db
      .insert(quoteComparisons)
      .values({ vehicleId, files, note, output, model })
      .returning();
    return comparisonOf(row);
  }

  async removeComparison(id: string): Promise<void> {
    const removed = await this.svc.db
      .delete(quoteComparisons)
      .where(eq(quoteComparisons.id, id))
      .returning({ id: quoteComparisons.id });
    if (!removed.length) throw new NotFoundException('Comparison not found');
  }

  private async assertNoOtherCar(
    tx: Pick<ServiceDb['db'], 'select'>,
    vin: string | number | null,
    except: string | null,
  ): Promise<void> {
    const code = normalizeCode(vin === null ? null : String(vin));
    if (!code) return;
    const rows = await tx.select().from(vehicles);
    if (
      rows.some(
        (r) =>
          r.id !== except &&
          normalizeCode((r.values.vin as string) ?? null) === code,
      )
    )
      throw new ConflictException(
        'Another of your cars has this VIN: file the document under that car',
      );
  }

  private async parentOf(): Promise<ParentOf> {
    const rows = await this.svc.db.select().from(categoryTree);
    return new Map(
      rows.filter((c) => !c.deleted).map((c) => [c.id, c.parentId]),
    );
  }

  private async carDocuments(): Promise<CarDocument[]> {
    const [parentOf, rows] = await Promise.all([
      this.parentOf(),
      this.svc.db.select().from(documents).where(isNull(documents.deletedAt)),
    ]);
    return rows.flatMap((row) => {
      const { isCar, type } = carDocumentType(row.categories, parentOf);
      return isCar
        ? [
            {
              row,
              type,
              reading: readCarDocument(type, row.fields, [
                row.title,
                row.originalFilename,
              ]),
            },
          ]
        : [];
    });
  }

  private async carDocument(uploadId: string): Promise<CarDocument> {
    const doc = (await this.carDocuments()).find(
      (d) => d.row.uploadId === uploadId,
    );
    if (!doc) throw new NotFoundException('No car document with this id');
    return doc;
  }
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string) {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(key(row)) ?? [];
    list.push(row);
    map.set(key(row), list);
  }
  return map;
}

export function comparisonOf(row: QuoteComparisonRow): QuoteComparisonDto {
  return {
    ...row.output,
    id: row.id,
    vehicleId: row.vehicleId,
    files: row.files,
    note: row.note,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The links to People of the parties whose name `changed` does not touch. */
export function withoutChangedParties(
  people: Partial<Record<VehiclePartyField, string>> | null | undefined,
  changed: Partial<Record<string, unknown>>,
): Partial<Record<VehiclePartyField, string>> {
  const kept = { ...(people ?? {}) };
  for (const field of VEHICLE_PARTY_FIELDS)
    if (field in changed) delete kept[field];
  return kept;
}

/** Expired first, then in the grace period, missing, and expiring soonest. */
function alertRank(alert: RenewalAlertDto): number {
  const base = { expired: 0, grace: 1, missing: 2, expiring: 3, ok: 4 }[
    alert.level
  ];
  return base * 100_000 + (alert.daysLeft ?? 0);
}

/** The car's 3D model as the screen sees it, or null when it has none. */
export function modelOf(row: VehicleRow): VehicleDto['model'] {
  return row.modelKey && row.modelFilename && row.modelFormat
    ? {
        filename: row.modelFilename,
        format: row.modelFormat,
        sizeBytes: row.modelSize ?? 0,
        uploadedAt: (row.modelUploadedAt ?? row.createdAt).toISOString(),
      }
    : null;
}
