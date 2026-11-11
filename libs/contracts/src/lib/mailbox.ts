import { z } from 'zod';
import {
  lifeAmount,
  lifeDate,
  lifeName,
  lifeNote,
  lifeOptionalDate,
  type LifeRecord,
} from './life-schemas.js';

/*
 * Admin mailbox (Diplo, svc-mailbox, mfe-mailbox): the official letters you
 * get (Agenzia delle Entrate, INPS, fines, the bank, the condo, the comune),
 * each with what it asks, the amount and the date to act by, until it is
 * done; and an AI that explains a letter in plain words and lists what to do.
 */

export const LETTER_KINDS = [
  'tax',
  'social-security',
  'fine',
  'bank',
  'condo',
  'municipality',
  'utility',
  'insurance',
  'employer',
  'court',
  'health',
  'school',
  'other',
] as const;
export type LetterKind = (typeof LETTER_KINDS)[number];
export const LETTER_KIND_LABELS: Record<LetterKind, string> = {
  tax: 'Taxes (Agenzia Entrate, F24)',
  'social-security': 'INPS and pensions',
  fine: 'Fines',
  bank: 'Bank and post office',
  condo: 'Condominium',
  municipality: 'Comune (TARI, registry)',
  utility: 'Utilities',
  insurance: 'Insurance',
  employer: 'Employer',
  court: 'Legal',
  health: 'Health service (ASL)',
  school: 'School',
  other: 'Other',
};

export const LETTER_STATUSES = ['todo', 'waiting', 'done', 'archived'] as const;
export type LetterStatus = (typeof LETTER_STATUSES)[number];
export const LETTER_STATUS_LABELS: Record<LetterStatus, string> = {
  todo: 'To do',
  waiting: 'Waiting for an answer',
  done: 'Done',
  archived: 'Just to keep',
};

export const letterRequestSchema = z.object({
  receivedOn: lifeDate,
  sender: lifeName(160),
  kind: z.enum(LETTER_KINDS).optional(),
  subject: lifeName(240),
  /** The letter's text, pasted or typed, for the explainer and to search. */
  text: lifeNote(20000),
  reference: lifeNote(120),
  amount: lifeAmount.nullable().optional(),
  dueOn: lifeOptionalDate,
  status: z.enum(LETTER_STATUSES).optional(),
  /** What you have to do, in your words. */
  action: lifeNote(1000),
  notes: lifeNote(),
});
export type LetterRequest = z.input<typeof letterRequestSchema>;

export const letterExplainerOutputSchema = z.object({
  summary: z
    .string()
    .describe('What the letter is, in two plain sentences'),
  meaning: z
    .string()
    .describe('What it means for you, and what happens if you do nothing'),
  kind: z.enum(LETTER_KINDS),
  urgency: z.enum(['low', 'medium', 'high']),
  amount: z
    .number()
    .describe('The amount to pay in euro, 0 when nothing is due'),
  dueOn: z
    .string()
    .describe('The date to act by as YYYY-MM-DD, or empty when none is written'),
  actions: z
    .array(
      z.object({
        what: z.string().describe('One action, verb first'),
        by: z.string().describe('YYYY-MM-DD, or empty'),
      }),
    )
    .describe('The steps to take, in order, at most six'),
  questions: z
    .array(z.string())
    .describe('Up to three things to check or ask (a CAF, the sender)'),
});
export type LetterExplainerOutput = z.infer<
  typeof letterExplainerOutputSchema
>;

export interface LetterExplanationDto {
  output: LetterExplainerOutput;
  source: 'claude' | 'offline';
  model: string | null;
  createdAt: string;
}

export type LetterDto = LifeRecord<{
  receivedOn: string;
  sender: string;
  kind: LetterKind;
  subject: string;
  text: string | null;
  reference: string | null;
  amount: number | null;
  dueOn: string | null;
  status: LetterStatus;
  action: string | null;
  notes: string | null;
}> & {
  explanation: LetterExplanationDto | null;
  daysLeft: number | null;
};

export interface MailboxOverviewDto {
  today: string;
  letters: LetterDto[];
  totals: {
    open: number;
    overdue: number;
    dueSoon: number;
    /** What open letters ask you to pay. */
    toPay: number;
  };
  aiExplainer: boolean;
}

/** Common Italian words in official letters, for the offline reading. */
export const LETTER_KIND_KEYWORDS: readonly [RegExp, LetterKind][] = [
  [/agenzia delle entrate|cartella|avviso bonario|f24|irpef|imposta|riscossione/i, 'tax'],
  [/inps|contribut|pension|naspi|assegno unico/i, 'social-security'],
  [/verbale|contravvenzione|codice della strada|polizia locale|multa|sanzione/i, 'fine'],
  [/banca|conto corrente|estratto conto|poste italiane|bancoposta/i, 'bank'],
  [/condomin|amministratore|rata condominiale/i, 'condo'],
  [/comune di|tari|anagrafe|imu|tributi/i, 'municipality'],
  [/bolletta|fornitura|enel|eni|a2a|hera|acea/i, 'utility'],
  [/polizza|assicurazion|sinistro/i, 'insurance'],
  [/tribunale|avvocato|decreto ingiuntivo|precetto/i, 'court'],
  [/asl|ats|azienda sanitaria|ticket/i, 'health'],
  [/scuola|istituto comprensivo|iscrizion/i, 'school'],
];
