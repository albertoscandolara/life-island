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
  facts: CarDocumentFactDto[];
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

const money = (n: number) =>
  n.toLocaleString('en-GB', { style: 'currency', currency: 'EUR' });

export function readCarDocument(
  type: CarDocumentType | null,
  fields: Fields | null,
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
      reading.amount = amount;
      reading.costDate = date('payment_date') ?? reading.validFrom;
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
      const expiryMonth = str('expiry_month');
      const months = num('validity_months');
      reading.number = str('receipt_number');
      reading.issuer = str('region');
      reading.exempt = f['exempt'] === true;
      reading.validUntil = roadTaxDeadline(expiryMonth);
      reading.validFrom =
        expiryMonth && reading.validUntil
          ? addMonths(`${expiryMonth}-01`, -((months ?? 12) - 1))
          : null;
      reading.amount = amount;
      reading.costDate = date('payment_date') ?? reading.validFrom;
      fact('Region', reading.issuer);
      fact('Covers through', expiryMonth);
      fact('Months', months);
      fact('Next one due by', reading.validUntil);
      fact('Paid on', date('payment_date'));
      fact('Amount', amount === null ? null : money(amount));
      if (reading.exempt) fact('Exempt', 'yes');
      break;
    }
    case 'VEHICLE_INSPECTION': {
      const outcome = str('outcome')?.toLowerCase() ?? null;
      reading.outcome =
        (['passed', 'repeat', 'suspended'] as const).find(
          (o) => o === outcome,
        ) ?? null;
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
      fact('Outcome', reading.outcome);
      fact('Km', reading.odometerKm);
      fact('Next one by', reading.validUntil);
      fact('Centre', reading.issuer);
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
      fact('Kind', reading.expenseKind);
      fact('Supplier', reading.issuer);
      fact('Date', reading.validFrom);
      fact('Km', reading.odometerKm);
      fact('Litres', reading.litres);
      fact('Next service by', reading.nextServiceDate);
      fact('Next service at km', reading.nextServiceKm);
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
}

export interface CarVersion<T extends ApprovedCarDocument> {
  document: T;
  version: number;
  status: CarDocumentStatus;
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
  const byType = new Map<CarDocumentType | null, T[]>();
  for (const d of documents) {
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

function levelOf(
  kind: RenewableKind,
  dueDate: string,
  today: string,
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
    level: daysLeft <= RENEWAL_WARNING_DAYS[kind] ? 'expiring' : 'ok',
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
): T | null {
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
      ...levelOf(kind, dueDate, today),
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
  if (service?.reading.nextServiceDate)
    push(
      'service',
      service.reading.nextServiceDate,
      service.uploadId,
      'Printed on the last service',
      {
        dueOdometerKm: service.reading.nextServiceKm,
      },
    );

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

/** What each approved document cost, newest first. */
export function costsOf<T extends ApprovedCarDocument & { title: string }>(
  documents: readonly T[],
): CarCostDto[] {
  const kindOf = (d: T): CostKind | null => {
    switch (d.type) {
      case 'CAR_INSURANCE':
        return 'insurance';
      case 'ROAD_TAX':
        return 'road_tax';
      case 'VEHICLE_INSPECTION':
        return 'inspection';
      case 'VEHICLE_EXPENSE':
        return d.reading.expenseKind ?? 'other';
      default:
        return null;
    }
  };
  return documents
    .flatMap((d) => {
      const kind = kindOf(d);
      if (!kind || d.reading.amount === null || d.markedStatus === 'cancelled')
        return [];
      return [
        {
          uploadId: d.uploadId,
          title: d.title,
          type: d.type,
          kind,
          date: d.reading.costDate,
          amount: d.reading.amount,
          supplier: d.reading.issuer,
          odometerKm: d.reading.odometerKm,
          litres: d.reading.litres,
        },
      ];
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
