import type {
  PaymentKind,
  TransactionFacts,
  TransactionReference,
  TransactionRole,
} from '@life-island/contracts';
import { normalizeTransactionFacts } from '../transaction-facts.js';

/**
 * The offline stand-in for the TRANSACTION step: the money facts a regular
 * expression can find in a document's text (Italian and English), so that
 * invoice and payment matching works without an API key. It reads the
 * content only, never the file name or the title. The AI reads far more.
 */

const MONTHS: Record<string, number> = Object.fromEntries(
  [
    ['gennaio', 'january'],
    ['febbraio', 'february'],
    ['marzo', 'march'],
    ['aprile', 'april'],
    ['maggio', 'may'],
    ['giugno', 'june'],
    ['luglio', 'july'],
    ['agosto', 'august'],
    ['settembre', 'september'],
    ['ottobre', 'october'],
    ['novembre', 'november'],
    ['dicembre', 'december'],
  ].flatMap((names, index) => names.map((name) => [name, index + 1])),
);

const NUMERIC_DATE = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/;
const WORD_DATE = new RegExp(
  `\\b(\\d{1,2})\\s+(${Object.keys(MONTHS).join('|')})\\s+(\\d{4})\\b`,
  'i',
);

function isoDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const numeric = NUMERIC_DATE.exec(text);
  const word = WORD_DATE.exec(text);
  const first =
    numeric && word
      ? numeric.index <= word.index
        ? numeric
        : word
      : (numeric ?? word);
  if (!first) return null;
  const day = Number(first[1]);
  const month =
    first === word ? MONTHS[first[2].toLowerCase()] : Number(first[2]);
  let year = Number(first[3]);
  if (year < 100) year += 2000;
  if (!day || !month || day > 31 || month > 12) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** `6.500,00`, `6500,00`, `6,500.00` or `6500.00` → 6500. */
export function parseAmount(text: string | null | undefined): number | null {
  if (!text) return null;
  const match =
    /(\d{1,3}(?:[.\s]\d{3})+,\d{2}|\d+,\d{2}|\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2})(?!\d)/.exec(
      text,
    );
  if (!match) return null;
  const raw = match[1];
  const normalized = /,\d{2}$/.test(raw)
    ? raw.replace(/[.\s]/g, '').replace(',', '.')
    : raw.replace(/,/g, '');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * The value of a label: printed after it on the same line (`Causale: ...`)
 * or, as bank PDFs lay them out, on the next line. Labels match at the start
 * of a line only.
 */
function after(text: string, label: RegExp): string | null {
  const lines = text.split('\n').map((line) => line.trim());
  for (const [index, line] of lines.entries()) {
    const match = label.exec(line);
    if (!match || match.index !== 0) continue;
    const rest = line
      .slice(match[0].length)
      .trim()
      .replace(/^\([^)]*\)/, '')
      .replace(/^[\s:.-]+/, '')
      .trim();
    if (rest) return rest;
    const next = lines.slice(index + 1).find((candidate) => candidate);
    if (next) return next;
  }
  return null;
}

/**
 * A payment description, which bank PDFs often wrap around its label: the
 * line before `Causale` belongs to it when the label stands alone.
 */
function descriptionOf(text: string): string | null {
  const lines = text.split('\n').map((line) => line.trim());
  const at = lines.findIndex((line) => /^(causale|description)\b/i.test(line));
  if (at < 0) return null;
  const rest = lines[at].replace(/^(causale|description)\b[\s:.-]*/i, '');
  if (rest) return rest;
  const before = lines[at - 1] ?? '';
  const next = lines[at + 1] ?? '';
  const wrapped = before.length > 40 && /[a-z]{3}/.test(before);
  return [wrapped ? before : '', next].filter(Boolean).join(' ') || null;
}

const IBAN = /\b([A-Z]{2}\s?\d{2}(?:\s?[A-Z0-9]){11,30})\b/g;

function ibansIn(text: string): string[] {
  return [...text.matchAll(IBAN)]
    .map((match) => match[1].replace(/\s/g, ''))
    .filter((iban) => !iban.startsWith('IT') || iban.length === 27);
}

const TAX_CODE =
  /\b([A-Z]{3}\s?[A-Z]{3}\s?\d{2}[A-EHLMPRST]\d{2}\s?[A-Z]\d{3}[A-Z])\b/g;
const VAT =
  /(?:P\.?\s?IVA|Part(?:ita)?\.?\s*IVA|VAT(?:\s+number)?)\D{0,12}((?:IT)?\d{11})\b/i;

function roleOf(text: string): TransactionRole {
  const payment =
    /dettaglio bonifico|ricevuta (del |di )?bonifico|bank transfer (receipt|details)|esito (del )?bonifico/i.test(
      text,
    ) ||
    (/\b(beneficiario|beneficiary)\b/i.test(text) &&
      /\b(ordinante|causale|payer)\b/i.test(text));
  if (payment) return 'PAYMENT';
  if (/\b(preventivo|pro-?forma|quotation|estimate)\b/i.test(text))
    return 'QUOTE';
  if (/\b(fattura|invoice|parcella|notula|bolletta)\b/i.test(text))
    return 'INVOICE';
  return 'NONE';
}

