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
  BILLING_PERIODS,
  PLATFORM_PLAN_LABELS,
  PLATFORM_PLANS,
  STUDY_TOPIC_LABELS,
  STUDY_TOPICS,
  TRAINING_PLATFORM_PRESETS,
  TRAINING_PLATFORM_STATUS_LABELS,
  TRAINING_PLATFORM_STATUSES,
  type BillingPeriod,
  type StudiesOverviewDto,
  type StudyTopic,
  type TrainingPlatformDto,
  type TrainingPlatformPlan,
  type TrainingPlatformPreset,
  type TrainingPlatformStatus,
} from '@life-island/contracts';
import {
  UiBadge,
  UiButton,
  UiCard,
  UiEmptyState,
  UiIcon,
} from '@life-island/design-system';
import type { Observable } from 'rxjs';
import { StudiesApi } from '../api/studies-api';
import {
  dateText,
  daysText,
  errorText,
  euro,
  hostOf,
  numberOrNull,
  safeUrl,
  textOrNull,
  today,
  TOPIC_COLORS,
} from './labels';

interface PlatformDraft {
  id: string | null;
  name: string;
  url: string;
  account: string;
  plan: TrainingPlatformPlan;
  status: TrainingPlatformStatus;
  price: string;
  billingPeriod: BillingPeriod;
  renewsOn: string;
  topics: StudyTopic[];
  notes: string;
}

/** The training platforms you use, one click away, with what their subscriptions cost. */
@Component({
  selector: 'studies-platforms',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiBadge, UiButton, UiCard, UiEmptyState, UiIcon],
  templateUrl: './platforms-tab.html',
  styleUrls: ['./blocks.css', './platforms-tab.css'],
})
export class PlatformsTab {
  private readonly api = inject(StudiesApi);

  readonly data = input.required<StudiesOverviewDto>();
  readonly changed = output<void>();
  readonly failed = output<string>();

  protected readonly topics = STUDY_TOPICS.filter((t) => t !== 'other');
  protected readonly topicLabels = STUDY_TOPIC_LABELS;
  protected readonly topicColors = TOPIC_COLORS;
  protected readonly plans = PLATFORM_PLANS;
  protected readonly planLabels = PLATFORM_PLAN_LABELS;
  protected readonly periods = BILLING_PERIODS;
  protected readonly statuses = TRAINING_PLATFORM_STATUSES;
  protected readonly statusLabels = TRAINING_PLATFORM_STATUS_LABELS;
  protected readonly euro = euro;
  protected readonly dateText = dateText;
  protected readonly hostOf = hostOf;
  protected readonly safeUrl = safeUrl;

  protected readonly topic = signal<StudyTopic | null>(null);
  protected readonly draft = signal<PlatformDraft | null>(null);
  protected readonly busy = signal<string | null>(null);

  protected readonly platforms = computed(() => {
    const topic = this.topic();
    return this.data().platforms.filter(
      (p) => !topic || p.topics.includes(topic),
    );
  });
  protected readonly presets = computed(() => {
    const topic = this.topic();
    const names = new Set(
      this.data().platforms.map((p) => p.name.toLowerCase()),
    );
    return TRAINING_PLATFORM_PRESETS.filter(
      (p) =>
        !names.has(p.name.toLowerCase()) &&
        (!topic || p.topics.includes(topic)),
    );
  });

  /** Days to the renewal of a subscription, when within the reminder window. */
  protected renewal(p: TrainingPlatformDto): string | null {
    const reminder = this.data().reminders.find(
      (r) => r.kind === 'subscription' && r.refId === p.id,
    );
    return reminder ? `Renews ${daysText(reminder.daysLeft)}` : null;
  }

  private run(
    key: string,
    call: Observable<unknown>,
    failure: string,
    done?: () => void,
  ): void {
    this.busy.set(key);
    call.subscribe({
      next: () => {
        this.busy.set(null);
        done?.();
        this.changed.emit();
      },
      error: (error: unknown) => {
        this.busy.set(null);
        this.failed.emit(errorText(error, failure));
      },
    });
  }

  protected start(
    preset?: TrainingPlatformPreset,
    p?: TrainingPlatformDto,
  ): void {
    this.draft.set({
      id: p?.id ?? null,
      name: p?.name ?? preset?.name ?? '',
      url: p?.url ?? preset?.url ?? 'https://',
      account: p?.account ?? '',
      plan: p?.plan ?? preset?.plan ?? 'free',
      status: p?.status ?? 'active',
      price: p?.price?.toString() ?? '',
      billingPeriod: p?.billingPeriod ?? 'year',
      renewsOn: p?.renewsOn ?? '',
      topics: [...(p?.topics ?? preset?.topics ?? [])],
      notes: p?.notes ?? preset?.note ?? '',
    });
  }

  /** Adds a preset as it is, in one click. */
  protected addPreset(preset: TrainingPlatformPreset): void {
    this.run(
      preset.name,
      this.api.addPlatform({
        name: preset.name,
        url: preset.url,
        plan: preset.plan,
        topics: [...preset.topics],
        notes: preset.note,
      }),
      'Could not add the platform.',
    );
  }

  protected set(patch: Partial<PlatformDraft>): void {
    this.draft.update((d) => (d ? { ...d, ...patch } : d));
  }

  protected toggleTopic(topic: StudyTopic): void {
    this.draft.update((d) =>
      d
        ? {
            ...d,
            topics: d.topics.includes(topic)
              ? d.topics.filter((t) => t !== topic)
              : [...d.topics, topic],
          }
        : d,
    );
  }

  protected save(): void {
    const d = this.draft();
    if (!d) return;
    const request = {
      name: d.name,
      url: d.url.trim(),
      account: textOrNull(d.account),
      plan: d.plan,
      status: d.status,
      price: numberOrNull(d.price),
      billingPeriod: d.billingPeriod,
      renewsOn: d.renewsOn || null,
      topics: d.topics,
      notes: textOrNull(d.notes),
    };
    this.run(
      d.id ?? 'platform',
      d.id
        ? this.api.updatePlatform(d.id, request)
        : this.api.addPlatform(request),
      'Could not save the platform.',
      () => this.draft.set(null),
    );
  }

  /** Opening a platform from here remembers when you last went there. */
  protected opened(p: TrainingPlatformDto): void {
    this.api.platformOpened(p.id).subscribe({
      next: () => this.changed.emit(),
      error: () => undefined,
    });
  }

  protected remove(p: TrainingPlatformDto): void {
    this.run(
      p.id,
      this.api.removePlatform(p.id),
      'Could not remove the platform.',
    );
  }

  protected lastOpened(p: TrainingPlatformDto): string {
    if (!p.lastOpenedAt) return 'Not opened from here yet';
    const day = p.lastOpenedAt.slice(0, 10);
    return day === today() ? 'Opened today' : `Opened ${dateText(day)}`;
  }
}
