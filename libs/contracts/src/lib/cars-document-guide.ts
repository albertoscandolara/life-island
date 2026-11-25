import type { CarArchiveAction } from './cars-archive.js';
import type { CarDocumentType, RenewableKind } from './cars.js';

/*
 * The car documents, one shape for all: how often each is renewed, which
 * date counts, where it is kept and for how long, what happens if you are
 * late, and the rules it comes from (at the rules of November 2026). Every
 * document card of Cars shows its own in an "About" box, the same way, so a
 * bollo, a revisione and a policy read alike.
 */

/** The car documents with a card of their own: every type but the expenses. */
export const CAR_DOCUMENT_CARD_TYPES = [
  'CAR_INSURANCE',
  'ROAD_TAX',
  'VEHICLE_INSPECTION',
  'CNG_CYLINDER_INSPECTION',
  'VEHICLE_REGISTRATION',
  'VEHICLE_OWNERSHIP',
] as const satisfies readonly CarDocumentType[];
export type CarDocumentCardType = (typeof CAR_DOCUMENT_CARD_TYPES)[number];

/** The renewal each card shows on top; the carta di circolazione has none of its own. */
export const CAR_DOCUMENT_RENEWAL_KIND: Record<
  CarDocumentCardType,
  RenewableKind | null
> = {
  CAR_INSURANCE: 'insurance',
  ROAD_TAX: 'road_tax',
  VEHICLE_INSPECTION: 'inspection',
  CNG_CYLINDER_INSPECTION: 'cng_cylinders',
  // The temporary registration (foglio di via) only, when there is one.
  VEHICLE_REGISTRATION: 'registration',
  // Nothing to renew: a new one comes with a change of owner.
  VEHICLE_OWNERSHIP: null,
};

export interface CarDocumentGuide {
  /** What it is, in a line. */
  what: string;
  /** How often, in two or three words, for the card's summary line. */
  every: string;
  /** How often it is renewed. */
  renewal: string;
  /** Which date counts. */
  deadline: string;
  /** What to do when it is due soon, late or missing. */
  todo: string;
  /** The next step's verb before its date: "Pay by 31 May 2027". */
  dueVerb: string;
  /** The upload button, and what the loader asks for. */
  load: string;
  proof: string;
  /** Where the current one goes. */
  where: CarArchiveAction;
  whereText: string;
  /** How long to keep it, and what to do with the older ones. */
  keepFor: string;
  /** What happens if it is late or missing. */
  ifLate: string;
  /** The rules it comes from. */
  sources: string[];
  /**
   * Why a car may rightly have none on file: then a card without one is not
   * a step to take, and says this instead.
   */
  notAlways?: string;
}

export const CAR_DOCUMENT_GUIDES: Record<
  CarDocumentCardType,
  CarDocumentGuide
