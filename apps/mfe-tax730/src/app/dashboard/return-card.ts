import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  TAX730_FIGURE_LABELS,
  type Tax730TaxFiguresDto,
  type Tax730TaxReturnDto,
} from '@life-island/contracts';
import { UiBadge, UiCard } from '@life-island/design-system';
import { formatDate, formatEuro } from './format';

type FigureKey = keyof Tax730TaxFiguresDto;

const FIGURES = Object.keys(TAX730_FIGURE_LABELS) as FigureKey[];

/**
 * The return of the year: once filed (730 or Redditi PF) its figures are
 * certain and shown first, with how they compare with the forecast and what
 * is left to do; until then the forecast from your documents, and the
 * deadline of the form you file.
 */
@Component({
  selector: 'tax-return-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiBadge],
  template: `
    @let r = taxReturn();
    <ui-card [heading]="heading()">
      <div class="status">
        @switch (r.status) {
          @case ('filed') {
            <ui-badge tone="success">Filed</ui-badge>
            <span
              >{{ r.formLabel }} {{ r.filingYear }}
              @if (r.filed?.filedOn; as on) {
                · sent on {{ formatDate(on) }}
              }
              @if (r.filed?.filingId; as id) {
                · {{ id }}
              }
            </span>
          }
          @case ('late') {
            <ui-badge tone="danger">Not uploaded</ui-badge>
            <span
              >The {{ r.formLabel }} was due on {{ formatDate(r.deadline) }}.
              Filed already? Upload it in the documents app: its figures replace
              the forecast and the deadline is done.</span
            >
          }
          @default {
            <ui-badge tone="info">Forecast</ui-badge>
            <span
              >{{ r.formLabel }} {{ r.filingYear }} due by
              {{ formatDate(r.deadline) }}. Once you upload it, its figures
              replace this forecast.</span
            >
          }
        }
      </div>

      @if (r.filed; as f) {
        <div class="result">
          <div>
            <span class="result__label">{{
              f.result > 0
                ? 'To pay'
                : f.result < 0
                  ? 'In your favour'
                  : 'Result'
            }}</span>
            <span
              class="result__value"
              [class.result__value--credit]="f.result < 0"
              >{{ formatEuro(abs(f.result)) }}</span
            >
            <span class="result__sub"
              >IRPEF {{ signed(f.irpefDue - f.irpefCredit) }}, surtaxes
              {{ signed(f.surtaxDue - f.surtaxCredit) }}</span
            >
          </div>
          @if (r.comparison; as c) {
            <div>
              <span class="result__label">Against the forecast</span>
              <ui-badge [tone]="c.matches ? 'success' : 'warning'">{{
                c.matches ? 'Matches' : 'Differs'
              }}</ui-badge>
            </div>
          }
        </div>
        <ul class="notes" role="list">
          @for (n of f.notes; track n) {
            <li>{{ n }}</li>
          }
        </ul>
      }

      @if (rows().length) {
        <table class="figures">
          <thead>
            <tr>
              <th scope="col">
                {{ r.filed ? 'Figure' : 'Forecast from your documents' }}
              </th>
              <th scope="col" class="row">Rigo</th>
              @if (r.filed) {
                <th scope="col" class="num">Filed</th>
              }
              @if (r.forecast) {
                <th scope="col" class="num">Forecast</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.key) {
              <tr [class.off]="row.matches === false">
                <th scope="row">{{ row.label }}</th>
                <td class="row">{{ row.row }}</td>
                @if (r.filed) {
                  <td class="num">{{ amount(row.filed) }}</td>
                }
                @if (r.forecast) {
                  <td class="num">
                    {{ amount(row.forecast) }}
                    @if (row.matches === false && row.difference !== null) {
                      <span class="diff"
                        >return {{ signed(row.difference) }}</span
                      >
                    }
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      }

      @if (r.comparison; as c) {
        <p class="summary" [class.summary--ok]="c.matches">{{ c.summary }}</p>
        @if (c.causes.length) {
          <h3 class="sub">What is likely missing</h3>
          <ul class="causes" role="list">
            @for (cause of c.causes; track cause) {
              <li>{{ cause }}</li>
            }
          </ul>
        }
      }

      @if (r.forecast; as fc) {
        <p class="basis">
          @if (r.filed) {
            Forecast built from:
          } @else {
            Built from:
          }
          {{ basisText(fc.basis) }}.
        </p>
        @if (!r.filed && fc.missing.length) {
          <ul class="missing" role="list">
            @for (m of fc.missing; track m) {
              <li>Upload {{ lower(m) }}</li>
            }
          </ul>
        }
      } @else if (!r.filed) {
        <p class="basis">
          Upload the Certificazione Unica or your payslips of
          {{ r.filingYear - 1 }} to see a forecast of the return.
        </p>
      }
      <p class="foot">
        A forecast for planning, with the brackets and credits of the year; the
        filed return is what counts.
      </p>
    </ui-card>
  `,
  styles: `
    .status {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2) var(--space-3);
      margin-bottom: var(--space-4);
      color: var(--text-secondary);
      font-size: var(--text-sm);
    }
    .result {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-6);
      margin-bottom: var(--space-3);
    }
    .result > div {
      display: grid;
      align-content: start;
      justify-items: start;
      gap: var(--space-1);
    }
    .result__label,
    .result__sub {
      color: var(--text-muted);
      font-size: var(--text-sm);
    }
    .result__value {
      color: var(--text-primary);
      font-size: var(--text-2xl);
      font-variant-numeric: tabular-nums;
    }
    .result__value--credit {
      color: var(--tone-success);
    }
    .notes,
    .causes,
    .missing {
      display: grid;
      gap: var(--space-2);
      margin: 0 0 var(--space-4);
      padding-left: var(--space-5);
      font-size: var(--text-sm);
    }
    .causes {
      padding: var(--space-3) var(--space-4) var(--space-3) var(--space-6);
      border-radius: var(--radius-md);
      background: var(--tone-warning-soft);
    }
    .figures {
      width: 100%;
      margin-bottom: var(--space-4);
      border-collapse: collapse;
      font-size: var(--text-sm);
    }
    .figures th,
    .figures td {
      padding: var(--space-2) var(--space-2);
      border-bottom: 1px solid var(--border-subtle);
      text-align: left;
      font-weight: normal;
    }
    .figures thead th {
      color: var(--text-muted);
    }
    .figures .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .figures .row {
      color: var(--text-muted);
      white-space: nowrap;
    }
    .figures tr.off td.num:last-child {
      color: var(--tone-warning);
    }
    .diff {
      display: block;
      font-size: var(--text-xs);
    }
    .summary {
      margin: 0 0 var(--space-3);
      color: var(--tone-warning);
      font-weight: 600;
    }
    .summary--ok {
      color: var(--tone-success);
    }
    .sub {
      margin: 0 0 var(--space-2);
      font-size: var(--text-sm);
    }
    .basis,
    .foot {
      margin: 0 0 var(--space-2);
      color: var(--text-muted);
      font-size: var(--text-sm);
    }
    .foot {
      font-size: var(--text-xs);
    }
    @media (max-width: 40rem) {
      .figures .row {
        display: none;
      }
    }
  `,
})
export class ReturnCard {
  readonly taxReturn = input.required<Tax730TaxReturnDto>();

