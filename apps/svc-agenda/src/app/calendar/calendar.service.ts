import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import {
  isoAddDays,
  type CalendarFeedDto,
  type CalendarFeedLinkDto,
} from '@life-island/contracts';
import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { CONFIG, SERVICE_DB, type ServiceConfig } from '../config.js';
import { calendarFeeds, type CalendarFeedRow } from '../db/schema.js';
import { AgendaService, today } from '../agenda/agenda.service.js';
import { buildCalendar } from './ics.js';

/** The feed reaches back this far, and a year ahead. */
const FEED_PAST_DAYS = 30;

const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/**
 * The private calendar link (docs/guides/calendar-feed.md). Calendar apps
 * cannot sign in, so the link carries a 256-bit secret instead: only its
 * SHA-256 is stored, the link is shown once, and a new one or turning it off
 * stops the old one at once. The feed is read-only and holds only dates.
 */
@Injectable()
export class CalendarService {
  constructor(
    @Inject(CONFIG) private readonly config: ServiceConfig,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
    @Inject(AgendaService) private readonly agenda: AgendaService,
  ) {}

  private get db() {
    return this.svc.db;
  }

  async status(): Promise<CalendarFeedDto> {
    const [row] = await this.db
      .select()
      .from(calendarFeeds)
      .orderBy(desc(calendarFeeds.createdAt))
      .limit(1);
    return toDto(row ?? null);
  }

  /** A new link; the one before, if any, stops working. */
  async create(): Promise<CalendarFeedLinkDto> {
    const token = randomBytes(32).toString('base64url');
    const row = await this.db.transaction(async (tx) => {
      await tx.delete(calendarFeeds);
      const [created] = await tx
        .insert(calendarFeeds)
        .values({ tokenHash: hash(token) })
        .returning();
      return created;
    });
    return {
      ...toDto(row),
      url: `${this.config.appUrl}/api/agenda/calendar/feed/${token}.ics`,
    };
  }

  async remove(): Promise<void> {
    await this.db.delete(calendarFeeds);
  }

  /** The feed for a secret; 404 for any other, so a wrong one says nothing. */
  async feed(token: string, now = new Date()): Promise<string> {
    const [row] = await this.db
      .select()
      .from(calendarFeeds)
      .where(eq(calendarFeeds.tokenHash, hash(token)));
    if (!row) throw new NotFoundException();
    // Remember when it was read, at most once a minute.
    await this.db
      .update(calendarFeeds)
      .set({ lastReadAt: now })
      .where(
        and(
          eq(calendarFeeds.id, row.id),
          or(
            isNull(calendarFeeds.lastReadAt),
            lt(calendarFeeds.lastReadAt, new Date(now.getTime() - 60_000)),
          ),
        ),
      );
    const day = today();
    const { entries } = await this.agenda.window(
      day,
      isoAddDays(day, -FEED_PAST_DAYS),
      isoAddDays(day, 366),
    );
    return buildCalendar({ entries, appUrl: this.config.appUrl, now });
  }
}

function toDto(row: CalendarFeedRow | null): CalendarFeedDto {
  return {
    active: !!row,
    createdAt: row?.createdAt.toISOString() ?? null,
    lastReadAt: row?.lastReadAt?.toISOString() ?? null,
  };
}
