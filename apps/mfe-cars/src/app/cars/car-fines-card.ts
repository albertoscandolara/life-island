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
  FINE_STAGE_LABELS,
  type CarFineDto,
  type CarFinesDto,
  type CarsPeopleDto,
  type FineStage,
} from '@life-island/contracts';
import {
  UiBadge,
  UiButton,
  UiCard,
  UiIcon,
  type UiTone,
} from '@life-island/design-system';
import { CarsApi } from '../api/cars-api';
import { italianNumber } from './labels';

const STAGE_TONES: Record<FineStage, UiTone> = {
  discount: 'warning',
  due: 'warning',
  late: 'danger',
  paid: 'success',
  unknown: 'neutral',
};

/** What you are typing on one fine. */
interface FineDraft {
  notifiedOn: string;
  paidOn: string;
  points: string;
  /** A person of People, '' for none, or 'typed' for a name you type. */
  driver: string;
  driverName: string;
}

/**
 * The car's fines (expenses of kind fine) with their deadlines, which all run
 * from the day the fine reached you: 30% off within 5 days, the full amount
 * within 60, appeal within 30 (Giudice di pace) or 60 (Prefetto), and the
 * driver to name within 60 when it costs licence points. Below, the points
 * each driver lost in the last 2 years.
 */
@Component({
  selector: 'cars-fines-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, UiBadge, UiButton, UiCard, UiIcon],
  styleUrl: './insights.css',
  template: `
    <ui-card heading="Fines">
      @let f = fines();
      @if (!f.fines.length) {
        <p class="muted">
          No fines. A fine filed as a car expense shows here with its deadlines:
          30% off within 5 days of notification, the full amount within 60.
        </p>
      } @else {
        <ul class="items">
          @for (fine of f.fines; track fine.uploadId) {
            <li class="item">
              <div class="item__head">
                <h3 class="item__title">
                  {{
                    fine.violationDate
                      ? (fine.violationDate | date: 'd MMM y')
                      : 'Fine'
                  }}
                  @if (fine.article) {
                    <span class="muted small">· {{ fine.article }}</span>
                  }
                </h3>
                <ui-badge [tone]="stageTones[fine.stage]">{{
                  stageLabels[fine.stage]
                }}</ui-badge>
              </div>
              <p class="muted">
                {{ fine.authority ?? fine.title }}
                @if (fine.amount !== null) {
                  · € {{ num(fine.amount, 2, 2) }}
                  @if (fine.reducedAmount !== null && fine.stage !== 'paid') {
                    (€ {{ num(fine.reducedAmount, 2, 2) }} within 5 days)
                  }
                }
                @if (fine.points) {
                  · {{ fine.points }} licence
                  {{ fine.points === 1 ? 'point' : 'points' }}
                }
                @if (fine.driverName) {
                  · driven by {{ fine.driverName }}
                }
              </p>
              @if (fine.stage === 'paid') {
                <p class="muted">
                  Paid on {{ fine.paidOn | date: 'd MMM y' }}.
                </p>
              } @else if (fine.notifiedOn) {
                <dl class="deadlines">
                  <div [class.deadline--past]="past(fine.discountUntil)">
                    <dt>30% off by</dt>
                    <dd>{{ fine.discountUntil | date: 'd MMM y' }}</dd>
                  </div>
                  <div [class.deadline--past]="past(fine.payBy)">
                    <dt>Pay by</dt>
                    <dd>{{ fine.payBy | date: 'd MMM y' }}</dd>
                  </div>
                  <div [class.deadline--past]="past(fine.judgeAppealBy)">
                    <dt>Appeal, Giudice di pace</dt>
                    <dd>{{ fine.judgeAppealBy | date: 'd MMM y' }}</dd>
                  </div>
                  <div [class.deadline--past]="past(fine.prefectAppealBy)">
                    <dt>Appeal, Prefetto</dt>
                    <dd>{{ fine.prefectAppealBy | date: 'd MMM y' }}</dd>
                  </div>
                  @if (fine.driverBy) {
                    <div [class.deadline--past]="past(fine.driverBy)">
                      <dt>Name the driver by</dt>
                      <dd>{{ fine.driverBy | date: 'd MMM y' }}</dd>
                    </div>
                  }
                </dl>
              } @else {
                <p>
                  Add the day it reached you (the notification): every deadline
                  runs from it.
                </p>
              }

              @if (drafts()[fine.uploadId]; as d) {
                <form
                  class="form"
                  (submit)="$event.preventDefault(); save(fine)"
                >
                  <label>
                    <span>Reached you on</span>
                    <input
                      class="ui-input"
                      type="date"
                      [value]="d.notifiedOn"
                      (input)="
                        set(fine, { notifiedOn: $any($event.target).value })
                      "
                    />
                  </label>
                  <label>
                    <span>Paid on</span>
                    <input
                      class="ui-input"
                      type="date"
                      [value]="d.paidOn"
                      (input)="set(fine, { paidOn: $any($event.target).value })"
                    />
                  </label>
                  <label>
                    <span>Licence points</span>
                    <input
                      class="ui-input"
                      type="number"
                      min="0"
                      max="20"
                      [value]="d.points"
                      (input)="set(fine, { points: $any($event.target).value })"
                    />
                  </label>
                  <label>
                    <span>Driver</span>
                    <select
                      class="ui-input"
                      [value]="d.driver"
                      (change)="
                        set(fine, { driver: $any($event.target).value })
                      "
                    >
                      <option value="">Not named</option>
                      @for (p of people().people; track p.id) {
                        <option [value]="p.id">{{ p.name }}</option>
                      }
                      <option value="typed">Someone else…</option>
                    </select>
                  </label>
                  @if (d.driver === 'typed') {
                    <label>
                      <span>Driver's name</span>
                      <input
                        class="ui-input"
                        maxlength="120"
                        [value]="d.driverName"
                        (input)="
                          set(fine, { driverName: $any($event.target).value })
                        "
                      />
                    </label>
                  }
                  <div class="form__buttons">
                    <button
                      uiButton
                      size="sm"
                      type="submit"
                      [loading]="busy() === fine.uploadId"
                    >
                      <ui-icon name="check" [size]="16" /> Save
                    </button>
                    <button
                      uiButton
                      variant="ghost"
                      size="sm"
                      type="button"
                      (click)="cancel(fine)"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              } @else {
                <div class="actions">
                  <button
                    uiButton
                    variant="ghost"
                    size="sm"
                    type="button"
                    (click)="edit(fine)"
                  >
                    <ui-icon name="edit" [size]="14" />
                    {{ fine.notifiedOn ? 'Edit' : 'Add the notification date' }}
                  </button>
                  @if (fine.stage !== 'paid') {
                    <button
                      uiButton
                      variant="ghost"
                      size="sm"
                      type="button"
                      [loading]="busy() === fine.uploadId"
                      (click)="markPaid(fine)"
                    >
                      <ui-icon name="check" [size]="14" /> Paid today
                    </button>
                  }
                </div>
              }
            </li>
          }
        </ul>
        @if (f.points.length) {
          <h3 class="sub">Licence points lost in the last 2 years</h3>
          <ul class="plain">
            @for (p of f.points; track p.driverName) {
              <li>
                <strong>{{ p.driverName }}</strong
                >: {{ p.points }} {{ p.points === 1 ? 'point' : 'points' }} over
                {{ p.fines }}
                {{ p.fines === 1 ? 'fine' : 'fines' }}
              </li>
            }
          </ul>
          <p class="muted small">
            From this car's fines only. Your balance is on the Portale
            dell'automobilista.
          </p>
        }
      }
      @if (error()) {
        <p class="small tone--danger" role="alert">{{ error() }}</p>
      }
    </ui-card>
  `,
})
export class CarFinesCard {
  private readonly api = inject(CarsApi);

