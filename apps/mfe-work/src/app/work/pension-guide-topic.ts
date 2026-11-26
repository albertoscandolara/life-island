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
import { WorkGuideSections } from './work-guide-sections';

/**
 * How a pension fund works, in plain words, one fold per question, with the
 * year's deduction limit written in. Reading matter: a topic of the Work
 * guide, out of the Pension fund tab.
 */
@Component({
  selector: 'work-pension-guide',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WorkGuideSections],
  template: `
    <work-guide-sections
      [sections]="guide"
      [openFirst]="newcomer()"
      [text]="text"
    >
      <p>
        <a href="/work#work-tfr" (click)="openTfr($event)"
          >Compare the company and a fund with your figures</a
        >
      </p>
      <p class="ui-info-sources">
        The pension figures on the Work page are estimates for planning: your
        fund and your CAF have the last word. Sources:
        @for (s of pension().sources; track s.url; let last = $last) {
          <a [href]="s.url" target="_blank" rel="noopener">{{ s.label }}</a
          >{{ last ? '' : ' · ' }}
        }
      </p>
    </work-guide-sections>
  `,
})
export class PensionGuideTopic {
  readonly pension = input.required<PensionOverviewDto>();
  /** Opens the company-or-fund comparison, in For later. */
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

  protected readonly text = (value: string): string =>
    guideText(value, this.limits());

  protected openTfr(event: Event): void {
    event.preventDefault();
    this.showTfr.emit();
  }
}
