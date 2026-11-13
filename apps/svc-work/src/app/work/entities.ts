import {
  cleanAliases,
  entityKey,
  type EntityRefDto,
  type WorkOverviewDto,
} from '@life-island/contracts';

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/**
 * The workplaces of Work (`GET /entities`): each one found by its name or its
 * employer's name and tax code, and each new employer a work document
 * suggests (pending until you approve its review).
 */
export function workEntities(overview: WorkOverviewDto): EntityRefDto[] {
  const confirmed = overview.workplaces.map((w): EntityRefDto => {
    const employer = text(w.values.employerName);
    const name = w.label || employer || 'Unnamed workplace';
    return {
      kind: 'workplace',
      id: w.id,
      name,
      status: 'confirmed',
      detail: employer && employer !== name ? employer : null,
      aliases: cleanAliases(name, [employer, text(w.values.employerTaxCode)]),
    };
  });
  const seen = new Set(
    confirmed.flatMap((e) => [e.name, ...e.aliases].map(entityKey)),
  );
  const pending: EntityRefDto[] = [];
  for (const review of overview.reviews) {
    if (review.workplaceId || !review.employerName) continue;
    const key = entityKey(review.employerName);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    pending.push({
      kind: 'workplace',
      id: review.uploadId,
      name: review.employerName,
      status: 'pending',
      detail: 'New workplace read from a work document',
      aliases: cleanAliases(review.employerName, [review.employerTaxCode]),
    });
  }
  return [...confirmed, ...pending];
}
