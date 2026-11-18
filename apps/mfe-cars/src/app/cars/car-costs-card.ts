import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  COST_KIND_LABELS,
  type CarCostDto,
  type CarCostTotalDto,
  type CostKind,
} from '@life-island/contracts';
import { UiBadge, UiCard } from '@life-island/design-system';
import { dateText, euro } from '@life-island/records-ui';
import { italianNumber } from './labels';

/** What one car cost, year by year and kind by kind, and the documents behind it. */
@Component({
  selector: 'cars-costs-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiBadge, UiCard],
  templateUrl: './car-costs-card.html',
  styleUrl: './car-costs-card.css',
})
export class CarCostsCard {
  readonly costs = input.required<CarCostDto[]>();
  readonly totals = input.required<CarCostTotalDto[]>();

  protected readonly costKindLabels = COST_KIND_LABELS;
  protected readonly num = italianNumber;
  protected readonly euro = euro;
  protected readonly dateText = dateText;

  /** Years with costs, newest first, and the kinds that appear in them. */
  protected readonly table = computed(() => {
    const totals = this.totals();
    const years = [...new Set(totals.map((t) => t.year))];
    const kinds = [...new Set(totals.map((t) => t.kind))];
    return {
      kinds,
      years: years.map((year) => {
        const of = (kind: CostKind) =>
          totals.find((t) => t.year === year && t.kind === kind)?.total ?? null;
        return {
          year,
          totals: kinds.map(of),
          total: totals
            .filter((t) => t.year === year)
            .reduce((sum, t) => sum + t.total, 0),
        };
      }),
    };
  });
}
