import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import {
  HOUSE_FIELD_LABELS,
  type HouseField,
  type HouseProposedChangeDto,
  type HouseSuggestionDto,
  type PropertyDto,
} from '@life-island/contracts';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiCard,
  UiIcon,
} from '@life-island/design-system';
import { errorMessage, HomeApi } from '../api/home-api';
import { formatDate } from '../shared/format';
import { PropertyStore } from '../shared/property-store';

interface Draft {
  /** A house id, or 'new'. */
  target: string;
  name: string;
  accept: Set<HouseField>;
}

const same = (a: string | null, b: string) =>
  a !== null &&
  a
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]/g, '') ===
    b
      .toLowerCase()
      .normalize('NFD')
      .replace(/[^a-z0-9]/g, '');

/** What a house has in a field, as the service compares it. */
function currentOf(house: PropertyDto, field: HouseField): string | null {
  if (field === 'supplyCodes') return house.supplyCodes.join(', ') || null;
  if (field === 'owners')
    return house.owners.map((o) => o.name).join(', ') || null;
  const value = house[field];
  return value === null || value === undefined ? null : String(value);
}

/**
 * What your documents say about houses, waiting for you: a house you do not
 * have yet, or new or different data of one you have. Nothing reaches a
 * house until you approve it, field by field, like People's reviews.
 */
@Component({
  selector: 'home-house-suggestions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiBadge, UiButton, UiIcon, UiAlert],
  template: `
    @if (error(); as message) {
      <ui-alert tone="danger" class="error">{{ message }}</ui-alert>
    }
    @if (suggestions().length) {
      <ui-card heading="Suggested by your documents">
        <ui-badge uiCardActions tone="warning"
          >{{ suggestions().length }} waiting</ui-badge
        >
        <p class="muted intro">
          Documents never change a house on their own. Pick which house they are
          about and which values to take.
        </p>
        @for (s of suggestions(); track s.key) {
          <article class="review" [class.review--busy]="busy() === s.key">
            <header class="review__head">
              <div>
                <h3 class="review__title">
                  @if (s.kind === 'new_house') {
                    <ui-icon name="plus" [size]="16" /> A house you do not have:
                    {{ s.name }}
                  } @else {
                    <ui-icon name="info" [size]="16" /> New data for
                    {{ store.name(s.propertyId) }}
                  }
                </h3>
                <p class="muted">
                  From {{ s.documents.length }}
                  {{ s.documents.length === 1 ? 'document' : 'documents' }}:
                  @for (d of s.documents.slice(0, 3); track d.uploadId) {
                    <a
                      [href]="api.previewUrl(d.uploadId)"
                      target="_blank"
                      rel="noopener"
                      >{{ d.title }}</a
                    >
                    <span class="muted"> ({{ formatDate(d.uploadedAt) }})</span
                    >{{ $last ? '' : ', ' }}
                  }
                  @if (s.documents.length > 3) {
                    and {{ s.documents.length - 3 }} more
                  }
                </p>
              </div>
            </header>

            <div class="review__whose">
              <label>
                <span>Which house?</span>
                <select
                  class="ui-input compact"
                  (change)="choose(s, $any($event.target).value)"
                >
                  <option value="new" [selected]="draft(s).target === 'new'">
                    A new house
                  </option>
                  @for (p of store.properties() ?? []; track p.id) {
                    <option
                      [value]="p.id"
                      [selected]="draft(s).target === p.id"
                    >
                      {{ p.name }}
                      @if (p.id === s.propertyId) {
                        (matched)
                      }
                    </option>
                  }
                </select>
              </label>
              @if (draft(s).target === 'new') {
                <label>
                  <span>Its name</span>
                  <input
                    class="ui-input compact"
                    [value]="draft(s).name"
                    (input)="rename(s, $any($event.target).value)"
                  />
                </label>
              }
            </div>

            @if (rows(s); as list) {
              @if (list.length) {
                <div class="table-wrap">
                  <table class="table">
                    <thead>
                      <tr>
                        <th scope="col">Take</th>
                        <th scope="col">Field</th>
                        <th scope="col">You have</th>
                        <th scope="col">Read</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (c of list; track c.field) {
                        <tr>
                          <td>
                            <input
                              type="checkbox"
                              [attr.aria-label]="'Take ' + labels[c.field]"
                              [checked]="draft(s).accept.has(c.field)"
                              (change)="toggle(s, c.field)"
                            />
                          </td>
                          <th scope="row">{{ labels[c.field] }}</th>
                          <td class="muted">{{ c.current ?? '—' }}</td>
                          <td>
                            <strong>{{ c.proposed }}</strong>
                            @if (c.kind === 'add') {
                              <ui-badge tone="info">adds</ui-badge>
                            } @else if (c.kind === 'different_value') {
                              <ui-badge tone="warning">different</ui-badge>
                            }
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              } @else {
                <p class="muted">
                  <ui-icon name="check" [size]="16" /> Same data as this house:
                  approving only files the documents under it.
                </p>
              }
            }

            <footer class="review__actions">
              <button
                uiButton
                variant="ghost"
                type="button"
                [disabled]="busy() !== null"
                (click)="dismiss(s)"
              >
                Not about a house of mine
              </button>
              <button
                uiButton
                type="button"
                [loading]="busy() === s.key"
                [disabled]="
                  busy() !== null ||
                  (draft(s).target === 'new' && !draft(s).name.trim())
                "
                (click)="approve(s)"
              >
                <ui-icon name="check" [size]="18" />
                {{ draft(s).target === 'new' ? 'Add the house' : 'Approve' }}
              </button>
            </footer>
          </article>
        }
      </ui-card>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .error {
      margin-bottom: var(--space-4);
    }
    .intro {
      margin: 0 0 var(--space-4);
    }
    .review {
      display: grid;
      gap: var(--space-3);
      padding: var(--space-4) 0;
      border-top: 1px solid var(--border-subtle);
    }
    .review--busy {
      opacity: 0.6;
    }
    .review__title {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin: 0;
      font-size: var(--text-md);
    }
    .review__head p {
      margin: var(--space-1) 0 0;
    }
    .review__whose {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
    .review__whose label {
      display: grid;
      gap: var(--space-1);
      font-size: var(--text-sm);
      font-weight: 600;
    }
    .review__actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: var(--space-2);
    }
    .table-wrap {
      overflow-x: auto;
    }
    .table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--text-sm);
    }
    .table th,
    .table td {
      padding: var(--space-2);
      border-bottom: 1px solid var(--border-subtle);
      text-align: left;
    }
    .muted {
      color: var(--text-muted);
      font-size: var(--text-sm);
    }
  `,
})
export class HouseSuggestions {
  protected readonly api = inject(HomeApi);
  protected readonly store = inject(PropertyStore);

