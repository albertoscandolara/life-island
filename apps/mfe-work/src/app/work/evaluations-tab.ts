import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  GOAL_STATUS_LABELS,
  GOAL_STATUSES,
  type EvaluationDto,
  type EvaluationRulesDto,
  type EvaluationStatsDto,
  type GoalDto,
  type GoalStatus,
  type ReviewPayDto,
} from '@life-island/contracts';
import {
  UiBadge,
  UiButton,
  UiCard,
  UiEmptyState,
  UiIcon,
  type UiTone,
} from '@life-island/design-system';
import { WorkApi } from '../api/work-api';
import { ColumnChart, type ChartSeries } from '../charts/column-chart';
import { euro, euroShort, periodText, scoreText, signed } from './labels';

const GOAL_TONES: Record<GoalStatus, UiTone> = {
  open: 'info',
  met: 'success',
  partly: 'progress',
  missed: 'danger',
  dropped: 'neutral',
};

const PART_COLORS = [
  'var(--viz-part-1)',
  'var(--viz-part-2)',
  'var(--viz-part-3)',
  'var(--viz-part-4)',
];

/** "1° quadrimestre 2026" as "1° 26", "H2 2025" as "H2 25"; else the month. */
export function cycleShort(
  e: Pick<EvaluationDto, 'cycle' | 'date' | 'periodEnd'>,
): string {
  const cycle = e.cycle ?? '';
  const year = /\b(?:19|20)(\d{2})\b/.exec(cycle)?.[1];
  const nth = /(\d)\s*°/.exec(cycle)?.[1];
  const half = /\b([HQ]\d)\b/i.exec(cycle)?.[1];
  const part = nth ? `${nth}°` : half?.toUpperCase();
  if (year && part) return `${part} ${year}`;
  const date = e.periodEnd ?? e.date;
  if (!date) return cycle || '–';
  const [y, m] = date.split('-');
  return `${periodText(`${y}-${m}`).slice(0, 3)} ${y.slice(2)}`;
}

/**
 * Performance reviews: every evaluation, its score and its parts across the
 * periods, the bonus it converted to, and how your employer's rules read the
 * marks (each workplace has its own rules document, in as many versions as
 * the company publishes).
 */
@Component({
  selector: 'work-evaluations',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ColumnChart, UiBadge, UiButton, UiCard, UiEmptyState, UiIcon],
  templateUrl: './evaluations-tab.html',
  styleUrls: ['./blocks.css', './evaluations-tab.css'],
})
export class EvaluationsTab {
  private readonly api = inject(WorkApi);

  readonly data = input.required<EvaluationStatsDto>();
  readonly goals = input<GoalDto[]>([]);
  readonly reviewsVsPay = input<ReviewPayDto[]>([]);
  /** A goal's status was saved: the page reloads the overview. */
  readonly changed = output<void>();

  protected readonly goalStatuses = GOAL_STATUSES;
  protected readonly goalLabels = GOAL_STATUS_LABELS;
  protected readonly goalTones = GOAL_TONES;
  protected readonly savingGoal = signal<string | null>(null);

  /** Evaluations with a salary to compare, newest first. */
  protected readonly linkedReviews = computed(() =>
    [...this.reviewsVsPay()].filter((r) => r.salaryAt !== null).reverse(),
  );
  protected readonly goalCounts = computed(() =>
    GOAL_STATUSES.map((status) => ({
      status,
      count: this.goals().filter((g) => g.status === status).length,
    })).filter((c) => c.count),
  );

  protected riseText(value: number | null): string {
    if (value === null) return 'Not yet';
    return `${value > 0 ? '+' : ''}${value.toLocaleString('it-IT')}%`;
  }

  protected setGoal(goal: GoalDto, status: GoalStatus, note: string | null) {
    const id = goal.uploadId + goal.key;
    this.savingGoal.set(id);
    this.api
      .setGoalStatus({
        uploadId: goal.uploadId,
        key: goal.key,
        status,
        note: note?.trim() || null,
      })
      .subscribe({
        next: () => {
          this.savingGoal.set(null);
          this.changed.emit();
        },
        error: () => this.savingGoal.set(null),
      });
  }

  protected readonly euro = euro;
  protected readonly euroShort = euroShort;
  protected readonly periodText = periodText;
  protected readonly scoreText = scoreText;
  protected readonly signed = signed;
  protected readonly cycleShort = cycleShort;

  protected readonly latest = computed(() => this.data().latest);
  /** Newest first, for the list. */
  protected readonly newestFirst = computed(() =>
    [...this.data().evaluations].reverse(),
  );
  protected readonly scored = computed(() =>
    this.data().evaluations.filter((e) => e.score !== null),
  );

  /** The latest rules of each workplace, with the older versions behind it. */
  protected readonly rules = computed(() => {
    const byWorkplace = new Map<string, EvaluationRulesDto[]>();
    for (const r of this.data().rules)
      byWorkplace.set(r.workplaceId, [
        ...(byWorkplace.get(r.workplaceId) ?? []),
        r,
      ]);
    return [...byWorkplace.values()].map(([current, ...older]) => ({
      current,
      older,
      /** Highest band first, as a table reads. */
      bands: [...current.bands].reverse(),
    }));
  });

