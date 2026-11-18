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
import { MatchingService } from '../matching/matching.service.js';
import { MoneyService } from './money.service.js';

@Controller()
export class MoneyController {
  constructor(
    @Inject(MoneyService) private readonly money: MoneyService,
    @Inject(MatchingService) private readonly matching: MatchingService,
  ) {}

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
  async attention(): Promise<LifeAttentionDto> {
    // The payments to confirm come from the other areas: one that is down
    // never hides Money's own counts.
    const [counts, matches] = await Promise.all([
      this.money.attention(),
      this.matching.attention().catch(() => ({ ready: 0, items: [] })),
    ]);
    return {
      ...counts,
      toReview: counts.toReview + matches.ready,
      items: [...(counts.items ?? []), ...matches.items],
    };
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
