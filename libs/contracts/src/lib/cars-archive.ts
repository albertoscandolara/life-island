/*
 * Which documents of a car to keep, which go in the car and which can go:
 * the latest insurance and revisione, the bollo receipts until the Regione
 * can no longer claim them, the whole service history, fines until they can
 * no longer be collected. svc-cars works it out for every car (VehicleDto
 * `archive`) and downloads from it the files for the car (zip), the summary
 * (Excel) and the archive (zip, one folder per kind).
 */

/** The folders of a car's archive, in the order they are listed. */
export const CAR_ARCHIVE_FOLDERS = [
  'registration',
  'insurance',
  'road_tax',
  'inspection',
  'maintenance',
  'fines',
  'other',
] as const;
export type CarArchiveFolder = (typeof CAR_ARCHIVE_FOLDERS)[number];

/** Each folder's name: English on the page, Italian in the files you download. */
export const CAR_ARCHIVE_FOLDER_LABELS: Record<
  CarArchiveFolder,
  { en: string; it: string }
> = {
  registration: { en: 'Registration', it: '00 - Libretto' },
  insurance: { en: 'Insurance', it: '01 - Assicurazione' },
  road_tax: { en: 'Road tax (bollo)', it: '02 - Bollo' },
  inspection: { en: 'Revisione', it: '03 - Revisione' },
  maintenance: { en: 'Service and repairs', it: '04 - Manutenzione' },
  fines: { en: 'Fines', it: '05 - Multe' },
  other: { en: 'Other expenses', it: '06 - Altre spese' },
};

/**
 * What to do with a document: carry it in the car (and keep it), keep it at
 * home, or delete it if you like.
 */
export const CAR_ARCHIVE_ACTIONS = ['in_car', 'keep', 'discard'] as const;
export type CarArchiveAction = (typeof CAR_ARCHIVE_ACTIONS)[number];
export const CAR_ARCHIVE_ACTION_LABELS: Record<
  CarArchiveAction,
  { en: string; it: string }
> = {
  in_car: { en: 'In the car', it: 'In auto' },
  keep: { en: 'Keep at home', it: 'Da conservare' },
  discard: { en: 'Can go', it: 'Eliminabile' },
};

/** Years the Regione can claim an unpaid bollo: from 1 January after the year it was due (art. 5 DL 953/1982). */
export const ROAD_TAX_CLAIM_YEARS = 3;
/** Piemonte's own regional law gives it 5. */
export const ROAD_TAX_CLAIM_YEARS_PIEMONTE = 5;
/** Years a fine can be collected, from the day of the violation (art. 28 L. 689/1981). */
export const FINE_CLAIM_YEARS = 5;
/** The legal warranty on goods bought as a consumer (art. 133 Codice del consumo). */
export const WARRANTY_YEARS = 2;

