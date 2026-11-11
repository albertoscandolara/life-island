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
import { parseOrThrow, RecordCollections } from '@life-island/be-nest';
import {
  handledRequestSchema,
  lifeQuestionRequestSchema,
  type AgendaBriefDto,
  type AgendaOverviewDto,
  type AgendaUpcomingDto,
  type LifeAttentionDto,
} from '@life-island/contracts';
import { z } from 'zod';
import { AgendaService } from './agenda.service.js';
import { RECORDS } from './collections.js';

const upcomingQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(366).default(14),
});

@Controller()
export class AgendaController {
  constructor(
    @Inject(AgendaService) private readonly agenda: AgendaService,
    @Inject(RECORDS) private readonly records: RecordCollections,
  ) {}

  /** Every date from 60 days ago to a year ahead, your items and each area's state. */
  @Get('overview')
  overview(): Promise<AgendaOverviewDto> {
    return this.agenda.overview();
  }

  /** The next dates not handled, for the island hub. */
  @Get('upcoming')
  upcoming(@Query() query: unknown): Promise<AgendaUpcomingDto> {
    return this.agenda.upcoming(parseOrThrow(upcomingQuerySchema, query).days);
  }

  /** What needs you, for the island's badge: overdue and this week. */
  @Get('attention')
  attention(): Promise<LifeAttentionDto> {
    return this.agenda.attention();
  }

  /** Marks a date as handled, or not. */
  @Put('handled')
  @HttpCode(204)
  setHandled(@Body() body: unknown): Promise<void> {
    return this.agenda.setHandled(parseOrThrow(handledRequestSchema, body));
  }

  /** An item goes with the handled marks of its dates. */
  @Delete('items/:id')
  @HttpCode(204)
  async removeItem(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.records.remove('items', id);
    await this.agenda.forgetItem(id);
  }

  /** The week brief (Claude, or Life Island's own rules). */
  @Post('briefs')
  writeBrief(@Body() body: unknown): Promise<AgendaBriefDto> {
    return this.agenda.writeBrief(
      parseOrThrow(lifeQuestionRequestSchema, body ?? {}),
    );
  }

  @Delete('briefs/:id')
  @HttpCode(204)
  removeBrief(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.agenda.removeBrief(id);
  }
}
