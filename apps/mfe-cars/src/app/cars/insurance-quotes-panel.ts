import { DatePipe } from '@angular/common';
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
  QUOTE_CONTENT_TYPES,
  QUOTE_MAX_BYTES,
  QUOTE_MAX_FILES,
  type CoverStatus,
  type QuoteComparisonDto,
} from '@life-island/contracts';
import {
  UiAiPanel,
  UiAiStatus,
  UiButton,
  UiIcon,
} from '@life-island/design-system';
import { AiTool } from '@life-island/settings-ui';
import { CarsApi } from '../api/cars-api';
import { italianNumber } from './labels';

const COVER_LABELS: Record<CoverStatus, string> = {
  included: 'Included',
  optional: 'Optional',
  missing: 'Not covered',
  unknown: 'Not said',
};

const COVER_MARKS: Record<CoverStatus, string> = {
  included: '✓',
  optional: '+',
  missing: '✗',
  unknown: '?',
};

/**
 * The insurance quote comparison (AI tool cars.insurance-quotes): upload up to
 * four quotes, Claude reads them with the car's current policy and its
 * history, and sets them side by side, cover by cover. The files are not
 * kept; the comparisons are, newest first.
 */
@Component({
  selector: 'cars-insurance-quotes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, UiAiPanel, UiAiStatus, UiButton, UiIcon, AiTool],
  styleUrl: './insights.css',
  template: `
    <ui-ai-panel
      heading="Compare insurance quotes"
      [state]="comparing() ? 'working' : 'idle'"
      [offline]="!aiOn()"
    >
      <li-ai-tool uiAiPanelActions toolId="cars.insurance-quotes" />
      <p class="muted intro">
        @if (aiOn()) {
          Upload the quotes you received (PDF or photos, up to
          {{ maxFiles }}). Claude reads them with your current policy and its
          history, and sets them side by side: price, class, every cover, excess
          and the conditions to watch. The files are sent to the Claude API and
          not kept; only the comparison is.
        } @else {
          The comparison reads your quotes with the Claude API: it needs
          ANTHROPIC_API_KEY in .env (restart svc-cars after setting it) and the
          tool on in Settings → AI tools. Past comparisons stay below.
        }
      </p>
      <form class="form" (submit)="$event.preventDefault(); compare()">
        <label class="span">
          <span>Quotes</span>
          <input
            class="ui-input"
            type="file"
            multiple
            [accept]="accept"
            [disabled]="!aiOn() || comparing()"
            (change)="pick($event)"
          />
        </label>
        @if (files().length) {
          <ul class="files span">
            @for (file of files(); track file.name + file.size) {
              <li>
                <ui-icon name="file" [size]="14" /> {{ file.name }}
                <span class="muted small">{{ size(file.size) }}</span>
                <button
                  uiButton
                  variant="ghost"
                  size="sm"
                  type="button"
                  [attr.aria-label]="'Remove ' + file.name"
                  (click)="drop(file)"
                >
                  <ui-icon name="x" [size]="14" />
                </button>
              </li>
            }
          </ul>
        }
        <label class="span">
          <span>Anything to consider (optional)</span>
          <textarea
            class="ui-input"
            maxlength="1000"
            rows="2"
            placeholder="I drive about 8.000 km a year; my daughter will drive it too"
            [value]="note()"
            (input)="note.set($any($event.target).value)"
          ></textarea>
        </label>
        <div class="form__buttons">
          <button
            uiButton
            type="submit"
            [loading]="comparing()"
            [disabled]="!aiOn() || !files().length"
          >
            <ui-icon name="sparkles" [size]="16" /> Compare
          </button>
          @if (comparing()) {
            <ui-ai-status state="working"
              >Reading the quotes: this takes a minute.</ui-ai-status
            >
          } @else if (error()) {
            <ui-ai-status state="error">{{ error() }}</ui-ai-status>
          }
        </div>
      </form>

      @if (shown(); as c) {
        <div class="comparison">
          <h3 class="sub">
            {{ c.createdAt | date: 'd MMM y, HH:mm' }} ·
            {{ c.files.join(', ') }}
          </h3>
          <p>{{ c.summary }}</p>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th scope="col"></th>
                  @for (o of c.options; track $index) {
                    <th scope="col" [class.option--current]="o.current">
                      {{ o.name }}
                    </th>
                  }
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Yearly premium</th>
                  @for (o of c.options; track $index) {
                    <td [class.option--current]="o.current">
                      {{
                        o.yearlyPremium === null
                          ? '—'
                          : '€ ' + num(o.yearlyPremium, 2, 2)
                      }}
                    </td>
                  }
                </tr>
                <tr>
                  <th scope="row">Class (CU)</th>
                  @for (o of c.options; track $index) {
                    <td [class.option--current]="o.current">
                      {{ o.cuClass ?? '—' }}
                    </td>
                  }
                </tr>
                <tr>
                  <th scope="row">Who may drive</th>
                  @for (o of c.options; track $index) {
                    <td [class.option--current]="o.current">
                      {{ o.driverType ?? '—' }}
                    </td>
                  }
                </tr>
                <tr>
                  <th scope="row">RCA limit</th>
                  @for (o of c.options; track $index) {
                    <td [class.option--current]="o.current">
                      {{ o.rcaLimit ?? '—' }}
                    </td>
                  }
                </tr>
                <tr>
                  <th scope="row">Excess</th>
                  @for (o of c.options; track $index) {
                    <td [class.option--current]="o.current">
                      {{ o.excess ?? '—' }}
                    </td>
                  }
                </tr>
                @for (cover of c.covers; track cover.name) {
                  <tr>
                    <th scope="row">{{ cover.name }}</th>
                    @for (s of cover.statuses; track $index) {
                      <td [class.option--current]="c.options[$index]?.current">
                        <span
                          [class]="'cover--' + s.status"
                          [attr.title]="coverLabels[s.status]"
                          >{{ coverMarks[s.status] }}
                          <span class="sr-only">{{
                            coverLabels[s.status]
                          }}</span></span
                        >
                        @if (s.detail) {
                          <span class="muted small">
                            {{ detail(s.detail) }}</span
                          >
                        }
                      </td>
                    }
                  </tr>
                }
                <tr>
                  <th scope="row">Pros</th>
                  @for (o of c.options; track $index) {
                    <td [class.option--current]="o.current">
                      <ul class="bullets">
                        @for (p of o.pros; track $index) {
                          <li>{{ p }}</li>
                        }
                      </ul>
                    </td>
                  }
                </tr>
                <tr>
                  <th scope="row">Cons</th>
                  @for (o of c.options; track $index) {
                    <td [class.option--current]="o.current">
                      <ul class="bullets">
                        @for (p of o.cons; track $index) {
                          <li>{{ p }}</li>
                        }
                      </ul>
                    </td>
                  }
                </tr>
              </tbody>
            </table>
          </div>
          <p class="muted small">
            ✓ included · + optional, at extra cost · ✗ not covered · ? the
            document does not say
          </p>
          @if (c.watchOuts.length) {
            <h3 class="sub">Watch out for</h3>
            <ul class="bullets">
              @for (w of c.watchOuts; track $index) {
                <li>{{ w }}</li>
              }
            </ul>
          }
          @if (c.questions.length) {
            <h3 class="sub">Ask before signing</h3>
            <ul class="bullets">
              @for (q of c.questions; track $index) {
                <li>{{ q }}</li>
              }
            </ul>
          }
          <h3 class="sub">What to do</h3>
          <p>{{ c.recommendation }}</p>
          <div class="actions">
            <span class="muted small"
              >Compared{{ c.model ? ' by ' + c.model : '' }}. Check each figure
              on the quote before you sign.</span
            >
            <button
              uiButton
              variant="ghost"
              size="sm"
              type="button"
              aria-label="Delete this comparison"
              (click)="remove(c)"
            >
              <ui-icon name="trash" [size]="14" />
            </button>
          </div>
        </div>
      }
      @if (comparisons().length > 1) {
        <h3 class="sub">Earlier comparisons</h3>
        <ul class="plain">
          @for (c of comparisons(); track c.id) {
            <li>
              <button
                type="button"
                class="link"
                [class.link--on]="shown()?.id === c.id"
                (click)="shownId.set(c.id)"
              >
                {{ c.createdAt | date: 'd MMM y' }} · {{ c.files.join(', ') }}
              </button>
            </li>
          }
        </ul>
      }
    </ui-ai-panel>
  `,
  styles: `
    .comparison {
      margin-top: var(--space-4);
      padding-top: var(--space-4);
      border-top: 1px solid var(--border-subtle);
    }
    .comparison > p {
      margin: 0 0 var(--space-3);
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
})
export class InsuranceQuotesPanel {
  private readonly api = inject(CarsApi);

  readonly vehicleId = input.required<string>();
  readonly comparisons = input<QuoteComparisonDto[]>([]);
  /** Whether the tool calls Claude now (key set, tool on). */
  readonly aiOn = input(false);
  readonly changed = output<void>();

  protected readonly files = signal<File[]>([]);
  protected readonly note = signal('');
  protected readonly comparing = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly shownId = signal<string | null>(null);

  protected readonly shown = computed<QuoteComparisonDto | null>(
    () =>
      this.comparisons().find((c) => c.id === this.shownId()) ??
      this.comparisons()[0] ??
      null,
  );

  protected readonly num = italianNumber;
  protected readonly maxFiles = QUOTE_MAX_FILES;
  protected readonly accept = QUOTE_CONTENT_TYPES.join(',');
  protected readonly coverLabels = COVER_LABELS;
  protected readonly coverMarks = COVER_MARKS;

  /** "+ € 38" after the + mark reads "€ 38". */
  protected detail(text: string): string {
    return text.replace(/^\+\s*/, '');
  }

  protected size(bytes: number): string {
    return bytes < 1024 * 1024
      ? `${Math.max(1, Math.round(bytes / 1024))} KB`
      : `${italianNumber(bytes / 1024 / 1024, 1, 1)} MB`;
  }

  protected pick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const picked = [...(input.files ?? [])];
    input.value = '';
    this.error.set(null);
    const tooBig = picked.find((f) => f.size > QUOTE_MAX_BYTES);
    if (tooBig) {
      this.error.set(
        `${tooBig.name} is over ${QUOTE_MAX_BYTES / 1024 / 1024} MB`,
      );
      return;
    }
    const all = [...this.files(), ...picked];
    if (all.length > QUOTE_MAX_FILES)
      this.error.set(`Compare at most ${QUOTE_MAX_FILES} quotes at a time`);
    this.files.set(all.slice(0, QUOTE_MAX_FILES));
  }

  protected drop(file: File): void {
    this.files.update((all) => all.filter((f) => f !== file));
  }

  protected compare(): void {
    if (!this.files().length || this.comparing()) return;
    this.comparing.set(true);
    this.error.set(null);
    this.api
      .compareQuotes(this.vehicleId(), this.files(), this.note().trim() || null)
      .subscribe({
        next: (comparison) => {
          this.comparing.set(false);
          this.files.set([]);
          this.note.set('');
          this.shownId.set(comparison.id);
          this.changed.emit();
        },
        error: (error: { error?: { message?: string } }) => {
          this.comparing.set(false);
          this.error.set(
            error.error?.message ??
              'The comparison could not run. Try again in a moment.',
          );
        },
      });
  }

  protected remove(comparison: QuoteComparisonDto): void {
    this.api.removeComparison(comparison.id).subscribe({
      next: () => {
        if (this.shownId() === comparison.id) this.shownId.set(null);
        this.changed.emit();
      },
      error: () => this.error.set('The comparison could not be deleted.'),
    });
  }
}
