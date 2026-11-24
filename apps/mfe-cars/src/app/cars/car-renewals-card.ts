import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type {
  RenewableKind,
  RenewalDto,
  RenewalLevel,
} from '@life-island/contracts';
import {
  UiBadge,
  UiCard,
  UiIcon,
  type UiIconName,
  type UiTone,
} from '@life-island/design-system';
import { dateText } from '@life-island/records-ui';
import { CAR_DOCUMENT_ICONS } from './car-doc-card';
import { italianNumber, renewalText, renewalTitle } from './labels';

const LEVEL_TONES: Record<RenewalLevel, UiTone> = {
  ok: 'success',
  expiring: 'warning',
  grace: 'warning',
  expired: 'danger',
  missing: 'neutral',
  suspended: 'danger',
};

const LEVEL_LABELS: Record<RenewalLevel, string> = {
  ok: 'In order',
  expiring: 'Due soon',
  grace: 'Grace period',
  expired: 'Expired',
  missing: 'Missing',
  suspended: 'Suspended',
};

/** What needs you first: late, then suspended, then due soon, missing, in order. */
const LEVEL_ORDER: RenewalLevel[] = [
  'expired',
  'grace',
  'suspended',
  'expiring',
  'missing',
  'ok',
];

/** Where each kind is on the page, and its sign (a document's is its card's). */
const TARGETS: Record<RenewableKind, { id: string; icon: UiIconName }> = {
  insurance: {
    id: 'doc-CAR_INSURANCE',
    icon: CAR_DOCUMENT_ICONS.CAR_INSURANCE,
  },
  road_tax: { id: 'doc-ROAD_TAX', icon: CAR_DOCUMENT_ICONS.ROAD_TAX },
  inspection: {
    id: 'doc-VEHICLE_INSPECTION',
    icon: CAR_DOCUMENT_ICONS.VEHICLE_INSPECTION,
  },
  cng_cylinders: {
    id: 'doc-CNG_CYLINDER_INSPECTION',
    icon: CAR_DOCUMENT_ICONS.CNG_CYLINDER_INSPECTION,
  },
  registration: {
    id: 'doc-VEHICLE_REGISTRATION',
    icon: CAR_DOCUMENT_ICONS.VEHICLE_REGISTRATION,
  },
  service: { id: 'car-money', icon: 'wrench' },
  fine: { id: 'car-money', icon: 'alert' },
  tyres: { id: 'car-money', icon: 'layers' },
};

/**
 * What one car has to renew or pay (insurance, bollo, revisione, CNG
 * cylinders, service, fines, tyres), most urgent first: each opens the card
 * it is about.
 */
@Component({
  selector: 'cars-renewals-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiBadge, UiCard, UiIcon],
  templateUrl: './car-renewals-card.html',
  styleUrls: ['./cars-bits.css'],
})
export class CarRenewalsCard {
  readonly renewals = input.required<RenewalDto[]>();
  /** In use: only then does a renewal need you. */
  readonly active = input(true);
  /** The id of the card a renewal is about, to scroll to. */
  readonly open = output<string>();

  protected readonly sorted = computed(() =>
    [...this.renewals()].sort(
      (a, b) =>
        LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) ||
        (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'),
    ),
  );
  protected readonly needsYou = computed(
    () => this.sorted().filter((r) => r.level !== 'ok').length,
  );

  protected readonly levelTones = LEVEL_TONES;
  protected readonly levelLabels = LEVEL_LABELS;
  protected readonly targets = TARGETS;
  protected readonly num = italianNumber;
  protected readonly dateText = dateText;
  protected readonly renewalText = renewalText;
  protected readonly renewalTitle = renewalTitle;
}
