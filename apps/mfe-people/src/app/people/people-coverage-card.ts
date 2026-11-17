import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { ID_DOCUMENT_TYPES, type PersonDto } from '@life-island/contracts';
import { UiBadge, UiCard, type UiTone } from '@life-island/design-system';
import {
  coverage,
  personName,
  typeLabel,
  type CoverageCell,
  type CoverageState,
} from './labels';

const COVERAGE_TONES: Record<CoverageState, UiTone> = {
  current: 'success',
  expiring: 'warning',
  expired: 'danger',
  unusable: 'warning',
  missing: 'neutral',
};

/** Everyone against the four ID document types: who has what, and until when. */
@Component({
  selector: 'people-coverage-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiBadge, UiCard],
  templateUrl: './people-coverage-card.html',
  styleUrls: ['./people-bits.css', './people-coverage-card.css'],
})
export class PeopleCoverageCard {
  readonly people = input.required<PersonDto[]>();
  /** A name was clicked: the page shows that person. */
  readonly open = output<string>();

  protected readonly idTypes = ID_DOCUMENT_TYPES;
  protected readonly coverageTones = COVERAGE_TONES;
  protected readonly typeLabel = typeLabel;
  protected readonly personName = personName;

  protected readonly coverageRows = computed(() =>
    this.people().map((person) => ({ person, cells: coverage(person) })),
  );

  protected coverageText(cell: CoverageCell): string {
    switch (cell.state) {
      case 'missing':
        return 'None';
      case 'unusable':
        return 'Lost or withdrawn';
      case 'expired':
        return 'Expired';
      default:
        return cell.expiryDate
          ? `Until ${new Date(cell.expiryDate).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`
          : 'Current';
    }
  }
}
