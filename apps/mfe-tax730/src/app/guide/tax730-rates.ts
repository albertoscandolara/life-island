import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  tax730DeductionRules,
  type Tax730DeductionRule,
} from '@life-island/contracts';
import { formatEuro } from '../dashboard/format';

const percent = (rate: number) => `${Math.round(rate * 100)}%`;

/**
 * The rate, cap, franchigia and years of each kind of expense for one tax
 * year, with where the figures come from. Reading matter: a topic of the
 * page's guide.
 */
@Component({
  selector: 'tax-730-rates',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-info-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Expense</th>
            <th scope="col">730 row</th>
            <th scope="col" class="ui-info-num">Rate</th>
            <th scope="col" class="ui-info-num">Cap</th>
            <th scope="col" class="ui-info-num">Franchigia</th>
            <th scope="col" class="ui-info-num">Years</th>
          </tr>
        </thead>
        <tbody>
          @for (r of rules(); track r.group) {
            @if (r.rate !== null) {
              <tr>
                <th scope="row">{{ r.label.en }}</th>
                <td>{{ r.row730 }}</td>
                <td class="ui-info-num">{{ rateText(r) }}</td>
                <td class="ui-info-num">{{ capText(r) }}</td>
                <td class="ui-info-num">
                  {{ r.franchigia ? formatEuro(r.franchigia) : '–' }}
                </td>
                <td class="ui-info-num">{{ r.instalments }}</td>
              </tr>
            }
          }
        </tbody>
      </table>
    </div>
    <p class="ui-info-sources">
      Figures for the 730/2026; check each year's instructions with your
      commercialista. Sources:
      @for (s of sources; track s.url; let last = $last) {
        <a [href]="s.url" target="_blank" rel="noopener">{{ s.name }}</a>
        @if (!last) {
          ,
        }
      }
    </p>
  `,
})
export class Tax730Rates {
  /** The year the expenses are from. */
  readonly taxYear = input.required<number>();

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
