import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import {
  listBillsQuerySchema,
  updateBillRequestSchema,
  bankPaymentOf,
  type BillDto,
  type BillPaymentDto,
  paymentsByKey,
} from '@life-island/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { SERVICE_DB } from '../config.js';
import {
  billOverrides,
  payments as paymentRows,
  bills,
  documents,
  organizations,
  properties,
  supplyContracts,
  supplyPoints,
  type PaymentRow,
  type BillRow,
} from '../db/schema.js';
import { contractDirectDebit, isAutoPaid } from './auto-pay.js';
import { BillLedger } from './bill-ledger.js';
import { billSpan, normalizeCode } from './bill-reader.js';

type ListBills = z.output<typeof listBillsQuerySchema>;
type UpdateBill = z.output<typeof updateBillRequestSchema>;

/** A stored bill as Bills shows it: its house through its supply point unless you picked one. */
export function toBillDto(
  row: BillRow,
  pointHouse: string | null | undefined,
  autoPaid = false,
  payments: readonly PaymentRow[] = [],
  supplierName: string | null = null,
): BillDto {
  const viaPoint = !row.manualProperty && row.supplyPointId !== null;
  const propertyId = viaPoint ? (pointHouse ?? null) : row.propertyId;
  return {
    id: row.id,
    uploadId: row.uploadId,
    title: row.title,
    utility: row.utility,
    utilityOverridden: row.utilityOverridden,
    propertyId,
    assignment: viaPoint
      ? propertyId
        ? 'SUPPLY_CODE'
        : null
      : row.manualProperty
        ? row.propertyId
          ? 'MANUAL'
          : null
        : row.assignment,
    provider: row.provider,
    customerId: row.customerId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    amount: row.amount,
    currency: row.currency,
    consumption: row.consumption,
    unit: row.unit,
    fee: row.fee,
    invoiceNumber: row.invoiceNumber,
    totalDue: row.totalDue,
    supplierId: row.supplierId,
    supplierName: row.supplierId ? supplierName : null,
    supplyPointId: row.supplyPointId,
    contractId: row.contractId,
    directDebit: row.directDebit,
    autoPaid,
    bankPayment: billPayment(row.totalDue ?? row.amount, payments),
  };
}

/** A bill's key in Money matching (PayableDto.key). */
export function billPayableKey(uploadId: string): string {
  return `home:bill:${uploadId}`;
}

/** What the matched bank movements paid of a bill (only the links still in place). */
export function billPayment(
  due: number,
  payments: readonly PaymentRow[],
): BillPaymentDto | null {
  return bankPaymentOf(due, payments);
}

/**
 * Bills are entities: one row per bill document, kept in step with your
 * documents by BillLedger, tied to a supplier, a supply point and a
 * contract. Your corrections stay in bill_overrides and are applied on sync.
 */
@Injectable()
export class BillsService {
  constructor(
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
    @Inject(BillLedger) private readonly ledger: BillLedger,
  ) {}

  /** Every bill, with its house and whether it is paid on its own. */
  private async all(): Promise<{ bill: BillDto; counted: boolean }[]> {
    const rows = await this.svc.db
      .select({
        bill: bills,
        pointHouse: supplyPoints.propertyId,
        autoPay: supplyContracts.autoPay,
        supplierName: organizations.name,
      })
      .from(bills)
      .leftJoin(supplyPoints, eq(bills.supplyPointId, supplyPoints.id))
      .leftJoin(supplyContracts, eq(bills.contractId, supplyContracts.id))
      .leftJoin(organizations, eq(bills.supplierId, organizations.id));
    const payments = paymentsByKey(
      await this.svc.db
        .select()
        .from(paymentRows)
        .where(isNull(paymentRows.unlinkedAt)),
    );
    const detected = contractDirectDebit(rows.map((r) => r.bill));
    return rows.map((r) => ({
      bill: toBillDto(
        r.bill,
        r.pointHouse,
        isAutoPaid(
          r.bill,
          r.autoPay,
          r.bill.contractId ? detected.get(r.bill.contractId) : undefined,
        ),
        payments.get(billPayableKey(r.bill.uploadId)),
        r.supplierName,
      ),
      counted: r.bill.duplicateOf === null,
    }));
  }

