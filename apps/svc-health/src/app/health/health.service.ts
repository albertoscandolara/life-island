import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import { AiAssistant } from '@life-island/be-nest';
import {
  deadlineWindow,
  inDeadlineWindow,
  isoAddDays,
  isoToday,
  resultsExplainerOutputSchema,
  VISIT_KIND_LABELS,
  type DeadlineDto,
  type DeadlinesQuery,
  type HealthOverviewDto,
  type LifeAttentionDto,
  type ResultsExplainRequest,
  type ResultsExplanationDto,
} from '@life-island/contracts';
import { desc, eq, inArray } from 'drizzle-orm';
import { CONFIG, SERVICE_DB, type ServiceConfig } from '../config.js';
import {
  checkups,
  explanations,
  medicines,
  testResults,
  vaccinations,
  visits,
  type ExplanationRow,
} from '../db/schema.js';
import {
  EXPLAINER_INSTRUCTIONS,
  explainerDossier,
  offlineExplanation,
  series,
  withDue,
  withFlag,
} from './records.js';

/** The AI tool of Health (AI_TOOLS in libs/contracts settings.ts). */
export const EXPLAINER_TOOL = 'health.results-explainer';

export function today(): string {
  return isoToday(process.env['SETTINGS_TIMEZONE'] || 'Europe/Rome');
}

const EXPLAIN_STEP = {
  stepId: 'explain',
  label: 'Explain the results',
  system: EXPLAINER_INSTRUCTIONS,
  userTemplate:
    'Results:\n{one line per test: name, unit, reference range, the last 5 dated values with H/L flags}\n\n{My question: <your question>, or: Explain my results.}',
  outputFormat: 'resultsExplainerOutput',
  effort: 'medium' as const,
  maxTokens: 8000,
};

const iso = <T extends { createdAt: Date }>(row: T) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
});

@Injectable()
export class HealthService implements OnApplicationBootstrap {
  private readonly ai: AiAssistant;

