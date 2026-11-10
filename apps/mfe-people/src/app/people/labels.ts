import {
  ID_DOCUMENT_TYPE_LABELS,
  ID_DOCUMENT_TYPES,
  type ExpiryAlertDto,
  type IdDocumentType,
  type PersonDto,
} from '@life-island/contracts';

/** "Passport", or "ID document" when only the root category is known. */
export function typeLabel(type: IdDocumentType | null): string {
  return type ? ID_DOCUMENT_TYPE_LABELS[type] : 'ID document';
}

/** Documents print names in capitals: "ALBERTO" reads as "Alberto". */
export function displayName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .replace(
      /(^|[\s'-])(\p{L})/gu,
      (_, sep: string, letter: string) => sep + letter.toUpperCase(),
    );
}

export function personName(person: {
  firstName: string | null;
  lastName: string | null;
}): string {
  return (
    displayName(
      [person.firstName, person.lastName].filter(Boolean).join(' '),
    ) || 'Unnamed person'
  );
}

/** "Maria Rossi's passport expires in 12 days." / "... expired 3 days ago." */
export function alertText(alert: ExpiryAlertDto): string {
  const what = `${displayName(alert.personName) || 'Someone'}'s ${typeLabel(alert.type).toLowerCase()}${alert.category ? ` category ${alert.category}` : ''}`;
  const days = Math.abs(alert.daysLeft);
  if (alert.level === 'expired')
    return days === 1
      ? `${what} expired yesterday.`
      : `${what} expired ${days} days ago.`;
  if (days === 0) return `${what} expires today.`;
  return `${what} expires in ${days} ${days === 1 ? 'day' : 'days'}.`;
}

/**
 * A number kept out of sight until you ask: the last 3 characters show, so
 * you can still tell two apart ("•••••••••••••01U").
 */
export function masked(value: string | null, revealed: boolean): string | null {
  if (value === null || revealed || value.length <= 4) return value;
  return '•'.repeat(value.length - 3) + value.slice(-3);
}

export type CoverageState =
  'current' | 'expiring' | 'expired' | 'unusable' | 'missing';

export interface CoverageCell {
  type: IdDocumentType;
  state: CoverageState;
  expiryDate: string | null;
}

/**
 * Which ID documents a person has, type by type: the state of the latest
 * version, so the grid shows at a glance who misses what.
 */
export function coverage(person: PersonDto): CoverageCell[] {
  return ID_DOCUMENT_TYPES.map((type) => {
    const latest = person.series.find((s) => s.type === type)?.versions[0];
    if (!latest) return { type, state: 'missing', expiryDate: null };
    const alert = person.alerts.find(
      (a) => a.uploadId === latest.uploadId && a.category === null,
    );
    const state: CoverageState =
      latest.status === 'expired'
        ? 'expired'
        : latest.status !== 'current'
          ? 'unusable'
          : alert
            ? 'expiring'
            : 'current';
    return { type, state, expiryDate: latest.expiryDate };
  });
}
