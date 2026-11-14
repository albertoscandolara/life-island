import {
  sameName,
  type PersonNoticeDto,
  type PersonValues,
} from '@life-island/contracts';

type Known = { id: string } & Pick<
  PersonValues,
  'firstName' | 'lastName' | 'birthDate' | 'taxCode'
>;

const fullName = (p: Known) =>
  [p.firstName, p.lastName].filter(Boolean).join(' ');

/**
 * Whether two people of your list are likely one person entered twice: the
 * same name however printed (case, accents, apostrophes, spacing, a typo in
 * a long name, first and last name swapped), and no birth date or tax code
 * that tells them apart.
 */
export function likelySamePerson(a: Known, b: Known): boolean {
  if (a.id === b.id) return false;
  if (a.taxCode && b.taxCode)
    return (
      a.taxCode.replace(/\s/g, '').toUpperCase() ===
      b.taxCode.replace(/\s/g, '').toUpperCase()
    );
  if (a.birthDate && b.birthDate && a.birthDate !== b.birthDate) return false;
  const name = fullName(a);
  if (!name || !fullName(b)) return false;
  const swapped = [b.lastName, b.firstName].filter(Boolean).join(' ');
  return sameName(name, fullName(b)) || sameName(name, swapped);
}

/** A notice on a person who looks like someone else in the list, to merge them. */
export function duplicateNotices(
  person: Known,
  people: readonly Known[],
): PersonNoticeDto[] {
  return people
    .filter((other) => likelySamePerson(person, other))
    .map((other) => ({
      level: 'warning' as const,
      text: `Looks like the same person as ${fullName(other) || 'another person'}: if so, merge them (Merge, on this person).`,
    }));
}
