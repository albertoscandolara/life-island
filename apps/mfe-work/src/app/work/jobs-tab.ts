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
  JOB_APPLICATION_STALE_DAYS,
  JOB_APPLICATION_STATUS_LABELS,
  JOB_APPLICATION_STATUSES,
  type JobApplicationDto,
  type JobApplicationRequest,
  type JobApplicationStatus,
  type JobSearchStatsDto,
} from '@life-island/contracts';
import {
  UiBadge,
  UiButton,
  UiCard,
  UiEmptyState,
  UiIcon,
  type UiTone,
} from '@life-island/design-system';
import type { Observable } from 'rxjs';
import { WorkApi } from '../api/work-api';
import { euro, parseAmount, periodText, safeUrl } from './labels';
import type { OfferDraft } from './tools-tab';

/** An application as you type it. */
export interface ApplicationDraft {
  /** The application being edited; null adds one. */
  id: string | null;
  company: string;
  role: string;
  source: string;
  url: string;
  location: string;
  status: JobApplicationStatus;
  appliedAt: string;
  nextStep: string;
  nextStepAt: string;
  ralMin: string;
  ralMax: string;
  offerRal: string;
  offerMonths: '' | '13' | '14';
  offerWelfare: string;
  offerBonus: string;
  notes: string;
}

const STATUS_TONES: Record<JobApplicationStatus, UiTone> = {
  saved: 'neutral',
  applied: 'info',
  screening: 'info',
  interview: 'warning',
  offer: 'success',
  accepted: 'success',
  rejected: 'danger',
  withdrawn: 'neutral',
};

const today = () => new Date().toISOString().slice(0, 10);

function text(value: string): string | null {
  return value.trim() || null;
}

/** The request for a draft: amounts parsed, blanks as null. */
export function applicationRequest(
  draft: ApplicationDraft,
): JobApplicationRequest {
  return {
    company: draft.company.trim(),
    role: draft.role.trim(),
    source: text(draft.source),
    url: text(draft.url),
    location: text(draft.location),
    status: draft.status,
    appliedAt: draft.appliedAt || null,
    nextStep: text(draft.nextStep),
    nextStepAt: draft.nextStepAt || null,
    ralMin: parseAmount(draft.ralMin),
    ralMax: parseAmount(draft.ralMax),
    offerRal: parseAmount(draft.offerRal),
    offerMonths: draft.offerMonths
      ? (Number(draft.offerMonths) as 13 | 14)
      : null,
    offerWelfare: parseAmount(draft.offerWelfare),
    offerBonus: parseAmount(draft.offerBonus),
    notes: text(draft.notes),
  };
}

/** The request that saves an application as it is, with a new status. */
export function withStatus(
  application: JobApplicationDto,
  status: JobApplicationStatus,
): JobApplicationRequest {
  const {
    company,
    role,
    source,
    url,
    location,
    appliedAt,
    nextStep,
    nextStepAt,
    ralMin,
    ralMax,
    offerRal,
    offerMonths,
    offerWelfare,
    offerBonus,
    notes,
  } = application;
  return {
    company,
    role,
    source,
    url,
    location,
    status,
    appliedAt: appliedAt ?? (status === 'saved' ? null : today()),
    nextStep,
    nextStepAt,
    ralMin,
    ralMax,
    offerRal,
    offerMonths,
    offerWelfare,
    offerBonus,
    notes,
  };
}

/** An offer on record, ready for the offer comparison of Tools. */
export function offerDraftOf(application: JobApplicationDto): OfferDraft {
  const amount = (value: number | null) => (value ? String(value) : '');
  return {
    employer: application.company,
    ral: amount(application.offerRal),
    monthsPaid: application.offerMonths === 14 ? '14' : '13',
    welfare: amount(application.offerWelfare),
    bonus: amount(application.offerBonus),
    benefits: '',
    costs: '',
  };
}

/**
 * Job search: the applications you sent, where each stands, how many get an
 * answer, and the offers, which go straight to the offer comparison.
 */
@Component({
  selector: 'work-jobs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiBadge, UiButton, UiCard, UiEmptyState, UiIcon],
  templateUrl: './jobs-tab.html',
  styleUrls: ['./blocks.css', './jobs-tab.css'],
})
export class JobsTab {
  private readonly api = inject(WorkApi);