  /** Whether the latest evaluation's workplace has no rules on record. */
  protected readonly missingRules = computed(() => {
    const latest = this.latest();
    return (
      !!latest &&
      !this.data().rules.some((r) => r.workplaceId === latest.workplaceId)
    );
  });

  /** Score of each period, stacked by its sections when the forms list them. */
  protected readonly scoreChart = computed(() => {
    const evaluations = this.scored();
    const buckets = evaluations.map((e) => e.uploadId);
    const names: string[] = [];
    for (const e of evaluations)
      for (const s of e.sections)
        if (!names.some((n) => n.toLowerCase() === s.name.toLowerCase()))
          names.push(s.name);
    const sectioned = evaluations.every((e) => e.sections.length);
    const series: ChartSeries[] =
      sectioned && names.length
        ? names.map((name, i) => ({
            id: `s${i}`,
            label: name,
            color: PART_COLORS[i] ?? 'var(--viz-other)',
            values: evaluations.map(
              (e) =>
                e.sections.find(
                  (s) => s.name.toLowerCase() === name.toLowerCase(),
                )?.score ?? null,
            ),
          }))
        : [
            {
              id: 'score',
              label: 'Score',
              color: 'var(--viz-part-1)',
              values: evaluations.map((e) => e.score),
            },
          ];
    const max = Math.max(0, ...evaluations.map((e) => e.maxScore ?? 0));
    return { buckets, series, max: max || null };
  });

  /** Bonus target and what you were paid, year by year. */
  protected readonly bonusChart = computed(() => {
    const years = this.data().years.filter((y) => y.bonus || y.bonusTarget);
    return {
      buckets: years.map((y) => String(y.year)),
      series: [
        {
          id: 'target',
          label: 'Target',
          color: 'var(--viz-other)',
          values: years.map((y) => y.bonusTarget),
        },
        {
          id: 'paid',
          label: 'Paid',
          color: 'var(--viz-bonus)',
          values: years.map((y) => y.bonus),
        },
      ] satisfies ChartSeries[],
    };
  });

  /** The periods as table columns, oldest first. */
  protected readonly columns = computed(() =>
    this.data().evaluations.filter((e) => e.criteria.length),
  );

  protected scoreOf(
    criterion: EvaluationStatsDto['criteria'][number],
    e: EvaluationDto,
  ): number | null {
    return (
      criterion.points.find((p) => p.uploadId === e.uploadId)?.score ?? null
    );
  }

  protected labelOf = (uploadId: string): string => {
    const e = this.data().evaluations.find((x) => x.uploadId === uploadId);
    if (!e) return uploadId;
    return e.cycle ?? periodText(e.periodEnd ?? e.date);
  };

  protected shortOf = (uploadId: string): string => {
    const e = this.data().evaluations.find((x) => x.uploadId === uploadId);
    return e ? cycleShort(e) : uploadId;
  };

  protected readonly points = (value: number) => value.toLocaleString('it-IT');

  protected pointsText(value: number): string {
    return `${this.points(value)} point${value === 1 ? '' : 's'}`;
  }

  protected percent(value: number | null): string {
    return value === null ? '–' : `${value.toLocaleString('it-IT')}%`;
  }

  /** The share of the target: as the form prints it, else as its rules read the score. */
  protected conversion(e: EvaluationDto): string {
    return this.percent(e.payoutPct ?? e.band?.pct ?? null);
  }

  protected sectionText(s: EvaluationRulesDto['sections'][number]): string {
    return [s.value !== null ? `up to ${this.points(s.value)}` : null, s.note]
      .filter((part) => part)
      .join(', ');
  }

  protected bandRange(b: EvaluationRulesDto['bands'][number]): string {
    if (b.min === null) return `below ${(b.max ?? 0) + 1}`;
    if (b.max === null) return `${b.min} and over`;
    return `${b.min} to ${b.max}`;
  }

  /** Whether the latest score of this workplace falls in the band. */
  protected inBand(
    rules: EvaluationRulesDto,
    b: EvaluationRulesDto['bands'][number],
  ): boolean {
    const latest = [...this.data().evaluations]
      .reverse()
      .find(
        (e) => e.band?.rulesUploadId === rules.uploadId && e.score !== null,
      );
    if (!latest?.band || latest.score === null) return false;
    return latest.band.pct === b.pct && (b.min ?? -Infinity) <= latest.score;
  }

  protected latestOf(rules: EvaluationRulesDto): EvaluationDto | null {
    return (
      [...this.data().evaluations]
        .reverse()
        .find((e) => e.band?.rulesUploadId === rules.uploadId) ?? null
    );
  }

  protected previewUrl(uploadId: string): string {
    return this.api.previewUrl(uploadId);
  }
}
