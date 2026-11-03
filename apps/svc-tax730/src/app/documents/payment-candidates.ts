import type { DocumentRow } from '../db/schema.js';
import { documentAmount, documentDate } from './document-view.js';

export interface ExpenseToProve {
  amount: number;
  issuer: string;
  date: string;
}

/** Words of a company name that say nothing about which company it is. */
const GENERIC_WORDS = new Set([
  'srl',
  'srls',
  'spa',
  'snc',
  'sas',
  'societa',
  'società',
  'impianti',
  'studio',
  'dott',
  'dottor',
  'avv',
  'notaio',
  'della',
  'delle',
  'degli',
]);

const PAYMENT_HINT =
  /bonific|transfer|payment|pagament|ricevut|receipt|bank|banca|carta|card|sepa|addebit/i;

const DAY_MS = 24 * 60 * 60 * 1000;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !GENERIC_WORDS.has(word));
}

/**
 * How likely a document proves an expense was paid: the same amount, the
 * supplier's name, a date close to the expense, and words that say "payment".
 * Each match adds to the score and explains itself in `reasons`.
 */
export function scorePaymentCandidate(
  expense: ExpenseToProve,
  document: DocumentRow,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const fieldValues = Object.values(document.fields ?? {});

  const amount = documentAmount(document.fields);
  const sameAmount = (value: unknown) =>
    typeof value === 'number' && Math.abs(value - expense.amount) < 0.01;
  if (amount !== null && sameAmount(amount)) {
    score += 3;
    reasons.push('Same amount');
  } else if (fieldValues.some(sameAmount)) {
    score += 2;
    reasons.push('Mentions the same amount');
  }

  const text = [
    document.title,
    document.description ?? '',
    document.originalFilename,
    ...fieldValues.filter((value) => typeof value === 'string'),
  ].join(' ');
  const haystack = new Set(words(text));
  const issuerWords = words(expense.issuer);
  if (issuerWords.length && issuerWords.some((word) => haystack.has(word))) {
    score += 2;
    reasons.push(`Mentions ${expense.issuer}`);
  }

  const date = documentDate(document.fields);
  if (date) {
    const days = Math.abs(Date.parse(date) - Date.parse(expense.date)) / DAY_MS;
    if (days <= 90) {
      score += 1;
      reasons.push(days < 1 ? 'Same day' : `${Math.round(days)} days apart`);
    }
  }

  if (PAYMENT_HINT.test(`${text} ${document.categories.join(' ')}`)) {
    score += 1;
    reasons.push('Looks like a payment');
  }

  return { score, reasons };
}
