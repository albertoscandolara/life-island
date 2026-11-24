import {
  CAR_DOCUMENT_ROOT,
  CAR_DOCUMENT_TYPES,
  FIRST_INSPECTION_MONTHS,
  INSPECTION_INTERVAL_MONTHS,
  INSURANCE_GRACE_DAYS,
  REGISTRATION_CERTIFICATE_KEYS,
  RENEWAL_WARNING_DAYS,
  STABLE_VEHICLE_FIELDS,
  VEHICLE_FIELD_DEFINITIONS,
  VEHICLE_FIELDS,
  type CarCostDto,
  type CarCostTotalDto,
  type CarDocumentFactDto,
  type CarDocumentRole,
  type CarDocumentStatus,
  type CarDocumentType,
  type CostKind,
  type ExpenseKind,
  type InspectionOutcome,
  type RenewableKind,
  type RenewalDto,
  type RenewalLevel,
  type VehicleChangeDto,
  type VehicleChangeSuggestion,
  type VehicleField,
  type VehicleMatch,
  type VehicleValue,
  type VehicleValues,
  euroText,
  CNG_CYLINDER_TYPES,
  CNG_INTERVAL_MONTHS,
  CNG_MAX_CYLINDERS,
  type CngApproval,
  type CngCylinderDto,
  type CngCylinderType,
} from '@life-island/contracts';

/*
 * Pure rules of the Cars area: which documents are car documents, what they
 * print, which car they are about, what would change on it, how versions are
 * ordered, when each renewable item is due, and what a car costs. No database
 * here, so every rule is unit-tested on its own.
 */

export type Fields = Record<string, string | number | boolean | null>;
export type ParentOf = ReadonlyMap<string, string | null>;

const DEFINITION = new Map(VEHICLE_FIELD_DEFINITIONS.map((d) => [d.field, d]));

/** The code printed next to a field on the carta di circolazione. */
export function codeOf(field: VehicleField): string | null {
  return DEFINITION.get(field)?.code ?? null;
}

/** A category and everything above it. */
export function withAncestors(id: string, parentOf: ParentOf): string[] {
  const chain: string[] = [];
  let current: string | null | undefined = id;
  while (current && !chain.includes(current)) {
    chain.push(current);
    current = parentOf.get(current);
  }
  return chain;
}

/**
 * Whether a document is a car document and of which type: one of its
 * categories is, or sits under, one of CAR_DOCUMENT_TYPES, or the
 * CAR_DOCUMENT root (then the type is unknown).
 */
export function carDocumentType(
  categories: readonly string[],
  parentOf: ParentOf,
): { isCar: boolean; type: CarDocumentType | null } {
  let isCar = false;
  for (const id of categories) {
    const chain = withAncestors(id, parentOf);
    const type = chain.find((c): c is CarDocumentType =>
      (CAR_DOCUMENT_TYPES as readonly string[]).includes(c),
    );
    if (type) return { isCar: true, type };
    if (chain.includes(CAR_DOCUMENT_ROOT)) isCar = true;
  }
  return { isCar, type: null };
}

function text(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim().replace(/\s+/g, ' ');
  return trimmed === '' ? null : trimmed;
}

function dateOf(value: string | number | boolean | null | undefined) {
  const raw = text(value);
  return raw && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

/** A number as printed: 1242, "1.242" or "5,2" (Italian decimals). */
export function numberOf(
  value: string | number | boolean | null | undefined,
): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = text(value);
  if (!raw) return null;
  let cleaned = raw.replace(/[^\d.,-]/g, '');
  if (cleaned.includes(','))
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(cleaned))
    cleaned = cleaned.replace(/\./g, '');
  const n = Number(cleaned);
  return cleaned !== '' && Number.isFinite(n) ? n : null;
}

/** A plate or a VIN as compared: upper-case, without spaces or dashes. */
export function normalizeCode(value: string | null): string | null {
  if (!value) return null;
  const code = value.toUpperCase().replace(/[\s.-]/g, '');
  return code === '' ? null : code;
}

/** How a value is compared: text ignores case and spacing, numbers their format. */
export function normalizeValue(field: VehicleField, value: VehicleValue) {
  if (value === null) return null;
  if (field === 'registrationNumber' || field === 'vin')
    return normalizeCode(String(value));
  const type = DEFINITION.get(field)?.type;
  if (type === 'integer' || type === 'number') return numberOf(value);
  if (type === 'date') return String(value).slice(0, 10);
  return String(value).toUpperCase().trim().replace(/\s+/g, ' ');
}

function vehicleValueOf(
  field: VehicleField,
  raw: string | number | boolean | null | undefined,
): VehicleValue {
  const definition = DEFINITION.get(field);
  if (!definition) return null;
  switch (definition.type) {
    case 'date':
      return dateOf(raw);
    case 'integer': {
      const n = numberOf(raw);
      return n === null ? null : Math.round(n);
    }
    case 'number':
      return numberOf(raw);
    case 'enum': {
      const value =
        text(raw)
          ?.toLowerCase()
          .replace(/[\s-]+/g, '_') ?? null;
      const options = definition.options as readonly string[];
      const match = options.find((o) => o.toLowerCase() === value);
      return match ?? null;
    }
    default: {
      const value = text(raw);
      return field === 'registrationNumber' || field === 'vin'
        ? normalizeCode(value)
        : value;
    }
  }
}

/** Last day of the month `months` after the month of `date` (YYYY-MM-DD). */
export function endOfMonthAfter(date: string, months: number): string {
  const y = +date.slice(0, 4);
  const m = +date.slice(5, 7) - 1 + months;
  const last = new Date(Date.UTC(y, m + 1, 0));
  return last.toISOString().slice(0, 10);
}

