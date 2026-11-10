/*
 * What the People area explains about the documents it keeps: the driving
 * licence categories and restriction codes (EU Directive 2006/126/EC, as the
 * Italian patente prints them). Life Island's own knowledge: no AI, the same
 * for everyone.
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
