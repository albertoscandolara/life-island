import { internalHeaders } from '@life-island/be-common';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import {
  HOUSE_TAX_EXPENSE_LABELS,
  type DossierExpenseDto,
  type HouseTaxExpenseDto,
  type HouseTaxExpensesDto,
  type TaxYearDossierDto,
  type TaxYearDto,
  type UpdateHouseTaxExpenseRequest,
  type WorkDto,
  type WorkKind,
} from '@life-island/contracts';
import { eq, inArray } from 'drizzle-orm';
import { CONFIG, SERVICE_DB, type HomeConfig } from '../config.js';
import {
  categoryTree,
  documents,
  taxExpenseLinks,
  workDocuments,
  works,
} from '../db/schema.js';
import { PropertiesService } from '../properties/properties.service.js';
import { WorksService } from '../works/works.service.js';
import { isHouseExpense, placeTaxExpense } from './house-tax-expenses.js';

const WORK_KIND_OF: Record<HouseTaxExpenseDto['expenseType'], WorkKind> = {
  renovation: 'RENOVATION',
  energy_efficiency: 'IMPROVEMENT',
  furniture: 'IMPROVEMENT',
};

/**
 * The 730 home expenses (renovations, ecobonus, bonus mobili) under their
 * house. They live in svc-tax730 and are read from its HTTP API; this
 * service never touches its tables and keeps only which house and work
 * each one belongs to. When the 730 cannot be reached, none are shown.
 */
@Injectable()
export class HouseTaxExpensesService {
  private readonly log = new Logger(HouseTaxExpensesService.name);

  constructor(
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
    @Inject(CONFIG) private readonly config: HomeConfig,
    @Inject(PropertiesService) private readonly properties: PropertiesService,
    @Inject(WorksService) private readonly works: WorksService,
  ) {}

  async list(property?: string): Promise<HouseTaxExpensesDto> {
    const read = await this.read();
    if (!read) return { available: false, expenses: [] };
    const placed = await this.place(read);
    return {
      available: true,
      expenses: placed
        .filter((e) => !property || e.propertyId === property)
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) || a.issuer.localeCompare(b.issuer),
        ),
    };
  }

  /**
   * Puts an expense on a house (null: on none) and maybe one of its works,
   * which then files its invoice and payment. `automaticProperty` forgets
   * your choice.
   */
  async update(
    expenseId: string,
    request: UpdateHouseTaxExpenseRequest,
  ): Promise<HouseTaxExpenseDto> {
    const current = await this.one(expenseId);
    if (request.automaticProperty && request.workId === undefined) {
      await this.svc.db
        .delete(taxExpenseLinks)
        .where(eq(taxExpenseLinks.expenseId, expenseId));
      return this.one(expenseId);
    }
    let propertyId =
      request.propertyId !== undefined
        ? request.propertyId
        : current.propertyId;
    const workId =
      request.workId !== undefined
        ? request.workId
        : propertyId === current.propertyId
          ? current.workId
          : null;
    if (propertyId && !(await this.properties.exists(propertyId)))
      throw new BadRequestException(`Property ${propertyId} not found`);
    if (workId) {
      const work = await this.works.get(workId);
      if (request.propertyId === undefined) propertyId = work.propertyId;
      else if (work.propertyId !== propertyId)
        throw new BadRequestException('That work is on another house');
      // The work files its invoice and payment.
      for (const document of current.documents)
        await this.works.attach(workId, document.uploadId).catch(() => null);
    }
    const values = {
      manualProperty: true,
      propertyId,
      workId,
      updatedAt: new Date(),
    };
    await this.svc.db
      .insert(taxExpenseLinks)
      .values({ expenseId, ...values })
      .onConflictDoUpdate({ target: taxExpenseLinks.expenseId, set: values });
    return this.one(expenseId);
  }

  /** Makes a work of an expense: done, at its date, with its firm, cost and documents. */
  async createWork(
    expenseId: string,
    propertyId: string | undefined,
  ): Promise<WorkDto> {
    const expense = await this.one(expenseId);
    const house = propertyId ?? expense.propertyId;
    if (!house)
      throw new BadRequestException('Pick the house this expense is for first');
    const label = HOUSE_TAX_EXPENSE_LABELS[expense.expenseType];
    const work = await this.works.create({
      propertyId: house,
      title: (expense.description ?? `${label} · ${expense.issuer}`).slice(
        0,
        120,
      ),
      kind: WORK_KIND_OF[expense.expenseType],
      status: 'DONE',
      contractor: expense.issuer.slice(0, 120),
      endDate: expense.date,
      actualCost: expense.amount,
      notes: `In the 730 of ${expense.taxYear + 1} (expenses of ${expense.taxYear}): ${label}.`,
    });
    await this.update(expenseId, { propertyId: house, workId: work.id });
    return this.works.get(work.id);
  }

  private async one(expenseId: string): Promise<HouseTaxExpenseDto> {
    const read = await this.read();
    if (!read)
      throw new NotFoundException('The 730 area cannot be reached right now');
    const found = (await this.place(read)).find(
      (e) => e.expenseId === expenseId,
    );
    if (!found)
      throw new NotFoundException(`730 home expense ${expenseId} not found`);
    return found;
  }

  private async place(
    expenses: DossierExpenseDto[],
  ): Promise<HouseTaxExpenseDto[]> {
    const uploads = [
      ...new Set(
        expenses.flatMap((e) => [
          e.uploadId,
          ...e.attachments.map((a) => a.uploadId),
        ]),
      ),
    ];
    const [props, tree, docs, links, workRows, filed] = await Promise.all([
      this.properties.list(),
      this.svc.db.select().from(categoryTree),
      uploads.length
        ? this.svc.db
            .select()
            .from(documents)
            .where(inArray(documents.uploadId, uploads))
        : Promise.resolve([]),
      this.svc.db.select().from(taxExpenseLinks),
      this.svc.db
        .select({ id: works.id, propertyId: works.propertyId })
        .from(works),
      uploads.length
        ? this.svc.db
            .select()
            .from(workDocuments)
            .where(inArray(workDocuments.uploadId, uploads))
        : Promise.resolve([]),
    ]);
    const context = {
      properties: props,
      parentOf: new Map(
        tree.filter((c) => !c.deleted).map((c) => [c.id, c.parentId]),
      ),
      documents: new Map(
        docs.filter((d) => !d.deletedAt).map((d) => [d.uploadId, d]),
      ),
      works: new Map(workRows.map((w) => [w.id, w])),
      workOfUpload: new Map(filed.map((f) => [f.uploadId, f.workId])),
      links: new Map(links.map((l) => [l.expenseId, l])),
    };
    return expenses.map((e) => placeTaxExpense(e, context));
  }

  /** The home expenses of every tax year, from svc-tax730; null when it cannot be reached. */
  private async read(): Promise<DossierExpenseDto[] | null> {
    try {
      const years = await this.get<TaxYearDto[]>('/tax-years');
      const dossiers = await Promise.all(
        years.map((y) =>
          this.get<TaxYearDossierDto>(`/tax-years/${y.taxYear}`),
        ),
      );
      return dossiers.flatMap((d) => d.expenses.filter(isHouseExpense));
    } catch (error) {
      this.log.warn(
        `730 not available from ${this.config.tax730Url}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.config.tax730Url}${path}`, {
      signal: AbortSignal.timeout(4000),
      headers: internalHeaders(),
    });
    if (!response.ok)
      throw new Error(`svc-tax730 answered ${response.status} on ${path}`);
    return (await response.json()) as T;
  }
}
