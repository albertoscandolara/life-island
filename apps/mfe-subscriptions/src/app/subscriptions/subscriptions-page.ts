import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  BILLING_CYCLE_LABELS,
  SUBSCRIPTION_KIND_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  USAGE_LABELS,
  type RenewalAdviceDto,
  type SubscriptionDto,
  type SubscriptionsOverviewDto,
} from '@life-island/contracts';
import {
  UiAiPanel,
  UiAiStatus,
  UiAlert,
  UiButton,
  UiCard,
  UiEmptyState,
  UiIcon,
  UiPageHeader,
} from '@life-island/design-system';
import {
  LiDue,
  LiRecordDialog,
  LiTabs,
  RecordEditor,
  dateText,
  errorText,
  euro,
  liOptions,
  type LiField,
  type LiTab,
} from '@life-island/records-ui';
import { AiTool } from '@life-island/settings-ui';
import { SubscriptionsApi } from '../api/subscriptions-api';

const SERVICE = 'svc-subscriptions';

const FIELDS: readonly LiField[] = [
  {
    key: 'name',
    label: 'Name',
    type: 'text',
    required: true,
    placeholder: 'Netflix, Iliad, home insurance…',
  },
  { key: 'provider', label: 'Provider', type: 'text' },
  {
    key: 'kind',
    label: 'Kind',
    type: 'select',
    required: true,
    options: liOptions(SUBSCRIPTION_KIND_LABELS),
  },
  {
    key: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: liOptions(SUBSCRIPTION_STATUS_LABELS),
  },
  {
    key: 'cost',
    label: 'Cost',
    type: 'money',
    required: true,
    hint: 'For one billing period',
  },
  {
    key: 'cycle',
    label: 'Billed',
    type: 'select',
    required: true,
    options: liOptions(BILLING_CYCLE_LABELS),
  },
  {
    key: 'renewsOn',
    label: 'Next renewal',
    type: 'date',
    hint: 'Or the end of the free trial',
  },
  {
    key: 'noticeDays',
    label: 'Notice to cancel (days)',
    type: 'number',
    min: 0,
    max: 365,
    hint: 'Written in the contract; 0 if none',
  },
  { key: 'autoRenew', label: 'Renews on its own', type: 'checkbox' },
  {
    key: 'lockedUntil',
    label: 'Minimum term until',
    type: 'date',
    hint: 'The vincolo: leaving before costs a fee',
  },
  {
    key: 'usage',
    label: 'How often you use it',
    type: 'select',
    options: liOptions(USAGE_LABELS),
    emptyLabel: 'Not said',
  },
  {
    key: 'paidWith',
    label: 'Paid with',
    type: 'text',
    placeholder: 'Visa …1234, direct debit',
  },
  { key: 'startOn', label: 'Since', type: 'date' },
  { key: 'cancelUrl', label: 'Where to cancel', type: 'url', wide: true },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];

/**
 * Contracts & subscriptions (Allo): everything that renews on its own, what
 * it costs a year, the last day to cancel before it renews, and an advisor
 * that says what to keep, renegotiate or cancel.
 */
