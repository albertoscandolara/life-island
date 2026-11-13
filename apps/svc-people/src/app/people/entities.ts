import {
  cleanAliases,
  entityKey,
  identifiesSomeone,
  type EntityRefDto,
  type PeopleOverviewDto,
  type PersonValues,
} from '@life-island/contracts';

/** "Mario Rossi", from what is known; null when nothing is. */
function nameOf(
  person: Pick<PersonValues, 'firstName' | 'lastName'>,
): string | null {
  return [person.firstName, person.lastName].filter(Boolean).join(' ') || null;
}

/**
 * The people of People (`GET /entities`): everyone you have, found by name
 * either way round and by tax code, and each new person an ID document
 * suggests (pending until you approve its review).
 */
export function peopleEntities(overview: PeopleOverviewDto): EntityRefDto[] {
  const confirmed = overview.people.map((p): EntityRefDto => {
    const name = nameOf(p) ?? p.taxCode ?? 'Unnamed person';
    return {
      kind: 'person',
      id: p.id,
      name,
      status: 'confirmed',
      detail: p.taxCode,
      aliases: cleanAliases(name, [
        p.lastName && p.firstName ? `${p.lastName} ${p.firstName}` : null,
        p.taxCode,
      ]),
    };
  });
  const seen = new Set(
    confirmed.flatMap((e) => [e.name, ...e.aliases].map(entityKey)),
  );
  const pending: EntityRefDto[] = [];
  for (const review of overview.reviews) {
    if (review.personId || !identifiesSomeone(review.holder)) continue;
    const name = nameOf(review.holder) ?? review.holder.taxCode ?? '';
    const key = entityKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    pending.push({
      kind: 'person',
      id: review.uploadId,
      name,
      status: 'pending',
      detail: 'New person read from an ID document',
      aliases: cleanAliases(name, [
        review.holder.lastName && review.holder.firstName
          ? `${review.holder.lastName} ${review.holder.firstName}`
          : null,
        review.holder.taxCode,
      ]),
    });
  }
  return [...confirmed, ...pending];
}
