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
  habitCheckRequestSchema,
  lifeQuestionRequestSchema,
  weeklyReviewRequestSchema,
  type DeadlineDto,
  type GoalsCoachDto,
  type GoalsOverviewDto,
  type LifeAttentionDto,
} from '@life-island/contracts';
import { GoalsService } from './goals.service.js';

@Controller()
export class GoalsController {
  constructor(@Inject(GoalsService) private readonly goals: GoalsService) {}

  /** Goals with their steps and progress, habits with this week, reviews and advice. */
  @Get('overview')
  overview(): Promise<GoalsOverviewDto> {
    return this.goals.overview();
  }

  /** Goal target dates and step due dates, for the Agenda. */
  @Get('deadlines')
  deadlines(@Query() query: unknown): Promise<DeadlineDto[]> {
    return this.goals.deadlines(parseOrThrow(deadlinesQuerySchema, query));
  }

  @Get('attention')
  attention(): Promise<LifeAttentionDto> {
    return this.goals.attention();
  }

  /** Ticks (or unticks) a habit for a day. */
  @Put('habits/:id/checks')
  @HttpCode(204)
  checkHabit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.goals.checkHabit(id, parseOrThrow(habitCheckRequestSchema, body));
  }

  /** The review of one week; writing it again replaces it. */
  @Put('weekly-reviews')
  @HttpCode(204)
  saveWeeklyReview(@Body() body: unknown): Promise<void> {
    return this.goals.saveWeeklyReview(parseOrThrow(weeklyReviewRequestSchema, body));
  }

  /** The coach (Claude, or Life Island's own rules). */
  @Post('advice')
  coach(@Body() body: unknown): Promise<GoalsCoachDto> {
    return this.goals.coach(parseOrThrow(lifeQuestionRequestSchema, body ?? {}));
  }

  @Delete('advice/:id')
  @HttpCode(204)
  removeAdvice(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.goals.removeAdvice(id);
  }
}
