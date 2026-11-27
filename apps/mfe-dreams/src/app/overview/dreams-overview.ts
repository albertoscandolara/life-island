import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  DREAM_HARDNESS,
  type DreamDto,
  type DreamsOverviewDto,
  type DreamStepDto,
} from '@life-island/contracts';
import {
  UiButton,
  UiCard,
  UiColumnChart,
  UiEmptyState,
  UiIcon,
  type UiChartSeries,
} from '@life-island/design-system';
import { dateText, daysText } from '@life-island/records-ui';
import { fearPairs, proof, upNext, type UpNextItem } from './overview';

export interface OpenDream {
  dream: DreamDto;
  tab: string;
}

/**
 * Overview: Up next (the one thing that moves each dream now, with its
 * purpose and its plan), the proof your steps collected, and how hard they
 * were against how hard you feared.
 */
@Component({
  selector: 'dreams-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButton, UiCard, UiColumnChart, UiEmptyState, UiIcon],
  templateUrl: './dreams-overview.html',
  styleUrl: './dreams-overview.css',
})
export class DreamsOverview {
  readonly data = input.required<DreamsOverviewDto>();
  readonly checkIn = output<{
    step: DreamStepDto;
    outcome: 'done' | 'skipped' | null;
  }>();
  readonly plan = output<DreamStepDto>();
  readonly smaller = output<DreamStepDto>();
  readonly openDream = output<OpenDream>();
  readonly addDream = output<void>();

  protected readonly dateText = dateText;
  protected readonly daysText = daysText;

  protected readonly items = computed(() => upNext(this.data()));
  protected readonly proof = computed(() => proof(this.data()).slice(0, 6));
  protected readonly pairs = computed(() => fearPairs(this.data()));

  protected readonly chart = computed(() => {
    const pairs = this.pairs();
    const series: UiChartSeries[] = [
      {
        id: 'expected',
        label: 'How hard you feared',
        color: 'var(--viz-1)',
        values: pairs.map((p) => p.expected),
      },
      {
        id: 'actual',
        label: 'How hard it was',
        color: 'var(--viz-2)',
        values: pairs.map((p) => p.actual),
      },
    ];
    return { buckets: pairs.map((p) => p.stepId), series };
  });

  protected readonly fearSummary = computed(() => {
    const pairs = this.pairs();
    const easier = pairs.filter((p) => p.actual < p.expected).length;
    const harder = pairs.filter((p) => p.actual > p.expected).length;
    return { easier, harder, same: pairs.length - easier - harder };
  });

  protected readonly hardAxis = (v: number) =>
    DREAM_HARDNESS.find((h) => h.value === Math.round(v))?.label ?? '';
  protected readonly stepLabel = (id: string) =>
    this.pairs().find((p) => p.stepId === id)?.title ?? '';
  protected readonly stepShort = (id: string) => {
    const t = this.stepLabel(id);
    return t.length > 14 ? `${t.slice(0, 13)}…` : t;
  };

  protected hardText(value: number | null): string {
    return DREAM_HARDNESS.find((h) => h.value === value)?.label ?? '–';
  }

  /** "Saturday 30 nov, in 2 days" or "No day yet". */
  protected whenText(step: DreamStepDto): string {
    if (!step.dueDate) return 'No day yet';
    const days = Math.round(
      (Date.parse(step.dueDate) - Date.parse(this.data().today)) / 86_400_000,
    );
    return `${dateText(step.dueDate)}, ${daysText(days)}`;
  }

  protected late(step: DreamStepDto): boolean {
    return !!step.dueDate && step.dueDate < this.data().today;
  }

  protected open(item: UpNextItem): void {
    this.openDream.emit({
      dream: item.dream,
      tab: item.kind === 'questions' ? 'questions' : 'steps',
    });
  }
}
