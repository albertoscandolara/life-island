import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import type {
  CalendarFeedDto,
  CalendarFeedLinkDto,
} from '@life-island/contracts';
import { CalendarService } from './calendar.service.js';

const FEED_FILE = /^([A-Za-z0-9_-]{43})\.ics$/;

/** The private calendar link: made, shown, renewed and turned off when signed in. */
@Controller('calendar')
export class CalendarController {
  constructor(
    @Inject(CalendarService) private readonly calendar: CalendarService,
  ) {}

  @Get()
  status(): Promise<CalendarFeedDto> {
    return this.calendar.status();
  }

  @Post()
  create(): Promise<CalendarFeedLinkDto> {
    return this.calendar.create();
  }

  @Delete()
  @HttpCode(204)
  remove(): Promise<void> {
    return this.calendar.remove();
  }

  /**
   * The feed itself, read by calendar apps without sign-in: the only open
   * route of svc-agenda (bootstrap.ts, CALENDAR_FEED_PATH), checked by its secret.
   */
  @Get('feed/:file')
  async feed(
    @Param('file') file: string,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<string> {
    const token = FEED_FILE.exec(file)?.[1];
    if (!token) throw new NotFoundException();
    const ics = await this.calendar.feed(token);
    // Set only on success: a 404 stays a plain JSON error.
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="life-island.ics"');
    return ics;
  }
}
