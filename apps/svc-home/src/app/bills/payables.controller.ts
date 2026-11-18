import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import { parseOrThrow } from '@life-island/be-nest';
import { payablesQuerySchema, type PayableDto } from '@life-island/contracts';
import { SERVICE_DB } from '../config.js';
import { organizations } from '../db/schema.js';
import { BillsService } from './bills.service.js';
import { billPayables } from './payables.js';

/** The bills to pay, for Money matching (`GET /payables`). */
@Controller()
export class HomePayablesController {
  constructor(
    @Inject(BillsService) private readonly bills: BillsService,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
  ) {}

  @Get('payables')
  async payables(@Query() query: unknown): Promise<PayableDto[]> {
    const window = parseOrThrow(payablesQuerySchema, query);
    const [bills, suppliers] = await Promise.all([
      this.bills.list({ utility: undefined }),
      this.svc.db
        .select({
          id: organizations.id,
          name: organizations.name,
          aliases: organizations.aliases,
        })
        .from(organizations),
    ]);
    return billPayables(
      bills,
      new Map(suppliers.map((s) => [s.id, s])),
      window,
    );
  }
}