/** The same day `months` later (clamped to the month's end). */
export function addMonths(date: string, months: number): string {
  const y = +date.slice(0, 4);
  const m = +date.slice(5, 7) - 1 + months;
  const d = +date.slice(8, 10);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const t = Date.UTC(
    +date.slice(0, 4),
    +date.slice(5, 7) - 1,
    +date.slice(8, 10),
  );
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/** Days from `today` to `date` (both YYYY-MM-DD); negative once past. */
export function daysUntil(date: string, today: string): number {
  const ms = (d: string) =>
    Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((ms(date) - ms(today)) / 86_400_000);
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** What a car document prints, read from its template fields. */
export interface CarDocumentReading {
  type: CarDocumentType | null;
  /** Every car value it prints, under the JSON model's names. */
  values: Partial<Record<VehicleField, string | number>>;
  registrationNumber: string | null;
  vin: string | null;
  make: string | null;
  commercialName: string | null;
  /** Policy, receipt, report or certificate number. */
  number: string | null;
  /** Insurer, Regione, inspection centre or supplier. */
  issuer: string | null;
  /** When it starts to count: issue, policy start, inspection or expense date. */
  validFrom: string | null;
  /** The date it has to be renewed by, as far as the document alone says. */
  validUntil: string | null;
  /** The day the money went: payment date, else the document's own date. */
  costDate: string | null;
  amount: number | null;
  odometerKm: number | null;
  litres: number | null;
  expenseKind: ExpenseKind | null;
  outcome: InspectionOutcome | null;
  /** Road tax: paid as an exemption, never due. */
  exempt: boolean;
  /** Insurance: the next instalment of a split premium. */
  nextInstallmentDate: string | null;
  /** Expense: the service it says is due next. */
  nextServiceDate: string | null;
  nextServiceKm: number | null;
  /** The day it says the money was paid, when it prints one. */
  paymentDate: string | null;
  /** What it is within its record (policy, certificate, receipt), when known. */
  role: CarDocumentRole | null;
  /** Insurance: the bonus-malus class and the covers it lists. */
  cuClass: number | null;
  coverages: string[] | null;
  /** Fine (an expense of kind fine): what the verbale prints. */
  fine: FineReading | null;
  /** CNG cylinder label: its cylinders and months. */
  cng: CngReading | null;
  facts: CarDocumentFactDto[];
}

/** What a fine's verbale prints. */
export interface FineReading {
  violationDate: string | null;
  notificationDate: string | null;
  article: string | null;
  points: number | null;
  reducedAmount: number | null;
}

/** What a CNG cylinder label prints (car-cng.ts works out the rest). */
export interface CngReading {
  /** YYYY-MM. */
  appliedMonth: string | null;
  approval: CngApproval | null;
  cylinderType: CngCylinderType | null;
  cylinders: CngCylinderDto[];
  totalLitres: number | null;
  /** The month they are due again: printed, else the earliest of the cylinders'. */
  dueMonth: string | null;
  /**
   * The date the cylinders have to be requalified by: the last day of the
   * printed month, else 4 years (R110) or 5 (national) after the label.
   */
  dueDate: string | null;
  /** Whether dueDate was printed (else worked out from the month applied). */
  duePrinted: boolean;
  endOfLifeMonth: string | null;
  manufactureMonth: string | null;
}

/**
 * A month as printed or read: 2027-07, 07/2027, 7-2027, luglio 2023, or a
 * date (its month) → YYYY-MM.
 */
export function monthOf(
  value: string | number | boolean | null | undefined,
): string | null {
  const raw = text(value)?.toLowerCase();
  if (!raw) return null;
  const valid = (y: number, m: number) =>
    m >= 1 && m <= 12 && y >= 1950 && y <= 2100
      ? `${y}-${String(m).padStart(2, '0')}`
      : null;
  let match = /^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/.exec(raw);
  if (match) return valid(+match[1], +match[2]);
  match = /^(?:\d{1,2}[-/.])?(\d{1,2})[-/.](\d{4})$/.exec(raw);
  if (match) return valid(+match[2], +match[1]);
  const names = [
    'gen',
    'feb',
    'mar',
    'apr',
    'mag',
    'giu',
    'lug',
    'ago',
    'set',
    'ott',
    'nov',
    'dic',
  ];
  match = /^([a-z]+)\.?\s+(\d{4})$/.exec(raw);
  if (match) {
    const index = names.findIndex((n) => match?.[1].startsWith(n));
    return index < 0 ? null : valid(+match[2], index + 1);
  }
  return null;
}

/** The last day of a month (YYYY-MM). */
export function monthEnd(month: string): string {
  return endOfMonthAfter(`${month}-01`, 0);
}

/** The cylinders and months of a CNG cylinder label, from its template fields. */
export function readCngLabel(f: Fields): CngReading {
  const cylinders: CngCylinderDto[] = [];
  for (let i = 1; i <= CNG_MAX_CYLINDERS; i++) {
    const cylinder: CngCylinderDto = {
      litres: numberOf(f[`cylinder_${i}_litres`]),
      make: text(f[`cylinder_${i}_make`]),
      serialNumber: text(f[`cylinder_${i}_serial`]),
      dueMonth: monthOf(f[`cylinder_${i}_due_month`]),
    };
    if (Object.values(cylinder).some((v) => v !== null))
      cylinders.push(cylinder);
  }
  const option = <T extends string>(
    key: string,
    options: readonly T[],
  ): T | null => {
    const raw = text(f[key])
      ?.toLowerCase()
      .replace(/[\s-]+/g, '');
    return options.find((o) => o.toLowerCase() === raw) ?? null;
  };
  const printedDue = [
    monthOf(f['next_due_month']),
    ...cylinders.map((c) => c.dueMonth),
  ].filter((m): m is string => m !== null);
  const dueMonth = printedDue.sort()[0] ?? null;
  const appliedMonth = monthOf(f['applied_month']);
  const approvalText = text(f['approval'])
    ?.toLowerCase()
    .replace(/[\s.-]+/g, '');
  const approval: CngApproval | null = !approvalText
    ? null
    : /r110|cng[1-4]/.test(approvalText)
      ? 'r110'
      : /national|nazional|dgm/.test(approvalText)
        ? 'national'
        : null;
  const litres = cylinders
    .map((c) => c.litres)
    .filter((l): l is number => l !== null);
  return {
    appliedMonth,
    approval,
    cylinderType: option('cylinder_type', CNG_CYLINDER_TYPES),
    cylinders,
    totalLitres:
      numberOf(f['total_litres']) ??
      (litres.length
        ? Math.round(litres.reduce((a, b) => a + b, 0) * 10) / 10
        : null),
    dueMonth,
    dueDate: dueMonth
      ? monthEnd(dueMonth)
      : appliedMonth
        ? endOfMonthAfter(
            `${appliedMonth}-01`,
            CNG_INTERVAL_MONTHS[approval ?? 'r110'],
          )
        : null,
    duePrinted: dueMonth !== null,
    endOfLifeMonth: monthOf(f['end_of_life_month']),
    manufactureMonth: monthOf(f['manufacture_month']),
  };
}

/** "Furto, incendio; Cristalli" → ['Furto', 'incendio', 'Cristalli']: one cover each. */
export function coverList(value: string | null): string[] | null {
  if (!value) return null;
  const list = value
    .split(/[,;\n|]+|\s+\+\s+/)
    .map((c) => c.trim().replace(/\.$/, ''))
    .filter((c) => c.length > 1);
  return list.length ? list : null;
}

/**
 * What an insurance document is: as read (`document_kind`), else guessed
 * from its title or file name (Polizza, Certificato, Ricevuta...).
 */
export function roleOf(
  printed: string | number | boolean | null | undefined,
  ...names: (string | null | undefined)[]
): CarDocumentRole | null {
  const read = text(printed)?.toLowerCase();
  if (
    read === 'policy' ||
    read === 'certificate' ||
    read === 'receipt' ||
    read === 'other'
  )
    return read;
  const name = names.filter(Boolean).join(' ').toLowerCase();
  if (/ricevut|quietanz|receipt/.test(name)) return 'receipt';
  if (/certificat|carta verde|green card/.test(name)) return 'certificate';
  if (/polizz|policy|contratto/.test(name)) return 'policy';
  return null;
}

/**
 * The deadline of a road tax receipt: it covers through `expiryMonth`, and the
 * next payment is due by the last day of the month after it.
 */
export function roadTaxDeadline(expiryMonth: string | null): string | null {
  if (!expiryMonth || !/^\d{4}-(0[1-9]|1[0-2])$/.test(expiryMonth)) return null;
  return endOfMonthAfter(`${expiryMonth}-01`, 1);
}

/**
 * When the next revisione is due after one: printed, else by its outcome:
 * passed, within the month two years later; to repeat, within a month;
 * suspended, at once.
 */
export function nextInspectionDue(
  inspectionDate: string | null,
  outcome: InspectionOutcome | null,
  printedNext: string | null,
): string | null {
  if (printedNext) return printedNext;
  if (!inspectionDate) return null;
  if (outcome === 'repeat') return addMonths(inspectionDate, 1);
  if (outcome === 'suspended') return inspectionDate;
  return endOfMonthAfter(inspectionDate, INSPECTION_INTERVAL_MONTHS);
}

const money = (n: number) => euroText(n);
const moneyOrNull = (n: number | null) => (n === null ? null : money(n));

/** "REGIONE VENETO", "veneto" → "Veneto": the Regione as one name. */
export function regionName(value: string | null): string | null {
  const name = value
    ?.replace(/^\s*regione\s+/i, '')
    .trim()
    .toLowerCase()
    .replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase());
  return name || null;
}

/** What a revisione printed, as its outcome: passed, repeat or suspended (or the Italian words). */
export function inspectionOutcome(
  value: string | null,
): InspectionOutcome | null {
  const raw = value?.toLowerCase().trim() ?? '';
  if (/^(passed|regolare|superata|esito positivo)/.test(raw)) return 'passed';
  if (/^(repeat|ripetere|da ripetere)/.test(raw)) return 'repeat';
  if (/^(suspended|sospes)/.test(raw)) return 'suspended';
  return null;
}

const INSPECTION_OUTCOME_TEXT: Record<InspectionOutcome, string> = {
  passed: 'Passed (regolare)',
  repeat: 'To repeat (ripetere)',
  suspended: 'Suspended (sospeso)',
};

/**
 * What a car document prints, from its template fields; `names` (its title
 * and file name) tell what an insurance document is when it was not read.
 */
export function readCarDocument(
  type: CarDocumentType | null,
  fields: Fields | null,
  names: readonly (string | null)[] = [],
): CarDocumentReading {
  const f = fields ?? {};
  const values: Partial<Record<VehicleField, string | number>> = {};
  const fieldsRead: readonly VehicleField[] =
    type === 'VEHICLE_REGISTRATION'
      ? VEHICLE_FIELDS
      : ['registrationNumber', 'vin', 'make', 'commercialName'];
  for (const field of fieldsRead) {
    const value = vehicleValueOf(field, f[DEFINITION.get(field)?.key ?? '']);
    if (value !== null) values[field] = value;
  }
  const str = (key: string) => text(f[key]);
  const date = (key: string) => dateOf(f[key]);
  const num = (key: string) => numberOf(f[key]);
  const amount = num('total_amount');
  const facts: CarDocumentFactDto[] = [];
  const fact = (label: string, value: string | number | null) => {
    if (value !== null && value !== '')
      facts.push({ label, value: String(value) });
  };

  const reading: CarDocumentReading = {
    type,
    values,
    registrationNumber: (values.registrationNumber as string) ?? null,
    vin: (values.vin as string) ?? null,
    make: (values.make as string) ?? null,
    commercialName: (values.commercialName as string) ?? null,
    number: null,
    issuer: null,
    validFrom: null,
    validUntil: null,
    costDate: null,
    amount: null,
    odometerKm: null,
    litres: null,
    expenseKind: null,
    outcome: null,
    exempt: false,
    nextInstallmentDate: null,
    nextServiceDate: null,
    nextServiceKm: null,
    paymentDate: date('payment_date'),
    role: null,
    cuClass: null,
    coverages: null,
    fine: null,
    cng: null,
    facts,
  };

  switch (type) {
    case 'VEHICLE_REGISTRATION': {
      reading.number = str(REGISTRATION_CERTIFICATE_KEYS.documentNumber);
      reading.validFrom =
        date(REGISTRATION_CERTIFICATE_KEYS.issueDate) ??
        ((values.registrationDate as string) || null);
      reading.validUntil = (values.registrationValidUntil as string) ?? null;
      fact('Document number', reading.number);
      fact('Issued', reading.validFrom);
      break;
    }
    case 'CAR_INSURANCE': {
      reading.number = str('policy_number');
      reading.issuer = str('insurer');
      reading.validFrom = date('start_date');
      reading.validUntil = date('end_date');
      reading.nextInstallmentDate = date('next_installment_date');
      reading.role = roleOf(f['document_kind'], ...names);
      reading.amount = amount;
      reading.costDate = date('payment_date') ?? reading.validFrom;
      reading.cuClass = num('cu_class');
      reading.coverages = coverList(str('coverages'));
      fact('Insurer', reading.issuer);
      fact('Policy', reading.number);
      fact('From', reading.validFrom);
      fact('Until', reading.validUntil);
      fact('Next instalment', reading.nextInstallmentDate);
      fact('Cover', str('coverages'));
      fact('Bonus-malus class', num('cu_class'));
      fact('Premium', amount === null ? null : money(amount));
      break;
    }
    case 'ROAD_TAX': {
      // "APR 2020", "04/2020" or 2020-04: the last month it covers.
      const expiryMonth = monthOf(f['expiry_month']);
      const months = num('validity_months');
      const penalty = num('penalty_amount');
      const interest = num('interest_amount');
      reading.number = str('receipt_number');
      reading.issuer = regionName(str('region'));
      reading.exempt = f['exempt'] === true;
      reading.validUntil = roadTaxDeadline(expiryMonth);
      reading.validFrom =
        expiryMonth && reading.validUntil
          ? addMonths(`${expiryMonth}-01`, -((months ?? 12) - 1))
          : null;
      reading.amount = amount;
      reading.costDate = date('payment_date') ?? reading.validFrom;
      fact(
        'Covers',
        reading.validFrom && expiryMonth
          ? `${reading.validFrom.slice(0, 7)} – ${expiryMonth}`
          : expiryMonth,
      );
      fact('Next one due by', reading.validUntil);
      fact('Region', reading.issuer);
      fact('Paid on', date('payment_date'));
      fact('Amount', amount === null ? null : money(amount));
      fact('Tax', moneyOrNull(num('tax_amount')));
      // Only when paid late: a penalty or interest says so.
      if ((penalty ?? 0) > 0 || (interest ?? 0) > 0) {
        fact('Penalty', moneyOrNull(penalty));
        fact('Interest', moneyOrNull(interest));
      }
      fact('Fee', moneyOrNull(num('fee_amount')));
      fact('Power', num('power_kw') === null ? null : `${num('power_kw')} kW`);
      const reduction = num('reduction_percent');
      if (reduction) fact('Reduction', `${reduction}%`);
      fact('Paid by', str('payer_tax_code'));
      fact('Paid at', str('payment_channel'));
      fact('Receipt', reading.number);
      if (reading.exempt) fact('Exempt', 'yes');
      break;
    }
    case 'VEHICLE_INSPECTION': {
      reading.outcome = inspectionOutcome(str('outcome'));
      reading.number = str('report_number');
      reading.issuer = str('inspection_centre');
      reading.validFrom = date('inspection_date');
      reading.validUntil = nextInspectionDue(
        reading.validFrom,
        reading.outcome,
        date('next_due_date'),
      );
      reading.odometerKm = num('odometer_km');
      reading.amount = amount;
      reading.costDate = reading.validFrom;
      fact('Date', reading.validFrom);
      fact(
        'Outcome',
        reading.outcome === null
          ? null
          : INSPECTION_OUTCOME_TEXT[reading.outcome],
      );
      fact('Next one by', reading.validUntil);
      fact('Km', reading.odometerKm);
      fact('Centre', reading.issuer);
      fact('Deficiencies', str('deficiencies'));
      fact('Category', str('vehicle_category'));
      fact('Inspector', str('inspector'));
      fact('Certificate', reading.number);
      fact('Amount', amount === null ? null : money(amount));
      break;
    }
    case 'CNG_CYLINDER_INSPECTION': {
      const cng = readCngLabel(f);
      reading.cng = cng;
      reading.number = str('label_number');
      reading.issuer = str('workshop');
      reading.validFrom = cng.appliedMonth ? `${cng.appliedMonth}-01` : null;
      reading.validUntil = cng.dueDate;
      reading.amount = amount;
      reading.costDate = reading.paymentDate ?? reading.validFrom;
      fact('Requalified', cng.appliedMonth);
      fact('Next one by', cng.dueDate);
      fact('Label', reading.number);
      fact('Workshop', reading.issuer);
      fact(
        'Approval',
        cng.approval === 'r110'
          ? 'UNECE R110'
          : cng.approval === 'national'
            ? 'National (DGM)'
            : null,
      );
      fact('Cylinders', cng.cylinders.length || null);
      fact('Total litres', cng.totalLitres);
      fact('Amount', amount === null ? null : money(amount));
      break;
    }
    case 'VEHICLE_EXPENSE': {
      const kind = str('expense_kind')?.toLowerCase() ?? null;
      reading.expenseKind =
        (
          [
            'fuel',
            'ev_charging',
            'scheduled_service',
            'repair',
            'tyres',
            'body_work',
            'car_wash',
            'toll',
            'parking',
            'accessories',
            'fine',
            'other',
          ] as const
        ).find((k) => k === kind) ?? 'other';
      reading.number = str('document_number');
      reading.issuer = str('supplier');
      reading.validFrom = date('expense_date');
      reading.costDate = reading.validFrom;
      reading.odometerKm = num('odometer_km');
      reading.litres = num('litres');
      reading.nextServiceDate = date('next_service_date');
      reading.nextServiceKm = num('next_service_km');
      reading.validUntil = reading.nextServiceDate;
      reading.amount = amount;
      if (reading.expenseKind === 'fine') {
        reading.fine = {
          violationDate: date('violation_date'),
          notificationDate: date('notification_date'),
          article: str('violation_article'),
          points: num('licence_points'),
          reducedAmount: num('reduced_amount'),
        };
        reading.validFrom = reading.fine.violationDate ?? reading.validFrom;
        reading.costDate = reading.paymentDate ?? reading.validFrom;
      }
      fact('Kind', reading.expenseKind);
      fact('Supplier', reading.issuer);
      fact('Date', reading.validFrom);
      fact('Km', reading.odometerKm);
      fact('Litres', reading.litres);
      fact('Next service by', reading.nextServiceDate);
      fact('Next service at km', reading.nextServiceKm);
      if (reading.fine) {
        fact('Violation', reading.fine.violationDate);
        fact('Notified', reading.fine.notificationDate);
        fact('Rule', reading.fine.article);
        fact('Licence points', reading.fine.points);
        fact(
          'Within 5 days',
          reading.fine.reducedAmount === null
            ? null
            : money(reading.fine.reducedAmount),
        );
      }
      fact('Amount', amount === null ? null : money(amount));
      break;
    }
    default:
      reading.amount = amount;
  }
  return reading;
}

export interface KnownVehicle {
  id: string;
  values: Partial<Record<VehicleField, VehicleValue>>;
}

/**
 * Which car a document is about: the one with its VIN, else the one with its
 * plate. A different printed VIN is another car, whatever the plate. No
 * match: a new car (or, with neither plate nor VIN, one you pick).
 */
export function matchVehicle(
  printed: { registrationNumber: string | null; vin: string | null },
  vehicles: readonly KnownVehicle[],
): { vehicle: KnownVehicle | null; match: VehicleMatch } {
  const vin = normalizeCode(printed.vin);
  if (vin) {
    const byVin = vehicles.find(
      (v) => normalizeCode((v.values.vin as string) ?? null) === vin,
    );
    if (byVin) return { vehicle: byVin, match: 'vin' };
  }
  const plate = normalizeCode(printed.registrationNumber);
  if (plate) {
    const byPlate = vehicles.filter((v) => {
      const own = normalizeCode((v.values.vin as string) ?? null);
      return (
        normalizeCode((v.values.registrationNumber as string) ?? null) ===
          plate && !(vin && own && own !== vin)
      );
    });
    if (byPlate.length === 1)
      return { vehicle: byPlate[0], match: 'registration_number' };
  }
  return { vehicle: null, match: 'none' };
}

/**
 * What the document would change on the car, field by field, with a
 * suggestion: take a new value; for a different one, check it if it never
 * changes on a car (plate, VIN, make, type, first registration), else take it
 * (a transfer changes the holder, a conversion to LPG the fuel). An outdated
 * certificate suggests keeping your data.
 */
export function proposeVehicleChanges(
  printed: Partial<Record<VehicleField, string | number>>,
  vehicle: Partial<Record<VehicleField, VehicleValue>> | null,
  outdated: boolean,
): VehicleChangeDto[] {
  const changes: VehicleChangeDto[] = [];
  for (const field of VEHICLE_FIELDS) {
    const proposed = printed[field];
    if (proposed === undefined) continue;
    const current = vehicle?.[field] ?? null;
    const code = DEFINITION.get(field)?.code ?? null;
    if (current === null) {
      changes.push({
        field,
        code,
        kind: 'new_value',
        current: null,
        proposed,
        suggestion: vehicle && outdated ? 'keep_current' : 'accept',
      });
      continue;
    }
    if (normalizeValue(field, current) === normalizeValue(field, proposed))
      continue;
    const suggestion: VehicleChangeSuggestion = STABLE_VEHICLE_FIELDS.includes(
      field,
    )
      ? 'check'
      : outdated
        ? 'keep_current'
        : 'accept';
    changes.push({
      field,
      code,
      kind: 'different_value',
      current,
      proposed,
      suggestion,
    });
  }
  return changes;
}

/** Every value of the card, with null for the ones not known yet. */
export function completeValues(
  values: Partial<Record<VehicleField, VehicleValue>>,
): VehicleValues {
  return Object.fromEntries(
    VEHICLE_FIELDS.map((field) => [field, values[field] ?? null]),
  ) as VehicleValues;
}

export interface ApprovedCarDocument {
  uploadId: string;
  type: CarDocumentType | null;
  reading: CarDocumentReading;
  uploadedAt: string;
  /** Cancelled, as you marked it. */
  markedStatus: CarDocumentStatus | null;
  /** The record you put it in by hand; null: the one its number says. */
  groupKey?: string | null;
}

/**
 * Several documents that are one thing: the policy, certificate and receipt
 * of one insurance. It reads as one document (`reading` merged from all of
 * them, main one first) with its `members`.
 */
export interface CarDocumentGroup<
  T extends ApprovedCarDocument,
> extends ApprovedCarDocument {
  key: string;
  members: T[];
}

export interface CarVersion<T extends ApprovedCarDocument> {
  document: CarDocumentGroup<T>;
  version: number;
  status: CarDocumentStatus;
}

/** The record a document's number puts it in: same number, same record. */
export function numberKey(number: string | null): string | null {
  const code = normalizeCode(number);
  return code ? `number:${code}` : null;
}

/** The record a document is in: yours by hand, else by its number, else its own. */
export function groupKeyOf(d: ApprovedCarDocument): string {
  return (
    d.groupKey ??
    (d.type === 'VEHICLE_EXPENSE' ? null : numberKey(d.reading.number)) ??
    `own:${d.uploadId}`
  );
}

/**
 * Two dates that are the same day of cover: the green card prints the last
 * day covered (09/04), the policy the day it ends at 00:00 (10/04).
 */
function sameDay(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && Math.abs(daysUntil(a, b)) <= 1;
}

/** The record of a period of cover, as kept for a document put in it by hand. */
export function periodKey(from: string | null, until: string | null) {
  return from ? `period:${from}` : until ? `period:~${until}` : null;
}

interface CoverPeriod {
  key: string;
  from: string | null;
  until: string | null;
  numbers: Set<string>;
}

/**
 * The records of one car's insurance documents, by uploadId. One car has one
 * policy at a time, so its period of cover is what makes a record: the same
 * start or end (within a day), whatever number each file prints. A renewal
 * that keeps the policy number is a new record; a receipt that prints its own
 * number joins the policy. A document without dates (an instalment receipt)
 * joins by its number the record whose period it falls in, else the newest.
 * Yours by hand wins.
 */
function insuranceKeys(
  documents: readonly ApprovedCarDocument[],
): Map<string, string> {
  const keys = new Map<string, string>();
  const periods: CoverPeriod[] = [];
  const periodOf = (from: string | null, until: string | null) => {
    if (!from && !until) return undefined;
    const found = periods.find(
      (p) =>
        (sameDay(from, p.from) || sameDay(until, p.until)) &&
        !(from && p.from && !sameDay(from, p.from)) &&
        !(until && p.until && !sameDay(until, p.until)),
    );
    if (found) {
      found.from ??= from;
      found.until ??= until;
      return found;
    }
    const added: CoverPeriod = {
      key: periodKey(from, until) as string,
      from,
      until,
      numbers: new Set(),
    };
    periods.push(added);
    return added;
  };
  const byUpload = [...documents].sort((a, b) =>
    a.uploadedAt.localeCompare(b.uploadedAt),
  );
  const byNumber: ApprovedCarDocument[] = [];
  for (const d of byUpload) {
    const hand = d.groupKey ?? null;
    if (hand?.startsWith('own:')) {
      keys.set(d.uploadId, hand);
      continue;
    }
    if (hand?.startsWith('period:')) {
      const printed = hand.slice('period:'.length);
      const period = printed.startsWith('~')
        ? periodOf(null, printed.slice(1))
        : periodOf(printed, null);
      if (period) {
        const number = numberKey(d.reading.number);
        if (number) period.numbers.add(number);
        keys.set(d.uploadId, period.key);
        continue;
      }
    }
    const period = hand
      ? undefined
      : periodOf(d.reading.validFrom, d.reading.validUntil);
    if (!period) {
      byNumber.push(d);
      continue;
    }
    const number = numberKey(d.reading.number);
    if (number) period.numbers.add(number);
    keys.set(d.uploadId, period.key);
  }
  for (const d of byNumber) {
    const number = d.groupKey?.startsWith('number:')
      ? d.groupKey
      : numberKey(d.reading.number);
    const candidates = number
      ? periods.filter((p) => p.numbers.has(number))
      : [];
    const day =
      d.reading.validFrom ??
      d.reading.paymentDate ??
      d.reading.costDate ??
      d.reading.validUntil;
    const covering =
      day &&
      candidates.find(
        (p) =>
          (p.from === null || addDays(p.from, -1) <= day) &&
          (p.until === null || day < p.until),
      );
    const newest = [...candidates].sort((a, b) =>
      (b.from ?? b.until ?? '').localeCompare(a.from ?? a.until ?? ''),
    )[0];
    keys.set(
      d.uploadId,
      (covering || newest)?.key ?? number ?? `own:${d.uploadId}`,
    );
  }
  return keys;
}

/**
 * The records of one car's documents of a type that is not insurance or an
 * expense, by uploadId, for the ones that print no number: a scan that missed
 * it (the back of the libretto, a blurred photo) is the same document as the
 * one of that type issued the same day, so it joins that one's record. Two
 * without a number issued the same day are one record too. When more than
 * one record was issued that day, it stays on its own. Yours by hand wins.
 */
function issuedKeys(
  documents: readonly ApprovedCarDocument[],
): Map<string, string> {
  const keys = new Map<string, string>();
  const numbersOn = new Map<string, Set<string>>();
  for (const d of documents) {
    const number = numberKey(d.reading.number);
    const day = d.reading.validFrom;
    if (!number || !day) continue;
    const key = d.groupKey ?? number;
    numbersOn.set(day, (numbersOn.get(day) ?? new Set()).add(key));
  }
  for (const d of documents) {
    const day = d.reading.validFrom;
    if (d.groupKey || numberKey(d.reading.number) || !day) continue;
    const records = [...(numbersOn.get(day) ?? [])];
    keys.set(
      d.uploadId,
      records.length === 1
        ? records[0]
        : records.length === 0
          ? issuedKey(day)
          : `own:${d.uploadId}`,
    );
  }
  return keys;
}

/** The record of the documents without a number issued on a day. */
export function issuedKey(day: string): string {
  return `issued:${day}`;
}

/** The main document comes first: the policy, then the others, then the receipt. */
const ROLE_ORDER: (CarDocumentRole | null)[] = [
  'policy',
  null,
  'other',
  'certificate',
  'receipt',
];

function mergeReadings(members: readonly ApprovedCarDocument[]) {
  const [main] = members;
  const reading: CarDocumentReading = { ...main.reading, facts: [] };
  const keys = Object.keys(reading) as (keyof CarDocumentReading)[];
  for (const key of keys) {
    if (key === 'facts' || key === 'values' || key === 'exempt') continue;
    const found = members.find(
      (m) => m.reading[key] !== null && m.reading[key] !== undefined,
    );
    if (found)
      (reading as unknown as Record<string, unknown>)[key] = found.reading[key];
  }
  reading.values = Object.assign(
    {},
    ...[...members].reverse().map((m) => m.reading.values),
  );
  reading.exempt = members.some((m) => m.reading.exempt);
  const seen = new Set<string>();
  for (const m of members)
    for (const f of m.reading.facts)
      if (!seen.has(f.label)) {
        seen.add(f.label);
        reading.facts.push(f);
      }
  return reading;
}

/**
 * Documents in records: same type and same number (a policy, its certificate
 * and its receipt), insurance by its period of cover (insuranceKeys), one
 * without a number by the day it was issued (issuedKeys), or the record you
 * put them in. Expenses stay one each, unless you put them together.
 */
export function groupDocuments<T extends ApprovedCarDocument>(
  documents: readonly T[],
): CarDocumentGroup<T>[] {
  const known = new Map<string, string>();
  for (const type of new Set(documents.map((d) => d.type))) {
    if (type === null || type === 'VEHICLE_EXPENSE') continue;
    const ofType = documents.filter((d) => d.type === type);
    const keys =
      type === 'CAR_INSURANCE' ? insuranceKeys(ofType) : issuedKeys(ofType);
    for (const [uploadId, key] of keys) known.set(uploadId, key);
  }
  const groups = new Map<string, T[]>();
  for (const d of documents) {
    const key = `${d.type ?? ''}|${known.get(d.uploadId) ?? groupKeyOf(d)}`;
    const list = groups.get(key) ?? [];
    list.push(d);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([key, list]) => {
    const members = [...list].sort(
      (a, b) =>
        ROLE_ORDER.indexOf(a.reading.role) -
          ROLE_ORDER.indexOf(b.reading.role) ||
        a.uploadedAt.localeCompare(b.uploadedAt),
    );
    const [main] = members;
    return {
      key,
      members,
      uploadId: main.uploadId,
      type: main.type,
      reading: members.length === 1 ? main.reading : mergeReadings(members),
      uploadedAt: members.map((m) => m.uploadedAt).sort()[0],
      markedStatus: members.some((m) => m.markedStatus === 'cancelled')
        ? 'cancelled'
        : main.markedStatus,
      groupKey: main.groupKey ?? null,
    };
  });
}

/** The record key of a document among others of its car, as `group` keeps it. */
export function recordKeyOf(
  documents: readonly ApprovedCarDocument[],
  uploadId: string,
): string | null {
  const group = groupDocuments(documents).find((g) =>
    g.members.some((m) => m.uploadId === uploadId),
  );
  return group ? group.key.slice(group.key.indexOf('|') + 1) : null;
}

/** The order of versions: by when they start to count, else by upload. */
function versionKey(d: ApprovedCarDocument): string {
  return `${d.reading.validFrom ?? d.reading.validUntil ?? ''}|${d.uploadedAt}`;
}

/**
 * One car's approved documents as series, one per renewable type (expenses
 * have none), each numbered from the oldest, newest first. The newest is
 * current, or expired once past the date it has to be renewed by; the older
 * ones are superseded. Your mark (cancelled) wins.
 */
export function buildSeries<T extends ApprovedCarDocument>(
  documents: readonly T[],
  today: string,
): { type: CarDocumentType | null; versions: CarVersion<T>[] }[] {
  const byType = new Map<CarDocumentType | null, CarDocumentGroup<T>[]>();
  for (const d of groupDocuments(documents)) {
    if (d.type === 'VEHICLE_EXPENSE') continue;
    const list = byType.get(d.type) ?? [];
    list.push(d);
    byType.set(d.type, list);
  }
  const order = [...CAR_DOCUMENT_TYPES, null];
  return [...byType.entries()]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([type, list]) => {
      const sorted = [...list].sort((a, b) =>
        versionKey(a).localeCompare(versionKey(b)),
      );
      const versions = sorted.map((document, index) => {
        const latest = index === sorted.length - 1;
        const until = document.reading.validUntil;
        const status: CarDocumentStatus =
          document.markedStatus ??
          (!latest
            ? 'superseded'
            : until && until < today && !document.reading.exempt
              ? 'expired'
              : 'current');
        return { document, version: index + 1, status };
      });
      return { type, versions: versions.reverse() };
    });
}

