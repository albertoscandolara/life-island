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
  dreamAnswerRequestSchema,
  dreamCheckInRequestSchema,
  dreamSuggestRequestSchema,
  DREAM_STEP_STATUSES,
  type DeadlineDto,
  type DreamContextDto,
  type DreamDto,
  type DreamsOverviewDto,
  type LifeAttentionDto,
} from '@life-island/contracts';
import { z } from 'zod';
import { DreamsService } from './dreams.service.js';

const stepStatusRequestSchema = z.object({
  status: z.enum(DREAM_STEP_STATUSES),
});

@Controller()
export class DreamsController {
  constructor(@Inject(DreamsService) private readonly dreams: DreamsService) {}

  /** Every dream with its questions, steps, check-ins, guidance and pace. */
  @Get('overview')
  overview(): Promise<DreamsOverviewDto> {
    return this.dreams.overview();
  }

  /** The dates you gave chosen steps, for the Agenda. */
  @Get('deadlines')
  deadlines(@Query() query: unknown): Promise<DeadlineDto[]> {
    return this.dreams.deadlines(parseOrThrow(deadlinesQuerySchema, query));
  }

  @Get('attention')
  attention(): Promise<LifeAttentionDto> {
    return this.dreams.attention();
  }

  /** What the areas a dream shares say now: exactly what the small steps tool reads. */
  @Get('dreams/:id/context')
  context(@Param('id', ParseUUIDPipe) id: string): Promise<DreamContextDto> {
    return this.dreams.context(id);
  }

  /** The questions asked before any step (Claude, or Life Island's own list). */
  @Post('dreams/:id/questions')
  askQuestions(@Param('id', ParseUUIDPipe) id: string): Promise<DreamDto> {
    return this.dreams.askQuestions(id);
  }

  @Put('questions/:id')
  @HttpCode(204)
  answer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.dreams.answer(id, parseOrThrow(dreamAnswerRequestSchema, body));
  }

  /** The next small steps (Claude, or Life Island's own ladder). */
  @Post('dreams/:id/suggestions')
  suggest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<DreamDto> {
    return this.dreams.suggest(
      id,
      parseOrThrow(dreamSuggestRequestSchema, body ?? {}),
    );
  }

  /** Chooses a suggestion, sets it aside, or brings it back. */
  @Put('steps/:id/status')
  @HttpCode(204)
  setStepStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.dreams.setStepStatus(
      id,
      parseOrThrow(stepStatusRequestSchema, body).status,
    );
  }

  /** How a step went, and the pace for the next ones. */
  @Post('check-ins')
  @HttpCode(204)
  checkIn(@Body() body: unknown): Promise<void> {
    return this.dreams.checkIn(parseOrThrow(dreamCheckInRequestSchema, body));
  }

  @Delete('check-ins/:id')
  @HttpCode(204)
  removeCheckIn(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.dreams.removeCheckIn(id);
  }
}
