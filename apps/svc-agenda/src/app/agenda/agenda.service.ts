import {
  Inject,
  Injectable,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { readBooleanSetting, type ServiceDb } from '@life-island/be-common';
import { AiAssistant } from '@life-island/be-nest';
import {
  AGENDA_CALENDAR_SETTING,
  agendaBriefOutputSchema,
  DEADLINE_SOURCES,
  isoAddDays,
  isoToday,
  type AgendaBriefDto,

  type AgendaItemDto,
  type AgendaOverviewDto,
  type AgendaUpcomingDto,
  type HandledRequest,
  type LifeAttentionDto,
  type LifeQuestionRequest,
} from '@life-island/contracts';
import { desc, eq, inArray, like } from 'drizzle-orm';
import { CONFIG, SERVICE_DB, type ServiceConfig } from '../config.js';
import {
  agendaItems,
  handledEntries,
  weekBriefs,
  type AgendaItemRow,
  type WeekBriefRow,
} from '../db/schema.js';
import { readDeadlines } from './sources.js';
import {
  BRIEF_INSTRUCTIONS,
  briefDossier,
  buildEntries,
  offlineBrief,
  openEntries,
} from './timeline.js';

/** The AI tool of the Agenda (AI_TOOLS in libs/contracts settings.ts). */
export const BRIEF_TOOL = 'agenda.week-brief';

export function today(): string {
  return isoToday(process.env['SETTINGS_TIMEZONE'] || 'Europe/Rome');
}

const NAMES: Record<string, string> = Object.fromEntries([
  ...DEADLINE_SOURCES.map((s) => [s.module, s.name]),
  ['taxes', '730 & taxes'],
]);

const BRIEF_STEP = {
  stepId: 'brief',
  label: 'Write the brief',
  system: BRIEF_INSTRUCTIONS,
  userTemplate:
    '<dates>\n{today, then one line per open date of the next 45 days: date, days left, area, title, amount, detail}\n</dates>\n\n{My question: <your question>, or: Write my week brief.}',
  outputFormat: 'agendaBriefOutput',
  effort: 'low' as const,
  maxTokens: 6000,
};

@Injectable()
export class AgendaService implements OnApplicationBootstrap {
  private readonly ai: AiAssistant;

  constructor(
    @Inject(CONFIG) private readonly config: ServiceConfig,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
  ) {
    this.ai = new AiAssistant({
      toolId: BRIEF_TOOL,
      service: 'svc-agenda',
      apiKey: config.anthropicApiKey,
      defaultModel: config.aiModel,
      svc,
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.ai.describe([BRIEF_STEP]);
  }

  private get db() {
    return this.svc.db;
  }

  /** Everything from 60 days ago to a year ahead, with the state of each area. */
  private async timeline(day: string, from: string, to: string) {
    const window = { from, to };
    const [read, itemRows, handledRows, calendar] = await Promise.all([
      readDeadlines(this.config.sources, window),
      this.db.select().from(agendaItems).orderBy(agendaItems.date),
      this.db.select({ key: handledEntries.key }).from(handledEntries),
      readBooleanSetting(
        this.svc.pool,
        this.svc.schema,
        AGENDA_CALENDAR_SETTING,
      ).catch(() => true),
    ]);
    const items = itemRows.map(toItemDto);
    const entries = buildEntries({
      today: day,
      window,
      deadlines: read.deadlines,
      items,
      calendar,
      handled: new Set(handledRows.map((r) => r.key)),
    });
    return { entries, items, sources: read.sources, calendar };
  }

  async overview(day = today()): Promise<AgendaOverviewDto> {
    const [{ entries, items, sources, calendar }, briefRows, aiBrief] =
      await Promise.all([
        this.timeline(day, isoAddDays(day, -60), isoAddDays(day, 366)),
        this.db
          .select()
          .from(weekBriefs)
          .orderBy(desc(weekBriefs.createdAt))
          .limit(5),
        this.ai.active(),
      ]);
    return {
      today: day,
      entries,
      items,
      sources,
      italianCalendar: calendar,
      briefs: briefRows.map(toBriefDto),
      aiBrief,
    };
  }

  /** The next dates not handled (overdue included), for the island hub. */
  async upcoming(days: number, day = today()): Promise<AgendaUpcomingDto> {
    const { entries } = await this.timeline(
      day,
      isoAddDays(day, -60),
      isoAddDays(day, days),
    );
    return { today: day, entries: openEntries(entries, days).slice(0, 12) };
  }

  async attention(day = today()): Promise<LifeAttentionDto> {
    const { entries } = await this.timeline(
      day,
      isoAddDays(day, -60),
      isoAddDays(day, 7),
    );
    const open = openEntries(entries, 7);
    return {
      expired: open.filter((e) => e.daysLeft < 0).length,
      expiring: open.filter((e) => e.daysLeft >= 0).length,
      toReview: 0,
    };
  }

  async setHandled(request: HandledRequest): Promise<void> {
    if (request.key.startsWith('item:')) {
      // A one-off item is simply done; a repeating one keeps one key per date.
      const [, id] = request.key.split(':');
      const [item] = await this.db
        .select()
        .from(agendaItems)
        .where(eq(agendaItems.id, id))
        .catch(() => []);
      if (!item) throw new NotFoundException('Item not found');
      if (item.repeat === 'none') {
        await this.db
          .update(agendaItems)
          .set({ done: request.handled })
          .where(eq(agendaItems.id, id));
        return;
      }
    }
    if (request.handled)
      await this.db
        .insert(handledEntries)
        .values({ key: request.key })
        .onConflictDoNothing();
    else
      await this.db
        .delete(handledEntries)
        .where(eq(handledEntries.key, request.key));
  }

  /** Forgets the handled marks of an item's dates when the item goes. */
  async forgetItem(id: string): Promise<void> {
    await this.db
      .delete(handledEntries)
      .where(like(handledEntries.key, `item:${id}:%`));
  }

  async writeBrief(
    request: LifeQuestionRequest,
    day = today(),
  ): Promise<AgendaBriefDto> {
    const { entries } = await this.timeline(
      day,
      isoAddDays(day, -60),
      isoAddDays(day, 45),
    );
    const question = request.question?.trim() || null;
    let row: Omit<WeekBriefRow, 'id' | 'createdAt'>;
    if (await this.ai.active()) {
      const answer = await this.ai.ask({
        step: BRIEF_STEP,
        output: agendaBriefOutputSchema,
        user: `<dates>\n${briefDossier(day, entries, NAMES)}\n</dates>\n\n${
          question ? `My question: ${question}` : 'Write my week brief.'
        }`,
      });
      row = {
        question,
        output: answer.output,
        source: 'claude',
        model: answer.model,
      };
    } else
      row = {
        question,
        output: offlineBrief(entries, NAMES),
        source: 'offline',
        model: null,
      };
    const [saved] = await this.db.insert(weekBriefs).values(row).returning();
    // Keep the last 10.
    const old = await this.db
      .select({ id: weekBriefs.id })
      .from(weekBriefs)
      .orderBy(desc(weekBriefs.createdAt))
      .offset(10);
    if (old.length)
      await this.db.delete(weekBriefs).where(
        inArray(
          weekBriefs.id,
          old.map((o) => o.id),
        ),
      );
    return toBriefDto(saved);
  }

  async removeBrief(id: string): Promise<void> {
    const deleted = await this.db
      .delete(weekBriefs)
      .where(eq(weekBriefs.id, id))
      .returning({ id: weekBriefs.id });
    if (!deleted.length) throw new NotFoundException('Brief not found');
  }
}

export function toItemDto(row: AgendaItemRow): AgendaItemDto {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

function toBriefDto(row: WeekBriefRow): AgendaBriefDto {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

