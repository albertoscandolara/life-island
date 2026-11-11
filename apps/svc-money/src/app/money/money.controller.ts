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
  Query,
} from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  deadlinesQuerySchema,
  lifeQuestionRequestSchema,
  transactionImportRequestSchema,
  type DeadlineDto,
  type LifeAttentionDto,
  type MoneyOverviewDto,
  type SpendingReviewDto,
} from '@life-island/contracts';
import { MoneyService } from './money.service.js';

@Controller()
export class MoneyController {
  constructor(@Inject(MoneyService) private readonly money: MoneyService) {}

  /** Accounts, movements, budgets, months, recurring charges and reviews. */
  @Get('overview')
  overview(): Promise<MoneyOverviewDto> {
    return this.money.overview();
  }

  /** The recurring charges expected in the window, for the Agenda. */
  @Get('deadlines')
  deadlines(@Query() query: unknown): Promise<DeadlineDto[]> {
    return this.money.deadlines(parseOrThrow(deadlinesQuerySchema, query));
  }

  @Get('attention')
  attention(): Promise<LifeAttentionDto> {
    return this.money.attention();
  }

  /** Many movements at once, e.g. from a bank's CSV export. */
  @Post('transactions/import')
  importTransactions(
    @Body() body: unknown,
  ): Promise<{ added: number; skipped: number }> {
    return this.money.importTransactions(
      parseOrThrow(transactionImportRequestSchema, body),
    );
  }

  /** The spending review (Claude, or Life Island's own rules). */
  @Post('reviews')
  writeReview(@Body() body: unknown): Promise<SpendingReviewDto> {
    return this.money.writeReview(
      parseOrThrow(lifeQuestionRequestSchema, body ?? {}),
    );
  }

  @Delete('reviews/:id')
  @HttpCode(204)
  removeReview(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.money.removeReview(id);
  }
}
