import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type {
  Tax730DeductionLineDto,
  TaxYearDossierDto,
} from '@life-island/contracts';
import { UiBadge, UiCard } from '@life-island/design-system';
import { formatEuro } from './format';

const percent = (rate: number) => `${Math.round(rate * 100)}%`;

/**
 * A year's expenses against the rules of the 730: one row per kind with its
 * cap (filled by what you spent), franchigia, rate and the tax it gives back,
 * then the instalments of home bonuses from earlier years.
 */
@Component({
  selector: 'tax-deductions-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiBadge],
  template: `
    <ui-card heading="Deductions and limits">
      @let d = dossier().deductions;
      <div class="head">
        <div>
          <span class="head__label"
            >Estimated tax back in the 730/{{ dossier().filingYear }}</span
          >
          <span class="head__value">{{ formatEuro(d.thisYear) }}</span>
        </div>
        @if (d.futureYears > 0) {
          <div>
            <span class="head__label">Still to come in later 730s</span>
            <span class="head__value head__value--soft">{{
              formatEuro(d.futureYears)
            }}</span>
          </div>
        }
      </div>

      <ul class="lines" role="list">
        @for (l of d.lines; track l.group) {
          <li class="line">
            <div class="line__title">
              <span class="line__label">{{ l.label }}</span>
              <ui-badge>{{ l.row730 }}</ui-badge>
              <span class="line__rule">{{ ruleText(l) }}</span>
            </div>
            <div class="line__meter">
              @if (l.effectiveCap) {
                <span
                  class="track"
                  role="meter"
                  [attr.aria-label]="l.label + ' cap used'"
                  aria-valuemin="0"
                  [attr.aria-valuemax]="l.effectiveCap"
                  [attr.aria-valuenow]="l.spent - l.excluded"
                >
                  <span
                    class="fill"
                    [class.fill--over]="(l.capUsage ?? 0) > 1"
                    [style.width.%]="usageWidth(l)"
                  ></span>
                  @if (l.franchigia) {
                    <span
                      class="mark"
                      [style.left.%]="(l.franchigia / l.effectiveCap) * 100"
                      [title]="'Franchigia ' + formatEuro(l.franchigia)"
                    ></span>
                  }
                </span>
                <span class="line__cap">
                  {{ formatEuro(l.spent - l.excluded) }} of
                  {{ formatEuro(l.effectiveCap) }}
                  @if (l.people && l.people > 1) {
                    ({{ l.people }} people)
                  }
                </span>
              } @else {
                <span class="line__cap"
                  >{{ formatEuro(l.spent) }} spent ·
                  {{
                    l.capScope === 'intervention'
                      ? 'cap set per kind of works'
                      : 'no cap'
                  }}</span
                >
              }
            </div>
            <div class="line__result">
              <span class="line__deduction">{{ formatEuro(l.deduction) }}</span>
              @if (l.instalments > 1 && l.totalDeduction) {
                <span class="line__sub"
                  >1 of {{ l.instalments }},
                  {{ formatEuro(l.totalDeduction) }} in all</span
                >
              }
            </div>
            @if (warnings(l).length) {
              <ul class="line__warnings" role="list">
                @for (w of warnings(l); track w) {
                  <li>{{ w }}</li>
                }
              </ul>
            }
            <details class="line__notes">
              <summary>Rules</summary>
              <ul>
                @for (n of l.notes; track n) {
                  <li>{{ n }}</li>
                }
              </ul>
            </details>
          </li>
        } @empty {
          <li class="muted">No expenses in {{ dossier().taxYear }} yet.</li>
        }
      </ul>

      @if (d.carried.length) {
        <h3 class="sub">Instalments from earlier years</h3>
        <ul class="carried" role="list">
          @for (c of d.carried; track c.fromYear + c.group) {
            <li>
              <span>{{ c.label }}, expenses of {{ c.fromYear }}</span>
              <span class="muted"
                >instalment {{ c.instalment }} of {{ c.of }}</span
              >
              <span class="num">{{ formatEuro(c.amount) }}</span>
            </li>
          }
        </ul>
      }
      <p class="foot">
        An estimate for planning: home bonuses at the main-home rate, before the
        income limits (above €75,000 or €120,000). The commercialista decides.
      </p>
    </ui-card>
  `,
  styles: `
    .head {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-6);
      margin-bottom: var(--space-5);
    }
    .head > div {
      display: grid;
    }
    .head__label {
      color: var(--text-muted);
      font-size: var(--text-sm);
    }
    .head__value {
      color: var(--text-primary);
      font-size: var(--text-2xl);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .head__value--soft {
      color: var(--text-secondary);
    }
    .lines,
    .carried {
      display: grid;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .line {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 9rem;
      gap: var(--space-2) var(--space-4);
      padding: var(--space-3) 0;
      border-bottom: 1px solid var(--border-subtle);
    }
    .line:last-child {
      border-bottom: 0;
    }
    .line__title {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
    }
    .line__label {
      color: var(--text-primary);
      font-weight: 600;
    }
    .line__rule,
    .line__cap,
    .line__sub {
      color: var(--text-muted);
      font-size: var(--text-sm);
    }
    .line__meter {
      display: grid;
      grid-column: 1;
      gap: var(--space-1);
    }
    .line__result {
      display: grid;
      grid-row: 1 / span 2;
      grid-column: 2;
      align-content: start;
      text-align: right;
    }
    .line__deduction {
      color: var(--text-primary);
      font-size: var(--text-lg);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .track {
      position: relative;
      display: block;
      height: var(--space-3);
      border-radius: var(--radius-full);
      background: var(--surface-sunken);
    }
    .fill {
      display: block;
      height: 100%;
      min-width: var(--space-1);
      border-radius: var(--radius-full);
      background: var(--accent);
    }
    .fill--over {
      background: var(--tone-danger);
    }
    .mark {
      position: absolute;
      top: calc(-1 * var(--space-1));
      bottom: calc(-1 * var(--space-1));
      width: 2px;
      background: var(--text-secondary);
    }
    .line__warnings {
      grid-column: 1 / -1;
      margin: 0;
      padding-left: var(--space-5);
      color: var(--tone-warning);
      font-size: var(--text-sm);
    }
    .line__notes {
      grid-column: 1 / -1;
      color: var(--text-secondary);
      font-size: var(--text-sm);
    }
    .line__notes summary {
      color: var(--text-muted);
      cursor: pointer;
    }
    .line__notes ul {
      margin: var(--space-2) 0 0;
      padding-left: var(--space-5);
    }
    .sub {
      margin: var(--space-5) 0 var(--space-2);
      font-size: var(--text-base);
    }
    .carried li {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto 8rem;
      gap: var(--space-3);
      padding: var(--space-1) 0;
      color: var(--text-secondary);
      font-size: var(--text-sm);
    }
    .num {
      color: var(--text-primary);
      font-variant-numeric: tabular-nums;
      text-align: right;
    }
    .muted {
      color: var(--text-muted);
    }
    .foot {
      margin: var(--space-4) 0 0;
      color: var(--text-muted);
      font-size: var(--text-xs);
    }
    @media (max-width: 40rem) {
      .line {
        grid-template-columns: 1fr;
      }
      .line__result {
        grid-row: auto;
        grid-column: 1;
        text-align: left;
      }
      .carried li {
        grid-template-columns: minmax(0, 1fr) auto;
      }
      .carried li .muted {
        grid-row: 2;
      }
    }
  `,
})
export class DeductionsCard {
  readonly dossier = input.required<TaxYearDossierDto>();