/** Why a document is kept, carried or not needed, as the page and the files explain it. */
export const CAR_ARCHIVE_RULES = {
  registration_current: {
    en: 'Only the original is valid on board: keep it in the car. This scan is your copy.',
    it: "In auto va l'originale (art. 180 CdS); questa scansione è la tua copia.",
  },
  registration_old: {
    en: 'Replaced by a newer carta di circolazione.',
    it: 'Sostituita da una carta di circolazione più recente.',
  },
  insurance_current: {
    en: 'Its certificate goes in the car (art. 180 Codice della strada); a printed copy is fine.',
    it: 'Il certificato va tenuto a bordo (art. 180 CdS); va bene anche stampato.',
  },
  insurance_latest: {
    en: 'Your latest policy. Add the new one once renewed: until then there is nothing valid to carry.',
    it: 'Ultima polizza: aggiungi quella nuova appena rinnovi.',
  },
  insurance_suspended: {
    en: 'Suspended while the car is laid up: keep it, you need it to reactivate the policy.',
    it: 'Sospesa mentre l’auto è ferma: conservala, serve per riattivare la polizza.',
  },
  insurance_old: {
    en: 'An expired policy: no need to keep it, unless a claim on it is still open.',
    it: 'Polizza scaduta: non serve conservarla, salvo sinistri ancora aperti.',
  },
  road_tax_claimable: {
    en: 'Keep it at home until the Regione can no longer claim it (3 years from 1 January after the year it was due, 5 in Piemonte). Not in the car.',
    it: 'Da conservare a casa fino alla prescrizione (3 anni dal 1° gennaio successivo, 5 in Piemonte). Non in auto.',
  },
  road_tax_old: {
    en: 'The Regione can no longer claim it: you can delete it, unless you received a notice about that year (a notice restarts the 3 years).',
    it: 'Prescritto: puoi eliminarlo, salvo avvisi o solleciti su quell’anno (riaprono i 3 anni).',
  },
  inspection_current: {
    en: 'Latest revisione: the outcome is also on the carta di circolazione and in the Motorizzazione records; a copy in the car helps at a check.',
    it: "Ultima revisione: l'esito è anche sul libretto e negli archivi della Motorizzazione; una copia in auto aiuta ai controlli.",
  },
  inspection_old: {
    en: 'Replaced by a newer revisione; keep it only if you want the km history.',
    it: 'Sostituita da una revisione più recente; tienila solo per lo storico dei km.',
  },
  maintenance: {
    en: 'Service history: keep it as long as you have the car, it shows how it was looked after.',
    it: "Storico manutenzione: conservalo finché hai l'auto, dimostra come è stata tenuta.",
  },
  warranty: {
    en: 'Keep it 2 years for the legal warranty.',
    it: 'Conservala 2 anni per la garanzia legale.',
  },
  fine_open: {
    en: 'Not paid yet: keep everything until it is paid.',
    it: 'Non ancora pagata: conserva tutto fino al pagamento.',
  },
  fine_paid: {
    en: 'Keep the receipt until it can no longer be collected: 5 years from the violation (art. 28 L. 689/1981).',
    it: 'Conserva la ricevuta per 5 anni dalla violazione (art. 28 L. 689/1981).',
  },
  fine_old: {
    en: 'More than 5 years since the violation: you can delete it.',
    it: 'Passati 5 anni dalla violazione: puoi eliminarla.',
  },
  running_cost: {
    en: 'A running cost (fuel, tolls, parking): not needed once paid.',
    it: 'Spesa corrente (carburante, pedaggi, parcheggi): non serve una volta pagata.',
  },
} as const satisfies Record<string, { en: string; it: string }>;
export type CarArchiveRule = keyof typeof CAR_ARCHIVE_RULES;

/** What has to be in the car and cannot be printed from your documents. */
export const CAR_ORIGINALS_ON_BOARD = [
  {
    en: 'Carta di circolazione or Documento Unico',
    it: 'Carta di circolazione o Documento Unico, in originale',
  },
  {
    en: "The driver's licence (each driver carries their own)",
    it: 'Patente di chi guida',
  },
  {
    en: 'A blank CAI form (constatazione amichevole), from your insurer',
    it: "Modulo CAI (constatazione amichevole) in bianco, dall'assicurazione",
  },
] as const;

/** The warning of a laid-up car, on the page and in the summary. */
export const LAID_UP_WARNING = {
  en: 'Do not use it: with its insurance suspended it can be neither driven nor parked on a public road. Reactivate the policy first.',
  it: 'Da non usare: con l’assicurazione sospesa non può circolare né sostare su strada pubblica. Riattiva prima la polizza.',
} as const;

/** One file of an archived document. */
export interface CarArchiveFileDto {
  uploadId: string;
  title: string;
}

/** One document (or record: policy, certificate and receipt) of a car's archive. */
export interface CarArchiveItemDto {
  /** The record's main document. */
  uploadId: string;
  title: string;
  folder: CarArchiveFolder;
  action: CarArchiveAction;
  rule: CarArchiveRule;
  /** Its date: when it starts, or when it was spent. */
  date: string | null;
  /** When it expires (a policy, a revisione), when it has one. */
  validUntil: string | null;
  /** The last day it is worth keeping; null: as long as you have the car. */
  keepUntil: string | null;
  /** Every file of the record. */
  files: CarArchiveFileDto[];
  /** The files to print and keep in the car (the certificate of a policy), as they are. */
  printFiles: CarArchiveFileDto[];
}

/** Every document of a car, by what to do with it. */
export interface CarArchiveDto {
  items: CarArchiveItemDto[];
  inCar: number;
  keep: number;
  discard: number;
}
