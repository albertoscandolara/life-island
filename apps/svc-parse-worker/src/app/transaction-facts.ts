import {
  PAYMENT_KINDS,
  TRANSACTION_ROLES,
  transactionFactsSchema,
  type PaymentKind,
  type TransactionFacts,
  type TransactionParty,
  type TransactionRole,
} from '@life-island/contracts';

/** Facts of a document that plays no part in a money transaction. */
export function noTransaction(): TransactionFacts {
  const nobody = { name: null, vatNumber: null, taxCode: null, iban: null };
  return {
    role: 'NONE',
    documentKind: null,
    documentNumber: null,
    issueDate: null,
    dueDate: null,
    paymentDate: null,
    amount: null,
    fees: null,
    currency: null,
    counterparty: nobody,
    customer: { ...nobody },
    references: [],
    paymentKind: null,
    description: null,
    subjects: [],
  };
}

function text(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function day(value: unknown): string | null {
  const iso = text(value);
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const date = iso.slice(0, 10);
  return Number.isNaN(Date.parse(date)) ? null : date;
}

function amount(value: unknown): number | null {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.replace(/\s/g, '').replace(',', '.'))
        : NaN;
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

function party(value: unknown): TransactionParty {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    name: text(raw['name']),
    vatNumber: text(raw['vatNumber'], 40),
    taxCode: text(raw['taxCode'], 40),
    iban: text(raw['iban'], 50),
  };
}

/**
 * What the model returned, made safe to store: unknown roles become NONE,
 * dates that are not YYYY-MM-DD and amounts that are not numbers become
 * null, texts are trimmed and capped. Never throws.
 */
export function normalizeTransactionFacts(raw: unknown): TransactionFacts {
  if (!raw || typeof raw !== 'object') return noTransaction();
  const value = raw as Record<string, unknown>;
  const role = TRANSACTION_ROLES.includes(value['role'] as TransactionRole)
    ? (value['role'] as TransactionRole)
    : 'NONE';
  const paymentKind = PAYMENT_KINDS.includes(
    value['paymentKind'] as PaymentKind,
  )
    ? (value['paymentKind'] as PaymentKind)
    : null;
  const references = Array.isArray(value['references'])
    ? value['references'].slice(0, 10).map((ref) => {
        const r = (ref ?? {}) as Record<string, unknown>;
        return {
          kind: text(r['kind'], 60),
          number: text(r['number'], 60),
          date: day(r['date']),
        };
      })
    : [];
  const facts: TransactionFacts = {
    role,
    documentKind: text(value['documentKind'], 80),
    documentNumber: text(value['documentNumber'], 80),
    issueDate: day(value['issueDate']),
    dueDate: day(value['dueDate']),
    paymentDate: role === 'PAYMENT' ? day(value['paymentDate']) : null,
    amount: amount(value['amount']),
    fees: amount(value['fees']),
    currency: text(value['currency'], 3)?.toUpperCase() ?? null,
    counterparty: party(value['counterparty']),
    customer: party(value['customer']),
    references: references.filter((ref) => ref.number || ref.date),
    paymentKind: role === 'PAYMENT' ? paymentKind : null,
    description: text(value['description'], 1000),
    subjects: Array.isArray(value['subjects'])
      ? value['subjects']
          .map((subject) => text(subject))
          .filter((subject): subject is string => subject !== null)
          .slice(0, 10)
      : [],
  };
  return transactionFactsSchema.parse(facts);
}