> = {
  CAR_INSURANCE: {
    what: 'The compulsory third-party insurance (RCA) of the car, with its certificate.',
    every: 'Every year',
    renewal:
      'Every year (or every instalment of a split premium). It never renews by itself: since 2013 an RCA policy has no tacit renewal.',
    deadline:
      'The end date printed on the policy. The insurer still covers you for 15 days after it, while you renew or change company.',
    todo: 'Compare quotes and renew before the end date: an RCA policy never renews by itself. Then load the new policy or its certificate.',
    dueVerb: 'Renew by',
    load: 'Load the new policy',
    proof: 'the new insurance policy or its certificate',
    where: 'in_car',
    whereText:
      'Its certificate goes in the car, a printed copy is fine. Keep the policy at home.',
    keepFor:
      'The current one while it is valid. An old policy can go once no claim on it is open: a claim for damages can come up to 2 years after an accident.',
    ifLate:
      'Driving or parking on a public road without insurance: a fine from € 866 to € 3.464 and the car impounded.',
    sources: [
      'Art. 180 Codice della strada (documents on board)',
      'Art. 170-bis Codice delle assicurazioni (no tacit renewal, 15 days of cover after expiry)',
      'Art. 193 Codice della strada (driving without insurance)',
      'Art. 2947 Codice civile (2 years for road accident damages)',
    ],
  },
  ROAD_TAX: {
    what: 'The tassa automobilistica (bollo) paid to the Regione where the owner lives.',
    every: 'Every 12 months',
    renewal:
      'Every 12 months for most cars, for the same period every year (it ends in April, August or December for many). Cars registered from 1 January 2028 pay 12 months from their registration month.',
    deadline:
      'By the last day of the month after the one the last payment covers: covered through April, pay by 31 May.',
    todo: 'Pay it with pagoPA (on your Regione’s or ACI’s site, or your bank’s app), at a tobacconist or at the post office, then load the receipt.',
    dueVerb: 'Pay by',
    load: 'Load the new receipt',
    proof: 'the new bollo receipt',
    where: 'keep',
    whereText:
      'At home, not in the car: no law asks for it on board, and the police check it online.',
    keepFor:
      'Until the Regione can no longer claim it: 3 years from 1 January after the year it was due (a bollo due in 2026 until 31 December 2029). Piemonte claims 5 years by its own law, which courts dispute: kept 5 there to be safe. A notice (avviso) on a year restarts its count.',
    ifLate:
      'You pay it with interest and a penalty, smaller the sooner you pay (ravvedimento operoso). After 3 years unpaid the PRA can strike the car off (art. 96 Codice della strada).',
    sources: [
      'Art. 5 DL 953/1982 (3 years to claim it)',
      'DM 462/1998 (payment periods and deadlines)',
      'D.Lgs. 147/2026 art. 15 (12 months from registration, cars registered from 2028)',
      'L.R. Piemonte 20/2002 art. 5 (5 years, disputed)',
    ],
  },
  VEHICLE_INSPECTION: {
    what: 'The revisione: the safety check at a centro revisioni or the Motorizzazione, with its certificate.',
    every: 'Every 2 years',
    renewal:
      'The first 4 years after first registration, then every 2 years. To repeat (ripetere) within a month; suspended (sospeso) at once.',
    deadline:
      'By the end of the month of the last one, 2 years later: done on 24 June 2025, due by 30 June 2027 (the certificate prints it).',
    todo: 'Book a centro revisioni or the Motorizzazione, and bring the carta di circolazione. Then load the certificate.',
    dueVerb: 'Book the revisione by',
    load: 'Load the new certificate',
    proof: 'the new revisione certificate',
    where: 'keep',
    whereText:
      'At home. The outcome is recorded on the carta di circolazione and in the Motorizzazione records: nothing to carry.',
    keepFor:
      'The latest until the next revisione. Older ones can go; keep them only for the km history (it helps when you sell).',
    ifLate:
      'Driving with an overdue revisione: a fine from € 173 to € 694, and the car may only be driven to the revisione. Suspended: it cannot be driven at all until it passes.',
    sources: [
      'Art. 80 Codice della strada (when, and the fine)',
      'Art. 180 Codice della strada (documents on board)',
    ],
  },
  CNG_CYLINDER_INSPECTION: {
    what: 'The requalification of the methane cylinders, with the label (cartellino) the workshop fixes on the car.',
    every: 'Every 4 years',
    renewal:
      'Every 4 years for UNECE R110 cylinders, every 5 for national (DGM) ones. Not part of the car’s revisione.',
    deadline:
      'The month printed on the label for each cylinder: the earliest counts. Their end of life, when printed, comes first.',
    todo: 'Book a workshop recognised by the Fondo Bombole Metano: it checks or exchanges the cylinders and applies a new label. Photograph the label and load it.',
    dueVerb: 'Requalify by',
    load: 'Load the new label',
    proof: 'the new CNG cylinder label',
    where: 'keep',
    whereText:
      'A copy at home: the label itself stays fixed on the car (usually in the engine bay). No document goes on board.',
    keepFor: 'The latest until the next requalification; older labels can go.',
    ifLate:
      'Do not use the car, not even on petrol, until a recognised workshop has requalified or exchanged the cylinders.',
    sources: [
      'DM 13 maggio 2022 n. 144, art. 2 (every 4 years for R110)',
      'UNECE Regulation 110',
    ],
  },
  VEHICLE_REGISTRATION: {
    what: 'The carta di circolazione, or the Documento Unico (DU) that replaced it in 2020 for new registrations and changes.',
    every: 'When something changes',
    renewal:
      'Never by itself: a new one comes when something changes (owner, address, modifications). A temporary registration (foglio di via) has its own end date.',
    deadline:
      'None, apart from a temporary registration. A sale has to be recorded at the PRA within 60 days; a change of address is passed on by your Comune.',
    todo: 'Load the carta di circolazione or the Documento Unico: every code of the car is read from it.',
    dueVerb: 'Valid until',
    load: 'Load the new one',
    proof: 'the new carta di circolazione or Documento Unico',
    where: 'in_car',
    whereText:
      'The original goes in the car: a copy is not valid on board. Keep this scan at home as your copy.',
    keepFor: 'As long as you have the car. A replaced one can go.',
    ifLate:
      'Driving without it on board: a fine from € 42 to € 173, and you are asked to show it at a police office.',
    sources: [
      'Art. 180 Codice della strada (documents on board)',
      'Art. 94 Codice della strada (sale within 60 days)',
      'D.Lgs. 98/2017 (Documento Unico)',
    ],
  },
  VEHICLE_OWNERSHIP: {
    what: 'The certificato di proprietà from the PRA (ACI): it proves who owns the car and lists any lien on it (fermo amministrativo, ipoteca). Digital since October 2015, with a code to see it online.',
    every: 'When the owner changes',
    renewal:
      'Never by itself: a new one is issued at every change of owner (passaggio di proprietà), and when a lien is recorded or cancelled.',
    deadline:
      'None. A sale has to be recorded at the PRA within 60 days of the signed sale; the receipt of the PRA and the sale date it.',
    todo: 'Load the certificato di proprietà. After a change of owner, load the PRA receipt and the sale too: each is a step in the history of owners.',
    dueVerb: 'Issued',
    load: 'Load the certificate',
    proof:
      'the certificato di proprietà, or the PRA receipt of a change of owner',
    where: 'keep',
    whereText:
      'At home, in a safe place, apart from the libretto: no law asks for it on board, and left in a stolen car it makes a fraudulent sale easier.',
    keepFor:
      'As long as you have the car: you hand it (or its access code) to the buyer when you sell. Keep the papers of an earlier change of owner too: they prove from which day fines and bollo were no longer the seller’s.',
    ifLate:
      'A change of owner not recorded at the PRA within 60 days: a fine for the buyer and the carta di circolazione withdrawn. Until it is recorded, fines and the bollo still reach the seller.',
    sources: [
      'Art. 94 Codice della strada (change of owner within 60 days)',
      'Art. 180 Codice della strada (documents on board)',
      'D.Lgs. 98/2017 (Documento Unico)',
    ],
    notAlways:
      'A car registered or changing owner since 2020 has the Documento Unico instead, which holds the ownership too: then there is nothing else to load.',
  },
};
