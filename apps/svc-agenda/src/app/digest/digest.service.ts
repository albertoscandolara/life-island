import {
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { internalHeaders, type ServiceDb } from '@life-island/be-common';
import {
  digestScheduleText,
  digestSettings,
  displayName,
  DIGEST_FREQUENCY_SETTING,
  DIGEST_MONTH_DAY_SETTING,
  DIGEST_SETTING_KEYS,
  DIGEST_TIME_SETTING,
  DIGEST_WEEKDAY_SETTING,
  dueDigestSlot,
  localMoment,
  nextDigestSlot,
  personSummaryName,
  type DigestDto,
  type DigestProblem,
  type DigestSendDto,
  type DigestSettings,
  type DigestStatusDto,
  type DigestTestDto,
  type LocalMoment,
  type PersonSummaryDto,
} from '@life-island/contracts';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { CONFIG, MAILER, SERVICE_DB, type ServiceConfig } from '../config.js';
import {
  digestSends,
  settingsReplica,
  type DigestSendRow,
} from '../db/schema.js';
import { AgendaService, timeZone, today } from '../agenda/agenda.service.js';
import { buildDigest } from './digest.js';
import type { Mailer } from './mailer.js';

/** How often the scheduler looks whether a digest is due. */
export const DIGEST_TICK_MS = 60_000;
/** A failed send is tried again after this long, up to DIGEST_MAX_ATTEMPTS times. */
export const DIGEST_RETRY_MINUTES = 15;
export const DIGEST_MAX_ATTEMPTS = 3;
/** Sends are kept this long, for the list on the Agenda. */
const KEEP_DAYS = 400;

/** The settings that move the next send: changing one never sends a missed one at once. */
const SCHEDULE_KEYS = [
  DIGEST_FREQUENCY_SETTING,
  DIGEST_TIME_SETTING,
  DIGEST_WEEKDAY_SETTING,
  DIGEST_MONTH_DAY_SETTING,
];

interface Recipient {
  id: string;
  name: string;
  firstName: string | null;
  email: string | null;
}

type RecipientLookup =
  | { recipient: Recipient; problem: null }
  | { recipient: null; problem: 'people-down' | 'recipient-missing' };

/**
 * The email digest (docs/guides/email-digest.md): reads its settings from the
 * replica of Settings, the person and their email from People, the dates from
 * the Agenda, and sends through SMTP once per period. A period is claimed by
 * inserting its row, so it goes once even with two instances; a failed send
 * is tried again a few times, and one missed by a day (the service was down)
 * waits for the next period.
 */
@Injectable()
export class DigestService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DigestService.name);
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(CONFIG) private readonly config: ServiceConfig,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
    @Inject(AgendaService) private readonly agenda: AgendaService,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject('DIGEST_SCHEDULER') private readonly scheduler: boolean,
  ) {}

  private get db() {
    return this.svc.db;
  }

  onApplicationBootstrap(): void {
    if (!this.scheduler) return;
    if (!this.mailer.configured)
      this.logger.log('Email digest: SMTP_URL is not set, so none is sent');
    const tick = () =>
      void this.tick().catch((error: unknown) =>
        this.logger.warn(`Email digest check failed: ${String(error)}`),
      );
    this.first = setTimeout(tick, 15_000);
    this.timer = setInterval(tick, DIGEST_TICK_MS);
    this.first.unref();
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
  }

  /** The digest settings, and when its schedule last changed (island clock). */
  async settings(): Promise<{
    settings: DigestSettings;
    since: LocalMoment | null;
  }> {
    const rows = await this.db
      .select()
      .from(settingsReplica)
      .where(inArray(settingsReplica.key, [...DIGEST_SETTING_KEYS]));
    const settings = digestSettings(
      new Map(rows.map((row) => [row.key, row.value])),
    );
    const changed = rows
      .filter((row) => SCHEDULE_KEYS.includes(row.key))
      .map((row) => row.changedAt.getTime());
    return {
      settings,
      since: changed.length
        ? localMoment(timeZone(), new Date(Math.max(...changed)))
        : null,
    };
  }

  /** The person picked, from People (it owns them; read over HTTP). */
  private async lookup(id: string): Promise<RecipientLookup> {
    const base = this.config.sources['people'];
    try {
      if (!base) throw new Error('People is not configured (AGENDA_SOURCES)');
      const response = await fetch(`${base}/people`, {
        signal: AbortSignal.timeout(4000),
        headers: internalHeaders(),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const people = (await response.json()) as PersonSummaryDto[];
      const person = people.find((p) => p.id === id);
      if (!person) return { recipient: null, problem: 'recipient-missing' };
      return {
        recipient: {
          id: person.id,
          name: displayName(personSummaryName(person)),
          firstName: person.firstName ? displayName(person.firstName) : null,
          email: person.email ?? null,
        },
        problem: null,
      };
    } catch (error) {
      this.logger.warn(`People could not be read: ${String(error)}`);
      return { recipient: null, problem: 'people-down' };
    }
  }

  private async recipientOf(settings: DigestSettings): Promise<{
    recipient: Recipient | null;
    problem: DigestProblem | null;
  }> {
    if (!settings.recipientId)
      return { recipient: null, problem: 'no-recipient' };
    const found = await this.lookup(settings.recipientId);
    if (found.problem) return found;
    return {
      recipient: found.recipient,
      problem: found.recipient.email ? null : 'no-email',
    };
  }

  async status(now = new Date()): Promise<DigestStatusDto> {
    const [{ settings }, sends] = await Promise.all([
      this.settings(),
      this.db
        .select()
        .from(digestSends)
        .orderBy(desc(digestSends.updatedAt))
        .limit(8),
    ]);
    const { recipient, problem } = await this.recipientOf(settings);
    const first: DigestProblem | null =
      settings.frequency === 'off'
        ? 'off'
        : !this.mailer.configured
          ? 'no-mail'
          : problem;
    return {
      settings,
      schedule: digestScheduleText(settings),
      recipient: recipient
        ? { id: recipient.id, name: recipient.name, email: recipient.email }
        : null,
      mailConfigured: this.mailer.configured,
      problem: first,
      next: nextDigestSlot(settings, localMoment(timeZone(), now))?.at ?? null,
      sends: sends.map(toSendDto),
    };
  }

  /** The digest as it would go now (weekly while it is off). */
  async preview(day = today()): Promise<DigestDto> {
    const { settings } = await this.settings();
    const { recipient } = await this.recipientOf(settings);
    return this.build(settings, recipient, day);
  }

  private async build(
    settings: DigestSettings,
    recipient: Recipient | null,
    day: string,
  ): Promise<DigestDto> {
    const frequency =
      settings.frequency === 'off' ? 'weekly' : settings.frequency;
    const { entries, waiting } = await this.agenda.openDates(day);
    return buildDigest({
      today: day,
      frequency,
      entries,
      waiting,
      appUrl: this.config.appUrl,
      name: recipient?.firstName ?? null,
    });
  }

  /** Sends the digest now to the person picked, whatever the schedule. */
  async test(now = new Date()): Promise<DigestTestDto> {
    if (!this.mailer.configured)
      throw new UnprocessableEntityException(
        'Email is not set up: set SMTP_URL in .env and restart svc-agenda.',
      );
    const { settings } = await this.settings();
    const { recipient, problem } = await this.recipientOf(settings);
    if (!recipient?.email)
      throw new UnprocessableEntityException(problemText(problem, recipient));
    const digest = await this.build(settings, recipient, today());
    const period = `test:${now.toISOString()}`;
    try {
      await this.mailer.send({
        to: recipient.email,
        subject: digest.subject,
        text: digest.text,
        html: digest.html,
      });
    } catch (error) {
      await this.db.insert(digestSends).values({
        period,
        recipient: recipient.email,
        status: 'failed',
        error: errorText(error),
      });
      throw new UnprocessableEntityException(
        `The email server refused it: ${errorText(error)}`,
      );
    }
    await this.db.insert(digestSends).values({
      period,
      recipient: recipient.email,
      status: 'sent',
    });
    return { to: recipient.email, subject: digest.subject };
  }

  /**
   * Sends the digest of the current period if it is due and nobody sent it
   * yet. Returns what happened to it, or null when nothing was due.
   */
  async tick(now = new Date()): Promise<DigestSendDto | null> {
    if (this.running || !this.mailer.configured) return null;
    this.running = true;
    try {
      const { settings, since } = await this.settings();
      const clock = localMoment(timeZone(), now);
      const slot = dueDigestSlot(settings, clock, since);
      if (!slot) return null;
      const claimed = await this.claim(slot.period);
      if (!claimed) return null;
      const finish = async (
        values: Pick<DigestSendRow, 'status' | 'recipient' | 'error'>,
      ) => {
        const [row] = await this.db
          .update(digestSends)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(digestSends.period, slot.period))
          .returning();
        return toSendDto(row);
      };
      const { recipient, problem } = await this.recipientOf(settings);
      if (!recipient?.email)
        return finish({
          status: 'failed',
          recipient: null,
          error: problemText(problem, recipient),
        });
      const digest = await this.build(settings, recipient, clock.slice(0, 10));
      if (digest.empty)
        return finish({ status: 'empty', recipient: null, error: null });
      try {
        await this.mailer.send({
          to: recipient.email,
          subject: digest.subject,
          text: digest.text,
          html: digest.html,
        });
      } catch (error) {
        this.logger.warn(
          `Email digest ${slot.period} not sent: ${errorText(error)}`,
        );
        return finish({
          status: 'failed',
          recipient: recipient.email,
          error: errorText(error),
        });
      }
      this.logger.log(`Email digest ${slot.period} sent`);
      await this.db
        .delete(digestSends)
        .where(
          lt(
            digestSends.createdAt,
            sql`now() - make_interval(days => ${KEEP_DAYS})`,
          ),
        );
      return finish({
        status: 'sent',
        recipient: recipient.email,
        error: null,
      });
    } finally {
      this.running = false;
    }
  }

  /**
   * Takes a period to send: a new row, or a failed (or stuck) one whose
   * retry time has come. False when another instance has it, it was sent, or
   * it failed too many times.
   */
  private async claim(period: string): Promise<boolean> {
    const retryBefore = sql`now() - make_interval(mins => ${DIGEST_RETRY_MINUTES})`;
    const rows = await this.db
      .insert(digestSends)
      .values({ period, status: 'sending', attempts: 1 })
      .onConflictDoUpdate({
        target: digestSends.period,
        set: {
          status: 'sending',
          error: null,
          attempts: sql`${digestSends.attempts} + 1`,
          updatedAt: sql`now()`,
        },
        setWhere: and(
          or(
            eq(digestSends.status, 'failed'),
            eq(digestSends.status, 'sending'),
          ),
          lt(digestSends.attempts, DIGEST_MAX_ATTEMPTS),
          lt(digestSends.updatedAt, retryBefore),
        ),
      })
      .returning({ period: digestSends.period });
    return rows.length > 0;
  }
}

function toSendDto(row: DigestSendRow): DigestSendDto {
  return {
    period: row.period,
    recipient: row.recipient,
    status: row.status,
    attempts: row.attempts,
    error: row.error,
    at: row.updatedAt.toISOString(),
  };
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

/** What stops the digest, said so you can fix it. */
export function problemText(
  problem: DigestProblem | null,
  recipient: { name: string } | null,
): string {
  switch (problem) {
    case 'no-recipient':
      return 'Pick who receives it in Settings, Email digest.';
    case 'people-down':
      return 'People could not be reached, so the address is unknown. Is svc-people running?';
    case 'recipient-missing':
      return 'The person picked is no longer in People: pick another in Settings.';
    case 'no-email':
      return `${recipient?.name ?? 'The person picked'} has no email: add it on their page in People.`;
    case 'no-mail':
      return 'Email is not set up: set SMTP_URL in .env and restart svc-agenda.';
    case 'off':
      return 'The digest is off: choose how often in Settings.';
    default:
      return 'It cannot be sent now.';
  }
}
