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
  ID_DOCUMENT_TYPES,
  identifiesSomeone,
  PERSON_FIELD_LABELS,
  PERSON_FIELDS,
  RELATION_KINDS,
  RELATION_LABELS,
  type ChangeSuggestion,
  type IdDocumentStatus,
  type PendingReviewDto,
  type PeopleOverviewDto,
  type PersonDto,
  type PersonField,
  type RelationKind,
  type ResidenceHouseDto,
  type TaxCodeCheckStatus,
  type UpdatePersonRequest,
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
import {
  alertText,
  coverage,
  masked,
  personName,
  typeLabel,
  type CoverageCell,
  type CoverageState,
} from './labels';

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

const COVERAGE_TONES: Record<CoverageState, UiTone> = {
  current: 'success',
  expiring: 'warning',
  expired: 'danger',
  unusable: 'warning',
  missing: 'neutral',
};

const TAX_CODE_BADGES: Record<
  TaxCodeCheckStatus,
  { text: string; tone: UiTone } | null
> = {
  valid: { text: 'Checked', tone: 'success' },
  mismatch: { text: 'Does not match', tone: 'warning' },
  invalid: { text: 'Not a valid code', tone: 'danger' },
  unknown: null,
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
  /** Remove or merge, being confirmed on the selected person. */
  protected readonly action = signal<'remove' | 'merge' | null>(null);
  /** The duplicate picked for a merge. */
  protected readonly mergeFrom = signal<string | null>(null);
  /** The Home area's houses, to pick one as residence. */
  protected readonly houses = signal<ResidenceHouseDto[]>([]);
  protected readonly housesAvailable = signal(true);
  /** The house picked for Residence while editing; '' means a typed address. */
  protected readonly residenceHouse = signal('');
  /** The values being edited on the selected person, or null when not editing. */
  protected readonly editing = signal<Record<PersonField, string> | null>(null);
  /** Tax codes and document numbers are hidden until you ask. */
  protected readonly revealed = signal(false);
  /** The relation being added to the selected person. */
  protected readonly relationDraft = signal<{
    personId: string;
    kind: RelationKind;
  }>({ personId: '', kind: 'partner' });

  protected readonly idTypes = ID_DOCUMENT_TYPES;
  protected readonly relationKinds = RELATION_KINDS;
  protected readonly relationLabels = RELATION_LABELS;
  protected readonly coverageTones = COVERAGE_TONES;
  protected readonly taxCodeBadges = TAX_CODE_BADGES;

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
  /** Everyone against the four document types: the coverage grid. */
  protected readonly coverageRows = computed(() =>
    this.people().map((person) => ({ person, cells: coverage(person) })),
  );
  protected readonly selected = computed(
    () =>
      this.people().find((p) => p.id === this.selectedId()) ??
      this.people()[0] ??
      null,
  );

  constructor() {
    this.load();
    this.api.residenceHouses().subscribe({
      next: ({ houses, available }) => {
        this.houses.set(houses);
        this.housesAvailable.set(available);
      },
      error: () => this.housesAvailable.set(false),
    });
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

  /** The warning of the document itself (a licence category warns apart). */
  protected alertsOf(person: PersonDto, uploadId: string) {
    return (
      person.alerts.find(
        (a) => a.uploadId === uploadId && a.category === null,
      ) ?? null
    );
  }

  /** A tax code or document number, hidden but its end until you ask. */
  protected secret(value: string | null): string | null {
    return masked(value, this.revealed());
  }

  protected coverageText(cell: CoverageCell): string {
    switch (cell.state) {
      case 'missing':
        return 'None';
      case 'unusable':
        return 'Lost or withdrawn';
      case 'expired':
        return 'Expired';
      default:
        return cell.expiryDate
          ? `Until ${new Date(cell.expiryDate).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`
          : 'Current';
    }
  }

  protected nameOf(id: string | null): string {
    const person = this.people().find((p) => p.id === id);
    return person ? personName(person) : 'Someone removed';
  }

  // ---- household ----------------------------------------------------------

  /** The people this one could still be related to. */
  protected unrelated(person: PersonDto): PersonDto[] {
    const related = new Set(person.relations.map((r) => r.personId));
    return this.others(person).filter((p) => !related.has(p.id));
  }

  protected addRelation(person: PersonDto): void {
    const draft = this.relationDraft();
    const personId = draft.personId || this.unrelated(person)[0]?.id;
    if (!personId) return;
    this.run(
      person.id,
      () => this.api.setRelation(person.id, { personId, kind: draft.kind }),
      () => this.relationDraft.set({ personId: '', kind: 'partner' }),
    );
  }

  protected removeRelation(person: PersonDto, otherId: string): void {
    this.run(person.id, () => this.api.removeRelation(person.id, otherId));
  }

  protected setDependent(person: PersonDto, value: string): void {
    this.run(person.id, () =>
      this.api.updatePerson(person.id, { taxDependentOf: value || null }),
    );
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

  /** Whether it says whose it is: a document read as nothing never makes a person. */
  protected readable(review: PendingReviewDto): boolean {
    return identifiesSomeone(review.holder);
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

  // ---- edit a person ------------------------------------------------------

  protected select(personId: string): void {
    this.selectedId.set(personId);
    this.editing.set(null);
    this.action.set(null);
    this.relationDraft.set({ personId: '', kind: 'partner' });
  }

  // ---- remove and merge ----------------------------------------------------

  protected remove(person: PersonDto): void {
    this.run(
      person.id,
      () => this.api.removePerson(person.id),
      () => {
        this.action.set(null);
        this.selectedId.set(null);
      },
    );
  }

  protected others(person: PersonDto): PersonDto[] {
    return this.people().filter((p) => p.id !== person.id);
  }

  /** A person told apart from namesakes: tax code or birth date, and their documents. */
  protected describe(person: PersonDto): string {
    const documents = person.series.map((s) => typeLabel(s.type)).join(', ');
    return [
      personName(person),
      this.secret(person.taxCode) ?? person.birthDate,
      documents || 'no documents',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  protected startMerge(person: PersonDto): void {
    // Suggest someone with the same surname first: the likeliest duplicate.
    const others = this.others(person);
    const likely =
      others.find((p) => p.lastName && p.lastName === person.lastName) ??
      others[0];
    this.mergeFrom.set(likely?.id ?? null);
    this.action.set('merge');
  }

  /** What the merge would do, the same way svc-people does it. */
  protected mergePreview(person: PersonDto) {
    const from = this.others(person).find((p) => p.id === this.mergeFrom());
    if (!from) return null;
    return {
      from,
      conflict: !!(
        person.taxCode &&
        from.taxCode &&
        person.taxCode !== from.taxCode
      ),
      taken: this.fields.filter(
        (field) => person[field] === null && from[field] !== null,
      ),
    };
  }

  protected merge(person: PersonDto): void {
    const from = this.mergeFrom();
    if (!from) return;
    this.run(
      person.id,
      () => this.api.mergePeople(person.id, { from }),
      () => this.action.set(null),
    );
  }

  protected edit(person: PersonDto): void {
    // Keep this person shown after saving, even if the list order changes.
    this.selectedId.set(person.id);
    this.residenceHouse.set(person.residencePropertyId ?? '');
    this.editing.set(
      Object.fromEntries(
        this.fields.map((field) => [field, person[field] ?? '']),
      ) as Record<PersonField, string>,
    );
  }

  protected setValue(field: PersonField, value: string): void {
    this.editing.update((values) =>
      values ? { ...values, [field]: value } : values,
    );
  }

  /** The house this person lives in, when one was picked and Home still has it. */
  protected residenceOf(person: PersonDto): ResidenceHouseDto | null {
    if (!person.residencePropertyId) return null;
    return (
      this.houses().find((h) => h.id === person.residencePropertyId) ?? null
    );
  }

  /** The house's page in the Home area (the shell serves it at /home). */
  protected houseUrl(id: string): string {
    return `/home?property=${encodeURIComponent(id)}`;
  }

  protected chooseHouse(id: string): void {
    this.residenceHouse.set(id);
    const house = this.houses().find((h) => h.id === id);
    if (house) this.setValue('residenceAddress', house.address ?? house.name);
  }

  /** Saves what you typed; an emptied field goes back to unknown. */
  protected save(person: PersonDto): void {
    const values = this.editing();
    if (!values) return;
    const changed: UpdatePersonRequest = Object.fromEntries(
      this.fields
        .map((field) => [field, values[field].trim() || null] as const)
        .filter(([field, value]) => value !== person[field]),
    );
    const house = this.residenceHouse() || null;
    if (house !== person.residencePropertyId) {
      // A picked house sends its address too; a typed one unlinks the house.
      changed.residencePropertyId = house;
      changed.residenceAddress = values.residenceAddress.trim() || null;
    }
    this.run(
      person.id,
      () => this.api.updatePerson(person.id, changed),
      () => this.editing.set(null),
    );
  }

  protected previewUrl(uploadId: string): string {
    return this.api.previewUrl(uploadId);
  }

  private run(
    key: string,
    call: () => Observable<void>,
    done?: () => void,
  ): void {
    this.busy.set(key);
    call().subscribe({
      next: () => {
        this.busy.set(null);
        done?.();
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