  readonly applications = input<JobApplicationDto[]>([]);
  readonly stats = input.required<JobSearchStatsDto>();
  /** Something was saved: the page reloads the overview. */
  readonly changed = output<void>();
  /** Compare this offer with your current package. */
  readonly compare = output<OfferDraft>();

  protected readonly euro = euro;
  protected readonly periodText = periodText;
  protected readonly safeUrl = safeUrl;
  protected readonly statuses = JOB_APPLICATION_STATUSES;
  protected readonly statusLabels = JOB_APPLICATION_STATUS_LABELS;
  protected readonly statusTones = STATUS_TONES;
  protected readonly staleDays = JOB_APPLICATION_STALE_DAYS;

  protected readonly draft = signal<ApplicationDraft | null>(null);
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly removing = signal<string | null>(null);
  protected readonly showClosed = signal(false);

  protected readonly shown = computed(() =>
    this.showClosed()
      ? this.applications()
      : this.applications().filter(
          (a) => !['rejected', 'withdrawn'].includes(a.status),
        ),
  );
  protected readonly closed = computed(
    () => this.applications().length - this.shown().length,
  );

  protected start(application?: JobApplicationDto): void {
    const amount = (value: number | null) =>
      value === null ? '' : String(value);
    this.draft.set(
      application
        ? {
            id: application.id,
            company: application.company,
            role: application.role,
            source: application.source ?? '',
            url: application.url ?? '',
            location: application.location ?? '',
            status: application.status,
            appliedAt: application.appliedAt ?? '',
            nextStep: application.nextStep ?? '',
            nextStepAt: application.nextStepAt ?? '',
            ralMin: amount(application.ralMin),
            ralMax: amount(application.ralMax),
            offerRal: amount(application.offerRal),
            offerMonths: application.offerMonths
              ? (String(application.offerMonths) as '13' | '14')
              : '',
            offerWelfare: amount(application.offerWelfare),
            offerBonus: amount(application.offerBonus),
            notes: application.notes ?? '',
          }
        : {
            id: null,
            company: '',
            role: '',
            source: '',
            url: '',
            location: '',
            status: 'applied',
            appliedAt: today(),
            nextStep: '',
            nextStepAt: '',
            ralMin: '',
            ralMax: '',
            offerRal: '',
            offerMonths: '',
            offerWelfare: '',
            offerBonus: '',
            notes: '',
          },
    );
  }

  protected setDraft(change: Partial<ApplicationDraft>): void {
    this.draft.update((d) => (d ? { ...d, ...change } : d));
  }

  private run(
    key: string,
    call: () => Observable<unknown>,
    after?: () => void,
  ) {
    this.busy.set(key);
    this.error.set(null);
    call().subscribe({
      next: () => {
        this.busy.set(null);
        after?.();
        this.changed.emit();
      },
      error: (error: { error?: { message?: string | string[] } }) => {
        this.busy.set(null);
        const message = error.error?.message;
        this.error.set(
          (Array.isArray(message) ? message.join(', ') : message) ??
            'That did not work. Try again in a moment.',
        );
      },
    });
  }

  protected save(): void {
    const draft = this.draft();
    if (!draft?.company.trim() || !draft.role.trim()) return;
    const request = applicationRequest(draft);
    this.run(
      draft.id ?? 'new',
      () =>
        draft.id
          ? this.api.updateApplication(draft.id, request)
          : this.api.addApplication(request),
      () => this.draft.set(null),
    );
  }

  protected setStatus(
    application: JobApplicationDto,
    status: JobApplicationStatus,
  ): void {
    if (status === application.status) return;
    this.run(application.id, () =>
      this.api.updateApplication(
        application.id,
        withStatus(application, status),
      ),
    );
  }

  protected remove(application: JobApplicationDto): void {
    this.run(
      application.id,
      () => this.api.removeApplication(application.id),
      () => this.removing.set(null),
    );
  }

  protected compareOffer(application: JobApplicationDto): void {
    this.compare.emit(offerDraftOf(application));
  }

  protected range(application: JobApplicationDto): string | null {
    const { ralMin, ralMax } = application;
    if (ralMin !== null && ralMax !== null && ralMin !== ralMax)
      return `${euro(ralMin)} – ${euro(ralMax)}`;
    const one = ralMin ?? ralMax;
    return one !== null ? euro(one) : null;
  }
}