  constructor(
    @Inject(CONFIG) config: ServiceConfig,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
  ) {
    this.ai = new AiAssistant({
      toolId: EXPLAINER_TOOL,
      service: 'svc-health',
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

  private async records(day: string) {
    const [visitRows, medicineRows, resultRows, vaccinationRows, checkupRows] =
      await Promise.all([
        this.db.select().from(visits).orderBy(desc(visits.date)),
        this.db.select().from(medicines).orderBy(desc(medicines.active), medicines.name),
        this.db.select().from(testResults).orderBy(desc(testResults.date), testResults.test),
        this.db.select().from(vaccinations).orderBy(desc(vaccinations.date)),
        this.db.select().from(checkups).orderBy(checkups.person, checkups.name),
      ]);
    const results = resultRows.map((r) => withFlag(iso(r)));
    return {
      visits: visitRows.map(iso),
      medicines: medicineRows.map(iso),
      results,
      series: series(results),
      vaccinations: vaccinationRows.map(iso),
      checkups: checkupRows
        .map((c) => withDue(iso(c), day))
        .sort((a, b) => a.nextDueOn.localeCompare(b.nextDueOn)),
    };
  }

  async overview(day = today()): Promise<HealthOverviewDto> {
    const [records, explanationRows, aiExplainer] = await Promise.all([
      this.records(day),
      this.db.select().from(explanations).orderBy(desc(explanations.createdAt)).limit(5),
      this.ai.active(),
    ]);
    const year = Number(day.slice(0, 4));
    const thisYear = records.visits.filter((v) => v.date.startsWith(String(year)));
    const people = new Set<string>();
    for (const list of [records.visits, records.medicines, records.results, records.vaccinations, records.checkups])
      for (const r of list) people.add(r.person);
    return {
      today: day,
      people: [...people].sort(),
      ...records,
      costs: {
        year,
        total: round(thisYear.reduce((s, v) => s + (v.cost ?? 0), 0)),
        deductible: round(thisYear.filter((v) => v.deductible).reduce((s, v) => s + (v.cost ?? 0), 0)),
      },
      explanations: explanationRows.map(toExplanationDto),
      aiExplainer,
    };
  }

  /** Follow-ups, refills, vaccine boosters and checkups, for the Agenda. */
  async deadlines(query: DeadlinesQuery, day = today()): Promise<DeadlineDto[]> {
    const window = deadlineWindow(query, day);
    const r = await this.records(day);
    const out: DeadlineDto[] = [];
    const add = (d: Omit<DeadlineDto, 'module' | 'amount'>) =>
      inDeadlineWindow(d.date, window) && out.push({ ...d, module: 'health', amount: null });
    for (const v of r.visits)
      if (v.followUpOn)
        add({
          id: `follow-up:${v.id}:${v.followUpOn}`,
          kind: 'follow-up',
          title: `Follow-up: ${v.doctor ?? VISIT_KIND_LABELS[v.kind]} (${v.person})`,
          detail: v.reason,
          date: v.followUpOn,
          path: '/health?tab=visits',
        });
    for (const m of r.medicines)
      if (m.active && m.refillOn)
        add({
          id: `refill:${m.id}:${m.refillOn}`,
          kind: 'refill',
          title: `${m.name} runs out (${m.person})`,
          detail: 'Get the prescription or a new box.',
          date: m.refillOn,
          path: '/health?tab=medicines',
        });
    // Only the latest dose of each vaccine says when the next one is due.
    const latest = new Map<string, (typeof r.vaccinations)[number]>();
    for (const v of r.vaccinations) {
      const key = `${v.person}|${v.name.toLowerCase()}`;
      if (!latest.has(key)) latest.set(key, v);
    }
    for (const v of latest.values())
      if (v.nextDueOn)
        add({
          id: `vaccine:${v.id}:${v.nextDueOn}`,
          kind: 'vaccine',
          title: `${v.name} booster (${v.person})`,
          detail: null,
          date: v.nextDueOn,
          path: '/health?tab=vaccinations',
        });
    for (const c of r.checkups)
      add({
        id: `checkup:${c.id}:${c.nextDueOn}`,
        kind: 'checkup',
        title: `${c.name} (${c.person})`,
        detail: c.lastDoneOn ? `Last done ${c.lastDoneOn}; every ${c.everyMonths} months.` : 'Never recorded as done.',
        date: c.nextDueOn,
        path: '/health?tab=checkups',
      });
    return out;
  }

  async attention(day = today()): Promise<LifeAttentionDto> {
    const r = await this.records(day);
    const soon = isoAddDays(day, 30);
    return {
      expired: r.checkups.filter((c) => c.overdue).length,
      expiring:
        r.checkups.filter((c) => !c.overdue && c.nextDueOn <= soon).length +
        r.medicines.filter((m) => m.active && m.refillOn && m.refillOn <= isoAddDays(day, 7)).length,
      toReview: 0,
    };
  }

  async explain(
    request: ResultsExplainRequest,
    day = today(),
  ): Promise<ResultsExplanationDto> {
    const person = request.person?.trim() || null;
    const question = request.question?.trim() || null;
    const all = (await this.records(day)).series;
    const list = person ? all.filter((s) => s.person === person) : all;
    let row: Omit<ExplanationRow, 'id' | 'createdAt'>;
    if (await this.ai.active()) {
      const answer = await this.ai.ask({
        step: EXPLAIN_STEP,
        output: resultsExplainerOutputSchema,
        // The person's name is not sent: only the values.
        user: `${explainerDossier(null, list)}\n\n${question ? `My question: ${question}` : 'Explain my results.'}`,
      });
      row = { person, question, output: answer.output, source: 'claude', model: answer.model };
    } else
      row = { person, question, output: offlineExplanation(list), source: 'offline', model: null };
    const [saved] = await this.db.insert(explanations).values(row).returning();
    const old = await this.db
      .select({ id: explanations.id })
      .from(explanations)
      .orderBy(desc(explanations.createdAt))
      .offset(10);
    if (old.length)
      await this.db.delete(explanations).where(inArray(explanations.id, old.map((o) => o.id)));
    return toExplanationDto(saved);
  }

  async removeExplanation(id: string): Promise<void> {
    await this.db.delete(explanations).where(eq(explanations.id, id));
  }
}

const round = (v: number) => Math.round(v * 100) / 100;

function toExplanationDto(row: ExplanationRow): ResultsExplanationDto {
  return { ...row, createdAt: row.createdAt.toISOString() };
}
