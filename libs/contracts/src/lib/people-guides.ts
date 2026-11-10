import type { IdDocumentType } from './people.js';

/*
 * What the People area explains about the documents it keeps: the driving
 * licence categories and restriction codes (EU Directive 2006/126/EC, as the
 * Italian patente prints them), and how each document is renewed in Italy.
 * Life Island's own knowledge: no AI, the same for everyone.
 */

/** Field 9 of the licence: what each category lets you drive. */
export const LICENCE_CATEGORY_LABELS: Record<string, string> = {
  AM: 'Mopeds and light quadricycles (up to 45 km/h)',
  A1: 'Motorcycles up to 125 cc and 11 kW',
  A2: 'Motorcycles up to 35 kW',
  A: 'Any motorcycle',
  B1: 'Quadricycles',
  B: 'Cars up to 3,500 kg and 8 passengers',
  BE: 'Car with a trailer over 750 kg',
  C1: 'Lorries from 3,500 to 7,500 kg',
  C1E: 'C1 lorry with a heavy trailer',
  C: 'Lorries over 3,500 kg',
  CE: 'Articulated lorries',
  D1: 'Minibuses up to 16 passengers',
  D1E: 'D1 minibus with a heavy trailer',
  D: 'Buses',
  DE: 'Bus with a heavy trailer',
};

/**
 * Field 12 of the licence: the harmonised EU codes. A sub-code (01.06) is
 * explained by itself when listed, otherwise by its main code (01).
 */
export const RESTRICTION_CODE_LABELS: Record<string, string> = {
  '01': 'Needs vision correction or protection',
  '01.01': 'Must wear glasses',
  '01.02': 'Must wear contact lenses',
  '01.05': 'Must wear an eye cover',
  '01.06': 'Must wear glasses or contact lenses',
  '01.07': 'Specific optical aid',
  '02': 'Must wear a hearing aid',
  '03': 'Limb prosthesis or orthosis',
  '05': 'Limited use, for medical reasons',
  '05.01': 'Daytime driving only',
  '05.02': 'Only within a radius of the place of residence',
  '05.03': 'No passengers',
  '05.04': 'Speed limited',
  '05.05': 'Only with another licence holder in the car',
  '05.06': 'No trailer',
  '05.07': 'No motorway driving',
  '05.08': 'No alcohol at all',
  '10': 'Modified transmission',
  '15': 'Modified clutch',
  '20': 'Modified brakes',
  '25': 'Modified accelerator',
  '30': 'Combined brake and accelerator',
  '35': 'Modified controls',
  '40': 'Modified steering',
  '42': 'Modified mirrors',
  '43': 'Modified driver seat',
  '44': 'Motorcycle modifications',
  '61': 'Daytime driving only',
  '62': 'Only within a radius of the place of residence',
  '63': 'No passengers',
  '64': 'Speed limited',
  '65': 'Only with another licence holder in the car',
  '66': 'No trailer',
  '67': 'No motorway driving',
  '68': 'No alcohol at all',
  '69': 'Only vehicles with an alcohol interlock',
  '70': 'Exchanged from a licence of another country',
  '71': 'Duplicate of a licence',
  '78': 'Automatic transmission only',
  '79': 'Only vehicles meeting the specifications in brackets',
  '95': 'Driver CPC (CQC) for professional driving, valid until the date shown',
  '96': 'B with a trailer up to 4,250 kg in total',
  '97': 'Not allowed to drive C1 vehicles that need a tachograph',
};

/** "01.06" explained, or its main code's meaning, or null when unknown. */
export function restrictionMeaning(code: string): string | null {
  const clean = code.trim();
  return (
    RESTRICTION_CODE_LABELS[clean] ??
    RESTRICTION_CODE_LABELS[clean.split('.')[0].padStart(2, '0')] ??
    null
  );
}

/** How a document is renewed in Italy, as a checklist. */
export interface RenewalGuide {
  /** Where you go, or who sends it. */
  where: string;
  /** How to book, with the official site when there is one. */
  book: string;
  bookingUrl: string | null;
  /** How early you can or should start. */
  when: string;
  bring: readonly string[];
  /** What it costs, roughly: offices add their own fees. */
  cost: string;
  /** How long until the new one is in your hands. */
  takes: string;
  /** What changes for a minor. */
  minors: string | null;
}

export const RENEWAL_GUIDES: Record<IdDocumentType, RenewalGuide> = {
  IDENTITY_CARD: {
    where: 'The Comune you live in (anagrafe), or one of its partner offices',
    book: 'Book an appointment on the Ministry of the Interior agenda, or with your Comune',
    bookingUrl: 'https://www.prenotazionicie.interno.gov.it',
    when: 'From 180 days before it expires',
    bring: [
      'The old identity card (or the police report, if lost or stolen)',
      'One recent passport photo, unless your Comune takes it',
      'Your health card, for the tax code',
      'The receipt of the payment, if your Comune asks you to pay first',
    ],
    cost: 'About €22, more in some Comuni or for a duplicate',
    takes: 'Sent by post within about 6 working days',
    minors:
      'Both parents give their consent at the counter for it to be valid for travel abroad. It lasts 3 years under 3 and 5 years from 3 to 17.',
  },
  PASSPORT: {
    where:
      'The Questura or police station, or a Polis post office in smaller towns',
    book: 'Book on the State Police passport agenda',
    bookingUrl: 'https://passaportonline.poliziadistato.it',
    when: 'Well ahead of any trip: appointments can be weeks away',
    bring: [
      'The application form, filled in',
      'Two recent passport photos',
      'The old passport (or the police report, if lost or stolen)',
      'The €73.50 administrative stamp (contrassegno amministrativo)',
      'The receipt of the €42.50 payment (bollettino)',
      'An identity document',
    ],
    cost: 'About €116 in total',
    takes: 'Usually 2 to 4 weeks, longer in busy seasons',
    minors:
      'Both parents sign their consent. It lasts 3 years under 3 and 5 years from 3 to 17. Under 14, travelling without a parent also needs the dichiarazione di accompagnamento from the Questura.',
  },
  DRIVING_LICENCE: {
    where: 'A medico certificatore (ASL, ACI or an authorised medical office)',
    book: 'Book the medical check with the doctor or office; they send the renewal to the Motorizzazione',
    bookingUrl: null,
    when: 'Up to 4 months before it expires; you cannot drive once it has',
    bring: [
      'The licence and an identity document',
      'Your health card, for the tax code',
      'One or two recent passport photos',
      'The certificato anamnestico from your family doctor, if the office asks for it',
      'The receipts of the €10.20 and €16 payments on PagoPA',
    ],
    cost: 'About €26 in fees, plus the medical check (often €50 to €100)',
    takes:
      'The new card is posted to your residence within a few weeks; the medical certificate covers you meanwhile',
    minors: null,
  },
  HEALTH_CARD: {
    where:
      'Nowhere: the Agenzia delle Entrate posts the new card to your residence',
    book: 'Nothing to book. If it has not arrived a month before expiry, ask your ASL or the Agenzia delle Entrate online',
    bookingUrl: 'https://www.agenziaentrate.gov.it',
    when: 'Check about 2 months before it expires',
    bring: [
      'Nothing, if it arrives. Otherwise an identity document at the ASL or Agenzia office',
    ],
    cost: 'Free',
    takes: 'Usually arrives before the old one expires',
    minors:
      'A newborn gets the tax code and card after the birth is registered.',
  },
};