  protected readonly heading = computed(() => {
    const r = this.taxReturn();
    return `${r.formLabel} ${r.filingYear} · income of ${r.filingYear - 1}`;
  });

  /** One row per figure that the return or the forecast knows. */
  protected readonly rows = computed(() => {
    const r = this.taxReturn();
    const lines = new Map(r.comparison?.lines.map((l) => [l.key, l]) ?? []);
    return FIGURES.map((key) => {
      const filed = r.filed?.figures[key] ?? null;
      const forecast = r.forecast?.figures[key] ?? null;
      return {
        key,
        ...TAX730_FIGURE_LABELS[key],
        filed,
        forecast,
        matches: lines.get(key)?.matches ?? null,
        difference: lines.get(key)?.difference ?? null,
      };
    }).filter((row) => row.filed !== null || row.forecast !== null);
  });

  protected readonly formatEuro = formatEuro;
  protected readonly formatDate = formatDate;
  protected readonly abs = Math.abs;
  protected amount(value: number | null): string {
    return value === null ? '–' : formatEuro(value);
  }
  protected signed(value: number): string {
    const rounded = Math.round(value * 100) / 100;
    if (rounded === 0) return formatEuro(0);
    return `${rounded > 0 ? '+' : '−'}${formatEuro(Math.abs(rounded))}`;
  }
  protected basisText(basis: string[]): string {
    return basis.map((b) => this.lower(b)).join('; ') || 'nothing yet';
  }
  protected lower(text: string): string {
    return text.charAt(0).toLowerCase() + text.slice(1);
  }
}