@Component({
  selector: 'subs-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AiTool,
    LiDue,
    LiRecordDialog,
    LiTabs,
    UiAiPanel,
    UiAiStatus,
    UiAlert,
    UiButton,
    UiCard,
    UiEmptyState,
    UiIcon,
    UiPageHeader,
  ],
  host: { 'data-character': 'allo', class: 'subscriptions' },
  templateUrl: './subscriptions-page.html',
  styleUrl: './subscriptions-page.css',
})
export class SubscriptionsPage {
  private readonly api = inject(SubscriptionsApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly data = signal<SubscriptionsOverviewDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly tab = signal<string>(
    this.route.snapshot.queryParamMap.get('tab') === 'advisor'
      ? 'advisor'
      : 'contracts',
  );
  protected readonly showEnded = signal(false);
  protected readonly euro = euro;
  protected readonly dateText = dateText;
  protected readonly fields = FIELDS;
  protected readonly items = new RecordEditor(
    this.api,
    'items',
    () => this.load(),
    SERVICE,
  );

  protected readonly question = signal('');
  protected readonly asking = signal(false);
  protected readonly adviceStatus = signal<'idle' | 'done' | 'error'>('idle');
  protected readonly shownAdvice = signal<string | null>(null);

  protected readonly live = computed(() =>
    (this.data()?.items ?? []).filter((i) => i.status !== 'cancelled'),
  );
  protected readonly ended = computed(() =>
    (this.data()?.items ?? []).filter((i) => i.status === 'cancelled'),
  );
  protected readonly cancelSoon = computed(() =>
    this.live().filter(
      (i) =>
        i.daysToCancelBy !== null &&
        i.daysToCancelBy >= 0 &&
        i.daysToCancelBy <= 30,
    ),
  );

  protected readonly tabs = computed<LiTab[]>(() => [
    {
      id: 'contracts',
      label: 'Contracts',
      icon: 'file',
      count: this.cancelSoon().length,
    },
    { id: 'advisor', label: 'Advisor', icon: 'sparkles' },
  ]);

  protected readonly maxKind = computed(() =>
    Math.max(1, ...(this.data()?.byKind ?? []).map((k) => k.yearly)),
  );

  protected readonly advice = computed<RenewalAdviceDto | null>(() => {
    const all = this.data()?.advice ?? [];
    return all.find((a) => a.id === this.shownAdvice()) ?? all[0] ?? null;
  });

  constructor() {
    this.load();
  }

  protected setTab(tab: string): void {
    this.tab.set(tab);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === 'contracts' ? null : tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected load(): void {
    this.api.overview().subscribe({
      next: (data) => {
        this.data.set(data);
        this.error.set(null);
      },
      error: (error: unknown) =>
        this.error.set(
          errorText(error, 'Could not load your contracts.', SERVICE),
        ),
    });
  }

  protected kind(k: string): string {
    return (
      SUBSCRIPTION_KIND_LABELS[k as keyof typeof SUBSCRIPTION_KIND_LABELS] ?? k
    );
  }

  protected status(i: SubscriptionDto): string {
    return SUBSCRIPTION_STATUS_LABELS[i.status];
  }

  protected cycle(i: SubscriptionDto): string {
    return BILLING_CYCLE_LABELS[i.cycle].toLowerCase();
  }

  protected usage(i: SubscriptionDto): string | null {
    return i.usage ? USAGE_LABELS[i.usage] : null;
  }

  protected add(): void {
    this.items.add({
      kind: 'streaming',
      status: 'active',
      cycle: 'monthly',
      autoRenew: true,
      noticeDays: 0,
    });
  }

  protected setStatus(
    i: SubscriptionDto,
    status: 'cancelling' | 'cancelled',
  ): void {
    this.api.update('items', i.id, { status }).subscribe({
      next: () => this.load(),
      error: (error: unknown) =>
        this.error.set(errorText(error, 'Could not save it.', SERVICE)),
    });
  }

  protected advise(): void {
    this.asking.set(true);
    this.adviceStatus.set('idle');
    this.api.advise({ question: this.question().trim() || null }).subscribe({
      next: (a) => {
        this.asking.set(false);
        this.adviceStatus.set('done');
        this.shownAdvice.set(a.id);
        this.question.set('');
        this.load();
      },
      error: (error: unknown) => {
        this.asking.set(false);
        this.adviceStatus.set('error');
        this.error.set(
          errorText(error, 'The advisor could not answer.', SERVICE),
        );
      },
    });
  }

  protected removeAdvice(id: string): void {
    this.api.removeAdvice(id).subscribe({
      next: () => {
        this.shownAdvice.set(null);
        this.load();
      },
      error: (error: unknown) =>
        this.error.set(errorText(error, 'Could not remove it.', SERVICE)),
    });
  }

  protected readonly verdictLabel: Record<string, string> = {
    keep: 'Keep',
    renegotiate: 'Renegotiate',
    switch: 'Switch',
    cancel: 'Cancel',
  };
}
