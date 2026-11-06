import type { ExpiryAlertDto } from '@life-island/contracts';
import { alertText, personName, typeLabel } from './labels';

const alert = (level: ExpiryAlertDto['level'], daysLeft: number) => ({
  level,
  daysLeft,
  personId: 'p1',
  personName: 'MARIA ROSSI',
  uploadId: 'u1',
  type: 'PASSPORT' as const,
  expiryDate: '2027-01-01',
});

describe('labels', () => {
  it('names the document and the person', () => {
    expect(typeLabel('DRIVING_LICENCE')).toBe('Driving licence');
    expect(typeLabel(null)).toBe('ID document');
    expect(personName({ firstName: 'ANNA MARIA', lastName: "D'ANGELO" })).toBe(
      "Anna Maria D'Angelo",
    );
    expect(personName({ firstName: null, lastName: null })).toBe(
      'Unnamed person',
    );
  });

  it('says how long is left, or since when it expired', () => {
    expect(alertText(alert('expiring', 12))).toBe(
      "Maria Rossi's passport expires in 12 days.",
    );
    expect(alertText(alert('expiring', 0))).toBe(
      "Maria Rossi's passport expires today.",
    );
    expect(alertText(alert('expired', -1))).toBe(
      "Maria Rossi's passport expired yesterday.",
    );
    expect(alertText(alert('expired', -30))).toBe(
      "Maria Rossi's passport expired 30 days ago.",
    );
  });
});