export function levelOf(
  kind: RenewableKind,
  dueDate: string,
  today: string,
  windows: Readonly<Record<RenewableKind, number>>,
): { level: RenewalLevel; daysLeft: number; graceUntil: string | null } {
  const daysLeft = daysUntil(dueDate, today);
  const graceUntil =
    kind === 'insurance' ? addDays(dueDate, INSURANCE_GRACE_DAYS) : null;
  if (daysLeft < 0) {
    if (graceUntil && graceUntil >= today)
      return { level: 'grace', daysLeft, graceUntil };
    return { level: 'expired', daysLeft, graceUntil };
  }
  return {
    level: daysLeft <= windows[kind] ? 'expiring' : 'ok',
    daysLeft,
    graceUntil,
  };
}

/** The latest version of a type that still counts (not cancelled). */
function latestOf<T extends ApprovedCarDocument>(
  series: readonly {
    type: CarDocumentType | null;
    versions: CarVersion<T>[];
  }[],
  type: CarDocumentType,
): CarDocumentGroup<T> | null {
  const latest = series.find((s) => s.type === type)?.versions[0];
  return latest && latest.status !== 'cancelled' ? latest.document : null;
}

/**
 * Where every renewable item of a car stands today: insurance (with its 15
 * days of cover after expiry), road tax (due by the end of the month after
 * it expires), revisione (printed, else 2 years after the last one, else 4
 * years after first registration), service (only when an invoice prints it)
 * and a temporary registration (H). A car with no insurance or road tax on
 * file says so, and so does one whose first revisione is past with none on
 * file.
 */
