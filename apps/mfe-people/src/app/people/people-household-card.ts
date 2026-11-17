import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import {
  RELATION_KINDS,
  RELATION_LABELS,
  type PersonDto,
  type RelationKind,
} from '@life-island/contracts';
import { UiAlert, UiButton, UiCard, UiIcon } from '@life-island/design-system';
import { errorText } from '@life-island/records-ui';
import type { Observable } from 'rxjs';
import { PeopleApi } from '../api/people-api';
import { personName } from './labels';

/**
 * How one person is related to the others at home, and whose fiscal
 * dependent they are (for the 730).
 */
@Component({
  selector: 'people-household-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAlert, UiButton, UiCard, UiIcon],
  templateUrl: './people-household-card.html',
  styleUrls: ['./people-bits.css', './people-household-card.css'],
})
export class PeopleHouseholdCard {
  private readonly api = inject(PeopleApi);

  readonly person = input.required<PersonDto>();
  readonly people = input.required<PersonDto[]>();
  /** A relative's name was clicked: the page shows that person. */
  readonly open = output<string>();
  /** A relation or the dependent changed: the page loads everyone again. */
  readonly changed = output<void>();

  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  /** The relation being added, cleared when another person is shown. */
  protected readonly relationDraft = linkedSignal<
    string,
    { personId: string; kind: RelationKind }
  >({
    source: () => this.person().id,
    computation: () => ({ personId: '', kind: 'partner' }),
  });

  protected readonly relationKinds = RELATION_KINDS;
  protected readonly relationLabels = RELATION_LABELS;
  protected readonly personName = personName;

  private readonly byId = computed(
    () => new Map(this.people().map((p) => [p.id, p])),
  );

  protected nameOf(id: string | null): string {
    const person = id ? this.byId().get(id) : undefined;
    return person ? personName(person) : 'Someone removed';
  }

  protected others(person: PersonDto): PersonDto[] {
    return this.people().filter((p) => p.id !== person.id);
  }

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
      () => this.api.setRelation(person.id, { personId, kind: draft.kind }),
      () => this.relationDraft.set({ personId: '', kind: 'partner' }),
    );
  }

  protected removeRelation(person: PersonDto, otherId: string): void {
    this.run(() => this.api.removeRelation(person.id, otherId));
  }

  protected setDependent(person: PersonDto, value: string): void {
    this.run(() =>
      this.api.updatePerson(person.id, { taxDependentOf: value || null }),
    );
  }

  private run(call: () => Observable<void>, done?: () => void): void {
    this.busy.set(this.person().id);
    this.error.set(null);
    call().subscribe({
      next: () => {
        this.busy.set(null);
        done?.();
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
