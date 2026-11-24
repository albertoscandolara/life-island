import type { UtilityKind } from '@life-island/contracts';

/** The rules of one utility's bills, as each card's "About it" box tells them. */
export interface UtilityGuide {
  /** How often it is billed, short: the chip on the box. */
  every: string;
  /** What the bill is, in one line. */
  what: string;
  /** What the price on this page means. */
  price: string;
  /** Changing supplier, or why you cannot. */
  change: string;
  /** How long to keep the bills. */
  keepFor: string;
  /** What happens when a bill is paid late. */
  ifLate: string;
  /** Where to compare offers, when there is an official place. */
  compare: { label: string; url: string } | null;
  sources: string[];
}

const PORTALE_OFFERTE = {
  label: 'Compare offers on the Portale Offerte',
  url: 'https://www.ilportaleofferte.it/',
};

/** The rules of November 2026. */
export const UTILITY_GUIDES: Record<UtilityKind, UtilityGuide> = {
  ELECTRICITY: {
    every: 'Every 1 or 2 months',
    what: 'The bolletta della luce: the energy of your POD (kWh), plus network and system charges, excise and VAT.',
    price:
      'What the bills cost over the kWh they bill. Fixed charges are inside, so a month you use little costs more per kWh.',
    change:
      'Free and without new works: the new supplier asks for the switch, and the meter, the POD and the power stay.',
    keepFor:
      '5 years, with the proof of payment. Amounts older than 2 years can no longer be asked of you (prescrizione biennale).',
    ifLate:
      'Late-payment interest, then a written reminder; after it, the power can be lowered and the supply suspended.',
    compare: PORTALE_OFFERTE,
    sources: [
      'ARERA, Portale Offerte',
      'Legge 205/2017, art. 1 c. 4 (2 years)',
      'art. 2948 c.c. (5 years)',
    ],
  },
  GAS: {
    every: 'Every 1 or 2 months',
    what: 'The bolletta del gas: the gas of your PDR in Smc (standard cubic metres), plus network and system charges, excise and VAT.',
    price:
      'What the bills cost over the Smc they bill: winter uses more, so compare a month with the same month a year ago.',
    change:
      'Free and without new works: the new supplier asks for the switch, and the meter and the PDR stay.',
    keepFor:
      '5 years, with the proof of payment. Amounts older than 2 years can no longer be asked of you (prescrizione biennale).',
    ifLate:
      'Late-payment interest, then a written reminder; after it, the supply can be suspended.',
    compare: PORTALE_OFFERTE,
    sources: [
      'ARERA, Portale Offerte',
      'Legge 205/2017, art. 1 c. 4 (2 years)',
      'art. 2948 c.c. (5 years)',
    ],
  },
  WATER: {
    every: 'Every 3 to 6 months',
    what: 'The bolletta dell’acqua of the local water operator (gestore idrico): water in m³, sewers and treatment, at the tariff of your area.',
    price:
      'What the bills cost over the m³ they bill. Bills on an estimated reading are adjusted on the next real one.',
    change:
      'You cannot: each area has one operator. Send your own meter reading (autolettura) so it bills what you used.',
    keepFor:
      '5 years, with the proof of payment. Amounts older than 2 years can no longer be asked of you (prescrizione biennale).',
    ifLate:
      'Late-payment interest, then a written reminder; after it, the flow can be reduced to the minimum.',
    compare: null,
    sources: [
      'ARERA, water service rules',
      'Legge 205/2017, art. 1 c. 4 (2 years)',
      'art. 2948 c.c. (5 years)',
    ],
  },
  INTERNET: {
    every: 'Every month',
    what: 'The bill of your line: the monthly fee of the offer, plus extras such as calls, options or the router in instalments.',
    price:
      'The monthly fee of the offer. Extras are counted apart, so an option you added does not read as a price rise.',
    change:
      'At any time: the operator may only charge what leaving really costs it, plus the instalments left on a router or a discount.',
    keepFor: '5 years, with the proof of payment.',
    ifLate:
      'Late-payment interest, then a written reminder; after it, the line can be suspended.',
    compare: null,
    sources: [
      'Legge 172/2017 (billed every month)',
      'Legge 40/2007, art. 1 (leaving at any time)',
      'art. 2948 c.c. (5 years)',
    ],
  },
};
