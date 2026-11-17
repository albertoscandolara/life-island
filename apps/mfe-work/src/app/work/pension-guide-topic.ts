import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  pensionDeductionLimit,
  type PensionOverviewDto,
} from '@life-island/contracts';
import { euro } from './labels';
import { guideText, PENSION_GUIDE } from './pension-guide';

/**
 * How a pension fund works, in plain words, one fold per question, with the
 * year's deduction limit written in. Reading matter: a topic of the Work
 * guide, out of the Pension fund tab.
 */
@Component({
  selector: 'work-pension-guide',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (s of guide; track s.id; let first = $first) {
      <details [open]="first && newcomer()">
        <summary>{{ s.title }}</summary>
        @for (p of s.body; track $index) {
          <p>{{ text(p) }}</p>
        }
        @if (s.points?.length) {
          <ul>
            @for (p of s.points; track $index) {
              <li>{{ text(p) }}</li>
            }
          </ul>
        }
        @if (s.id === 'worth') {
          <p>
            <a href="/work?tab=tfr" (click)="openTfr($event)"
              >Open the comparison in the TFR tab</a
            >
          </p>
        }
      </details>
    }
    <p class="ui-info-sources">
      The figures in the Pension fund tab are estimates for planning: your fund
      and your CAF have the last word. Sources:
      @for (s of pension().sources; track s.url; let last = $last) {
        <a [href]="s.url" target="_blank" rel="noopener">{{ s.label }}</a
        >{{ last ? '' : ' · ' }}
      }
    </p>
  `,
})
export class PensionGuideTopic {
  readonly pension = input.required<PensionOverviewDto>();
  /** Opens the TFR tab, with the company-or-fund comparison. */
  readonly showTfr = output<void>();

  protected readonly guide = PENSION_GUIDE;
  private readonly limits = computed(() => ({
    limit: euro(this.pension().limit),
    oldLimit: euro(pensionDeductionLimit(2025)),
  }));
  /** Nothing on record yet: the first question starts open. */
  protected readonly newcomer = computed(
    () => !this.pension().funds.length && !this.pension().onPayslips,
  );

  protected text(value: string): string {
    return guideText(value, this.limits());
  }

  protected openTfr(event: Event): void {
    event.preventDefault();
    this.showTfr.emit();
  }
}
