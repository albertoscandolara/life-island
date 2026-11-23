import {
  CNG_INTERVAL_MONTHS,
  CNG_MAX_LIFE_YEARS,
  FIRST_INSPECTION_MONTHS,
  RENEWAL_WARNING_DAYS,
  usesCngCylinders,
  type CarCngDto,
  type CarDocumentType,
  type CngInspectionDto,
  type RenewableKind,
  type RenewalDto,
  type VehicleField,
  type VehicleValue,
} from '@life-island/contracts';
import {
  endOfMonthAfter,
  levelOf,
  monthEnd,
  type ApprovedCarDocument,
  type CarVersion,
} from './car-documents.js';

/*
 * The CNG cylinders of a car (docs/guides/life-island-app.md, Cars, "CNG
 * cylinders"): every car whose fuel (P.3) is CNG, or that has a cylinder
 * label on file, has its cylinders requalified by the month the label prints;
 * without one, 4 years (UNECE R110, DM 144/2022 art. 2) or 5 (national DGM)
 * after the last label, and a car with no label at all is first due 4 years
 * after its first registration. Pure, so every rule is unit-tested.
 */

type Series<T extends ApprovedCarDocument> = readonly {
  type: CarDocumentType | null;
  versions: CarVersion<T>[];
}[];

const sameCylinders = (a: CngInspectionDto, b: CngInspectionDto) => {
  const serials = (i: CngInspectionDto) =>
    i.cylinders
      .map((c) => c.serialNumber?.replace(/[^0-9A-Z]/gi, '').toUpperCase())
      .filter(Boolean)
      .sort()
      .join('|');
  return !serials(a) || !serials(b) || serials(a) === serials(b);
};

/** The car's CNG section, or null for a car with no CNG cylinders. */
export function cngOf<T extends ApprovedCarDocument>(
  values: Partial<Record<VehicleField, VehicleValue>>,
  series: Series<T>,
  today: string,
  windows: Readonly<Record<RenewableKind, number>> = RENEWAL_WARNING_DAYS,
): CarCngDto | null {
  const labels = (
    series.find((s) => s.type === 'CNG_CYLINDER_INSPECTION')?.versions ?? []
  ).filter((v) => v.status !== 'cancelled');
  if (!labels.length && !usesCngCylinders(values['engine.fuelKey']))
    return null;

  // Newest first, like the series.
  const history: CngInspectionDto[] = labels.map(({ document }) => ({
    uploadId: document.uploadId,
    month: document.reading.cng?.appliedMonth ?? null,
    workshop: document.reading.issuer,
    labelNumber: document.reading.number,
    cylinders: document.reading.cng?.cylinders ?? [],
    replaced: false,
  }));
  history.forEach((h, i) => {
    const older = history[i + 1];
    h.replaced = !!older && !sameCylinders(h, older);
  });

  const latest = labels[0]?.document.reading.cng ?? null;
  const approval = latest?.approval ?? null;
  const section = (
    dueDate: string | null,
    basis: string,
    endOfLife: string | null = null,
  ): CarCngDto => {
    const level = dueDate
      ? levelOf('cng_cylinders', dueDate, today, windows)
      : { level: 'missing' as const, daysLeft: null };
    return {
      approval,
      cylinderType: latest?.cylinderType ?? null,
      totalLitres: latest?.totalLitres ?? null,
      cylinders: latest?.cylinders ?? [],
      dueDate,
      level: level.level,
      daysLeft: level.daysLeft,
      basis,
      endOfLife,
      history,
    };
  };

  if (!latest) {
    const first = values.firstRegistrationDate;
    if (typeof first !== 'string')
      return section(
        null,
        'No cylinder label on file: load the one the workshop applied on the car (usually in the engine bay).',
      );
    const due = endOfMonthAfter(first, FIRST_INSPECTION_MONTHS);
    if (due < today)
      return section(
        null,
        `No cylinder label on file: R110 cylinders are requalified every 4 years, so one was due by ${due}. Load the label on the car.`,
      );
    return section(
      due,
      'Estimated: 4 years after first registration (R110 cylinders). The label on the car has the real month.',
    );
  }

  const years = CNG_INTERVAL_MONTHS[approval ?? 'r110'] / 12;
  let dueDate = latest.dueDate;
  let basis = latest.duePrinted
    ? 'The month printed on the cylinder label'
    : approval
      ? `${years} years after the last requalification (${approval === 'r110' ? 'UNECE R110' : 'national approval'})`
      : `${years} years after the last requalification (assumed R110: the label does not say)`;
  if (!dueDate)
    basis = 'The label on file prints no date: check the one on the car.';

  // An R110 cylinder's end of life: printed, else 20 years from manufacture.
  const endOfLife = latest.endOfLifeMonth
    ? monthEnd(latest.endOfLifeMonth)
    : latest.manufactureMonth && approval !== 'national'
      ? endOfMonthAfter(
          `${latest.manufactureMonth}-01`,
          CNG_MAX_LIFE_YEARS * 12,
        )
      : null;
  if (endOfLife && (!dueDate || endOfLife < dueDate)) {
    dueDate = endOfLife;
    basis = 'End of life of the cylinders: they have to be replaced';
  }
  return section(dueDate, basis, endOfLife);
}

/** The renewal of the cylinders, beside insurance, bollo and revisione. */
export function cngRenewals(cng: CarCngDto | null): RenewalDto[] {
  if (!cng) return [];
  return [
    {
      kind: 'cng_cylinders',
      subject: null,
      level: cng.level,
      dueDate: cng.dueDate,
      daysLeft: cng.dueDate ? cng.daysLeft : null,
      graceUntil: null,
      uploadId: cng.history[0]?.uploadId ?? null,
      basis: cng.basis,
      dueOdometerKm: null,
    },
  ];
}
