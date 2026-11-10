import type {
  CarCostDto,
  CarDocumentType,
  InsuranceHistoryDto,
  InsuranceNoteDto,
  InsurancePeriodDto,
} from '@life-island/contracts';
import type { ApprovedCarDocument, CarVersion } from './car-documents.js';

/** A rise above this, renewal on renewal, is worth comparing quotes for. */
export const PREMIUM_RISE_WARNING = 0.1;

const round = (n: number, digits = 2) =>
  Math.round(n * 10 ** digits) / 10 ** digits;

/** "furto e incendio" and "Furto e Incendio." are the same cover. */
function coverKey(cover: string): string {
  return cover
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function euro(n: number): string {
  return `€ ${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * The car's insurance policy after policy, newest first: what each one cost
 * (its payments, else the premium it prints), its bonus-malus class and its
 * covers, each against the one before. The notes say what the latest
 * renewal changed that is worth acting on.
 */
export function insuranceHistory<T extends ApprovedCarDocument>(
  series: readonly {
    type: CarDocumentType | null;
    versions: CarVersion<T>[];
  }[],
  costs: readonly CarCostDto[],
): InsuranceHistoryDto {
  const versions = [
    ...(series.find((s) => s.type === 'CAR_INSURANCE')?.versions ?? []),
  ].reverse();
  const periods: InsurancePeriodDto[] = [];
  let previous: InsurancePeriodDto | null = null;
  for (const { document, status } of versions) {
    const ids = new Set(document.members.map((m) => m.uploadId));
    const paid = costs.filter(
      (c) => c.kind === 'insurance' && ids.has(c.uploadId),
    );
    const premium = paid.length
      ? round(paid.reduce((sum, c) => sum + c.amount, 0))
      : document.reading.amount;
    const coverages = document.reading.coverages ?? [];
    const cancelled = status === 'cancelled';
    const period: InsurancePeriodDto = {
      uploadId: document.uploadId,
      insurer: document.reading.issuer,
      number: document.reading.number,
      validFrom: document.reading.validFrom,
      validUntil: document.reading.validUntil,
      premium,
      cuClass: document.reading.cuClass,
      coverages,
      premiumChange: null,
      cuClassChange: null,
      added: [],
      removed: [],
      cancelled,
    };
    if (previous && !cancelled) {
      if (premium !== null && previous.premium)
        period.premiumChange = round(
          (premium - previous.premium) / previous.premium,
          4,
        );
      if (period.cuClass !== null && previous.cuClass !== null)
        period.cuClassChange = period.cuClass - previous.cuClass;
      if (coverages.length && previous.coverages.length) {
        const before = new Set(previous.coverages.map(coverKey));
        const now = new Set(coverages.map(coverKey));
        period.added = coverages.filter((c) => !before.has(coverKey(c)));
        period.removed = previous.coverages.filter(
          (c) => !now.has(coverKey(c)),
        );
      }
    }
    periods.push(period);
    if (!cancelled) previous = period;
  }
  periods.reverse();
  return { periods, notes: insuranceNotes(periods) };
}

/** What the latest renewal changed that you may want to act on. */
export function insuranceNotes(
  periods: readonly InsurancePeriodDto[],
): InsuranceNoteDto[] {
  const counted = periods.filter((p) => !p.cancelled);
  const latest = counted[0];
  const before = counted[1];
  if (!latest) return [];
  const notes: InsuranceNoteDto[] = [];
  if (latest.cuClassChange !== null && latest.cuClassChange > 0)
    notes.push({
      tone: 'warning',
      text: `The bonus-malus class got worse, from ${before?.cuClass} to ${latest.cuClass}: a claim was charged to the policy. Check the attestato di rischio, and ask whether you can pay the claim back to keep the class.`,
    });
  else if (latest.cuClassChange !== null && latest.cuClassChange < 0)
    notes.push({
      tone: 'success',
      text: `The bonus-malus class improved, from ${before?.cuClass} to ${latest.cuClass}.`,
    });
  if (
    latest.premiumChange !== null &&
    latest.premium !== null &&
    before?.premium
  ) {
    const pct = Math.round(latest.premiumChange * 100);
    if (latest.premiumChange > PREMIUM_RISE_WARNING)
      notes.push({
        tone: 'warning',
        text: `The premium went up ${pct}% (${euro(before.premium)} → ${euro(latest.premium)})${
          latest.cuClassChange !== null && latest.cuClassChange <= 0
            ? ' with no worse class'
            : ''
        }${latest.added.length ? `, ${latest.added.length === 1 ? 'one cover was' : `${latest.added.length} covers were`} added` : ''}. Worth comparing quotes before the next renewal.`,
      });
    else if (latest.premiumChange < 0)
      notes.push({
        tone: 'success',
        text: `The premium went down ${Math.abs(pct)}% (${euro(before.premium)} → ${euro(latest.premium)}).`,
      });
  }
  if (latest.removed.length)
    notes.push({
      tone: 'warning',
      text: `No longer covered: ${latest.removed.join(', ')}.`,
    });
  if (latest.added.length)
    notes.push({
      tone: 'info',
      text: `New covers: ${latest.added.join(', ')}.`,
    });
  if (
    before &&
    latest.insurer &&
    before.insurer &&
    coverKey(latest.insurer) !== coverKey(before.insurer)
  )
    notes.push({
      tone: 'info',
      text: `You moved from ${before.insurer} to ${latest.insurer}.`,
    });
  return notes;
}
