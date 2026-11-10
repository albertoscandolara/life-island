import { VEHICLE_OPTION_LABELS, type VehicleDto } from '@life-island/contracts';

const euro = (n: number | null) =>
  n === null
    ? 'unknown'
    : `${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/**
 * The car and its insurance history as the quote comparison reads them:
 * only what an insurer prices on (make, model, power, fuel, age, holder),
 * never the VIN or the holder's tax code and address.
 */
export function quoteDossier(vehicle: VehicleDto, note: string | null): string {
  const v = vehicle.values;
  const option = (value: unknown) =>
    value === null || value === undefined
      ? null
      : (VEHICLE_OPTION_LABELS[String(value)] ?? String(value));
  const lines: (string | null)[] = [
    `Car: ${[v.make, v.commercialName].filter(Boolean).join(' ') || 'unknown model'}, plate ${v.registrationNumber ?? 'unknown'}`,
    v.firstRegistrationDate
      ? `First registered: ${v.firstRegistrationDate}`
      : null,
    v['engine.maxNetPowerKw'] !== null
      ? `Power: ${v['engine.maxNetPowerKw']} kW`
      : null,
    v['engine.capacityCc'] !== null
      ? `Engine: ${v['engine.capacityCc']} cm³`
      : null,
    option(v['engine.fuelKey']) ? `Fuel: ${option(v['engine.fuelKey'])}` : null,
    option(v.useKey) ? `Use: ${option(v.useKey)}` : null,
    v['parties.holder.name'] ? `Holder: ${v['parties.holder.name']}` : null,
    vehicle.usage.kmPerYear !== null
      ? `Km a year: about ${vehicle.usage.kmPerYear}`
      : null,
    vehicle.usage.estimatedKm !== null
      ? `Odometer today: about ${vehicle.usage.estimatedKm} km`
      : null,
  ];
  const periods = vehicle.insurance.periods.filter((p) => !p.cancelled);
  if (periods.length) {
    lines.push('', 'Insurance history, newest first:');
    for (const p of periods)
      lines.push(
        `- ${p.insurer ?? 'Unknown insurer'}${p.number ? `, policy ${p.number}` : ''}: ${p.validFrom ?? '?'} to ${p.validUntil ?? '?'}, premium ${euro(p.premium)}, CU class ${p.cuClass ?? 'unknown'}, covers: ${p.coverages.length ? p.coverages.join(', ') : 'not read'}`,
      );
  } else lines.push('', 'No insurance on file in Life Island.');
  const claims = vehicle.insurance.periods.find(
    (p) => p.cuClassChange !== null && p.cuClassChange > 0,
  );
  if (claims)
    lines.push(
      `The CU class got worse at the renewal of ${claims.validFrom ?? 'one policy'}: a claim was charged.`,
    );
  if (note?.trim()) lines.push('', `My note: ${note.trim()}`);
  return lines.filter((l) => l !== null).join('\n');
}
