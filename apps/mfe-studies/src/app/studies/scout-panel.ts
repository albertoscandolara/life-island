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
  learningPath,
  pathStep,
  STUDY_SCOUT_NONE,
  STUDY_SCOUT_SUBJECT_SETTING,
  type LearningPath,
  type OutlineChangeDto,
  type OutlineDecision,
  type StudiesOverviewDto,
} from '@life-island/contracts';
import {
  UiAiPanel,
  UiAiStatus,
  UiButton,
  UiIcon,
} from '@life-island/design-system';
import { AiTool, SettingsApi } from '@life-island/settings-ui';
import { StudiesApi } from '../api/studies-api';
import { dateText, errorText } from './labels';

/** Settings reach svc-studies a moment after they are saved. */
const SETTLE_MS = 1500;

/**
 * The resource scout for the path on screen: whether it keeps this path
 * current (one path at a time), when it scans next, Refresh now, the last
 * scan, and the outline changes it proposes for you to accept or decline.
 * The resources it found sit under each step (paths-tab).
 */
@Component({
  selector: 'studies-scout-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AiTool, UiAiPanel, UiAiStatus, UiButton, UiIcon],
  templateUrl: './scout-panel.html',
  styleUrls: ['./blocks.css', './scout-panel.css'],
})
export class ScoutPanel {
  private readonly api = inject(StudiesApi);
  private readonly settings = inject(SettingsApi);

  readonly data = input.required<StudiesOverviewDto>();
  readonly path = input.required<LearningPath>();
  readonly changed = output<void>();
  readonly failed = output<string>();

  protected readonly dateText = dateText;
  protected readonly busy = signal<string | null>(null);

  protected readonly scout = computed(() => this.data().scout);
  protected readonly watching = computed(
    () => this.scout().subject === this.path().id,
  );
  protected readonly otherName = computed(() => {
    const subject = this.scout().subject;
    return subject && subject !== this.path().id
      ? (learningPath(subject, this.data().catalogue)?.name ?? subject)
      : null;
  });
  /** The latest scan, when it is of this path. */
  protected readonly scan = computed(() => {
    const last = this.scout().lastScan;
    return last?.pathId === this.path().id ? last : null;
  });
  protected readonly running = computed(
    () => this.scout().lastScan?.status === 'running',
  );
  protected readonly proposals = computed(() =>
    this.scout().proposals.filter((p) => p.pathId === this.path().id),
  );

  protected stageTitle(stageId: string): string {
    return this.path().stages.find((s) => s.id === stageId)?.title ?? stageId;
  }

  protected stepTitle(change: OutlineChangeDto): string {
    return (
      change.title ??
      pathStep(change.stepId, this.data().catalogue)?.title ??
      change.stepId
    );
  }

  /** Watch this path (one at a time), or stop watching. */
  protected async watch(on: boolean): Promise<void> {
    this.busy.set('watch');
    try {
      await this.settings.setSetting(
        STUDY_SCOUT_SUBJECT_SETTING,
        on ? this.path().id : STUDY_SCOUT_NONE,
      );
      setTimeout(() => {
        this.busy.set(null);
        this.changed.emit();
      }, SETTLE_MS);
    } catch (error) {
      this.busy.set(null);
      this.failed.emit(
        errorText(error, 'Could not change the path to keep current.'),
      );
    }
  }

  protected refresh(): void {
    this.busy.set('refresh');
    this.api.scoutScan().subscribe({
      next: () => {
        this.busy.set(null);
        this.changed.emit();
      },
      error: (error: unknown) => {
        this.busy.set(null);
        this.failed.emit(errorText(error, 'Could not start the scan.'));
      },
    });
  }

  protected decide(change: OutlineChangeDto, decision: OutlineDecision): void {
    this.busy.set(change.id);
    this.api.decideChange(change.id, { decision }).subscribe({
      next: () => {
        this.busy.set(null);
        this.changed.emit();
      },
      error: (error: unknown) => {
        this.busy.set(null);
        this.failed.emit(errorText(error, 'Could not save your decision.'));
      },
    });
  }
}
