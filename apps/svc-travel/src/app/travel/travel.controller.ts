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
  applyTripPlanRequestSchema,
  deadlinesQuerySchema,
  tripPlanRequestSchema,
  type DeadlineDto,
  type LifeAttentionDto,
  type TravelOverviewDto,
  type TripPlanDto,
} from '@life-island/contracts';
import { TravelService } from './travel.service.js';

@Controller()
export class TravelController {
  constructor(@Inject(TravelService) private readonly travel: TravelService) {}

  /** Every trip with its bookings, checklist and expenses, and the plans. */
  @Get('overview')
  overview(): Promise<TravelOverviewDto> {
    return this.travel.overview();
  }

  /** Departures, free-cancellation limits and checklist dates, for the Agenda. */
  @Get('deadlines')
  deadlines(@Query() query: unknown): Promise<DeadlineDto[]> {
    return this.travel.deadlines(parseOrThrow(deadlinesQuerySchema, query));
  }

  @Get('attention')
  attention(): Promise<LifeAttentionDto> {
    return this.travel.attention();
  }

  /** The trip planner (Claude, or Life Island's own rules). */
  @Post('trips/:id/plans')
  plan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<TripPlanDto> {
    return this.travel.plan(
      id,
      parseOrThrow(tripPlanRequestSchema, body ?? {}),
    );
  }

  @Post('plans/:id/apply')
  applyPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ added: number }> {
    return this.travel.applyPlan(
      id,
      parseOrThrow(applyTripPlanRequestSchema, body ?? {}),
    );
  }

  @Delete('plans/:id')
  @HttpCode(204)
  removePlan(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.travel.removePlan(id);
  }
}
