/*
 * Which documents of a car to keep, which go in the car and which can go:
 * the latest insurance, revisione and CNG cylinder label, the bollo receipts until the Regione
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
  'cng_cylinders',
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
  cng_cylinders: { en: 'CNG cylinders', it: '04 - Bombole metano' },
  maintenance: { en: 'Service and repairs', it: '05 - Manutenzione' },
  fines: { en: 'Fines', it: '06 - Multe' },
  other: { en: 'Other expenses', it: '07 - Altre spese' },
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
    en: 'Latest revisione: keep it at home. The outcome is recorded on the carta di circolazione and in the Motorizzazione records, so it need not be carried.',
    it: "Ultima revisione: da conservare a casa. L'esito risulta sul libretto e negli archivi della Motorizzazione: non serve tenerla in auto.",
  },
  inspection_old: {
    en: 'Replaced by a newer revisione; keep it only if you want the km history.',
    it: 'Sostituita da una revisione più recente; tienila solo per lo storico dei km.',
  },
  cng_current: {
    en: 'Latest cylinder label: keep a copy at home, it lists your cylinders and when they are due. Nothing to carry: the workshop fixes the label on the car, and no law asks for a document on board.',
    it: "Ultimo cartellino delle bombole: conservane la copia a casa, riporta le bombole e la scadenza. Non va tenuto in auto: l'officina applica il cartellino sull'auto e nessuna norma chiede un documento a bordo (art. 180 CdS).",
  },
  cng_old: {
    en: 'Replaced by a newer requalification: you can delete it.',
    it: 'Sostituito da una riqualificazione più recente: puoi eliminarlo.',
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

/** What the law (art. 180 Codice della strada) wants in the car in original, so not printed from your documents. */
export const CAR_ORIGINALS_ON_BOARD = [
  {
    en: 'Carta di circolazione or Documento Unico',
    it: 'Carta di circolazione o Documento Unico, in originale',
  },
  {
    en: "The driver's licence (each driver carries their own)",
    it: 'Patente di chi guida',
  },
] as const;

/** For a car with CNG cylinders: what the in-car checklist says of their label. */
export const CNG_LABEL_ON_BOARD = {
  en: 'Fixed on the car by the workshop (usually in the engine bay): check that it is there and legible, nothing to print',
  it: "Applicato sull'auto dall'officina (di solito nel vano motore): verifica che ci sia e sia leggibile, non va stampato",
} as const;

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
