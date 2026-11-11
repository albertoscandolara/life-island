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
  Query,
} from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  deadlinesQuerySchema,
  lifeQuestionRequestSchema,
  type DeadlineDto,
  type LifeAttentionDto,
  type RenewalAdviceDto,
  type SubscriptionsOverviewDto,
} from '@life-island/contracts';
import { SubscriptionsService } from './subscriptions.service.js';

@Controller()
export class SubscriptionsController {
  constructor(@Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService) {}

  /** Every contract with its cost, next renewal and cancel-by date, totals and advice. */
  @Get('overview')
  overview(): Promise<SubscriptionsOverviewDto> {
    return this.subscriptions.overview();
  }

  /** Renewals, last days to cancel and minimum terms, for the Agenda. */
  @Get('deadlines')
  deadlines(@Query() query: unknown): Promise<DeadlineDto[]> {
    return this.subscriptions.deadlines(parseOrThrow(deadlinesQuerySchema, query));
  }

  @Get('attention')
  attention(): Promise<LifeAttentionDto> {
    return this.subscriptions.attention();
  }

  /** Changes a contract; a new cost is remembered as a price change. */
  @Put('items/:id')
  @HttpCode(204)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<void> {
    return this.subscriptions.update(id, body);
  }

  /** The renewal advisor (Claude, or Life Island's own rules). */
  @Post('advice')
  advise(@Body() body: unknown): Promise<RenewalAdviceDto> {
    return this.subscriptions.advise(parseOrThrow(lifeQuestionRequestSchema, body ?? {}));
  }

  @Delete('advice/:id')
  @HttpCode(204)
  removeAdvice(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.subscriptions.removeAdvice(id);
  }
}
