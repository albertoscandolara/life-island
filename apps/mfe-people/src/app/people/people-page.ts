import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  entityParam,
  PERSON_FIELD_LABELS,
  PERSON_FIELDS,
  type PeopleOverviewDto,
  type PersonDto,
  type PersonField,
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
import { PeopleCoverageCard } from './people-coverage-card';
import { PeopleHouseholdCard } from './people-household-card';
import { PeopleReviewCard } from './people-review-card';
import { PeopleSeriesCard } from './people-series-card';
import { alertText, masked, personName, typeLabel } from './labels';

const TAX_CODE_BADGES: Record<
  TaxCodeCheckStatus,
  { text: string; tone: UiTone } | null
> = {
  valid: { text: 'Checked', tone: 'success' },
  mismatch: { text: 'Does not match', tone: 'warning' },
  invalid: { text: 'Not a valid code', tone: 'danger' },
  unknown: null,
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
    PeopleCoverageCard,
    PeopleHouseholdCard,
    PeopleReviewCard,
    PeopleSeriesCard,
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
  styleUrls: ['./people-bits.css', './people-page.css'],
})
export class PeoplePage {
  private readonly api = inject(PeopleApi);

  protected readonly overview = signal<PeopleOverviewDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal<string | null>(null);
  protected readonly selectedId = signal<string | null>(null);
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

  protected readonly taxCodeBadges = TAX_CODE_BADGES;

  protected readonly fields = PERSON_FIELDS;
  protected readonly fieldLabels = PERSON_FIELD_LABELS;

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
    // A link from anywhere on the island opens one person: /people?person=<id>.
    inject(ActivatedRoute)
      .queryParamMap.pipe(takeUntilDestroyed())
      .subscribe((query) => {
        const id = query.get(entityParam('person'));
        if (id) this.selectedId.set(id);
      });
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

  /** A tax code or document number, hidden but its end until you ask. */
  protected secret(value: string | null): string | null {
    return masked(value, this.revealed());
  }

  /** Brings back a document rejected as not about anyone. */
  protected reopen(uploadId: string): void {
    this.run(uploadId, () => this.api.reopen(uploadId));
  }

  // ---- edit a person ------------------------------------------------------

  protected select(personId: string): void {
    this.selectedId.set(personId);
    this.editing.set(null);
    this.action.set(null);
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
