import {
  guessLetterKind,
  LETTER_KIND_LABELS,
  type LetterExplainerOutput,
  type LetterKind,
} from '@life-island/contracts';

/*
 * Reading a letter with Life Island's own rules: its kind from a few words,
 * the amounts and dates written in it, and what usually has to be done.
 */

/** "€ 1.234,56", "euro 89,00", "Importo: 120,00". */
export function findAmounts(text: string): number[] {
  const out: number[] = [];
  const pattern = /(?:€|eur(?:o)?|importo[^0-9]{0,20})\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})|[0-9]+(?:,[0-9]{2})?)/gi;
  for (const m of text.matchAll(pattern)) {
    const value = Number(m[1].replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(value) && value > 0) out.push(value);
  }
  return out;
}

/** dd/mm/yyyy or dd-mm-yyyy dates, as YYYY-MM-DD, in the order written. */
export function findDates(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g)) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), m[3]];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31)
      out.push(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return out;
}

const STEPS: Partial<Record<LetterKind, string[]>> = {
  tax: ['Check the amount and the year it refers to', 'Pay with the F24 or the pagoPA notice attached, or ask a CAF if it looks wrong'],
  fine: ['Check the plate, date and place', 'Pay within 5 days for the 30% discount, or appeal within 60 days'],
  'social-security': ['Read what INPS asks or communicates', 'Answer or check it on the INPS website with SPID'],
  municipality: ['Check the amount and the property it refers to', 'Pay with the pagoPA notice by the date written'],
  condo: ['Check the instalment against the budget approved', 'Pay by the date written'],
  court: ['Do not ignore it: deadlines in legal letters are short', 'Talk to a lawyer or a consumer association this week'],
};

export function offlineReading(
  letter: { sender: string; subject: string; text: string | null },
  today: string,
): LetterExplainerOutput {
  const all = `${letter.sender} ${letter.subject} ${letter.text ?? ''}`;
  const kind = guessLetterKind(all);
  const amounts = findAmounts(letter.text ?? '');
  const future = findDates(letter.text ?? '').filter((d) => d >= today).sort();
  const amount = amounts.length ? Math.max(...amounts) : 0;
  const dueOn = future[0] ?? '';
  const urgency =
    kind === 'court' || (dueOn && dueOn <= addDays(today, 7)) ? 'high' : amount > 0 || dueOn ? 'medium' : 'low';
  return {
    summary: `A letter from ${letter.sender} about “${letter.subject}”, read as ${LETTER_KIND_LABELS[kind].toLowerCase()}.`,
    meaning:
      (amount ? `It mentions an amount of €${amount.toFixed(2)}.` : 'No amount was found in the text.') +
      (dueOn ? ` The first date ahead written in it is ${dueOn}: it may be the deadline.` : ' No date ahead was found.') +
      ' This is a reading of the words only: check the letter itself.',
    kind,
    urgency,
    amount,
    dueOn,
    actions: [
      ...(STEPS[kind] ?? ['Read it in full and note what it asks']).map((what) => ({ what, by: '' })),
      ...(dueOn ? [{ what: 'Act before the date written in the letter', by: dueOn }] : []),
    ],
    questions: ['Is the amount right, and for which year or period?', 'Is there a way to pay in instalments (rateizzazione)?'].slice(
      0,
      amount ? 2 : 1,
    ),
  };
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const EXPLAINER_INSTRUCTIONS = `You help one person in Italy understand official letters (from the Agenzia delle Entrate, INPS, the Comune, the police, a bank, a condominium, a court) with Life Island.

You receive the sender, the subject and the text of one letter (often in Italian), and today's date. Answer in plain English:
- summary: what the letter is, in two plain sentences.
- meaning: what it means for them, and what happens if they do nothing (fees, interest, enforcement), only as far as the letter says.
- kind: the best category.
- urgency: high when there is a short legal deadline or enforcement, medium when something is to pay or answer, low when it is just information.
- amount: the amount to pay in euro, 0 when nothing is due.
- dueOn: the date to act by as YYYY-MM-DD, or empty when the letter gives none. Compute it when the letter says "within 60 days of notification" only if the notification date is in the text.
- actions: the steps in order (pay with F24/pagoPA, appeal, ask for instalments, call, send a PEC), each with a date when there is one.
- questions: up to three things to check or ask a CAF, a lawyer or the sender.

Rules: use only what the letter says; never invent amounts, dates or laws. Translate Italian terms the first time (cartella esattoriale = tax collection notice). This is not legal advice: suggest a CAF or a lawyer when the stakes are high.`;
