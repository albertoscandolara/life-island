import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  ID_DOCUMENT_STATUS_LABELS,
  PERSON_FIELD_LABELS,
  PERSON_FIELDS,
  type ChangeSuggestion,
  type IdDocumentStatus,
  type PendingReviewDto,
  type PeopleOverviewDto,
  type PersonDto,
  type PersonField,
} from '@life-island/contracts';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiCard,
  UiEmptyState,
  UiIcon,
  UiPageHeader,
  type UiTone,
} from '@life-island/design-system';
import type { Observable } from 'rxjs';
import { PeopleApi } from '../api/people-api';
import { alertText, personName, typeLabel } from './labels';

/** The choices you make on one document waiting for review. */
interface Draft {
  /** The person it belongs to; 'new' creates one from it. */
  personId: string;
  accept: Set<PersonField>;
}

const STATUS_TONES: Record<IdDocumentStatus, UiTone> = {
  current: 'success',
  expired: 'danger',
  superseded: 'neutral',
  lost: 'warning',
  stolen: 'warning',
  withdrawn: 'warning',
};

const SUGGESTION_LABELS: Record<ChangeSuggestion, string> = {
  accept: 'Take it',
  keep_current: 'Keep yours',
  check: 'Check it',
};

const SUGGESTION_TONES: Record<ChangeSuggestion, UiTone> = {
  accept: 'success',
  keep_current: 'neutral',
  check: 'warning',
};

/**
 * People & IDs: everyone your ID documents belong to, each document with its
 * versions, the review of new or different personal data, and warnings for
 * the documents that expired or are about to.
 */
@Component({
  selector: 'people-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    UiAlert,
    UiBadge,
    UiButton,
    UiCard,
    UiEmptyState,
    UiIcon,
    UiPageHeader,
  ],
  host: { 'data-character': 'para', class: 'people' },
  templateUrl: './people-page.html',
  styleUrl: './people-page.css',
})
export class PeoplePage {
  private readonly api = inject(PeopleApi);

  protected readonly overview = signal<PeopleOverviewDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal<string | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  private readonly drafts = signal<Record<string, Draft>>({});

  protected readonly fields = PERSON_FIELDS;
  protected readonly fieldLabels = PERSON_FIELD_LABELS;
  protected readonly statusLabels = ID_DOCUMENT_STATUS_LABELS;
  protected readonly statusTones = STATUS_TONES;
  protected readonly suggestionLabels = SUGGESTION_LABELS;
  protected readonly suggestionTones = SUGGESTION_TONES;

  protected readonly people = computed(() => this.overview()?.people ?? []);
  protected readonly reviews = computed(() => this.overview()?.reviews ?? []);
  protected readonly alerts = computed(() => this.overview()?.alerts ?? []);
  protected readonly rejected = computed(() => this.overview()?.rejected ?? []);
  protected readonly selected = computed(
    () =>
      this.people().find((p) => p.id === this.selectedId()) ??
      this.people()[0] ??
      null,
  );

  constructor() {
    this.load();
  }

  protected load(): void {
    this.api.overview().subscribe({
      next: (overview) => {
        this.overview.set(overview);
        this.error.set(null);
      },
      error: () =>
        this.error.set(
          'People could not be loaded. Is svc-people running? Try again in a moment.',
        ),
    });
  }

  protected readonly typeLabel = typeLabel;
  protected readonly personName = personName;
  protected readonly alertText = alertText;

  protected initials(person: PersonDto): string {
    return (
      [person.firstName, person.lastName]
        .map((part) => part?.[0] ?? '')
        .join('')
        .toUpperCase() || '?'
    );
  }

  protected alertsOf(person: PersonDto, uploadId: string) {
    return person.alerts.find((a) => a.uploadId === uploadId) ?? null;
  }

  // ---- review -------------------------------------------------------------

  protected draft(review: PendingReviewDto): Draft {
    return (
      this.drafts()[review.uploadId] ?? {
        personId: review.personId ?? 'new',
        accept: new Set(
          review.changes
            .filter((c) => c.suggestion === 'accept')
            .map((c) => c.field),
        ),
      }
    );
  }

  private update(review: PendingReviewDto, change: Partial<Draft>): void {
    this.drafts.update((all) => ({
      ...all,
      [review.uploadId]: { ...this.draft(review), ...change },
    }));
  }

  protected choosePerson(review: PendingReviewDto, personId: string): void {
    this.update(review, { personId });
  }

  protected toggle(review: PendingReviewDto, field: PersonField): void {
    const accept = new Set(this.draft(review).accept);
    if (accept.has(field)) accept.delete(field);
    else accept.add(field);
    this.update(review, { accept });
  }

  /** The changes against the person you picked (the server compared with its match). */
  protected changesFor(review: PendingReviewDto) {
    return this.draft(review).personId === review.personId
      ? review.changes
      : [];
  }

  protected isNewPerson(review: PendingReviewDto): boolean {
    return this.draft(review).personId === 'new';
  }

  protected printed(review: PendingReviewDto) {
    return this.fields
      .filter((field) => review.holder[field] !== null)
      .map((field) => ({ field, value: review.holder[field] }));
  }

  protected approve(review: PendingReviewDto): void {
    const draft = this.draft(review);
    this.run(review.uploadId, () =>
      this.api.approve(review.uploadId, {
        personId: draft.personId === 'new' ? null : draft.personId,
        accept: this.changesFor(review)
          .map((c) => c.field)
          .filter((field) => draft.accept.has(field)),
      }),
    );
  }

  protected reject(review: PendingReviewDto): void {
    this.run(review.uploadId, () => this.api.reject(review.uploadId));
  }

  protected reopen(uploadId: string): void {
    this.run(uploadId, () => this.api.reopen(uploadId));
  }

  protected mark(uploadId: string, value: string): void {
    const status =
      value === 'lost' || value === 'stolen' || value === 'withdrawn'
        ? value
        : null;
    this.run(uploadId, () => this.api.mark(uploadId, { status }));
  }

  protected previewUrl(uploadId: string): string {
    return this.api.previewUrl(uploadId);
  }

  private run(key: string, call: () => Observable<void>): void {
    this.busy.set(key);
    call().subscribe({
      next: () => {
        this.busy.set(null);
        this.drafts.update((all) => {
          const rest = { ...all };
          delete rest[key];
          return rest;
        });
        this.load();
      },
      error: (error: { error?: { message?: string } }) => {
        this.busy.set(null);
        this.error.set(
          error.error?.message ?? 'That did not work. Please try again.',
        );
      },
    });
  }
}
