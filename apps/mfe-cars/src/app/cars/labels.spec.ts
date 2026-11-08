import type { RenewalAlertDto } from '@life-island/contracts';
import {
  alertText,
  paintColour,
  typeLabel,
  valueText,
  vehicleName,
} from './labels';

const alert = (
  kind: RenewalAlertDto['kind'],
  level: RenewalAlertDto['level'],
  daysLeft: number | null,
): RenewalAlertDto => ({
  kind,
  level,
  daysLeft,
  dueDate: '2027-01-01',
  graceUntil: null,
  uploadId: null,
  basis: '',
  dueOdometerKm: null,
  vehicleId: 'v1',
  vehicleName: 'Panda · AB123CD',
});

describe('labels', () => {
  it('names the car and the document', () => {
    expect(typeLabel('ROAD_TAX')).toBe('Road tax (bollo)');
    expect(typeLabel(null)).toBe('Car document');
    expect(
      vehicleName({
        label: null,
        values: {
          make: 'FIAT',
          commercialName: 'PANDA',
          registrationNumber: 'AB123CD',
        },
      }),
    ).toBe('FIAT PANDA · AB123CD');
    expect(vehicleName({ label: 'Panda', values: {} })).toBe('Panda');
    expect(vehicleName({ label: null, values: {} })).toBe('Unnamed car');
  });

  it('shows the values of the card in words, with their unit', () => {
    expect(valueText('engine.fuelKey', 'petrol_lpg')).toBe('Petrol and LPG');
    expect(valueText('engine.capacityCc', 1242)).toBe('1.242 cm³');
    expect(valueText('firstRegistrationDate', '2019-03-14')).toBe('14/03/2019');
    expect(valueText('colour', null)).toBe('');
  });

  it('says what is due, expired, in its grace period or missing', () => {
    expect(alertText(alert('insurance', 'expiring', 12))).toBe(
      'Panda · AB123CD: insurance expires in 12 days.',
    );
    expect(alertText(alert('insurance', 'grace', -3))).toBe(
      'Panda · AB123CD: insurance expired 3 days ago, still covered for 12 days.',
    );
    expect(alertText(alert('inspection', 'expiring', 1))).toBe(
      'Panda · AB123CD: revisione is due in 1 day.',
    );
    expect(alertText(alert('road_tax', 'expired', -1))).toBe(
      'Panda · AB123CD: road tax (bollo) expired yesterday.',
    );
    expect(alertText(alert('road_tax', 'missing', null))).toBe(
      'Panda · AB123CD: no road tax (bollo) on file.',
    );
  });

  it('paints the drawn car in the colour the certificate prints', () => {
    expect(paintColour('ROSSO')).toBe('#c0392b');
    expect(paintColour('Grigio antracite')).toBe('#7d848d');
    expect(paintColour('white')).toBe('#eef0f2');
    expect(paintColour('MAGENTA')).toBeNull();
    expect(paintColour(null)).toBeNull();
  });
});
