/*
 * Money in the text a service writes (an insight, a check, a brief for the
 * AI), the way every page writes it: "3.200,00 €", "36.000 €". The front ends
 * use the same rule through `euro` in libs/records-ui.
 */

// Italian leaves 4-digit amounts ungrouped (3200,00 €); 'always' groups them
// too. The ES2023 option is missing from the es2022 lib typings.
const GROUPED = {
  useGrouping: 'always',
} as unknown as Intl.NumberFormatOptions;

const WITH_CENTS = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  ...GROUPED,
});
const WHOLE = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
  ...GROUPED,
});

/** "3.200,00 €", or "3.200 €" without cents; "–" when there is no value. */
export function euroText(
  value: number | null | undefined,
  cents = true,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '–';
  // A plain space instead of the no-break space, so text reads the same in a
  // log, a prompt or a test.
  return (cents ? WITH_CENTS : WHOLE).format(value).replace(/\s/g, ' ');
}

const PER_UNIT = new Intl.NumberFormat('it-IT', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 4,
});

/**
 * A price per unit: "0,1234 €/kWh" (a metered price needs its 3rd and 4th
 * decimal), "30,98 €/month" (a fee, in cents); "–" when there is no value.
 */
export function unitPriceText(
  value: number | null | undefined,
  unit: string,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '–';
  if (unit === '€/month') return `${euroText(value).replace(' €', '')} ${unit}`;
  return `${PER_UNIT.format(value)} ${unit}`;
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
