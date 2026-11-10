import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  TYRE_SEASON_LABELS,
  TYRE_SEASONS,
  type CreateTyreSetRequest,
  type TyreSeason,
  type TyreSetDto,
} from '@life-island/contracts';
import { UiBadge, UiButton, UiCard, UiIcon } from '@life-island/design-system';
import type { Observable } from 'rxjs';
import { CarsApi } from '../api/cars-api';
import { italianNumber } from './labels';

/** What you are typing for a tyre set (new, or one being edited). */
interface TyreDraft {
  id: string | null;
  season: TyreSeason;
  label: string;
  size: string;
  dot: string;
  purchasedOn: string;
  treadMm: string;
  mounted: boolean;
  storedAt: string;
  notes: string;
}

const EMPTY: TyreDraft = {
  id: null,
  season: 'winter',
  label: '',
  size: '',
  dot: '',
  purchasedOn: '',
  treadMm: '',
  mounted: false,
  storedAt: '',
  notes: '',
};

/**
 * The car's tyre sets: which one is on the car, where the others are kept,
 * and each one's checks (age from the DOT code, tread, speed index against
 * the card). The set on the car drives the winter-tyre reminders, shown with
 * the renewals.
 */
@Component({
  selector: 'cars-tyres-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, UiBadge, UiButton, UiCard, UiIcon],
  styleUrl: './insights.css',
  template: `
    <ui-card heading="Tyres">
      @if (!draft()) {
        <button
          uiCardActions
          uiButton
          variant="ghost"
          size="sm"
          type="button"
          (click)="add()"
        >
          <ui-icon name="plus" [size]="14" /> Add a set
        </button>
      }
      @if (!sets().length && !draft()) {
        <p class="muted">
          Add your tyre sets (summer, winter, all-season) and mark the one on
          the car: Life Island then reminds you of the winter-tyre period (15
          Nov – 15 Apr) and checks their age, tread and speed index.
        </p>
      }
      @if (sets().length) {
        <ul class="items">
          @for (set of sets(); track set.id) {
            <li class="item">
              <div class="item__head">
                <h3 class="item__title">
                  {{ seasonLabels[set.season] }}
                  @if (set.label) {
                    <span class="muted small">· {{ set.label }}</span>
                  }
                </h3>
                @if (set.mounted) {
                  <ui-badge tone="success">On the car</ui-badge>
                } @else if (set.storedAt) {
                  <ui-badge tone="neutral">At {{ set.storedAt }}</ui-badge>
                }
              </div>
              <p class="muted">
                {{ set.size ?? 'Size not set' }}
                @if (set.dot) {
                  · DOT {{ set.dot }}
                  @if (set.ageYears !== null) {
                    ({{ num(set.ageYears, 0, 1) }} years)
                  }
                }
                @if (set.treadMm !== null) {
                  · {{ num(set.treadMm, 0, 1) }} mm tread
                }
                @if (set.purchasedOn) {
                  · bought {{ set.purchasedOn | date: 'MMM y' }}
                }
              </p>
              @if (set.checks.length) {
                <ul class="checks">
                  @for (c of set.checks; track $index) {
                    <li
                      [class.tone--danger]="c.tone === 'danger'"
                      [class.tone--warning]="c.tone === 'warning'"
                    >
                      {{ c.text }}
                    </li>
                  }
                </ul>
              }
              @if (set.notes) {
                <p class="muted small">{{ set.notes }}</p>
              }
              @if (confirming() === set.id) {
                <div
                  class="actions"
                  role="group"
                  aria-label="Remove this tyre set"
                >
                  <span class="small">Remove this set?</span>
                  <button
                    uiButton
                    variant="danger"
                    size="sm"
                    type="button"
                    [loading]="busy()"
                    (click)="remove(set)"
                  >
                    Remove
                  </button>
                  <button
                    uiButton
                    variant="ghost"
                    size="sm"
                    type="button"
                    (click)="confirming.set(null)"
                  >
                    Keep
                  </button>
                </div>
              } @else {
                <div class="actions">
                  @if (!set.mounted) {
                    <button
                      uiButton
                      variant="ghost"
                      size="sm"
                      type="button"
                      [disabled]="busy()"
                      (click)="mount(set)"
                    >
                      <ui-icon name="refresh" [size]="14" /> Put on the car
                    </button>
                  }
                  <button
                    uiButton
                    variant="ghost"
                    size="sm"
                    type="button"
                    (click)="edit(set)"
                  >
                    <ui-icon name="edit" [size]="14" /> Edit
                  </button>
                  <button
                    uiButton
                    variant="ghost"
                    size="sm"
                    type="button"
                    aria-label="Remove this tyre set"
                    (click)="confirming.set(set.id)"
                  >
                    <ui-icon name="trash" [size]="14" />
                  </button>
                </div>
              }
            </li>
          }
        </ul>
      }

      @if (draft(); as d) {
        <form class="form" (submit)="$event.preventDefault(); save()">
          <label>
            <span>Season</span>
            <select
              class="ui-input"
              [value]="d.season"
              (change)="set({ season: $any($event.target).value })"
            >
              @for (s of seasons; track s) {
                <option [value]="s">{{ seasonLabels[s] }}</option>
              }
            </select>
          </label>
          <label>
            <span>Name</span>
            <input
              class="ui-input"
              maxlength="60"
              placeholder="Michelin Alpin 6"
              [value]="d.label"
              (input)="set({ label: $any($event.target).value })"
            />
          </label>
          <label>
            <span>Size, as on the sidewall</span>
            <input
              class="ui-input"
              maxlength="40"
              placeholder="205/55 R16 91H"
              [value]="d.size"
              (input)="set({ size: $any($event.target).value })"
            />
          </label>
          <label>
            <span>DOT (week and year)</span>
            <input
              class="ui-input"
              inputmode="numeric"
              maxlength="4"
              placeholder="2321"
              [value]="d.dot"
              (input)="set({ dot: $any($event.target).value })"
            />
          </label>
          <label>
            <span>Tread (mm)</span>
            <input
              class="ui-input"
              type="number"
              min="0"
              max="20"
              step="0.1"
              [value]="d.treadMm"
              (input)="set({ treadMm: $any($event.target).value })"
            />
          </label>
          <label>
            <span>Bought on</span>
            <input
              class="ui-input"
              type="date"
              [value]="d.purchasedOn"
              (input)="set({ purchasedOn: $any($event.target).value })"
            />
          </label>
          <label>
            <span>Kept at, when off the car</span>
            <input
              class="ui-input"
              maxlength="120"
              placeholder="Gommista Rossi"
              [value]="d.storedAt"
              (input)="set({ storedAt: $any($event.target).value })"
            />
          </label>
          <label class="check">
            <input
              type="checkbox"
              [checked]="d.mounted"
              (change)="set({ mounted: $any($event.target).checked })"
            />
            On the car now
          </label>
          <label class="span">
            <span>Notes</span>
            <input
              class="ui-input"
              maxlength="500"
              [value]="d.notes"
              (input)="set({ notes: $any($event.target).value })"
            />
          </label>
          <div class="form__buttons">
            <button uiButton size="sm" type="submit" [loading]="busy()">
              <ui-icon name="check" [size]="16" /> {{ d.id ? 'Save' : 'Add' }}
            </button>
            <button
              uiButton
              variant="ghost"
              size="sm"
              type="button"
              (click)="draft.set(null)"
            >
              Cancel
            </button>
          </div>
        </form>
      }
      @if (error()) {
        <p class="small tone--danger" role="alert">{{ error() }}</p>
      }
    </ui-card>
  `,
})
export class CarTyresCard {
  private readonly api = inject(CarsApi);