function paymentKindOf(description: string | null): PaymentKind | null {
  if (!description) return null;
  if (/\bsaldo\b|\bbalance\b/i.test(description)) return 'BALANCE';
  if (/\b(acconto|anticipo|caparra|advance|deposit)\b/i.test(description))
    return 'ADVANCE';
  if (/\b(rata|instal+ment)\b/i.test(description)) return 'INSTALLMENT';
  return 'UNKNOWN';
}

/** Invoices and quotes a payment description names: `fattura n. 12/2025`, `preventivo del 27 Giugno 2025`. */
function referencesIn(description: string | null): TransactionReference[] {
  if (!description) return [];
  const refs: TransactionReference[] = [];
  const pattern =
    /\b(fattura|fatt\.?|invoice|preventivo|quote|ft\.?|nota)\s*(?:n\.?|nr\.?|numero|no\.?)?\s*([A-Z]{0,4}[\d][\w/-]*)?(?:\s*del(?:l['’])?\s+([^,;]+?(?:\d{4})))?(?=[\s,;.]|$)/gi;
  for (const match of description.matchAll(pattern)) {
    const kind = /preventiv|quote/i.test(match[1])
      ? 'quote'
      : /nota/i.test(match[1])
        ? 'note'
        : 'invoice';
    const number = match[2] ?? null;
    const date = isoDate(match[3]);
    if (number || date) refs.push({ kind, number, date });
  }
  return refs;
}

function firstLine(text: string): string | null {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => /[A-Za-z]{3}/.test(line)) ?? null
  );
}

/** The money facts this text shows, as far as a regular expression can tell. */
export function readTransactionText(text: string): TransactionFacts {
  const role = roleOf(text);
  if (role === 'NONE') return normalizeTransactionFacts({ role: 'NONE' });
  const taxCodes = [...text.matchAll(TAX_CODE)].map((m) => m[1]);
  const currency = /€|\beur\b/i.test(text) ? 'EUR' : null;

  if (role === 'PAYMENT') {
    // The beneficiary's details follow its heading; the payer's come before.
    const split =
      /dati beneficiario|beneficiary details|\bbeneficiario\b|\bbeneficiary\b/i.exec(
        text,
      );
    const payerPart = split ? text.slice(0, split.index) : '';
    const payeePart = split ? text.slice(split.index) : text;
    const description = descriptionOf(text);
    return normalizeTransactionFacts({
      role,
      documentKind: /sepa/i.test(text) ? 'SEPA bank transfer' : 'payment',
      documentNumber: after(text, /(CRO|TRN|ID transazione)\b/i),
      issueDate: isoDate(
        after(text, /data (di )?(inserimento|esecuzione|ordine)/i),
      ),
      paymentDate:
        isoDate(after(text, /data (di )?(addebito|valuta|regolamento)/i)) ??
        isoDate(after(text, /data (di )?(esecuzione|inserimento)/i)),
      amount:
        parseAmount(after(text, /importo\b(?! totale)/i)) ??
        parseAmount(after(text, /importo totale|amount/i)),
      fees: parseAmount(after(text, /commission[ie]|fees?\b/i)),
      currency,
      counterparty: {
        name: after(payeePart, /(beneficiario|beneficiary)\b/i),
        iban: ibansIn(payeePart)[0] ?? null,
      },
      customer: {
        name: after(payerPart, /(ordinante|payer)\b/i),
        iban: ibansIn(payerPart)[0] ?? null,
      },
      references: referencesIn(description),
      paymentKind: paymentKindOf(description),
      description,
      subjects: [],
    });
  }

  const numberLine =
    /\b(fattura|preventivo|invoice|quote|parcella)\s*(?:n\.?|nr\.?|numero|no\.?)\s*([\w/-]+)/i.exec(
      text,
    );
  const afterNumber = numberLine
    ? text.slice(numberLine.index, numberLine.index + 200)
    : '';
  const total =
    parseAmount(after(text, /totale da pagare|total due|amount due/i)) ??
    parseAmount(after(text, /\btotale\b|\btotal\b/i));
  const customerName =
    after(
      text,
      /(egr\.?|spett\.?(le)?|gentile|cliente|customer|bill to)(?=\s|$)/i,
    ) ??
    (() => {
      const lines = text.split('\n').map((line) => line.trim());
      const at = lines.findIndex((line) =>
        /^(egr\.?|spett\.?(le)?|gentile)$/i.test(line),
      );
      return at >= 0 ? (lines[at + 1] ?? null) : null;
    })();
  return normalizeTransactionFacts({
    role,
    documentKind: role === 'QUOTE' ? 'quote' : 'invoice',
    documentNumber: numberLine?.[2] ?? null,
    issueDate: isoDate(afterNumber) ?? isoDate(text),
    dueDate: isoDate(after(text, /scadenza|due date/i)),
    amount: total,
    currency,
    counterparty: {
      name: firstLine(text),
      vatNumber: VAT.exec(text)?.[1] ?? null,
      taxCode: taxCodes[0] ?? null,
      iban: ibansIn(text)[0] ?? null,
    },
    customer: {
      name: customerName,
      taxCode: taxCodes[1] ?? null,
    },
    references: [],
    description: after(text, /\b(oggetto|subject)\b/i),
    subjects: [],
  });
}
