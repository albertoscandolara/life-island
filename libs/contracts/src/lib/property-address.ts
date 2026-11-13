/**
 * Helpers for the "Property / location" dimension: homes are named by their
 * address, the same street with and without its number is one place, and a
 * car (a number plate) is never a place.
 */

const normalize = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** "Via dei Bandi, 10" → street "via dei bandi" and numbers [10]. */
function addressParts(text: string): { street: string; numbers: string[] } {
  const tokens = normalize(text).split(' ').filter(Boolean);
  return {
    street: tokens.filter((t) => !/^\d/.test(t)).join(' '),
    numbers: tokens.filter((t) => /^\d/.test(t)),
  };
}

/** Whether an address has a street number ("Via Ponzilovo 9"). */
export function hasStreetNumber(address: string): boolean {
  return addressParts(address).numbers.length > 0;
}

/**
 * How `title` stands for `address`: `full` when it is the address with its
 * number ("Via Ponzilovo 9"), `street` when it is the same street with no
 * other number ("Via Ponzilovo"), null otherwise.
 */
export function addressMatch(
  title: string,
  address: string | null | undefined,
): 'full' | 'street' | null {
  if (!address) return null;
  const home = addressParts(address);
  const place = addressParts(title);
  if (!home.street || place.street !== home.street) return null;
  if (!place.numbers.every((n) => home.numbers.includes(n))) return null;
  return place.numbers.length && home.numbers.length ? 'full' : 'street';
}

/** Whether two place names are one place: the same street, one maybe without its number. */
export function samePlace(a: string, b: string): boolean {
  return addressMatch(a, b) !== null || addressMatch(b, a) !== null;
}

/** An Italian number plate (EJ560PZ, EJ 560 PZ). */
const PLATE = /(^|[^a-z0-9])[a-z]{2}\s?\d{3}\s?[a-z]{2}($|[^a-z0-9])/i;

/** Whether a category names a vehicle (by its plate) rather than a place. */
export function namesVehicle(category: { id: string; title: string }): boolean {
  return (
    PLATE.test(category.title) || PLATE.test(category.id.replace(/_/g, ' '))
  );
}
