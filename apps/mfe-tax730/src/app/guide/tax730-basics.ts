import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { pensionDeductionLimit } from '@life-island/contracts';
import { formatEuro } from '../dashboard/format';

/**
 * What the 730 is and how a year of it goes: who files it, what goes in it,
 * detrazione or deduzione, what comes back, its limits and the documents to
 * keep. Reading matter: a topic of the page's guide.
 */
@Component({
  selector: 'tax-730-basics',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tax730-basics.html',
})
export class Tax730Basics {
  /** The year the expenses are from. */
  readonly taxYear = input.required<number>();

  protected readonly filingYear = computed(() => this.taxYear() + 1);
  protected readonly pensionLimit = computed(() =>
    pensionDeductionLimit(this.taxYear()),
  );
  protected readonly formatEuro = formatEuro;
}

/** The plain-words lead of the guide, for the topic's intro. */
export function tax730Intro(taxYear: number): string {
  return (
    `The 730 is the simplified income tax return for employees and pensioners ` +
    `in Italy. It always covers the year before: the 730/${taxYear + 1} ` +
    `declares the income and the expenses of ${taxYear}. Your employer or ` +
    `pension body settles it in your pay: a refund arrives in the payslip, tax ` +
    `due is withheld from it.`
  );
}