  /** Every bill counted (a second copy of an invoice is not), newest first. */
  async list(query: ListBills): Promise<BillDto[]> {
    return (await this.all())
      .filter((r) => r.counted)
      .map((r) => r.bill)
      .filter((bill) => matches(bill, query))
      .sort(
        (a, b) =>
          (billSpan(b)?.end ?? '').localeCompare(billSpan(a)?.end ?? '') ||
          a.uploadId.localeCompare(b.uploadId),
      );
  }

  async update(uploadId: string, request: UpdateBill): Promise<BillDto | null> {
    const [document] = await this.svc.db
      .select({ uploadId: documents.uploadId })
      .from(documents)
      .where(
        and(eq(documents.uploadId, uploadId), isNull(documents.deletedAt)),
      );
    if (!document)
      throw new NotFoundException(`Document ${uploadId} not found`);
    if (request.propertyId) {
      const [property] = await this.svc.db
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, request.propertyId));
      if (!property)
        throw new BadRequestException(
          `Property ${request.propertyId} not found`,
        );
    }

    const changes = {
      ...(request.automaticProperty
        ? { manualProperty: false, propertyId: null }
        : request.propertyId !== undefined
          ? { manualProperty: true, propertyId: request.propertyId }
          : {}),
      ...(request.utility !== undefined ? { utility: request.utility } : {}),
      ...(request.excluded !== undefined ? { excluded: request.excluded } : {}),
      updatedAt: new Date(),
    };
    await this.svc.db
      .insert(billOverrides)
      .values({ uploadId, ...changes })
      .onConflictDoUpdate({ target: billOverrides.uploadId, set: changes });
    await this.ledger.sync();
    let bill = await this.get(uploadId);
    if (request.propertyId && bill?.supplyPointId) {
      // A bill put on a house takes its supply point there: the next bills follow.
      await this.moveSupplyPoint(bill.supplyPointId, request.propertyId);
      bill = await this.get(uploadId);
    }
    // A bill with no supply point teaches the house nothing: its customer
    // code names the supply contract, never the house.
    return bill;
  }

  /** Moves a supply point, and so every bill of it, to a house (null: none). */
  async moveSupplyPoint(id: string, propertyId: string | null): Promise<void> {
    const [point] = await this.svc.db
      .update(supplyPoints)
      .set({ propertyId })
      .where(eq(supplyPoints.id, id))
      .returning();
    if (!point) throw new NotFoundException(`Supply point ${id} not found`);
    await this.learnSupplyCode(propertyId, point.code);
  }

  private async get(uploadId: string): Promise<BillDto | null> {
    return (
      (await this.all()).find((r) => r.bill.uploadId === uploadId)?.bill ?? null
    );
  }

  /**
   * A supply code (POD, PDR) now belongs to that home, so the documents of
   * that supply find it on their own (house suggestions read it too). A code
   * moves with your choice: it leaves the home that had it before.
   */
  private async learnSupplyCode(
    propertyId: string | null,
    code: string,
  ): Promise<void> {
    const wanted = normalizeCode(code);
    if (wanted.length < 6) return; // too short to tell supplies apart
    const rows = await this.svc.db.select().from(properties);
    for (const row of rows) {
      const has = row.supplyCodes.some((c) => normalizeCode(c) === wanted);
      const supplyCodes =
        row.id === propertyId
          ? has
            ? null
            : [...row.supplyCodes, code]
          : has
            ? row.supplyCodes.filter((c) => normalizeCode(c) !== wanted)
            : null;
      if (supplyCodes)
        await this.svc.db
          .update(properties)
          .set({ supplyCodes })
          .where(eq(properties.id, row.id));
    }
  }
}

function matches(bill: BillDto, query: ListBills): boolean {
  if (query.property === 'unassigned' && bill.propertyId !== null) return false;
  if (
    query.property &&
    query.property !== 'unassigned' &&
    bill.propertyId !== query.property
  )
    return false;
  if (query.utility && !query.utility.includes(bill.utility)) return false;
  if (query.from || query.to) {
    const span = billSpan(bill);
    if (!span) return false;
    if (query.from && span.end < query.from) return false;
    if (query.to && span.start > query.to) return false;
  }
  return true;
}
