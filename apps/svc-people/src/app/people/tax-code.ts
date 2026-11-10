import type { TaxCodeCheckDto } from '@life-island/contracts';

/*
 * The Italian tax code (codice fiscale, DM 23/12/1976): 3 letters of the last
 * name, 3 of the first name, the birth year, a month letter, the birth day
 * (plus 40 for women), the cadastral code of the birth place and a check
 * character. Everything but the birth place can be checked from the person's
 * own data, so a misread or a typo shows up before it spreads.
 */

const MONTHS = 'ABCDEHLMPRST';
/** Omocodia: a digit replaced by a letter when two people share a code. */
const OMOCODIA = 'LMNPQRSTUV';
const OMOCODIA_POSITIONS = [6, 7, 9, 10, 12, 13, 14];
const SHAPE =
  /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/;

const ODD: Record<string, number> = {
  '0': 1,
  '1': 0,
  '2': 5,
  '3': 7,
  '4': 9,
  '5': 13,
  '6': 15,
  '7': 17,
  '8': 19,
  '9': 21,
  A: 1,
  B: 0,
  C: 5,
  D: 7,
  E: 9,
  F: 13,
  G: 15,
  H: 17,
  I: 19,
  J: 21,
  K: 2,
  L: 4,
  M: 18,
  N: 20,
  O: 11,
  P: 3,
  Q: 6,
  R: 8,
  S: 12,
  T: 14,
  U: 16,
  V: 10,
  W: 22,
  X: 25,
  Y: 24,
  Z: 23,
};

function evenValue(char: string): number {
  return /[0-9]/.test(char)
    ? Number(char)
    : char.charCodeAt(0) - 'A'.charCodeAt(0);
}

/** The check character of the first 15 characters. */
export function checkCharacter(first15: string): string {
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const char = first15[i];
    // Positions count from 1: odd positions are the even indexes.
    sum += i % 2 === 0 ? ODD[char] : evenValue(char);
  }
  return String.fromCharCode('A'.charCodeAt(0) + (sum % 26));
}

/** The code with omocodia letters turned back into digits. */
function withDigits(code: string): string {
  const chars = code.split('');
  for (const i of OMOCODIA_POSITIONS) {
    const index = OMOCODIA.indexOf(chars[i]);
    if (index >= 0) chars[i] = String(index);
  }
  return chars.join('');
}

function letters(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

const isVowel = (c: string) => 'AEIOU'.includes(c);

/** The 3 letters of a last name: its consonants, then its vowels, then X. */
export function lastNameCode(lastName: string): string {
  const l = letters(lastName).split('');
  return [...l.filter((c) => !isVowel(c)), ...l.filter(isVowel), 'X', 'X', 'X']
    .slice(0, 3)
    .join('');
}

/** The 3 letters of a first name: with 4 consonants or more, the 1st, 3rd and 4th. */
export function firstNameCode(firstName: string): string {
  const l = letters(firstName).split('');
  const consonants = l.filter((c) => !isVowel(c));
  if (consonants.length >= 4)
    return consonants[0] + consonants[2] + consonants[3];
  return [...consonants, ...l.filter(isVowel), 'X', 'X', 'X']
    .slice(0, 3)
    .join('');
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export interface TaxCodePerson {
  taxCode: string | null;
  lastName: string | null;
  firstName: string | null;
  birthDate: string | null;
  sex: string | null;
}

/**
 * Checks a tax code against the person: its shape and check character, then
 * the last name, first name, birth date and sex it encodes. A value the person
 * does not have yet is not checked.
 */
export function checkTaxCode(person: TaxCodePerson): TaxCodeCheckDto {
  const raw = person.taxCode?.toUpperCase().replace(/\s/g, '') ?? '';
  if (!raw) return { status: 'unknown', problems: [] };
  if (raw.length !== 16 || !SHAPE.test(raw))
    return {
      status: 'invalid',
      problems: [
        raw.length !== 16
          ? `It has ${raw.length} characters instead of 16.`
          : 'Its letters and digits are not where a tax code has them.',
      ],
    };
  const expected = checkCharacter(raw.slice(0, 15));
  if (expected !== raw[15])
    return {
      status: 'invalid',
      problems: [
        `Its last character should be ${expected}, not ${raw[15]}: one character is probably misread.`,
      ],
    };

  const code = withDigits(raw);
  const problems: string[] = [];
  if (person.lastName && lastNameCode(person.lastName) !== code.slice(0, 3))
    problems.push(
      `The last name gives ${lastNameCode(person.lastName)}, the code has ${code.slice(0, 3)}.`,
    );
  if (person.firstName && firstNameCode(person.firstName) !== code.slice(3, 6))
    problems.push(
      `The first name gives ${firstNameCode(person.firstName)}, the code has ${code.slice(3, 6)}.`,
    );

  const year = code.slice(6, 8);
  const month = MONTHS.indexOf(code[8]) + 1;
  const rawDay = Number(code.slice(9, 11));
  const female = rawDay > 40;
  const day = female ? rawDay - 40 : rawDay;
  if (day < 1 || day > 31)
    return {
      status: 'invalid',
      problems: [`It encodes day ${rawDay}, which no date has.`],
    };
  const birth = person.birthDate?.slice(0, 10);
  if (birth && /^\d{4}-\d{2}-\d{2}$/.test(birth)) {
    const same =
      birth.slice(2, 4) === year &&
      Number(birth.slice(5, 7)) === month &&
      Number(birth.slice(8, 10)) === day;
    if (!same)
      problems.push(
        `The code encodes a birth on ${day} ${MONTH_NAMES[month - 1]} of a year ending in ${year}, not ${birth}.`,
      );
  }
  const sex = person.sex?.toUpperCase();
  if (sex === 'M' || sex === 'F') {
    if ((sex === 'F') !== female)
      problems.push(
        `The code is a ${female ? "woman's" : "man's"}, but the sex is ${sex}.`,
      );
  }
  return { status: problems.length ? 'mismatch' : 'valid', problems };
}
