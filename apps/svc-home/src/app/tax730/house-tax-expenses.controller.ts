import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  createWorkFromTaxExpenseRequestSchema,
  listHouseTaxExpensesQuerySchema,
  updateHouseTaxExpenseRequestSchema,
  type HouseTaxExpenseDto,
  type HouseTaxExpensesDto,
  type WorkDto,
} from '@life-island/contracts';
import { HouseTaxExpensesService } from './house-tax-expenses.service.js';

/** The 730 home expenses (renovations, ecobonus, bonus mobili) under their house. */
@Controller('tax-expenses')
export class HouseTaxExpensesController {
  constructor(
    @Inject(HouseTaxExpensesService)
    private readonly expenses: HouseTaxExpensesService,
  ) {}

  @Get()
  list(@Query() query: unknown): Promise<HouseTaxExpensesDto> {
    return this.expenses.list(
      parseOrThrow(listHouseTaxExpensesQuerySchema, query).property,
    );
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<HouseTaxExpenseDto> {
    return this.expenses.update(
      id,
      parseOrThrow(updateHouseTaxExpenseRequestSchema, body),
    );
  }

  /** Makes a work of the expense on its house, with its invoice and payment. */
  @Post(':id/work')
  createWork(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<WorkDto> {
    return this.expenses.createWork(
      id,
      parseOrThrow(createWorkFromTaxExpenseRequestSchema, body ?? {})
        .propertyId,
    );
  }
}
