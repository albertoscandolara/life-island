import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  identifiesSomeone,
  PERSON_FIELD_LABELS,
  PERSON_FIELDS,
  type ChangeSuggestion,
  type PendingReviewDto,
  type PersonDto,
  type PersonField,
} from '@life-island/contracts';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiCard,
  UiIcon,
  type UiTone,
} from '@life-island/design-system';
import { dateText, errorText } from '@life-island/records-ui';
import type { Observable } from 'rxjs';
import { PeopleApi } from '../api/people-api';
import { masked, personName, typeLabel } from './labels';

/** The choices you make on one document waiting for review. */
interface Draft {
  /** The person it belongs to; 'new' creates one from it. */
  personId: string;
  accept: Set<PersonField>;
}

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
 * The ID documents waiting for review: whose each one is (or a new person)
 * and which printed values to take. Nothing changes anyone's data until you
 * approve it here.
 */
@Component({
  selector: 'people-review-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAlert, UiBadge, UiButton, UiCard, UiIcon],
  templateUrl: './people-review-card.html',
})
export class PeopleReviewCard {
  private readonly api = inject(PeopleApi);

  readonly reviews = input.required<PendingReviewDto[]>();
  readonly people = input.required<PersonDto[]>();
  /** Tax codes and document numbers shown in full. */
  readonly revealed = input(false);
  /** A document was approved or rejected: the page loads everyone again. */
  readonly changed = output<void>();

  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  private readonly drafts = signal<Record<string, Draft>>({});

  protected readonly fieldLabels = PERSON_FIELD_LABELS;
  protected readonly suggestionLabels = SUGGESTION_LABELS;
  protected readonly suggestionTones = SUGGESTION_TONES;
  protected readonly typeLabel = typeLabel;
  protected readonly personName = personName;
  protected readonly dateText = dateText;

  /** A tax code or document number, hidden but its end until you ask. */
  protected secret(value: string | null): string | null {
    return masked(value, this.revealed());
  }

  protected previewUrl(uploadId: string): string {
    return this.api.previewUrl(uploadId);
  }

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

  /** Whether it says whose it is: a document read as nothing never makes a person. */
  protected readable(review: PendingReviewDto): boolean {
    return identifiesSomeone(review.holder);
  }

  protected isNewPerson(review: PendingReviewDto): boolean {
    return this.draft(review).personId === 'new';
  }

  protected printed(review: PendingReviewDto) {
    return PERSON_FIELDS.filter((field) => review.holder[field] !== null).map(
      (field) => ({ field, value: review.holder[field] }),
    );
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

  private run(key: string, call: () => Observable<void>): void {
    this.busy.set(key);
    this.error.set(null);
    call().subscribe({
      next: () => {
        this.busy.set(null);
        this.drafts.update((all) => {
          const rest = { ...all };
          delete rest[key];
          return rest;
        });
        this.changed.emit();
      },
      error: (error: unknown) => {
        this.busy.set(null);
        this.error.set(
          errorText(
            error,
            'That did not work. Please try again.',
            'svc-people',
          ),
        );
      },
    });
  }
}
