import type {
  CarDocumentType,
  CarOwnershipDto,
  CarOwnershipEventDto,
  VehicleField,
  VehicleValue,
} from '@life-island/contracts';
import type { ApprovedCarDocument, CarVersion } from './car-documents.js';

/*
 * Who owns a car (docs/guides/life-island-app.md, Cars, "Ownership"): the
 * latest certificato di proprietà, PRA receipt or sale on file names the
 * owners and the day they became owners; every one before it that names
 * someone else, or records a sale, is a change of owner in the car's history,
 * which starts at its first registration. When the libretto names another
 * holder than the latest owners, the carta di circolazione has to follow.
 * Pure, so every rule is unit-tested.
 */

type Series<T extends ApprovedCarDocument> = readonly {
  type: CarDocumentType | null;
  versions: CarVersion<T>[];
}[];

/** A name as compared: its words, upper-case, in any order ("Rossi Mario" is "MARIO ROSSI"). */
export function nameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

const sameOwners = (a: readonly string[], b: readonly string[]) =>
  a.map(nameKey).sort().join('|') === b.map(nameKey).sort().join('|');

/** The car's ownership, or null when no ownership document is on file. */
export function ownershipOf<T extends ApprovedCarDocument>(
  values: Partial<Record<VehicleField, VehicleValue>>,
  series: Series<T>,
): CarOwnershipDto | null {
  // Newest first, like the series; a cancelled one never counts.
  const records = (
    series.find((s) => s.type === 'VEHICLE_OWNERSHIP')?.versions ?? []
  )
    .filter((v) => v.status !== 'cancelled')
    .map((v) => v.document);
  if (!records.length) return null;

  const events: CarOwnershipEventDto[] = [];
  const first = values.firstRegistrationDate;
  if (typeof first === 'string')
    events.push({
      date: first,
      kind: 'registered',
      owners: [],
      seller: null,
      uploadId: null,
    });
  let owners: string[] | null = null;
  for (const record of [...records].reverse()) {
    const reading = record.reading.ownership;
    const named = reading?.owners ?? [];
    const sold = reading?.kind === 'sale' || reading?.kind === 'transfer';
    const changed =
      named.length > 0 && (owners === null || !sameOwners(named, owners));
    if (sold || changed)
      events.push({
        date: record.reading.validFrom,
        kind: reading?.kind ?? 'other',
        owners: named,
        seller: reading?.seller ?? null,
        uploadId: record.uploadId,
      });
    if (named.length) owners = named;
  }

  const latest = records[0];
  const reading = latest.reading.ownership;
  // The owners: the latest record that names any.
  const named =
    records.find((r) => r.reading.ownership?.owners.length)?.reading.ownership
      ?.owners ?? [];
  // What the current owners' own documents print (not a seller's old certificate).
  const theirs = records.filter((r) => {
    const own = r.reading.ownership?.owners ?? [];
    return !own.length || sameOwners(own, named);
  });
  const holder =
    typeof values['parties.holder.name'] === 'string'
      ? values['parties.holder.name']
      : null;
  const holderDiffers =
    holder && named.length && !named.some((o) => nameKey(o) === nameKey(holder))
      ? holder
      : null;
  const since =
    [...events].reverse().find((e) => e.kind !== 'registered')?.date ??
    latest.reading.validFrom;
  return {
    owners: named,
    since,
    previousOwners:
      theirs.find((r) => r.reading.ownership?.previousOwners != null)?.reading
        .ownership?.previousOwners ?? null,
    liens: reading?.liens ?? null,
    noLiens: reading?.noLiens ?? false,
    certificateNumber:
      theirs.find((r) => r.reading.ownership?.kind === 'certificate')?.reading
        .number ?? null,
    accessCode:
      theirs.find((r) => r.reading.ownership?.accessCode)?.reading.ownership
        ?.accessCode ?? null,
    holderDiffers,
    events,
  };
}