  protected readonly formatEuro = formatEuro;

  protected ruleText(line: Tax730DeductionLineDto): string {
    if (line.rate === null) return 'not estimated';
    const parts = [percent(line.rate)];
    if (line.reducedRate)
      parts[0] += ` (${percent(line.reducedRate.rate)} if ${line.reducedRate.when})`;
    if (line.franchigia)
      parts.push(`first ${formatEuro(line.franchigia)} never counts`);
    if (line.instalments > 1)
      parts.push(`${line.instalments} yearly instalments`);
    if (line.cap && line.capScope === 'person')
      parts.push(`${formatEuro(line.cap)} per person`);
    if (line.cap && line.capScope === 'unit')
      parts.push(`${formatEuro(line.cap)} per home`);
    return parts.join(' · ');
  }

  protected usageWidth(line: Tax730DeductionLineDto): number {
    return Math.min(1, line.capUsage ?? 0) * 100;
  }

  protected warnings(line: Tax730DeductionLineDto): string[] {
    const list: string[] = [];
    if (line.overCap > 0)
      list.push(`${formatEuro(line.overCap)} over the cap: it does not count.`);
    if (line.excluded > 0)
      list.push(
        `${formatEuro(line.excluded)} paid in cash: it does not count unless it was paid traceably.`,
      );
    if (line.franchigia && line.spent - line.excluded <= line.franchigia)
      list.push('Still under the franchigia: nothing back yet.');
    return list;
  }
}
