import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import {
  compareTfrChoice,
  PENSION_FUND_SOURCE,
  pensionDeductionLimit,
  type TfrChoiceResult,
  type TfrDto,
} from '@life-island/contracts';
import { UiBadge, UiCard, UiEmptyState } from '@life-island/design-system';
import { euro, parseAmount, periodText } from './labels';

/** The assumptions of the comparison, as you type them. */
export interface TfrChoiceDraft {
  ral: string;
  years: string;
  startingTfr: string;
  employeePct: string;
  employerPct: string;
  fundReturnPct: string;
  inflationPct: string;
  salaryGrowthPct: string;
}

function percent(raw: string): number | null {
  const value = Number(raw.replace(',', '.').replace('%', '').trim());
  return raw.trim() && Number.isFinite(value) ? value : null;
}

/** The comparison for a draft, or null while the RAL or the years are missing. */
export function tfrChoice(
  draft: TfrChoiceDraft,
  year: number,
): TfrChoiceResult | null {
  const ral = parseAmount(draft.ral);
  const years = percent(draft.years);
  if (ral === null || ral <= 0 || years === null || years < 1) return null;
  return compareTfrChoice({
    ral,
    years: Math.min(50, years),
    startingTfr: parseAmount(draft.startingTfr) ?? 0,
    employeePct: percent(draft.employeePct) ?? 0,
    employerPct: percent(draft.employerPct) ?? 0,
    fundReturnPct: percent(draft.fundReturnPct) ?? 0,
    inflationPct: percent(draft.inflationPct) ?? 0,
    salaryGrowthPct: percent(draft.salaryGrowthPct) ?? 0,
    year,
  });
}

/**
 * TFR and pension: the TFR your payslips set aside year by year, revalued
 * as the law says (1.5% + 75% of inflation, taxed 17%), and an estimate of
 * leaving it with the company against sending it to a pension fund.
 */
@Component({
  selector: 'work-tfr',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiBadge, UiCard, UiEmptyState],
  templateUrl: './tfr-tab.html',
  styleUrls: ['./blocks.css', './tfr-tab.css'],
})
export class TfrTab {
  readonly tfr = input.required<TfrDto>();

  protected readonly euro = euro;
  protected readonly periodText = periodText;
  protected readonly year = new Date().getFullYear();
  protected readonly deductionLimit = pensionDeductionLimit(this.year);
  protected readonly fundSource = PENSION_FUND_SOURCE;

  /** Your edits over the defaults read from the payslips. */
  private readonly edits = signal<Partial<TfrChoiceDraft>>({});
  protected readonly draft = computed<TfrChoiceDraft>(() => ({
    ral: this.tfr().ral !== null ? String(Math.round(this.tfr().ral ?? 0)) : '',
    years: '30',
    startingTfr: String(Math.round(this.tfr().companyFund)),
    employeePct: '1.2',
    employerPct: '2',
    fundReturnPct: '3',
    inflationPct: '2',
    salaryGrowthPct: '1',
    ...this.edits(),
  }));
  protected readonly choice = computed(() =>
    tfrChoice(this.draft(), this.year),
  );

  /** This year's row, if the payslips reach it. */
  protected readonly thisYear = computed(
    () => this.tfr().years.find((y) => y.year === this.year) ?? null,
  );

  protected setDraft(change: Partial<TfrChoiceDraft>): void {
    this.edits.update((e) => ({ ...e, ...change }));
  }

  protected reset(): void {
    this.edits.set({});
  }

  protected signedEuro(value: number | null): string {
    if (value === null) return '–';
    return `${value > 0 ? '+' : value < 0 ? '−' : ''}${euro(Math.abs(value))}`;
  }

  /** A revaluation rate, to two decimals (ISTAT publishes six). */
  protected rate(pct: number): string {
    return pct.toFixed(2);
  }

  /** How far the accrued TFR is from pay / 13.5, as a percentage. */
  protected gapPct(accrued: number, expected: number | null): number | null {
    if (!expected) return null;
    return Math.round(((accrued - expected) / expected) * 1000) / 10;
  }
}