  readonly fines = input.required<CarFinesDto>();
  readonly people = input<CarsPeopleDto>({ people: [], available: false });
  /** Today, as the page knows it (YYYY-MM-DD). */
  readonly today = input(new Date().toISOString().slice(0, 10));
  readonly changed = output<void>();

  protected readonly drafts = signal<Record<string, FineDraft>>({});
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly num = italianNumber;
  protected readonly stageLabels = FINE_STAGE_LABELS;
  protected readonly stageTones = STAGE_TONES;

  protected past(date: string | null): boolean {
    return date !== null && date < this.today();
  }

  protected edit(fine: CarFineDto): void {
    const known = this.people().people.some(
      (p) => p.id === fine.driverPersonId,
    );
    this.drafts.update((all) => ({
      ...all,
      [fine.uploadId]: {
        notifiedOn: fine.notifiedOn ?? '',
        paidOn: fine.paidOn ?? '',
        points: fine.points === null ? '' : String(fine.points),
        driver: known
          ? (fine.driverPersonId as string)
          : fine.driverName
            ? 'typed'
            : '',
        driverName: fine.driverName ?? '',
      },
    }));
  }

  protected set(fine: CarFineDto, change: Partial<FineDraft>): void {
    this.drafts.update((all) => ({
      ...all,
      [fine.uploadId]: { ...all[fine.uploadId], ...change },
    }));
  }

  protected cancel(fine: CarFineDto): void {
    this.drafts.update((all) => {
      const rest = { ...all };
      delete rest[fine.uploadId];
      return rest;
    });
  }

  protected save(fine: CarFineDto): void {
    const d = this.drafts()[fine.uploadId];
    if (!d) return;
    const person = this.people().people.find((p) => p.id === d.driver);
    const points = d.points.trim() === '' ? null : Math.round(Number(d.points));
    this.send(
      fine,
      {
        notifiedOn: d.notifiedOn || null,
        paidOn: d.paidOn || null,
        points: Number.isFinite(points) ? points : null,
        driverPersonId: person?.id ?? null,
        driverName: person
          ? person.name
          : d.driver === 'typed'
            ? d.driverName.trim() || null
            : null,
      },
      true,
    );
  }

  protected markPaid(fine: CarFineDto): void {
    this.send(fine, { paidOn: this.today() }, false);
  }

  private send(
    fine: CarFineDto,
    request: Parameters<CarsApi['updateFine']>[1],
    closeDraft: boolean,
  ): void {
    this.busy.set(fine.uploadId);
    this.error.set(null);
    this.api.updateFine(fine.uploadId, request).subscribe({
      next: () => {
        this.busy.set(null);
        if (closeDraft) this.cancel(fine);
        this.changed.emit();
      },
      error: (error: { error?: { message?: string } }) => {
        this.busy.set(null);
        this.error.set(
          error.error?.message ?? 'The fine could not be saved. Try again.',
        );
      },
    });
  }
}
