import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import {
  identifiesVehicle,
  type ApproveCarReviewRequest,
  type CarDocumentStatus,
  type CarDocumentType,
  type CarsOverviewDto,
  type CreateVehicleRequest,
  type MarkCarDocumentRequest,
  type PendingCarReviewDto,
  type RenewalAlertDto,
  type UpdateVehicleRequest,
  type VehicleDto,
  type VehicleField,
  type VehicleValue,
} from '@life-island/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import { SERVICE_DB } from '../config.js';
import {
  categoryTree,
  documents,
  reviews,
  vehicles,
  type DecidedVehicleChange,
  type DocumentRow,
  type VehicleRow,
} from '../db/schema.js';
import {
  buildSeries,
  carDocumentType,
  codeOf,
  completeValues,
  costsOf,
  costTotals,
  isOutdated,
  matchVehicle,
  normalizeCode,
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

  async overview(today = todayIso()): Promise<CarsOverviewDto> {
    const [docs, rows, decided] = await Promise.all([
      this.carDocuments(),
      this.svc.db.select().from(vehicles),
      this.svc.db.select().from(reviews),
    ]);
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
        decidedAt: review.decidedAt,
      });
      approvedOf.set(review.vehicleId, list);
    }

    const vehicleDtos: VehicleDto[] = rows
      .map((row) => {
        const approved = approvedOf.get(row.id) ?? [];
        const series = buildSeries(approved, today);
        const renewals = renewalsOf(
          row.values,
          series,
          approved.filter((d) => d.type === 'VEHICLE_EXPENSE'),
          today,
        );
        const costs = costsOf(approved);
        const readings = approved
          .map((d) => d.reading.odometerKm)
          .filter((km): km is number => km !== null);
        const alerts: RenewalAlertDto[] =
          row.status === 'active'
            ? renewals
                .filter((r) => r.level !== 'ok')
                .map((r) => ({
                  ...r,
                  vehicleId: row.id,
                  vehicleName: vehicleName(row),
                }))
            : [];
        return {
          id: row.id,
          label: row.label,
          status: row.status,
          values: completeValues(row.values),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          series: series.map(({ type, versions }) => ({
            type,
            versions: versions.map(({ document: d, version, status }) => ({
              uploadId: d.uploadId,
              title: d.title,
              type,
              version,
              status,
              number: d.reading.number,
              issuer: d.reading.issuer,
              validFrom: d.reading.validFrom,
              validUntil: d.reading.validUntil,
              amount: d.reading.amount,
              uploadedAt: d.uploadedAt,
              reviewedAt: d.decidedAt.toISOString(),
            })),
          })),
          renewals,
          alerts,
          costs,
          costTotals: costTotals(costs),
          odometerKm: readings.length ? Math.max(...readings) : null,
          model: modelOf(row),
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
        const outdated = isOutdated(
          doc.reading,
          vehicle ? (approvedOf.get(vehicle.id) ?? []) : [],
        );
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

  async mark(uploadId: string, request: MarkCarDocumentRequest): Promise<void> {
    const updated = await this.svc.db
      .update(reviews)
      .set({ markedStatus: request.status })
      .where(
        and(eq(reviews.uploadId, uploadId), eq(reviews.status, 'approved')),
      )
      .returning();
    if (!updated.length)
      throw new NotFoundException('No approved car document with this id');
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
      await tx
        .update(vehicles)
        .set({
          ...(request.label !== undefined ? { label: request.label } : {}),
          ...(request.status ? { status: request.status } : {}),
          values,
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
        ? [{ row, type, reading: readCarDocument(type, row.fields) }]
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
