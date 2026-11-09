import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import {
  tax730DeductionRules,
  type Tax730DeductionRule,
} from '@life-island/contracts';
import { UiButton, UiCard, UiIcon } from '@life-island/design-system';
import { formatEuro } from '../dashboard/format';

const percent = (rate: number) => `${Math.round(rate * 100)}%`;

/**
 * What the 730 is, how a year of it goes, what goes in it and what comes
 * back, with the rates and caps of each kind of expense for the year shown.
 */
@Component({
  selector: 'tax-730-guide',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiButton, UiIcon],
  templateUrl: './tax730-guide.html',
  styleUrl: './tax730-guide.css',
})
export class Tax730Guide {
  /** The year the expenses are from. */
  readonly taxYear = input.required<number>();

  protected readonly open = signal(false);
  protected readonly filingYear = computed(() => this.taxYear() + 1);
  protected readonly rules = computed(() =>
    tax730DeductionRules(this.taxYear()),
  );
  protected readonly formatEuro = formatEuro;

  protected readonly sources = [
    {
      name: 'Agenzia delle Entrate, 730 precompilato',
      url: 'https://infoprecompilata.agenziaentrate.gov.it/',
    },
    {
      name: 'Edotto, 730/2026 dates',
      url: 'https://www.edotto.com/articolo/7302026-precompilato-disponibile-dal-30-aprile',
    },
    {
      name: 'FiscoeTasse, detrazioni in the 730/2026',
      url: 'https://www.fiscoetasse.com/new-rassegna-stampa/3642-come-cambiano-le-detrazioni-nel-7302026.html',
    },
    {
      name: 'Centro Fiscale, deductible expenses 2026',
      url: 'https://centrofiscale.com/spese-detraibili-deducibili-730-2026/',
    },
    {
      name: 'InformazioneFiscale, home bonuses 2026',
      url: 'https://www.informazionefiscale.it/Bonus-casa-2026-proroga-novita-Legge-di-Bilancio',
    },
    {
      name: 'Ediltecnico, bonus mobili 2026',
      url: 'https://ediltecnico.it/speciale/bonus-mobili-arredi/',
    },
    {
      name: 'Money.it, veterinary expenses',
      url: 'https://www.money.it/detrazione-spese-veterinarie-730-2026-limiti-istruzioni',
    },
  ];

  protected rateText(rule: Tax730DeductionRule): string {
    if (rule.rate === null) return '–';
    return rule.reducedRate
      ? `${percent(rule.rate)} / ${percent(rule.reducedRate.rate)}`
      : percent(rule.rate);
  }

  protected capText(rule: Tax730DeductionRule): string {
    if (rule.cap === null)
      return rule.capScope === 'intervention' ? 'by works' : 'none';
    const scope =
      rule.capScope === 'person'
        ? ' each'
        : rule.capScope === 'unit'
          ? ' per home'
          : '';
    return `${formatEuro(rule.cap)}${scope}`;
  }
}
