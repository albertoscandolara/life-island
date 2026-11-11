import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { parseOrThrow, RecordCollections } from '@life-island/be-nest';
import {
  applySuggestionRequestSchema,
  lifeQuestionRequestSchema,
  shoppingItemRequestSchema,
  type GroceriesOverviewDto,
  type ShoppingSuggestionDto,
} from '@life-island/contracts';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { shoppingItems } from '../db/schema.js';
import { ShoppingService } from './shopping.service.js';

export const LIST_RECORDS = Symbol('ShoppingListRecords');

export function listCollections(db: NodePgDatabase): RecordCollections {
  return new RecordCollections(db, [
    {
      name: 'list',
      label: 'Item',
      table: shoppingItems,
      request: shoppingItemRequestSchema,
    },
  ]);
}

@Controller()
export class ShoppingController {
  constructor(
    @Inject(ShoppingService) private readonly shopping: ShoppingService,
    @Inject(LIST_RECORDS) private readonly records: RecordCollections,
  ) {}

  /** Months, categories, items with their prices, shops, recent receipts, the list and suggestions. */
  @Get('overview')
  overview(): Promise<GroceriesOverviewDto> {
    return this.shopping.overview();
  }

  @Post('list')
  add(@Body() body: unknown): Promise<{ id: string }> {
    return this.records.create('list', body);
  }

  /** Clears the ticked items off the list. */
  @Delete('list/done')
  @HttpCode(204)
  clearDone(): Promise<void> {
    return this.shopping.clearDone();
  }

  @Put('list/:id')
  @HttpCode(204)
  change(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.records.update('list', id, body);
  }

  @Delete('list/:id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.records.remove('list', id);
  }

  /** The shopping-list tool (Claude, or Life Island's own rules). */
  @Post('suggestions')
  suggest(@Body() body: unknown): Promise<ShoppingSuggestionDto> {
    return this.shopping.suggest(
      parseOrThrow(lifeQuestionRequestSchema, body ?? {}),
    );
  }

  @Post('suggestions/:id/apply')
  apply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ added: number }> {
    return this.shopping.apply(
      id,
      parseOrThrow(applySuggestionRequestSchema, body ?? {}),
    );
  }

  @Delete('suggestions/:id')
  @HttpCode(204)
  removeSuggestion(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.shopping.removeSuggestion(id);
  }
}
