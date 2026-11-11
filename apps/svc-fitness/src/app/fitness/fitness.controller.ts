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
  type DeadlineDto,
  type FitnessOverviewDto,
  type LifeAttentionDto,
  type TrainingPlanDto,
} from '@life-island/contracts';
import { FitnessService } from './fitness.service.js';

@Controller()
export class FitnessController {
  constructor(
    @Inject(FitnessService) private readonly fitness: FitnessService,
  ) {}

  /** Workouts, measurements, events, weeks against the goal and the plans. */
  @Get('overview')
  overview(): Promise<FitnessOverviewDto> {
    return this.fitness.overview();
  }

  /** The events you train for, for the Agenda. */
  @Get('deadlines')
  deadlines(@Query() query: unknown): Promise<DeadlineDto[]> {
    return this.fitness.deadlines(parseOrThrow(deadlinesQuerySchema, query));
  }

  @Get('attention')
  attention(): Promise<LifeAttentionDto> {
    return this.fitness.attention();
  }

  /** The training plan (Claude, or Life Island's own rules). */
  @Post('plans')
  plan(@Body() body: unknown): Promise<TrainingPlanDto> {
    return this.fitness.plan(
      parseOrThrow(lifeQuestionRequestSchema, body ?? {}),
    );
  }

  @Delete('plans/:id')
  @HttpCode(204)
  removePlan(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.fitness.removePlan(id);
  }
}