  /** A suggestion was approved or dismissed (bills may have moved). */
  readonly changed = output<void>();

  protected readonly suggestions = signal<HouseSuggestionDto[]>([]);
  protected readonly drafts = signal<Record<string, Draft>>({});
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly labels = HOUSE_FIELD_LABELS;
  protected readonly formatDate = formatDate;

  readonly count = computed(() => this.suggestions().length);

  constructor() {
    this.load();
  }

  load(): void {
    this.api.houseSuggestions().subscribe({
      next: (list) => {
        this.error.set(null);
        this.suggestions.set(list);
      },
      error: (error) => this.error.set(errorMessage(error)),
    });
  }

  protected draft(s: HouseSuggestionDto): Draft {
    return (
      this.drafts()[s.key] ?? {
        target: s.propertyId ?? 'new',
        name: s.name ?? '',
        // A value the house lacks is taken; a different one waits for you.
        accept: new Set(
          s.changes
            .filter((c) => c.kind !== 'different_value')
            .map((c) => c.field),
        ),
      }
    );
  }

  /** The changes against the house you picked (all of them for a new house). */
  protected rows(s: HouseSuggestionDto): HouseProposedChangeDto[] {
    const target = this.draft(s).target;
    if (target === 'new')
      return s.changes.map((c) => ({ ...c, current: null, kind: 'new_value' }));
    if (target === s.propertyId) return s.changes;
    const house = this.store.properties()?.find((p) => p.id === target);
    if (!house) return s.changes;
    return s.changes.flatMap((c) => {
      const current = currentOf(house, c.field);
      if (c.kind !== 'add' && same(current, c.proposed)) return [];
      return [
        {
          ...c,
          current,
          kind:
            c.kind === 'add'
              ? 'add'
              : current === null
                ? 'new_value'
                : 'different_value',
        },
      ];
    });
  }

  protected choose(s: HouseSuggestionDto, target: string): void {
    this.update(s, { target });
  }

  protected rename(s: HouseSuggestionDto, name: string): void {
    this.update(s, { name });
  }

  protected toggle(s: HouseSuggestionDto, field: HouseField): void {
    const accept = new Set(this.draft(s).accept);
    if (accept.has(field)) accept.delete(field);
    else accept.add(field);
    this.update(s, { accept });
  }

  protected approve(s: HouseSuggestionDto): void {
    const d = this.draft(s);
    const shown = new Set(this.rows(s).map((r) => r.field));
    this.busy.set(s.key);
    this.api
      .approveHouseSuggestion({
        uploadIds: s.documents.map((doc) => doc.uploadId),
        propertyId: d.target === 'new' ? null : d.target,
        accept: [...d.accept].filter((f) => shown.has(f)),
        ...(d.target === 'new' ? { name: d.name.trim() } : {}),
      })
      .subscribe({
        next: () => this.done(),
        error: (error) => this.fail(error),
      });
  }

  protected dismiss(s: HouseSuggestionDto): void {
    this.busy.set(s.key);
    this.api
      .dismissHouseSuggestion(s.documents.map((doc) => doc.uploadId))
      .subscribe({
        next: () => this.done(),
        error: (error) => this.fail(error),
      });
  }

  private update(s: HouseSuggestionDto, changes: Partial<Draft>): void {
    this.drafts.update((all) => ({
      ...all,
      [s.key]: { ...this.draft(s), ...changes },
    }));
  }

  private done(): void {
    this.busy.set(null);
    this.store.reload();
    this.load();
    this.changed.emit();
  }

  private fail(error: unknown): void {
    this.busy.set(null);
    this.error.set(errorMessage(error));
    this.load();
  }
}
