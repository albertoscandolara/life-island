import type { ExpiryAlertDto, PersonDto } from '@life-island/contracts';
import { alertText, coverage, masked, personName, typeLabel } from './labels';

const alert = (level: ExpiryAlertDto['level'], daysLeft: number) => ({
  level,
  daysLeft,
  personId: 'p1',
  personName: 'MARIA ROSSI',
  uploadId: 'u1',
  type: 'PASSPORT' as const,
  category: null as string | null,
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

  it('names a licence category that expires by itself', () => {
    expect(
      alertText({
        ...alert('expiring', 30),
        type: 'DRIVING_LICENCE',
        category: 'C',
      }),
    ).toBe("Maria Rossi's driving licence category C expires in 30 days.");
  });

  it('hides a number but its last characters until revealed', () => {
    expect(masked('RSSMRA80A01H501U', false)).toBe('•••••••••••••01U');
    expect(masked('RSSMRA80A01H501U', true)).toBe('RSSMRA80A01H501U');
    expect(masked(null, false)).toBeNull();
  });

  it('shows the latest state of each document type', () => {
    const version = (status: string, uploadId: string) => ({
      uploadId,
      status,
      expiryDate: '2027-01-01',
    });
    const person = {
      series: [
        { type: 'PASSPORT', versions: [version('current', 'p')] },
        { type: 'IDENTITY_CARD', versions: [version('expired', 'c')] },
        { type: 'HEALTH_CARD', versions: [version('lost', 'h')] },
      ],
      alerts: [{ uploadId: 'p', category: null }],
    } as unknown as PersonDto;
    expect(coverage(person).map((c) => [c.type, c.state])).toEqual([
      ['IDENTITY_CARD', 'expired'],
      ['PASSPORT', 'expiring'],
      ['HEALTH_CARD', 'unusable'],
      ['DRIVING_LICENCE', 'missing'],
    ]);
  });
});