export function renewalsOf<T extends ApprovedCarDocument>(
  values: Partial<Record<VehicleField, VehicleValue>>,
  series: readonly {
    type: CarDocumentType | null;
    versions: CarVersion<T>[];
  }[],
  expenses: readonly T[],
  today: string,
  odometer: OdometerTrend = NO_TREND,
  /** Days before a renewal its warning starts, per kind (Settings → Reminders). */
  windows: Readonly<Record<RenewableKind, number>> = RENEWAL_WARNING_DAYS,
): RenewalDto[] {
  const renewals: RenewalDto[] = [];
  const push = (
    kind: RenewableKind,
    dueDate: string | null,
    uploadId: string | null,
    basis: string,
    extra: Partial<RenewalDto> = {},
  ) => {
    if (!dueDate) {
      renewals.push({
        kind,
        subject: null,
        level: 'missing',
        dueDate: null,
        daysLeft: null,
        graceUntil: null,
        uploadId,
        basis,
        dueOdometerKm: null,
        ...extra,
      });
      return;
    }
    renewals.push({
      kind,
      subject: null,
      ...levelOf(kind, dueDate, today, windows),
      dueDate,
      uploadId,
      basis,
      dueOdometerKm: null,
      ...extra,
    });
  };

  const insurance = latestOf(series, 'CAR_INSURANCE');
  if (!insurance) push('insurance', null, null, 'No insurance on file');
  else {
    const { validUntil, nextInstallmentDate } = insurance.reading;
    const installment =
      nextInstallmentDate && (!validUntil || nextInstallmentDate < validUntil);
    push(
      'insurance',
      installment ? nextInstallmentDate : validUntil,
      insurance.uploadId,
      installment ? 'Next instalment of the premium' : 'End of the policy',
    );
  }

  const roadTax = latestOf(series, 'ROAD_TAX');
  if (!roadTax) push('road_tax', null, null, 'No road tax receipt on file');
  else if (roadTax.reading.exempt)
    renewals.push({
      kind: 'road_tax',
      subject: null,
      level: 'ok',
      dueDate: null,
      daysLeft: null,
      graceUntil: null,
      uploadId: roadTax.uploadId,
      basis: 'Exempt',
      dueOdometerKm: null,
    });
  else
    push(
      'road_tax',
      roadTax.reading.validUntil,
      roadTax.uploadId,
      'Last day of the month after the one it covers through',
    );

  const inspection = latestOf(series, 'VEHICLE_INSPECTION');
  if (inspection)
    push(
      'inspection',
      inspection.reading.validUntil,
      inspection.uploadId,
      inspection.reading.outcome === 'repeat'
        ? 'To repeat within a month'
        : inspection.reading.outcome === 'suspended'
          ? 'Suspended: the car cannot be driven until it passes'
          : 'Two years after the last revisione',
    );
  else {
    const first = values.firstRegistrationDate;
    if (typeof first === 'string') {
      const due = endOfMonthAfter(first, FIRST_INSPECTION_MONTHS);
      if (due < today)
        push(
          'inspection',
          null,
          null,
          `No revisione on file: the first one was due by ${due}`,
        );
      else push('inspection', due, null, 'Four years after first registration');
    }
  }

  const service = [...expenses]
    .filter((e) => e.reading.nextServiceDate || e.reading.nextServiceKm)
    .sort((a, b) =>
      (a.reading.validFrom ?? '').localeCompare(b.reading.validFrom ?? ''),
    )
    .at(-1);
  if (service) {
    const { nextServiceDate, nextServiceKm } = service.reading;
    const byKm =
      nextServiceKm !== null ? dateAtKm(nextServiceKm, odometer) : null;
    const reached =
      nextServiceKm !== null &&
      odometer.estimatedKm !== null &&
      odometer.estimatedKm >= nextServiceKm;
    if (nextServiceDate && (!byKm || nextServiceDate <= byKm))
      push(
        'service',
        nextServiceDate,
        service.uploadId,
        'Printed on the last service',
        {
          dueOdometerKm: nextServiceKm,
        },
      );
    else if (byKm)
      push(
        'service',
        byKm,
        service.uploadId,
        `Estimated: the car does about ${Math.round(odometer.kmPerYear ?? 0).toLocaleString('it-IT')} km a year`,
        { dueOdometerKm: nextServiceKm },
      );
    else if (nextServiceKm !== null)
      renewals.push({
        kind: 'service',
        subject: null,
        level: reached ? 'expired' : 'ok',
        dueDate: null,
        daysLeft: null,
        graceUntil: null,
        uploadId: service.uploadId,
        basis: reached
          ? 'The car has passed the km of the next service'
          : 'Printed on the last service: the date shows once two km readings are a month apart',
        dueOdometerKm: nextServiceKm,
      });
  }

  const until = values.registrationValidUntil;
  if (typeof until === 'string')
    push(
      'registration',
      until,
      null,
      'Field H of the registration certificate',
    );
  return renewals;
}

