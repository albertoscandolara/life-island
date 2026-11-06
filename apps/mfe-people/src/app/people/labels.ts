import {
  ID_DOCUMENT_TYPE_LABELS,
  type ExpiryAlertDto,
  type IdDocumentType,
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
  const what = `${displayName(alert.personName) || 'Someone'}'s ${typeLabel(alert.type).toLowerCase()}`;
  const days = Math.abs(alert.daysLeft);
  if (alert.level === 'expired')
    return days === 1
      ? `${what} expired yesterday.`
      : `${what} expired ${days} days ago.`;
  if (days === 0) return `${what} expires today.`;
  return `${what} expires in ${days} ${days === 1 ? 'day' : 'days'}.`;
}
