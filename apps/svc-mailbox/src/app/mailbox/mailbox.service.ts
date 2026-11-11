import { Inject, Injectable, NotFoundException, type OnApplicationBootstrap } from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import { AiAssistant } from '@life-island/be-nest';
import {
  deadlineWindow,
  inDeadlineWindow,
  isLifeIsoDate,
  isoDaysBetween,
  isoToday,
  letterExplainerOutputSchema,
  type DeadlineDto,
  type DeadlinesQuery,
  type LetterDto,
  type LetterExplanationDto,
  type LifeAttentionDto,
  type MailboxOverviewDto,
} from '@life-island/contracts';
import { desc, eq } from 'drizzle-orm';
import { CONFIG, SERVICE_DB, type ServiceConfig } from '../config.js';
import { letters, type LetterRow } from '../db/schema.js';
import { EXPLAINER_INSTRUCTIONS, offlineReading } from './reading.js';

/** The AI tool of the Mailbox (AI_TOOLS in libs/contracts settings.ts). */
export const EXPLAINER_TOOL = 'mailbox.letter-explainer';

export function today(): string {
  return isoToday(process.env['SETTINGS_TIMEZONE'] || 'Europe/Rome');
}

const EXPLAIN_STEP = {
  stepId: 'explain',
  label: 'Explain the letter',
  system: EXPLAINER_INSTRUCTIONS,
  userTemplate: 'Today is {today}.\nFrom: {sender}\nSubject: {subject}\n<letter>\n{the text, up to 20,000 characters}\n</letter>',
  outputFormat: 'letterExplainerOutput',
  effort: 'medium' as const,
  maxTokens: 8000,
};

const isOpen = (l: Pick<LetterDto, 'status'>) => l.status === 'todo' || l.status === 'waiting';

@Injectable()
export class MailboxService implements OnApplicationBootstrap {
  private readonly ai: AiAssistant;

  constructor(
    @Inject(CONFIG) config: ServiceConfig,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
  ) {
    this.ai = new AiAssistant({
      toolId: EXPLAINER_TOOL,
      service: 'svc-mailbox',
      apiKey: config.anthropicApiKey,
      defaultModel: config.aiModel,
      svc,
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.ai.describe([EXPLAIN_STEP]);
  }

  private get db() {
    return this.svc.db;
  }

  private async letters(day: string): Promise<LetterDto[]> {
    const rows = await this.db.select().from(letters).orderBy(desc(letters.receivedOn), desc(letters.createdAt));
    return rows.map((r) => toLetterDto(r, day));
  }

  async overview(day = today()): Promise<MailboxOverviewDto> {
    const [all, aiExplainer] = await Promise.all([this.letters(day), this.ai.active()]);
    const open = all.filter(isOpen);
    return {
      today: day,
      letters: all.sort(
        (a, b) =>
          Number(isOpen(b)) - Number(isOpen(a)) ||
          (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999') ||
          b.receivedOn.localeCompare(a.receivedOn),
      ),
      totals: {
        open: open.length,
        overdue: open.filter((l) => l.daysLeft !== null && l.daysLeft < 0).length,
        dueSoon: open.filter((l) => l.daysLeft !== null && l.daysLeft >= 0 && l.daysLeft <= 14).length,
        toPay: Math.round(open.reduce((s, l) => s + (l.amount ?? 0), 0) * 100) / 100,
      },
      aiExplainer,
    };
  }

  async deadlines(query: DeadlinesQuery, day = today()): Promise<DeadlineDto[]> {
    const window = deadlineWindow(query, day);
    return (await this.letters(day))
      .filter((l) => isOpen(l) && l.dueOn && inDeadlineWindow(l.dueOn, window))
      .map((l) => ({
        id: `letter:${l.id}:${l.dueOn}`,
        module: 'mailbox',
        kind: l.kind,
        title: `${l.subject} (${l.sender})`,
        detail: l.action,
        date: l.dueOn!,
        amount: l.amount,
        path: '/mailbox',
      }));
  }

  async attention(day = today()): Promise<LifeAttentionDto> {
    const open = (await this.letters(day)).filter(isOpen);
    return {
      expired: open.filter((l) => l.daysLeft !== null && l.daysLeft < 0).length,
      expiring: open.filter((l) => l.daysLeft !== null && l.daysLeft >= 0 && l.daysLeft <= 7).length,
      toReview: open.filter((l) => !l.dueOn && !l.action).length,
    };
  }

  private async row(id: string): Promise<LetterRow> {
    const [row] = await this.db.select().from(letters).where(eq(letters.id, id)).catch(() => []);
    if (!row) throw new NotFoundException('Letter not found');
    return row;
  }

  /** Explains a letter and keeps the explanation on it. */
  async explain(id: string, day = today()): Promise<LetterDto> {
    const letter = await this.row(id);
    let explanation: LetterExplanationDto;
    if ((await this.ai.active()) && letter.text?.trim()) {
      const answer = await this.ai.ask({
        step: EXPLAIN_STEP,
        output: letterExplainerOutputSchema,
        user: `Today is ${day}.\nFrom: ${letter.sender}\nSubject: ${letter.subject}\n<letter>\n${letter.text.slice(0, 20000)}\n</letter>`,
      });
      explanation = { output: answer.output, source: 'claude', model: answer.model, createdAt: new Date().toISOString() };
    } else
      explanation = { output: offlineReading(letter, day), source: 'offline', model: null, createdAt: new Date().toISOString() };
    const [saved] = await this.db
      .update(letters)
      .set({ explanation, updatedAt: new Date() })
      .where(eq(letters.id, id))
      .returning();
    return toLetterDto(saved, day);
  }

  /** Copies what the explanation found (kind, amount, date, steps) into the empty fields. */
  async applyExplanation(id: string): Promise<void> {
    const letter = await this.row(id);
    const out = letter.explanation?.output;
    if (!out) throw new NotFoundException('The letter has no explanation yet');
    await this.db
      .update(letters)
      .set({
        kind: letter.kind === 'other' ? out.kind : letter.kind,
        amount: letter.amount ?? (out.amount > 0 ? out.amount : null),
        dueOn: letter.dueOn ?? (isLifeIsoDate(out.dueOn) ? out.dueOn : null),
        action: letter.action ?? (out.actions.map((a) => a.what).join('; ').slice(0, 1000) || null),
        updatedAt: new Date(),
      })
      .where(eq(letters.id, id));
  }
}

function toLetterDto(row: LetterRow, day: string): LetterDto {
  const { updatedAt: _, ...rest } = row;
  return {
    ...rest,
    createdAt: row.createdAt.toISOString(),
    daysLeft: row.dueOn ? isoDaysBetween(day, row.dueOn) : null,
  };
}