/** How far the car goes: what the service estimate by km needs. */
export interface OdometerTrend {
  kmPerYear: number | null;
  last: { date: string; km: number } | null;
  estimatedKm: number | null;
}

export const NO_TREND: OdometerTrend = {
  kmPerYear: null,
  last: null,
  estimatedKm: null,
};

/** The day the car reaches `km` at its pace, or null when its pace is unknown. */
export function dateAtKm(km: number, trend: OdometerTrend): string | null {
  if (!trend.kmPerYear || trend.kmPerYear <= 0 || !trend.last) return null;
  const days = Math.round(((km - trend.last.km) / trend.kmPerYear) * 365);
  return addDays(trend.last.date, days);
}

/**
 * What each payment cost, newest first. A record counts each payment once:
 * its receipts when it has any, else every distinct payment its documents
 * print (date and amount), else the amount of its main document. So the
 * policy and the receipt of one premium are one cost, and two receipts of a
 * split premium are two.
 */
export function costsOf<T extends ApprovedCarDocument & { title: string }>(
  documents: readonly T[],
): CarCostDto[] {
  const kindOf = (d: ApprovedCarDocument): CostKind | null => {
    switch (d.type) {
      case 'CAR_INSURANCE':
        return 'insurance';
      case 'ROAD_TAX':
        return 'road_tax';
      case 'VEHICLE_INSPECTION':
        return 'inspection';
      case 'CNG_CYLINDER_INSPECTION':
        return 'cng_cylinders';
      case 'VEHICLE_EXPENSE':
        return d.reading.expenseKind ?? 'other';
      default:
        return null;
    }
  };
  const costOf = (d: T, kind: CostKind): CarCostDto => ({
    uploadId: d.uploadId,
    title: d.title,
    type: d.type,
    kind,
    date: d.reading.costDate,
    amount: d.reading.amount as number,
    supplier: d.reading.issuer,
    odometerKm: d.reading.odometerKm,
    litres: d.reading.litres,
    bankPayment: null,
  });
  return groupDocuments(documents)
    .flatMap((group) => {
      const kind = kindOf(group);
      if (!kind || group.markedStatus === 'cancelled') return [];
      const priced = group.members.filter((m) => m.reading.amount !== null);
      if (priced.length <= 1)
        return priced.map((m) => ({
          ...costOf(m, kind),
          supplier: m.reading.issuer ?? group.reading.issuer,
        }));
      const receipts = priced.filter((m) => m.reading.role === 'receipt');
      const paid = receipts.length
        ? receipts
        : priced.filter((m) => m.reading.paymentDate);
      if (!paid.length) return [costOf(priced[0], kind)];
      const seen = new Set<string>();
      return paid.flatMap((m) => {
        const key = `${m.reading.costDate}|${m.reading.amount}`;
        if (seen.has(key)) return [];
        seen.add(key);
        return [
          {
            ...costOf(m, kind),
            supplier: m.reading.issuer ?? group.reading.issuer,
          },
        ];
      });
    })
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

/** The costs added up per year and kind, newest year first. */
export function costTotals(costs: readonly CarCostDto[]): CarCostTotalDto[] {
  const totals = new Map<string, CarCostTotalDto>();
  for (const cost of costs) {
    if (!cost.date) continue;
    const year = +cost.date.slice(0, 4);
    const key = `${year}|${cost.kind}`;
    const total = totals.get(key) ?? { year, kind: cost.kind, total: 0 };
    total.total = Math.round((total.total + cost.amount) * 100) / 100;
    totals.set(key, total);
  }
  return [...totals.values()].sort(
    (a, b) => b.year - a.year || b.total - a.total,
  );
}

/**
 * A registration certificate is outdated for the car's data when the car
 * already has a newer one.
 */
export function isOutdated(
  reading: CarDocumentReading,
  approved: readonly ApprovedCarDocument[],
): boolean {
  if (reading.type !== 'VEHICLE_REGISTRATION') return false;
  const issued = reading.validFrom;
  if (!issued) return false;
  return approved.some(
    (d) =>
      d.type === 'VEHICLE_REGISTRATION' &&
      d.reading.validFrom !== null &&
      d.reading.validFrom > issued,
  );
}
