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
  resultsExplainRequestSchema,
  type DeadlineDto,
  type HealthOverviewDto,
  type LifeAttentionDto,
  type ResultsExplanationDto,
} from '@life-island/contracts';
import { HealthService } from './health.service.js';

@Controller()
export class HealthAreaController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  /** Visits, medicines, results with their series, vaccinations, checkups and costs. */
  @Get('overview')
  overview(): Promise<HealthOverviewDto> {
    return this.health.overview();
  }

  /** Follow-ups, refills, boosters and checkups, for the Agenda. */
  @Get('deadlines')
  deadlines(@Query() query: unknown): Promise<DeadlineDto[]> {
    return this.health.deadlines(parseOrThrow(deadlinesQuerySchema, query));
  }

  @Get('attention')
  attention(): Promise<LifeAttentionDto> {
    return this.health.attention();
  }

  /** The results explainer (Claude, or Life Island's own rules). */
  @Post('explanations')
  explain(@Body() body: unknown): Promise<ResultsExplanationDto> {
    return this.health.explain(
      parseOrThrow(resultsExplainRequestSchema, body ?? {}),
    );
  }

  @Delete('explanations/:id')
  @HttpCode(204)
  removeExplanation(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.health.removeExplanation(id);
  }
}
