import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type {
  InsuranceHistoryDto,
  InsuranceNoteTone,
} from '@life-island/contracts';
import { UiAlert, UiCard, type UiTone } from '@life-island/design-system';
import { italianNumber } from './labels';

const NOTE_TONES: Record<InsuranceNoteTone, UiTone> = {
  info: 'info',
  warning: 'warning',
  success: 'success',
};

/**
 * The car's insurance policy after policy: premium, bonus-malus class and
 * covers, each against the one before, and what the latest renewal changed.
 */
@Component({
  selector: 'cars-insurance-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, UiAlert, UiCard],
  styleUrl: './insights.css',
  template: `
    <ui-card heading="Insurance history">
      @let h = history();
      @if (!h.periods.length) {
        <p class="muted">
          No insurance on file yet: approve a policy, certificate or receipt and
          each renewal shows here with its premium, class and covers.
        </p>
      } @else {
        @if (h.notes.length) {
          <div class="notes">
            @for (note of h.notes; track $index) {
              <ui-alert [tone]="noteTones[note.tone]">{{ note.text }}</ui-alert>
            }
          </div>
        }
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col">Insurer</th>
                <th scope="col" class="num">Premium</th>
                <th scope="col" class="num">Class (CU)</th>
                <th scope="col">Covers</th>
              </tr>
            </thead>
            <tbody>
              @for (p of h.periods; track p.uploadId) {
                <tr [class.row--off]="p.cancelled">
                  <th scope="row">
                    {{ p.validFrom ? (p.validFrom | date: 'MMM y') : '?' }} –
                    {{ p.validUntil ? (p.validUntil | date: 'MMM y') : '?' }}
                    @if (p.cancelled) {
                      <span class="muted small">(cancelled)</span>
                    }
                  </th>
                  <td>
                    {{ p.insurer ?? '—' }}
                    @if (p.number) {
                      <span class="muted small">{{ p.number }}</span>
                    }
                  </td>
                  <td class="num nowrap">
                    {{ p.premium === null ? '—' : '€ ' + num(p.premium, 2, 2) }}
                    @if (p.premiumChange !== null) {
                      <span
                        class="small"
                        [class.up]="p.premiumChange > 0"
                        [class.down]="p.premiumChange < 0"
                        ><br />{{ p.premiumChange > 0 ? '+' : ''
                        }}{{ num(p.premiumChange * 100, 0, 1) }}%</span
                      >
                    }
                  </td>
                  <td class="num">
                    {{ p.cuClass ?? '—' }}
                    @if (p.cuClassChange) {
                      <span
                        class="small"
                        [class.up]="p.cuClassChange > 0"
                        [class.down]="p.cuClassChange < 0"
                        ><br />{{ p.cuClassChange > 0 ? '+' : ''
                        }}{{ p.cuClassChange }}</span
                      >
                    }
                  </td>
                  <td>
                    @if (p.coverages.length || p.removed.length) {
                      <ul class="chips">
                        @for (c of p.coverages; track c) {
                          <li
                            class="chip"
                            [class.chip--added]="p.added.includes(c)"
                          >
                            {{ c }}
                          </li>
                        }
                        @for (c of p.removed; track c) {
                          <li class="chip chip--removed">{{ c }}</li>
                        }
                      </ul>
                    } @else {
                      <span class="muted">—</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="muted small">
          The premium is what the payments of each policy add up to (its premium
          when no receipt is on file). Class 1 is the best, 18 the worst. Green
          covers are new, struck ones were dropped.
        </p>
      }
    </ui-card>
  `,
})
export class InsuranceHistoryCard {
  readonly history = input.required<InsuranceHistoryDto>();

  protected readonly num = italianNumber;
  protected readonly noteTones = NOTE_TONES;
}
