import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type { LearningPath, StudiesOverviewDto } from '@life-island/contracts';
import {
  UiAiPanel,
  UiAiStatus,
  UiButton,
  UiIcon,
} from '@life-island/design-system';
import { AiTool } from '@life-island/settings-ui';
import type { Observable } from 'rxjs';
import { StudiesApi } from '../api/studies-api';
import { dateText, errorText } from './labels';

/**
 * The resource scout for the path on screen: it keeps every path you follow
 * current, so this says when it scans this one next, with Refresh now and
 * Stop watching, the last scan, and how much waits in Fresh resources.
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

  readonly data = input.required<StudiesOverviewDto>();
  readonly path = input.required<LearningPath>();
  readonly changed = output<void>();
  readonly failed = output<string>();
  readonly openFresh = output<void>();

  protected readonly dateText = dateText;
  protected readonly busy = signal<string | null>(null);

  protected readonly scout = computed(() => this.data().scout);
  /** This path's watch; undefined when you do not follow it. */
  protected readonly watch = computed(() =>
    this.scout().watched.find((w) => w.pathId === this.path().id),
  );
  protected readonly running = computed(
    () => this.scout().lastScan?.status === 'running',
  );
  protected readonly budgetLeft = computed(
    () => this.scout().scansThisMonth < this.scout().monthlyScans,
  );
  /** What waits for you in Fresh resources, for this path. */
  protected readonly waiting = computed(() => {
    const id = this.path().id;
    const s = this.scout();
    return (
      s.resources.filter(
        (r) => r.pathId === id && (r.status === 'suggested' || r.outdated),
      ).length + s.proposals.filter((p) => p.pathId === id).length
    );
  });

  private run(key: string, call: Observable<unknown>, failure: string): void {
    this.busy.set(key);
    call.subscribe({
      next: () => {
        this.busy.set(null);
        this.changed.emit();
      },
      error: (error: unknown) => {
        this.busy.set(null);
        this.failed.emit(errorText(error, failure));
      },
    });
  }

  protected setWatch(on: boolean): void {
    this.run(
      'watch',
      this.api.setPath(this.path().id, { status: 'following', watch: on }),
      'Could not change what the scout watches.',
    );
  }

  protected refresh(): void {
    this.run(
      'refresh',
      this.api.scoutScan(this.path().id),
      'Could not start the scan.',
    );
  }
}