  readonly vehicleId = input.required<string>();
  readonly sets = input.required<TyreSetDto[]>();
  readonly changed = output<void>();

  protected readonly draft = signal<TyreDraft | null>(null);
  protected readonly busy = signal(false);
  protected readonly confirming = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly num = italianNumber;
  protected readonly seasons = TYRE_SEASONS;
  protected readonly seasonLabels = TYRE_SEASON_LABELS;

  protected add(): void {
    this.error.set(null);
    this.draft.set({ ...EMPTY, mounted: !this.sets().length });
  }

  protected edit(set: TyreSetDto): void {
    this.error.set(null);
    this.draft.set({
      id: set.id,
      season: set.season,
      label: set.label ?? '',
      size: set.size ?? '',
      dot: set.dot ?? '',
      purchasedOn: set.purchasedOn ?? '',
      treadMm: set.treadMm === null ? '' : String(set.treadMm),
      mounted: set.mounted,
      storedAt: set.storedAt ?? '',
      notes: set.notes ?? '',
    });
  }

  protected set(change: Partial<TyreDraft>): void {
    this.draft.update((d) => (d ? { ...d, ...change } : d));
  }

  protected save(): void {
    const d = this.draft();
    if (!d) return;
    const tread = d.treadMm.trim() === '' ? null : Number(d.treadMm);
    const request: CreateTyreSetRequest = {
      season: d.season,
      label: d.label.trim() || null,
      size: d.size.trim() || null,
      dot: d.dot.trim() || null,
      purchasedOn: d.purchasedOn || null,
      treadMm: tread !== null && Number.isFinite(tread) ? tread : null,
      mounted: d.mounted,
      storedAt: d.storedAt.trim() || null,
      notes: d.notes.trim() || null,
    };
    this.run(
      d.id
        ? this.api.updateTyreSet(d.id, request)
        : this.api.createTyreSet(this.vehicleId(), request),
      () => this.draft.set(null),
    );
  }

  protected mount(set: TyreSetDto): void {
    this.run(this.api.updateTyreSet(set.id, { mounted: true }));
  }

  protected remove(set: TyreSetDto): void {
    this.run(this.api.removeTyreSet(set.id), () => this.confirming.set(null));
  }

  private run(request: Observable<unknown>, done?: () => void): void {
    this.busy.set(true);
    this.error.set(null);
    request.subscribe({
      next: () => {
        this.busy.set(false);
        done?.();
        this.changed.emit();
      },
      error: (error: { error?: { message?: string } }) => {
        this.busy.set(false);
        this.error.set(
          error.error?.message ?? 'That did not work. Please try again.',
        );
      },
    });
  }
}
