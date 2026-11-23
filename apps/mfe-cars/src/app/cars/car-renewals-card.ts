import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { RenewalDto, RenewalLevel } from '@life-island/contracts';
import { UiBadge, UiCard, type UiTone } from '@life-island/design-system';
import { dateText } from '@life-island/records-ui';
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
  expiring: 'Expiring',
  grace: 'Grace period',
  expired: 'Expired',
  missing: 'Missing',
  suspended: 'Suspended',
};

/** What one car has to renew (insurance, road tax, revisione, service) and when. */
@Component({
  selector: 'cars-renewals-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiBadge, UiCard],
  templateUrl: './car-renewals-card.html',
  styleUrl: './cars-bits.css',
})
export class CarRenewalsCard {
  readonly renewals = input.required<RenewalDto[]>();

  protected readonly levelTones = LEVEL_TONES;
  protected readonly levelLabels = LEVEL_LABELS;
  protected readonly num = italianNumber;
  protected readonly dateText = dateText;
  protected readonly renewalText = renewalText;
  protected readonly renewalTitle = renewalTitle;
}
