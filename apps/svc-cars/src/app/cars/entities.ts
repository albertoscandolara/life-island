import {
  cleanAliases,
  entityKey,
  identifiesVehicle,
  type CarsOverviewDto,
  type EntityRefDto,
} from '@life-island/contracts';

/** "Fiat Punto · EJ560PZ": your name for the car, else make and model, with the plate. */
function carName(
  label: string | null,
  make: unknown,
  model: unknown,
  plate: unknown,
): string {
  const named =
    label ||
    [make, model].filter((v) => typeof v === 'string' && v).join(' ') ||
    null;
  return (
    [named, typeof plate === 'string' ? plate : null]
      .filter(Boolean)
      .join(' · ') || 'Unnamed car'
  );
}

/**
 * The cars of Cars (`GET /entities`): every car you have, found by plate
 * (also inside a longer text, "Fiat Punto EJ560PZ") or VIN, and each new car
 * a document suggests (pending until you approve its review).
 */
export function carEntities(overview: CarsOverviewDto): EntityRefDto[] {
  const confirmed = overview.vehicles.map((v): EntityRefDto => {
    const plate = v.values.registrationNumber;
    const name = carName(
      v.label,
      v.values.make,
      v.values.commercialName,
      plate,
    );
    const model = [v.values.make, v.values.commercialName]
      .filter(Boolean)
      .join(' ');
    return {
      kind: 'vehicle',
      id: v.id,
      name,
      status: 'confirmed',
      detail: typeof plate === 'string' ? plate : null,
      aliases: cleanAliases(name, [
        typeof plate === 'string' ? plate : null,
        typeof v.values.vin === 'string' ? v.values.vin : null,
        model && typeof plate === 'string' ? `${model} ${plate}` : null,
      ]),
    };
  });
  const seen = new Set(confirmed.flatMap((e) => e.aliases.map(entityKey)));
  const pending: EntityRefDto[] = [];
  for (const review of overview.reviews) {
    if (review.vehicleId || !identifiesVehicle(review)) continue;
    const key = entityKey(review.registrationNumber ?? review.vin ?? '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const name = carName(
      null,
      review.make,
      review.commercialName,
      review.registrationNumber,
    );
    pending.push({
      kind: 'vehicle',
      id: review.uploadId,
      name,
      status: 'pending',
      detail: 'New car read from a document',
      aliases: cleanAliases(name, [review.registrationNumber, review.vin]),
    });
  }
  return [...confirmed, ...pending];
}
