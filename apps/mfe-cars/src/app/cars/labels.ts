import {
  CAR_DOCUMENT_TYPE_LABELS,
  INSURANCE_GRACE_DAYS,
  RENEWABLE_LABELS,
  VEHICLE_FIELD_DEFINITIONS,
  VEHICLE_OPTION_LABELS,
  type CarDocumentType,
  type RenewalAlertDto,
  type RenewalDto,
  type VehicleField,
  type VehicleValue,
} from '@life-island/contracts';

const DEFINITION = new Map(VEHICLE_FIELD_DEFINITIONS.map((d) => [d.field, d]));

/** "Insurance", or "Car document" when only the root category is known. */
export function typeLabel(type: CarDocumentType | null): string {
  return type ? CAR_DOCUMENT_TYPE_LABELS[type] : 'Car document';
}

/** "Panda · AB123CD": your name for the car, else make and model, with the plate. */
export function vehicleName(vehicle: {
  label: string | null;
  values: Partial<Record<VehicleField, VehicleValue>>;
}): string {
  const plate = vehicle.values.registrationNumber ?? null;
  const model = [vehicle.values.make, vehicle.values.commercialName]
    .filter(Boolean)
    .join(' ');
  return (
    [vehicle.label || model || null, plate].filter(Boolean).join(' · ') ||
    'Unnamed car'
  );
}

/** A value of the card as you read it: options in words, numbers with their unit. */
export function valueText(field: VehicleField, value: VehicleValue): string {
  if (value === null || value === '') return '';
  const definition = DEFINITION.get(field);
  if (definition?.type === 'enum')
    return VEHICLE_OPTION_LABELS[String(value)] ?? String(value);
  if (definition?.type === 'date') {
    const [y, m, d] = String(value).split('-');
    return d ? `${d}/${m}/${y}` : String(value);
  }
  const unit = definition && 'unit' in definition ? ` ${definition.unit}` : '';
  if (typeof value === 'number') return `${italianNumber(value)}${unit}`;
  return `${value}${unit}`;
}

function days(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`;
}

/** What a renewal is about: its subject (a fine, a tyre set), else its kind. */
export function renewalTitle(renewal: RenewalDto): string {
  return renewal.subject ?? RENEWABLE_LABELS[renewal.kind];
}

/** "is due in 12 days", "expired 3 days ago, still covered for 12 days"... */
export function renewalText(renewal: RenewalDto): string {
  const left = renewal.daysLeft ?? 0;
  if (renewal.dueDate === null && renewal.level !== 'missing')
    return renewal.basis;
  if (renewal.kind === 'fine' || renewal.kind === 'tyres')
    return renewal.level === 'missing'
      ? renewal.basis
      : left < 0
        ? `was due ${left === -1 ? 'yesterday' : `${days(-left)} ago`}`
        : left === 0
          ? 'is due today'
          : `is due in ${days(left)}`;
  switch (renewal.level) {
    case 'missing':
      return 'none on file';
    case 'expired':
      if (renewal.kind === 'inspection' || renewal.kind === 'service')
        return left === -1 ? 'was due yesterday' : `was due ${days(-left)} ago`;
      return left === -1 ? 'expired yesterday' : `expired ${days(-left)} ago`;
    case 'grace':
      return `expired ${days(-left)} ago, still covered for ${days(left + INSURANCE_GRACE_DAYS)}`;
    default: {
      const due = renewal.kind === 'inspection' || renewal.kind === 'service';
      if (left === 0) return due ? 'is due today' : 'expires today';
      return due ? `is due in ${days(left)}` : `expires in ${days(left)}`;
    }
  }
}

/** "Panda · AB123CD: insurance expires in 12 days." */
export function alertText(alert: RenewalAlertDto): string {
  if (alert.subject) {
    const subject = `${alert.subject.charAt(0).toLowerCase()}${alert.subject.slice(1)}`;
    return alert.dueDate
      ? `${alert.vehicleName}: ${subject} ${renewalText(alert)}.`
      : `${alert.vehicleName}: ${subject}.`;
  }
  if (alert.dueDate === null && alert.level !== 'missing')
    return `${alert.vehicleName}: ${RENEWABLE_LABELS[alert.kind].toLowerCase()} · ${alert.basis}.`;
  if (alert.level === 'missing')
    return `${alert.vehicleName}: no ${RENEWABLE_LABELS[alert.kind].toLowerCase()} on file.`;
  return `${alert.vehicleName}: ${RENEWABLE_LABELS[alert.kind].toLowerCase()} ${renewalText(alert)}.`;
}

/** A number as printed on Italian documents, with the thousands always grouped: 1.242 and 119,5. */
export function italianNumber(
  value: number,
  minDigits = 0,
  maxDigits = 2,
): string {
  return value
    .toLocaleString('en-US', {
      minimumFractionDigits: minDigits,
      maximumFractionDigits: maxDigits,
    })
    .replace(/[.,]/g, (mark) => (mark === ',' ? '.' : ','));
}

/** Paint names as a registration certificate or you write them, Italian or English. */
const PAINTS: [RegExp, string][] = [
  [/bianc|white/, '#eef0f2'],
  [/ner|black/, '#24272c'],
  [/argent|silver/, '#b8bec6'],
  [/grigi|grey|gray|antracit/, '#7d848d'],
  [/ross|red|bordeaux/, '#c0392b'],
  [/blu|azzurr|blue/, '#2c5aa0'],
  [/verd|green/, '#3f7d4e'],
  [/giall|yellow/, '#e6b422'],
  [/arancio|orange/, '#e07b2a'],
  [/marron|brown|bronz/, '#7a5236'],
  [/beige|sabbia|champagne/, '#d6c3a0'],
  [/viola|purple/, '#6b4a8b'],
];

/** The car's colour as paint for its drawn 3D car, or null when unknown. */
export function paintColour(value: VehicleValue | undefined): string | null {
  if (typeof value !== 'string') return null;
  const name = value.toLowerCase();
  return PAINTS.find(([words]) => words.test(name))?.[1] ?? null;
}
